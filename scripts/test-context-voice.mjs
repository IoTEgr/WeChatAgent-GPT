import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {voiceRequest,voiceText} from '../components/qq-bridge/src/core/voice-protocol.js';import {parseSocialDecision} from '../components/qq-bridge/src/core/decision-format.js';
import {conversationVoiceRequest} from './voice-context.mjs';import {VoiceSender} from './voice-sender.mjs';import {HookOneBot} from './hook-onebot.mjs';
import {SocialEngine} from '../components/qq-bridge/src/core/social-engine.js';import {MessageBuffer} from '../components/qq-bridge/src/core/message-buffer.js';
const anchor='a'.repeat(64),delivery='b'.repeat(64),marker='[语音回复:群友拿摸鱼打趣，是熟人间的玩笑]',answer='哈哈，我这是被工作钓起来了。';
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'context-voice-'));for(const dir of ['roles','state/voice-out'])fs.mkdirSync(path.join(root,dir),{recursive:true});fs.writeFileSync(path.join(root,'roles/大肥鱼.md'),'# 大肥鱼\n你机灵，有主见。\n## 发送格式\n[语音回复:摘要]');
 const audio=path.join(root,'state/voice-out/sample.silk');fs.writeFileSync(audio,Buffer.concat([Buffer.from('\x02#!SILK_V3'),...Array.from({length:50},()=>Buffer.from([2,0,1,2]))]));
 const created=Math.floor(Date.now()/1000),rows=[{wechatagentMessageId:'c'.repeat(64),localId:1,localType:1,isSend:true,createTime:created-2,fullText:'摸鱼五分钟'},{wechatagentMessageId:anchor,localId:2,localType:1,isSend:false,createTime:created-1,senderName:'群友甲',fullText:'你这鱼怎么越摸越忙呀'},{wechatagentMessageId:'d'.repeat(64),localId:3,localType:1,isSend:false,createTime:created,fullText:'后到的消息不应混入这一条回复'}];let sends=0,syntheses=0,captured;
 const adapter={directory:root,project:{persona:{default:'大肥鱼'},wechat:{voice:{enabled:true,replyMode:'conversation'}}},hook:{baseUrl:'http://127.0.0.1:30001',expectedVersion:'4.1.10.27'},nativeToken:'fixture',status:{confirmed_sends:0},targetsSending:new Set(),reload(){},allowed:()=>true,checkNative:async()=>({account:'account-a'}),resolveTarget:async()=> 'room@chatroom',messages:async()=>structuredClone(rows),pollMs:1,receiptOverride:20,voiceFail(code,data){throw Object.assign(Error(code),{code,data});},json:async(_base,route)=>{if(route==='/health')return {ready:true};sends++;rows.push({isSend:true,localType:34,localId:4,serverId:'12345',createTime:Date.now()/1000});return {ret:0};}};
 const sender=new VoiceSender(adapter,{synthesize:async(_adapter,input)=>{syntheses++;captured=input;return {path:audio,transcript:answer};}});t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return {root,adapter,sender,rows,get sends(){return sends;},get syntheses(){return syntheses;},get captured(){return captured;}};
}
test('context voice carries an understanding summary rather than a script and rejects mixed visible prose',()=>{
 assert.deepEqual(voiceRequest(marker),{mode:'conversation',summary:'群友拿摸鱼打趣，是熟人间的玩笑'});assert.throws(()=>voiceText(marker));assert.equal(parseSocialDecision('RESPOND: '+marker).decision,'RESPOND');assert.equal(parseSocialDecision('RESPOND: 看这里'+marker).decision,'INVALID');
});
test('the conversation is anchored to the actual incoming row and strips sender protocol from persona',t=>{
 const f=fixture(t),input=conversationVoiceRequest(f.adapter,{kind:'group',target:'123',anchor,summary:'玩笑',identity:{account:'account-a'},rows:f.rows});assert.equal(input.messages.length,2);assert.equal(input.replyTo.text,'你这鱼怎么越摸越忙呀');assert(!input.persona.includes('语音回复'));assert(!JSON.stringify(input).includes('后到的消息'));assert.throws(()=>conversationVoiceRequest(f.adapter,{kind:'group',target:'123',anchor:'e'.repeat(64),identity:{account:'account-a'},rows:f.rows}),/ANCHOR_UNAVAILABLE/);
});
test('voice sender lets Live author its answer, stores its actual transcript, and reuses a receipt without generating again',async t=>{
 const f=fixture(t),receipt=await f.sender.send('group','123',marker,delivery,null,anchor);assert.equal(f.captured.mode,'conversation');assert(!Object.hasOwn(f.captured,'script'));assert.equal(receipt.spoken_text,answer);assert.equal(f.sends,1);assert.equal((await f.sender.send('group','123',marker,delivery,null,anchor)).reused,true);assert.equal(f.syntheses,1);await assert.rejects(f.sender.send('group','123',marker,delivery,null,'d'.repeat(64)),/CONFLICT/);
});
test('legacy model-written voice text is discarded when conversation mode is selected',async t=>{
 const f=fixture(t);await f.sender.send('group','123','[语音TTS:这段拟好的台词不应传给Live]',delivery,null,anchor);assert.equal(f.captured.mode,'conversation');assert(!JSON.stringify(f.captured).includes('这段拟好的台词'));assert.equal(f.captured.summary,'');
});
test('a missing context anchor cannot turn a summary into a chat message or submit any voice',async t=>{
 const f=fixture(t);await assert.rejects(f.sender.send('group','123',marker,delivery),e=>e.code==='VOICE_CONTEXT_ANCHOR_REQUIRED'&&e.data?.attempted===false);assert.equal(f.sends,0);assert.equal(f.syntheses,0);
});

test('image observations reach Live as facts, not a dictated answer, after chat scope verification',async t=>{
 const f=fixture(t),id='e'.repeat(64),messageId='f'.repeat(64),description='黑猫蹲在纸箱里，纸箱写着禁止加班';
 f.rows.unshift({wechatagentMessageId:messageId,localId:0,localType:3,isSend:false,createTime:f.rows[0].createTime-1});
 f.adapter.reader=async route=>{assert.equal(route,'/api/v1/images/'+id);return {imageId:id,conversationKey:'wechat:group:123'};};
 await f.sender.send('group','123',marker,delivery,null,anchor,[{id,messageId,ref:'I1',description}]);
 assert.equal(f.captured.visualFacts[0].description,description);assert(!Object.hasOwn(f.captured,'script'));assert.equal(f.sends,1);
});

test('cross-chat image observations cannot generate or send voice',async t=>{
 const f=fixture(t),id='e'.repeat(64);f.adapter.reader=async()=>({imageId:id,conversationKey:'wechat:group:456'});
 await assert.rejects(f.sender.send('group','123',marker,delivery,null,anchor,[{id,messageId:'f'.repeat(64),ref:'I1',description:'别的群的图'}]),e=>e.code==='VOICE_IMAGE_CONTEXT_INVALID'&&e.data?.attempted===false);
 assert.equal(f.sends,0);assert.equal(f.syntheses,0);
});

test('scheduled voice accepts old history without inventing a fresh incoming message or anchor',async t=>{
 const f=fixture(t),contextId='e'.repeat(64);for(const row of f.rows)row.createTime-=4*86400;f.rows.at(-1).isSend=true;
 let checks=0;f.adapter.assertProactive=(_kind,_target,_rows,proactive)=>{checks++;assert.equal(proactive.contextId,contextId);};
 await f.sender.send('group','123',marker,delivery,{contextId});assert.equal(f.captured.purpose,'proactive');assert.equal(f.captured.replyTo,null);assert.equal(f.captured.messages.at(-1).role,'assistant');assert.equal(f.sends,1);assert.equal(checks,2);
});

test('a changed proactive context after synthesis blocks native submission',async t=>{
 const f=fixture(t),synthesize=f.sender.synthesize;f.adapter.assertProactive=()=>{};
 f.sender.synthesize=async(...args)=>{const result=await synthesize(...args);f.adapter.assertProactive=()=>{throw Object.assign(Error('PROACTIVE_CONTEXT_CHANGED'),{code:'PROACTIVE_CONTEXT_CHANGED'});};return result;};
 await assert.rejects(f.sender.send('group','123',marker,delivery,{contextId:'e'.repeat(64)}),error=>error.code==='PROACTIVE_CONTEXT_CHANGED');assert.equal(f.sends,0);
});
test('social history records the spoken answer rather than the routing summary',async t=>{
 const f=fixture(t),buffer=new MessageBuffer(path.join(f.root,'messages.json'));let sentAnchor;
 const engine=new SocialEngine({buffer,batchMs:1,privateMinIntervalMs:0,maxPerMinute:100,maxPerTenMinutes:100,stickerPolicyFor:()=>({enabled:false}),contextVoiceFor:()=>true,decide:async(_key,prompt)=>{assert(prompt.includes('不拟写答案'));return 'RESPOND: '+marker;},send:async(_row,_text,options)=>{sentAnchor=options.voiceAnchor;return {confirmed:true,spokenText:answer};}});t.after(()=>engine.stop());engine.receive({platform:'wechat',kind:'private',conversation_id:'123',sender_id:'123',self_id:'99',message_id:anchor,text:'逗你玩呢',timestamp:Date.now()/1000});
 for(let i=0;i<500&&buffer.unread('wechat:private:123').length;i++)await new Promise(resolve=>setTimeout(resolve,5));assert.equal(sentAnchor,anchor);assert.deepEqual(buffer.recent('wechat:private:123').filter(r=>r.outgoing).map(r=>r.text),[answer]);assert.doesNotThrow(()=>new MessageBuffer(path.join(f.root,'messages.json')));
});
test('local or installed matching stickers take precedence over shared pool candidates',async()=>{
 const calls=[],id='c'.repeat(64);const fake={reload(){},allowed:()=>true,checkNative:async()=>{},status:{native_sticker_send:true},project:{wechat:{}},api:{reader_base_url:'http://127.0.0.1:1234',reader_token:'fixture'},reader:async route=>{calls.push(route);if(route.includes('sticker-packs/search'))return {sendSupported:true,candidates:[{id,caption:'无语',packId:'__local_library__'}]};throw Error('Shared pool should not be read');},json:async()=>({ready:true,id:'d'.repeat(64),collection:'local-library'})};const result=await HookOneBot.prototype.stickerList.call(fake,'group','123','无语');assert.equal(result.stickers.length,1);assert.equal(result.preferredSource,'local-library');assert.equal(calls.length,1);
 fake.reader=async route=>route.includes('sticker-packs/search')?{sendSupported:true,candidates:[]}:{stickers:[{id,description:'共享池笑脸',tags:['daily']}]};assert.equal((await HookOneBot.prototype.stickerList.call(fake,'group','123','哈哈')).stickers[0].description,'共享池笑脸');
});

test('format repair keeps context voice available even when there are no sticker choices',async()=>{
 const {resolveSocialDecision}=await import('../components/qq-bridge/src/core/decision-format.js');let prompt;
 const {result}=await resolveSocialDecision({rawOutput:'not a valid response',key:'wechat:group:123',metadata:{contextVoice:true,batchId:'fixture'},decide:async(_key,text)=>{prompt=text;return 'RESPOND: '+marker;}});
 assert.equal(result.decision,'RESPOND');assert(prompt.includes('文字、语音或沉默'));assert(prompt.includes('不拟写答案'));assert(prompt.includes('明确要求'));
});
for(const control of [marker,'[语音TTS:鱼这就开嗓，先听了再说]'])test('conversation synthesis failure chooses a natural nonvoice reply: '+control,async t=>{
 const f=fixture(t),buffer=new MessageBuffer(path.join(f.root,'messages.json'));const sent=[];
 const engine=new SocialEngine({buffer,batchMs:1,privateMinIntervalMs:0,maxPerMinute:100,maxPerTenMinutes:100,stickerPolicyFor:()=>({enabled:false}),contextVoiceFor:()=>true,decide:async(_key,_prompt,metadata)=> metadata.voiceUnavailable?'RESPOND: (￣▽￣)':'RESPOND: '+control,send:async(_row,text)=>{sent.push(text);if(text===control)throw Object.assign(Error('VOICE_LIVE_NO_SPEECH'),{code:'VOICE_LIVE_NO_SPEECH',data:{attempted:false,phase:'voice-synthesis'}});return {confirmed:true};}});t.after(()=>engine.stop());engine.receive({platform:'wechat',kind:'private',conversation_id:'123',sender_id:'123',self_id:'99',message_id:anchor,text:'发语音啊',timestamp:Date.now()/1000});
 for(let i=0;i<500&&buffer.unread('wechat:private:123').length;i++)await new Promise(resolve=>setTimeout(resolve,5));assert.equal(sent.length,2);assert.equal(sent[1],'(￣▽￣)');assert(!sent[1].includes('没生成成功'));assert(!sent[1].includes('开嗓'));assert(!sent[1].includes('熟人间的玩笑'));assert.deepEqual(buffer.recent('wechat:private:123').filter(r=>r.outgoing).map(r=>r.text),[sent[1]]);
});

test('a quiet request arriving during voice generation blocks native submission',async t=>{
 const {ChatParticipation}=await import('../components/qq-bridge/src/core/chat-participation.js');const f=fixture(t),synthesize=f.sender.synthesize;
 f.sender.synthesize=async(...args)=>{const audio=await synthesize(...args);new ChatParticipation(path.join(f.root,'state/social-messages.json.participation.json')).set('wechat:group:123',undefined,true);return audio;};
 await assert.rejects(f.sender.send('group','123',marker,delivery,null,anchor),error=>error.code==='VOICE_CHAT_PAUSED'&&error.data?.attempted===false);assert.equal(f.sends,0);
});
