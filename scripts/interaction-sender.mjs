import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {spawn} from 'node:child_process';
import {TextDeliveryStore} from './text-delivery-store.mjs';
export const interactionSettings=wechat=>({enabled:wechat?.interactions?.enabled===true,quote:wechat?.interactions?.quote===true,pat:wechat?.interactions?.pat===true});
export function interactionPython(root){
 const directory=path.resolve(root,'../runtimes'),file=path.join(root,'config/distribution.json'),build=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{};
 const candidates=[process.env.WECHATAGENT_PYTHON,build.python,path.join(directory,build.runtimeRevision??'','python/python.exe')].filter(value=>typeof value==='string'&&path.isAbsolute(value)&&fs.existsSync(value));
 if(candidates.length)return candidates[0];
 const versions=fs.existsSync(directory)?fs.readdirSync(directory).filter(name=>/^[0-9][A-Za-z0-9_.-]*$/.test(name)).sort().reverse():[];
 for(const version of versions){const file=path.join(directory,version,'python/python.exe');if(fs.existsSync(file))return file;}
 throw Error('INTERACTION_PYTHON_UNAVAILABLE');
}
export function runInteraction(root,value,{probe=false,script='wechat_interaction_service.py'}={}){return new Promise((resolve,reject)=>{
 let executable;try{executable=interactionPython(root);}catch(error){reject(error);return;}
 const child=spawn(executable,[path.join(root,'scripts',script),'--root',root,...(probe?['--probe']:[])],{windowsHide:true});let output='',settled=false;
 const done=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(result);};
 const timer=setTimeout(()=>{child.kill();done(Error('INTERACTION_CALL_UNCONFIRMED'));},26000);
 child.stdout.on('data',chunk=>{output+=chunk;if(output.length>12000){child.kill();done(Error('INTERACTION_OUTPUT_INVALID'));}});child.stderr.resume();child.on('error',()=>done(Error('INTERACTION_PROCESS_FAILED')));
 child.on('close',()=>{try{const result=JSON.parse(output.trim());if(result.ok===false)done(Error(/^INTERACTION_[A-Z_]+$/.test(result.error)?result.error:'INTERACTION_UNAVAILABLE'));else done(null,result);}catch{done(Error('INTERACTION_OUTPUT_INVALID'));}});
 child.stdin.end(probe?'':JSON.stringify(value));
});}
export const runMention=(root,value,options={})=>runInteraction(root,value,{...options,script:'wechat_mention_native.py'});
export class InteractionSender{
 constructor(adapter,{run=runInteraction,now=Date.now}={}){this.adapter=adapter;this.run=run;this.now=now;this.store=new TextDeliveryStore(path.join(adapter.directory,'state/interaction-deliveries'));}
 recentPats(account,wxid){return fs.existsSync(this.store.directory)?fs.readdirSync(this.store.directory).filter(name=>/^[a-f0-9]{64}\.json$/.test(name)).flatMap(name=>{const item=this.store.get(name.slice(0,-5));return item?.account===account&&item.wxid===wxid&&item.action==='pat'&&item.state!=='rejected'&&this.now()-item.startedAt<3600000?[item]:[];}):[];}
 async capabilities(kind,target){
  const a=this.adapter;a.reload();const settings=interactionSettings(a.project.wechat);if(!settings.enabled||!a.allowed(kind,target))return {quote:false,pat:false};
  const identity=await a.checkNative(),mention=kind==='group'&&a.status?.native_mention_send===true?{mention:true}:{};
  if(!this.cache||this.now()-this.cache.at>=30000){let info;try{info=await this.run(a.directory,null,{probe:true});}catch{info={};}this.cache={at:this.now(),ready:info.ready===true&&info.managerReady===true,quote:info.backend==='native-interaction-service-v1'&&info.capabilities?.quote===true&&info.capabilities?.senderEcho===true,pat:info.capabilities?.pat===true};}
  if(!this.cache.ready)return {quote:false,pat:false,...mention};
  const wxid=await a.resolveTarget(kind,target),recent=this.recentPats(identity.account,wxid);
  return {quote:settings.quote&&this.cache.quote,pat:settings.pat&&this.cache.pat&&recent.length<2&&!recent.some(item=>this.now()-item.startedAt<600000),...mention};
 }
 async send(kind,target,interaction,deliveryId){
  const a=this.adapter,fail=(code,data={})=>a.voiceFail(code,data);
  if(interaction?.action==='mention')return a.send(kind,target,interaction.text,deliveryId,undefined,interaction.reference);
  if(!/^[a-f0-9]{64}$/.test(deliveryId??'')||!interaction||!['quote','pat'].includes(interaction.action)||!/^[a-f0-9]{64}$/.test(interaction.reference??'')||typeof interaction.text!=='string'||interaction.text.length>4000||interaction.action==='quote'&&!interaction.text.trim()||interaction.action==='pat'&&interaction.text)fail('INTERACTION_REQUEST_INVALID',{attempted:false});
  const busy=kind+':'+target;if(a.targetsSending.has(busy))fail('SENDER_BUSY',{attempted:false});a.targetsSending.add(busy);
  try{
   const identity=await a.checkNative(),wxid=await a.resolveTarget(kind,target);a.reload();const settings=interactionSettings(a.project.wechat);
   if(!a.allowed(kind,target)||!settings.enabled||!settings[interaction.action])fail('INTERACTION_DISABLED',{attempted:false});
   const encoded=JSON.stringify(interaction),key=this.store.key(kind,target,deliveryId,encoded),saved=this.store.get(key);
   if(saved){if(saved.account!==identity.account||saved.wxid!==wxid||saved.text!==encoded)fail('INTERACTION_DELIVERY_CONFLICT',{attempted:false});if(saved.state==='confirmed')return {...saved.response,reused:true};if(saved.state==='rejected')fail('INTERACTION_REJECTED',{attempted:false});fail('TEXT_DELIVERY_UNCONFIRMED',{attempted:true});}
   const rows=await a.messages(wxid),row=rows.find(row=>row.wechatagentMessageId===interaction.reference),sender=row?.pat?.actor??row?.senderUsername;
   if(!row||row.isSend||!sender||sender===a.ownWxid||!Number.isFinite(Number(row.createTime))||Number(row.createTime)>this.now()/1000+60||this.now()/1000-Number(row.createTime)>3600)fail('INTERACTION_REFERENCE_UNAVAILABLE',{attempted:false});
   const request={action:interaction.action,self:a.ownWxid,account:identity.account,chat:wxid,target:sender,referenceId:interaction.reference,text:interaction.text,conversationKind:kind,conversationTarget:String(target)};
   if(interaction.action==='quote'){
    const content=String(row.fullText??row.content??'');if(Number(row.localType)!==1||!content.trim()||content.length>4000||!/^[1-9]\d{0,19}$/.test(String(row.serverId)))fail('INTERACTION_REFERENCE_UNAVAILABLE',{attempted:false});
   }else{
    if(interaction.text)fail('INTERACTION_REQUEST_INVALID',{attempted:false});
    const recent=this.recentPats(identity.account,wxid);
    if(recent.length>=2||recent.some(item=>this.now()-item.startedAt<600000))fail('INTERACTION_PAT_COOLDOWN',{attempted:false});
   }
   const attempt={version:1,key,deliveryId,account:identity.account,wxid,text:encoded,action:interaction.action,baseline:[],startedAt:this.now(),state:'dispatching'};this.store.put(attempt);
   let result;try{result=await this.run(a.directory,request);}catch{attempt.state='unconfirmed';this.store.put(attempt);fail('TEXT_DELIVERY_UNCONFIRMED',{attempted:true});}
   if(result.attempted!==true||result.responseReady===true&&result.ret!==0){attempt.state='rejected';this.store.put(attempt);fail('INTERACTION_REJECTED',{attempted:false});}
   if(result.responseReady!==true||result.ret!==0||interaction.action==='quote'&&!/^[1-9]\d{0,19}$/.test(result.serverMessageId??'')){attempt.state='unconfirmed';this.store.put(attempt);fail('TEXT_DELIVERY_UNCONFIRMED',{attempted:true});}
   attempt.state='confirmed';attempt.confirmedAt=this.now();attempt.response={receipt:interaction.action==='quote'?'wechat-server-id':'wechat-server-ack',...(result.serverMessageId?{message_id:result.serverMessageId}:{}),delivered:'server-confirmed',media_type:interaction.action==='quote'?'wechat-quote':'wechat-pat'};this.store.put(attempt);return attempt.response;
  }finally{a.targetsSending.delete(busy);}
 }
}
