import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {typingDelayMs,validateTypingSettings} from '../components/qq-bridge/src/core/typing-delay.js';
import {SocialEngine} from '../components/qq-bridge/src/core/social-engine.js';
import {MessageBuffer} from '../components/qq-bridge/src/core/message-buffer.js';
test('typing duration scales with text, counts WeChat faces once, and is bounded',()=>{
 const settings={enabled:true,start_ms:1000,char_ms:100,max_ms:12000,jitter_ms:0};
 assert.equal(typingDelayMs('好',settings),1100);assert.equal(typingDelayMs('好[让我看看]',settings),1200);
 assert.equal(typingDelayMs('字'.repeat(1000),settings),12000);assert.equal(typingDelayMs('好',{enabled:false}),0);
 for(const value of [{enabled:'yes'},{enabled:true,char_ms:0},{max_ms:60000}])assert.throws(()=>validateTypingSettings(value));
});
test('each text part waits once, persists its deadline, and is sent without repeating the model call',async t=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'typing-delivery-'));t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
 const file=path.join(folder,'buffer.json'),buffer=new MessageBuffer(file),sent=[];let calls=0,timings=0;
 const engine=new SocialEngine({buffer,batchMs:1,privateMinIntervalMs:0,maxPerMinute:100,maxPerTenMinutes:1000,
   typingDelayFor:()=>{timings++;return 70;},decide:async()=>{calls++;return 'RESPOND: 哈哈\n\n我刚反应过来';},send:async(_message,text)=>{sent.push({text,at:Date.now()});return{delivered:'database-confirmed'};}});t.after(()=>engine.stop());
 const start=Date.now();engine.receive({platform:'wechat',kind:'private',conversation_id:'123',sender_id:'456',self_id:'99',message_id:'typing-fixture',text:'你好',direct_mention:true,timestamp:start/1000});
 for(let i=0;i<100&&!buffer.pendingReplies.get('wechat:private:123')?.parts?.[0]?.typingReadyAt;i++)await new Promise(resolve=>setTimeout(resolve,2));
 const saved=JSON.parse(fs.readFileSync(file));assert(saved.pendingReplies['wechat:private:123'].parts[0].typingReadyAt>start);assert.equal(sent.length,0);
 for(let i=0;i<150&&sent.length<2;i++)await new Promise(resolve=>setTimeout(resolve,5));
 assert.equal(calls,1);assert.equal(timings,2);assert.deepEqual(sent.map(item=>item.text),['哈哈','我刚反应过来']);assert(sent[0].at-start>=65);assert(sent[1].at-sent[0].at>=65);
});

test('pre-submission voice failure falls back once and allows the next mention',async t=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'voice-fallback-'));t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));const buffer=new MessageBuffer(path.join(folder,'buffer.json')),sent=[];let decisions=0;
 const engine=new SocialEngine({buffer,batchMs:1,privateMinIntervalMs:0,maxPerMinute:100,maxPerTenMinutes:1000,typingDelayFor:()=>0,decide:async(_key,_prompt,metadata)=>{decisions++;return metadata.voiceUnavailable?'RESPOND: 嘿，我在呢':'RESPOND: [语音TTS:嘿，我在呢]';},send:async(_message,text)=>{sent.push(text);if(text.startsWith('[语音TTS:'))throw Object.assign(Error('VOICE_LIVE_TIMEOUT'),{code:'VOICE_LIVE_TIMEOUT',data:{attempted:false,phase:'voice-synthesis'}});assert.doesNotThrow(()=>new MessageBuffer(path.join(folder,'buffer.json')));return {delivered:'database-confirmed'};}});t.after(()=>engine.stop());
 const message=id=>({platform:'wechat',kind:'private',conversation_id:'123',sender_id:'456',self_id:'99',message_id:id,text:'你好',direct_mention:true,timestamp:Date.now()/1000});engine.receive(message('voice-fallback-one'));
 for(let i=0;i<100&&sent.length<2;i++)await new Promise(r=>setTimeout(r,5));assert.deepEqual(sent,['[语音TTS:嘿，我在呢]','嘿，我在呢']);assert.equal(decisions,2);
 for(let i=0;i<100&&buffer.pendingReplies.size;i++)await new Promise(r=>setTimeout(r,5));assert.equal(buffer.pendingReplies.size,0);engine.receive(message('voice-fallback-two'));for(let i=0;i<100&&sent.length<4;i++)await new Promise(r=>setTimeout(r,5));assert.equal(sent.length,4);assert.equal(decisions,4);
});

test('slow generation consumes the first typing wait but keeps pauses between parts',async t=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'typing-overlap-'));t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
 const file=path.join(folder,'buffer.json'),buffer=new MessageBuffer(file),sent=[];let calls=0,finished=0;
 const engine=new SocialEngine({buffer,batchMs:1,privateMinIntervalMs:0,maxPerMinute:100,maxPerTenMinutes:1000,
   typingDelayFor:()=>80,decide:async()=>{calls++;await new Promise(r=>setTimeout(r,160));finished=Date.now();return 'RESPOND: 嗯\n\n想起来了';},
   send:async(_message,text)=>{const pending=buffer.pendingReplies.get('wechat:private:123');sent.push({text,at:Date.now(),started:pending.typingStartedAt,ready:pending.parts[sent.length].typingReadyAt});assert.doesNotThrow(()=>new MessageBuffer(file));return{delivered:'database-confirmed'};}});t.after(()=>engine.stop());
 engine.receive({platform:'wechat',kind:'private',conversation_id:'123',sender_id:'456',self_id:'99',message_id:'slow-typing-fixture',text:'你好',direct_mention:true,timestamp:Date.now()/1000});
 for(let i=0;i<250&&sent.length<2;i++)await new Promise(r=>setTimeout(r,5));
 assert.equal(calls,1);assert.deepEqual(sent.map(item=>item.text),['嗯','想起来了']);
 assert(sent[0].started<=finished-150);assert(sent[0].ready<=sent[0].at);assert(sent[0].ready<finished+80,'first reply must not add a new typing deadline after slow generation');
 assert(sent[1].at-sent[0].at>=75,'later parts must retain their typing pause');
});

test('a persisted typing deadline resumes without another generation or a new wait',async t=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'typing-resume-'));t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
 const file=path.join(folder,'buffer.json'),buffer=new MessageBuffer(file);let calls=0;const sent=[];
 const options={batchMs:1,privateMinIntervalMs:0,maxPerMinute:100,maxPerTenMinutes:1000,typingDelayFor:()=>200,decide:async()=>{calls++;return 'RESPOND: 收到';},send:async(_message,text)=>{sent.push(text);return{delivered:'database-confirmed'};}};
 const engine=new SocialEngine({...options,buffer});t.after(()=>engine.stop());
 engine.receive({platform:'wechat',kind:'private',conversation_id:'123',sender_id:'456',self_id:'99',message_id:'resume-typing-fixture',text:'你好',direct_mention:true,timestamp:Date.now()/1000});
 for(let i=0;i<100&&!buffer.pendingReplies.get('wechat:private:123')?.parts?.[0]?.typingReadyAt;i++)await new Promise(r=>setTimeout(r,2));
 engine.stop();const restored=new MessageBuffer(file),pending=restored.pendingReplies.get('wechat:private:123');assert(pending.typingStartedAt>0);assert.equal(sent.length,0);
 pending.parts[0].typingReadyAt=Date.now()-1;restored.rememberReply('wechat:private:123',pending);
 const resumed=new SocialEngine({...options,buffer:restored});t.after(()=>resumed.stop());resumed.replay('wechat:private:123');
 for(let i=0;i<150&&sent.length<1;i++)await new Promise(r=>setTimeout(r,5));
 assert.equal(calls,1);assert.deepEqual(sent,['收到']);
});
