import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {parseSocialDecision,hasReplyProtocolControl,resolveSocialDecision} from '../components/qq-bridge/src/core/decision-format.js';
import {validVoiceObservations} from '../components/qq-bridge/src/core/voice-images.js';
import {SocialEngine} from '../components/qq-bridge/src/core/social-engine.js';import {MessageBuffer} from '../components/qq-bridge/src/core/message-buffer.js';
import {conversationVoiceRequest,VOICE_CONTEXT_LIMITS} from './voice-context.mjs';
import {WechatOneBotAdapter} from '../components/qq-bridge/src/adapters/wechat/wechat-onebot-adapter.js';
import {HookOneBot} from './hook-onebot.mjs';
const image='e'.repeat(64),source='c'.repeat(64),anchor='a'.repeat(64),marker='[语音回复:群友请你评价刚发的图片]',description='黑猫蹲在纸箱里，箱上写着“老板不在，禁止加班”。';
const refs={I1:{id:image,messageId:source}},envelope='<voice_images>'+JSON.stringify({I1:description})+'</voice_images>',options={voiceImageRefs:refs};
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'voice-image-context-'));fs.mkdirSync(path.join(root,'roles'));fs.writeFileSync(path.join(root,'roles/大肥鱼.md'),'# 大肥鱼\n你机灵有主见。');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return {root,adapter:{directory:root,project:{persona:{default:'大肥鱼'}}}};}

test('visual facts are bound to offered image IDs and removed from visible reply text',()=>{
 const value=parseSocialDecision('RESPOND: '+marker+'\n'+envelope,{},options);
 assert.equal(value.decision,'RESPOND');assert.equal(value.text,marker);assert.deepEqual(value.voiceObservations,[{...refs.I1,ref:'I1',description}]);assert.deepEqual(value.textParts,[marker]);
 assert(hasReplyProtocolControl(envelope));assert(!validVoiceObservations([{...value.voiceObservations[0],messageId:'bad'}]));
 const unavailable=parseSocialDecision('RESPOND: '+marker+'\n<voice_images>{"I1":null}</voice_images>',{},options);assert.equal(unavailable.voiceObservations[0].description,null);
});

test('the OneBot transport preserves structured visual facts through its action boundary',async()=>{
 const bridge=new WechatOneBotAdapter(),observations=[{...refs.I1,ref:'I1',description}];let captured;
 const hook={activeActions:0,reload(){},allowed:()=>true,status:{failed_sends:0},voiceSender:{send:async(...args)=>{captured=args;return {receipt:'wechat-server-id',spoken_text:'猫猫已经下班啦'};}}};
 bridge.server.action=(action,params)=>HookOneBot.prototype.action.call(hook,{action,params});
 const result=await bridge.sendText({kind:'group',target:'123',text:marker,voiceAnchor:anchor,voiceObservations:observations});
 assert.equal(result.confirmed,true);assert.equal(captured[5],anchor);assert.deepEqual(captured[6],observations);
});

test('missing, invented, duplicate and malformed observation envelopes never leak into WeChat',()=>{
 for(const raw of ['RESPOND: '+marker,'RESPOND: '+marker+'\n<voice_images>{"I2":"其他图片"}</voice_images>','RESPOND: '+marker+'\n'+envelope+envelope,'RESPOND: '+marker+'\n<voice_images>unfinished','RESPOND: 这是一只猫\n'+envelope,'RESPOND: '+marker+'\n<voice_images>{"I1":""}</voice_images>'])assert.equal(parseSocialDecision(raw,{},options).decision,'INVALID',raw);
 assert.equal(parseSocialDecision('RESPOND: '+marker+'\n'+envelope).decision,'INVALID');
});

test('a missing visual handoff gets one repair with the same image references',async()=>{
 let calls=0;const resolved=await resolveSocialDecision({rawOutput:'RESPOND: '+marker,key:'wechat:group:123',metadata:{contextVoice:true,voiceImageRefs:refs,images:[{id:image}]},decide:async(_key,prompt,metadata)=>{calls++;assert(prompt.includes('语音画面交接'));assert.equal(metadata.images[0].id,image);return 'RESPOND: '+marker+'\n'+envelope;}});
 assert.equal(calls,1);assert.equal(resolved.result.voiceObservations[0].description,description);
});

test('group image decisions carry observations through the outbox without sending the envelope',async t=>{
 const f=fixture(t),buffer=new MessageBuffer(path.join(f.root,'messages.json'));let captured,passes=0;
 const engine=new SocialEngine({buffer,batchMs:1,privateMinIntervalMs:0,maxPerMinute:100,maxPerTenMinutes:100,personaNameFor:()=> '大肥鱼',contextVoiceFor:()=>true,stickerPolicyFor:()=>({enabled:false}),decide:async(_key,prompt,metadata)=>{
  assert.equal(metadata.images[0].id,image);assert.deepEqual(metadata.voiceImageRefs,refs);assert(prompt.includes('语音画面交接')||prompt.includes('发送形式复核'));
  return ++passes===1?'RESPOND: 猫猫已经下班了':'RESPOND: '+marker+'\n'+envelope;
 },send:async(_row,text,details)=>{captured={text,details};return {confirmed:true,spokenText:'哈哈，猫都比我懂下班。'};}});t.after(()=>engine.stop());
 engine.receive({platform:'wechat',kind:'group',conversation_id:'123',sender_id:'456',self_id:'99',message_id:source,text:'请用语音评价一下这张图',images:[{id:image}],timestamp:Date.now()/1000});
 for(let i=0;i<500&&!captured;i++)await new Promise(resolve=>setTimeout(resolve,5));
 assert(captured);assert.equal(passes,2);assert.equal(captured.text,marker);assert.equal(captured.details.voiceAnchor,source);assert.equal(captured.details.voiceObservations[0].description,description);
 const reload=new MessageBuffer(buffer.file);assert(!reload.recent('wechat:group:123').some(row=>row.text.includes('<voice_images>')));
});

test('voice history keeps up to 100 rows before the anchor instead of 24, without later messages',t=>{
 const f=fixture(t),now=Math.floor(Date.now()/1000),rows=Array.from({length:140},(_,i)=>({wechatagentMessageId:i===119?anchor:String(i).padStart(64,'0'),localId:i+1,localType:1,isSend:false,createTime:now-140+i,fullText:'第'+i+'句短聊天',senderName:'群友'}));
 const request=conversationVoiceRequest(f.adapter,{kind:'group',target:'123',anchor,rows,summary:'之前在聊周末去哪玩',identity:{account:'fixture'}});
 assert.equal(request.messages.length,100);assert.equal(request.messages[0].text,'第20句短聊天');assert.equal(request.replyTo.text,'第119句短聊天');assert.equal(request.contextWindow.available,120);assert(!JSON.stringify(request).includes('第120句'));
});

test('visual observations preserve their source and UTF-8 history stays bounded',t=>{
 const f=fixture(t),now=Math.floor(Date.now()/1000),rows=Array.from({length:100},(_,i)=>({wechatagentMessageId:i===99?anchor:i===98?source:String(i).padStart(64,'0'),localId:i+1,localType:i===98?3:1,isSend:false,createTime:now-100+i,fullText:'长消息😀'.repeat(250),senderName:'群友'}));
 const observations=[{...refs.I1,ref:'I1',description}];
 const request=conversationVoiceRequest(f.adapter,{kind:'group',target:'123',anchor,rows,visualFacts:observations,identity:{account:'fixture'}});
 assert(request.messages.length>1&&request.messages.length<100);assert(request.messages.some(row=>row.text.includes('附图 I1')));assert.equal(request.visualFacts[0].description,description);assert(request.messages.reduce((size,row)=>size+Buffer.byteLength(row.speaker+'：'+row.text),0)<VOICE_CONTEXT_LIMITS.startupBytes);
 assert.throws(()=>conversationVoiceRequest(f.adapter,{kind:'group',target:'123',anchor,rows,visualFacts:[{...observations[0],messageId:'f'.repeat(64)}],identity:{account:'fixture'}}),/IMAGE_CONTEXT_INVALID/);
});
