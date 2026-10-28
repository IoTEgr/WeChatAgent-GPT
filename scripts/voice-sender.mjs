import {ChatParticipation} from '../components/qq-bridge/src/core/chat-participation.js';
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {spawn} from 'node:child_process';import {setTimeout as sleep} from 'node:timers/promises';
import {TextDeliveryStore} from './text-delivery-store.mjs';import {voiceRequest,VOICE_TIMING} from '../components/qq-bridge/src/core/voice-protocol.js';
import {conversationVoiceRequest} from './voice-context.mjs';
import {validVoiceObservations} from '../components/qq-bridge/src/core/voice-images.js';
export function inspectVoiceFile(root,file){
 const scope=fs.realpathSync(root),actual=fs.realpathSync(file),relative=path.relative(scope,actual);
 if(relative.startsWith('..')||path.isAbsolute(relative)||!/\.(?:silk|slk)$/i.test(actual))throw Error('VOICE_PATH_INVALID');
 const stat=fs.statSync(actual);if(!stat.isFile()||stat.size<26||stat.size>4*1024*1024)throw Error('VOICE_FILE_INVALID');
 const bytes=fs.readFileSync(actual);if(!bytes.subarray(0,10).equals(Buffer.from('\x02#!SILK_V3')))throw Error('VOICE_FORMAT_INVALID');
 let cursor=10,frames=0;while(cursor<bytes.length){if(cursor+2>bytes.length)throw Error('VOICE_FORMAT_INVALID');const size=bytes.readUInt16LE(cursor);cursor+=2;if(!size||cursor+size>bytes.length)throw Error('VOICE_FORMAT_INVALID');cursor+=size;frames++;}
 if(!frames||frames>3000)throw Error('VOICE_DURATION_INVALID');return {path:actual,durationMs:Math.max(1000,frames*20),sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
}
export function synthesizeVoice(adapter,text){return new Promise((resolve,reject)=>{
 const conversation=typeof text==='object'&&text?.mode==='conversation';
 const dir=path.join(adapter.directory,'state/voice-out');fs.mkdirSync(dir,{recursive:true});const input=path.join(dir,crypto.randomUUID()+(conversation?'.json':'.txt'));fs.writeFileSync(input,conversation?JSON.stringify(text):text,{mode:0o600});
 const child=spawn(process.execPath,[path.join(adapter.directory,'scripts/tts/say.mjs'),conversation?'--request-file':'--text-file',input],{windowsHide:true});let output='',done=false;
 const finish=(error,result)=>{if(done)return;done=true;clearTimeout(timer);try{fs.unlinkSync(input);}catch{}error?reject(error):resolve(result);};
 const timer=setTimeout(()=>{child.kill();finish(Error('VOICE_TTS_TIMEOUT'));},VOICE_TIMING.synthesisMs);
 child.on('error',()=>finish(Error('VOICE_TTS_FAILED')));child.stdout.on('data',chunk=>{output+=chunk;if(output.length>65536){child.kill();finish(Error('VOICE_TTS_BAD_OUTPUT'));}});child.stderr.resume();
 child.on('close',code=>{if(done)return;try{const info=JSON.parse(output.trim().split(/\r?\n/).at(-1));if(code!==0||info.ok!==true){finish(Error(/^VOICE_[A-Z_]+$/.test(info?.error??'')?info.error:'VOICE_TTS_FAILED'));return;}if(conversation&&(typeof info.transcript!=='string'||!info.transcript.trim()||info.transcript.length>800))throw Error('VOICE_LIVE_TRANSCRIPT_INVALID');finish(null,{...inspectVoiceFile(adapter.directory,info.path),...(typeof info.transcript==='string'?{transcript:info.transcript}:{}),mode:conversation?'conversation':'read'});}catch{finish(Error('VOICE_TTS_FAILED'));}});
});}
export class VoiceSender{
 constructor(adapter,{synthesize=synthesizeVoice}={}){this.adapter=adapter;this.synthesize=synthesize;this.store=new TextDeliveryStore(path.join(adapter.directory,'state/voice-deliveries'));}
 async health(){const a=this.adapter;const url=new URL(a.hook.baseUrl);url.port=String(Number(url.port||80)+1);return a.json(url.origin,'/health',{headers:{Authorization:'Bearer '+a.nativeToken}},1500);}
 async send(kind,target,marker,deliveryId,proactive,anchor,visualFacts=[]){
 const a=this.adapter,request=voiceRequest(marker),lock=kind+':'+target;if(a.targetsSending.has(lock)||a.targetsSending.size>=(a.hook.maxConcurrentSends??4))a.voiceFail('SENDER_BUSY');
 a.targetsSending.add(lock);
 try{
  a.reload();if(a.project.wechat?.voice?.enabled!==true||!a.allowed(kind,target))a.voiceFail('VOICE_NOT_ALLOWED');
  const identity=await a.checkNative(),wxid=await a.resolveTarget(kind,target),key=this.store.key(kind,target,deliveryId,marker);let attempt=this.store.get(key);
  if(attempt&&(attempt.account!==identity.account||attempt.wxid!==wxid||attempt.text!==marker))a.voiceFail('VOICE_DELIVERY_ID_CONFLICT');
  if(attempt?.anchor&&attempt.anchor!==anchor)a.voiceFail('VOICE_DELIVERY_ID_CONFLICT');
  if(attempt?.proactiveContextId&&attempt.proactiveContextId!==proactive?.contextId)a.voiceFail('VOICE_DELIVERY_ID_CONFLICT');
  if(attempt?.state==='confirmed')return {...attempt.response,reused:true};
  if(attempt?.state==='rejected')a.voiceFail(attempt.rejection?.code??'NATIVE_SEND_REJECTED',{attempted:false});
  if(!attempt){
   const participationFile=path.join(a.directory,'state/social-messages.json.participation.json'),participationKey='wechat:'+kind+':'+target,gate=new ChatParticipation(participationFile),speechEpoch=gate.epoch(participationKey,identity.selfId);
   if(gate.quiet(participationKey,identity.selfId))a.voiceFail('VOICE_CHAT_PAUSED',{attempted:false,phase:'voice-control'});
   if(proactive)a.assertProactive(kind,target,await a.messages(wxid),proactive,identity,wxid);
   const health=await this.health().catch(()=>null);a.status.native_voice_send=health?.ready===true&&(!health.version||health.version===a.hook.expectedVersion);
   if(!a.status.native_voice_send)a.voiceFail('VOICE_SENDER_UNAVAILABLE');
   let audio,verified;
   try{
    let input=request.text;
    if(request.mode==='conversation'||a.project.wechat.voice.replyMode==='conversation'){
     if(!validVoiceObservations(visualFacts))throw Error('VOICE_IMAGE_CONTEXT_INVALID');
     for(const fact of visualFacts){
      const resource=await a.reader('/api/v1/images/'+fact.id);
      if(resource.imageId!==fact.id||resource.conversationKey!=='wechat:'+kind+':'+target)throw Error('VOICE_IMAGE_CONTEXT_INVALID');
     }
     const rows=await a.messages(wxid,300),previousVoices=fs.existsSync(this.store.directory)?fs.readdirSync(this.store.directory).filter(n=>/^[a-f0-9]{64}\.json$/.test(n)).map(n=>this.store.get(n.slice(0,-5))).filter(v=>v?.wxid===wxid&&v.account===identity.account):[];
     input=conversationVoiceRequest(a,{kind,target,anchor,summary:request.summary??'',identity,rows,previousVoices,visualFacts,proactive});
    }
    audio=await this.synthesize(a,input);verified=inspectVoiceFile(a.directory,audio.path);
    if(typeof input==='object'&&(typeof audio.transcript!=='string'||!audio.transcript.trim()||audio.transcript.length>800))throw Error('VOICE_LIVE_TRANSCRIPT_INVALID');
   }
   catch(error){
    const code=/^VOICE_[A-Z_]+$/.test(error?.message??'')?error.message:'VOICE_TTS_FAILED';
    try{fs.writeFileSync(path.join(a.directory,'state/voice-health.json'),JSON.stringify({at:Date.now(),phase:'voice-synthesis',code,attempted:false}));}catch{}
    a.voiceFail(code,{attempted:false,phase:'voice-synthesis'});
   }
   // Synthesis can take seconds: recheck account, scope and proactive context before submission.
   const latestGate=new ChatParticipation(participationFile);if(latestGate.quiet(participationKey,identity.selfId)||latestGate.epoch(participationKey,identity.selfId)!==speechEpoch)a.voiceFail('VOICE_CHAT_PAUSED',{attempted:false,phase:'voice-control'});
   a.reload();const latest=await a.checkNative();if(latest.account!==identity.account||!a.allowed(kind,target)||a.project.wechat?.voice?.enabled!==true)a.voiceFail('VOICE_ACCOUNT_CHANGED');
   const rows=await a.messages(wxid);if(proactive)a.assertProactive(kind,target,rows,proactive,identity,wxid);
   const submissionGate=new ChatParticipation(participationFile);if(submissionGate.quiet(participationKey,identity.selfId)||submissionGate.epoch(participationKey,identity.selfId)!==speechEpoch)a.voiceFail('VOICE_CHAT_PAUSED',{attempted:false,phase:'voice-control'});
   attempt={version:1,key,text:marker,deliveryId:deliveryId??'',account:identity.account,wxid,baseline:rows.map(row=>String(row.localId)).filter(id=>/^\d+$/.test(id)),startedAt:Date.now(),state:'dispatching',audio:verified,...(audio.transcript?{spokenText:audio.transcript}:{}),...(anchor?{anchor}:{}),...(proactive?{proactiveContextId:proactive.contextId}:{})};this.store.put(attempt);
   const url=new URL(a.hook.baseUrl);url.port=String(Number(url.port||80)+1);let result;
   try{result=await a.json(url.origin,'/SendVoiceMsg',{method:'POST',headers:{Authorization:'Bearer '+a.nativeToken,'Content-Type':'application/json','X-WeChatAgent-Account':identity.account},body:JSON.stringify({wxidorgid:wxid,path:verified.path,duration:verified.durationMs})},a.hook.requestTimeoutMs??5000);}
   catch(error){if(/^API_HTTP_(400|401|403|409|429)$/.test(error.message)){attempt.state='rejected';attempt.rejection={code:error.message,at:Date.now()};this.store.put(attempt);a.voiceFail(error.message,{attempted:false});}attempt.state='unconfirmed';this.store.put(attempt);a.voiceFail('TEXT_DELIVERY_UNCONFIRMED',{attempted:true});}
   if(result?.ret!==0){attempt.state='rejected';attempt.rejection={code:'NATIVE_SEND_REJECTED',at:Date.now()};this.store.put(attempt);a.voiceFail('NATIVE_VOICE_REJECTED',{attempted:false});}
   attempt.state='accepted';this.store.put(attempt);
  }
  const deadline=Date.now()+(a.receiptOverride??a.hook.receiptTimeoutMs??18000);
  do{
   const rows=await a.messages(wxid);const candidates=rows.filter(row=>row.isSend&&row.localType===34&&!attempt.baseline.includes(String(row.localId))&&Number(row.createTime)>=Math.floor(attempt.startedAt/1000)-2&&Number.isSafeInteger(Number(row.localId))&&Number(row.localId)>0).sort((x,y)=>Number(x.localId)-Number(y.localId));
   if(!attempt.candidateId&&candidates.length){attempt.candidateId=String(candidates[0].localId);this.store.put(attempt);}
   const row=candidates.find(row=>String(row.localId)===attempt.candidateId);if(row&&/^\d{1,32}$/.test(String(row.serverId))&&BigInt(row.serverId)>0n){attempt.state='confirmed';attempt.confirmedAt=Date.now();attempt.response={message_id:Number(row.localId),receipt:'wechat-server-id',delivered:'database-confirmed',media_type:'wechat-voice',...(attempt.spokenText?{spoken_text:attempt.spokenText}:{})};this.store.put(attempt);a.status.confirmed_sends++;return attempt.response;}
   await sleep(a.pollMs);
  }while(Date.now()<deadline&&!a.stopped);
  attempt.state='unconfirmed';this.store.put(attempt);a.voiceFail('TEXT_DELIVERY_UNCONFIRMED',{attempted:true,delivery_id:deliveryId??key});
 }finally{a.targetsSending.delete(lock);}
 }
}
