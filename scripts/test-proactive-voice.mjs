import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {MessageBuffer} from '../components/qq-bridge/src/core/message-buffer.js';
import {ProactiveEngine} from '../components/qq-bridge/src/core/proactive-engine.js';
import {proactivePolicy,proactivePolicyKey} from '../components/qq-bridge/src/core/proactive-policy.js';
import {hasVoiceControl} from '../components/qq-bridge/src/core/voice-protocol.js';
import {resolveSocialDecision} from '../components/qq-bridge/src/core/decision-format.js';
const key='wechat:private:123',now=Date.UTC(2026,9,27,4),voice='[语音回复:主动聊一个与狗狗有关的轻松假设，熟悉的朋友间开玩笑]';
const failed=()=>Object.assign(Error('VOICE_LIVE_NO_SPEECH'),{code:'VOICE_LIVE_NO_SPEECH',data:{attempted:false,phase:'voice-synthesis'}});
function fixture(t,{enabled=true,send,decide}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'proactive-voice-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const buffer=new MessageBuffer(path.join(root,'messages.json')),row=buffer.append({platform:'wechat',kind:'private',conversation_id:'123',sender_id:'7',self_id:'99',message_id:'a'.repeat(64),text:'我是甲',timestamp:(now-3*86400000)/1000});buffer.markProcessed(key,row.id);
 const settings={wechat:{voice:{enabled,replyMode:'conversation'},whitelist:{private:[123],groups:[]},proactive:{enabled:true,mode:'greeting',intervalMinutes:30,idleMinutes:5,jitterMinutes:0,startTime:'00:00',endTime:'23:59',chats:{[key]:true},useSearch:false}}};
 const calls=[],sent=[];
 const options={stateFile:path.join(root,'proactive.json'),buffer,social:{noteOutgoing(){},withConversationLock:async(_key,fn)=>fn(),participation:{quiet:()=>false}},settingsFor:async()=>settings,personaFor:async()=>({personaName:'专属大肥鱼',persona:'机灵有主见，对方喜欢狗狗和羽毛球'}),selfIdFor:()=> '99',now:()=>now,random:()=>0,decide:async(...args)=>{calls.push(args);return decide?decide(...args):args[2].proactiveVoice?'RESPOND: '+voice:'RESPOND: 本鱼有个新想法[偷笑]';},send:async(...args)=>{sent.push(args);return send?send(...args):{confirmed:true,spokenText:'狗狗要是会开会，是不是就只讨论谁是好狗？'};}};
 const engine=new ProactiveEngine(options);engine.state.chats[key]={nextAt:now-1,cycles:0,history:[],signature:proactivePolicyKey(proactivePolicy(settings.wechat,key))};return {engine,options,buffer,calls,sent,settings};
}

test('greeting mode offers autonomous voice with the selected persona and records actual speech',async t=>{
 const f=fixture(t);await f.engine.tick();assert.equal(f.sent.length,1);assert.equal(f.sent[0][1],voice);assert.equal(f.sent[0][2].source,'proactive');assert.equal(f.calls[0][2].proactiveVoice,true);assert.equal(f.calls[0][2].personaName,'专属大肥鱼');assert(f.calls[0][1].includes('没有新的好友消息'));
 const row=f.buffer.recent(key).at(-1);assert.equal(row.reply_kind,'voice');assert(row.text.includes('好狗'));assert(!row.text.includes('语音回复:'));assert.equal(f.engine.state.chats[key].history[0].text,row.text);
});

test('disabled voice preserves a text greeting',async t=>{
 const f=fixture(t,{enabled:false,send:async()=>({confirmed:true})});await f.engine.tick();assert.equal(f.sent.length,1);assert(!hasVoiceControl(f.sent[0][1]));assert(!f.calls[0][2].proactiveVoice);assert(f.calls[0][1].includes('本轮只发文字'));
});

test('known unsent synthesis failure resumes a distinct nonvoice decision after restart',async t=>{
 const f=fixture(t,{send:async(_message,text)=>{if(hasVoiceControl(text))throw failed();return {confirmed:true};}});
 await f.engine.tick();assert.equal(f.sent.length,1);assert.equal(f.engine.state.chats[key].job.voiceUnavailable,true);assert.equal(f.engine.state.chats[key].history.length,0);
 const restored=new ProactiveEngine(f.options);await restored.tick();assert.equal(f.sent.length,2);assert(!hasVoiceControl(f.sent[1][1]));assert.notEqual(f.sent[0][2].deliveryId,f.sent[1][2].deliveryId);assert.equal(f.calls[1][2].voiceUnavailable,true);assert(!f.calls[1][2].proactiveVoice);assert(!f.sent[1][1].includes('没生成成功'));assert.equal(restored.state.chats[key].job,null);
});

test('already submitted or unknown voice failures do not choose a second delivery medium',async t=>{
 const f=fixture(t,{send:async()=>{throw Object.assign(Error('VOICE_LIVE_TIMEOUT'),{code:'VOICE_LIVE_TIMEOUT',data:{attempted:true,phase:'voice-synthesis'}});}});
 await f.engine.tick();assert.equal(f.calls.length,1);assert.equal(f.engine.state.chats[key].job.voiceUnavailable,undefined);assert.equal(f.sent.length,1);
});

test('fresh incoming chat cancels a pending voice-failure alternative',async t=>{
 const f=fixture(t,{send:async()=>{throw failed();}});await f.engine.tick();
 const row=f.buffer.append({platform:'wechat',kind:'private',conversation_id:'123',sender_id:'7',self_id:'99',message_id:'b'.repeat(64),text:'我来了',timestamp:now/1000});f.buffer.markProcessed(key,row.id);
 await f.engine.tick();assert.equal(f.sent.length,1);assert.equal(f.engine.state.chats[key].job,null);
});

test('proactive format repair retains its voice purpose without reactive participation guidance',async()=>{
 let prompt;const result=await resolveSocialDecision({rawOutput:'invalid',key,metadata:{proactiveVoice:true},decide:async(_key,value)=>{prompt=value;return 'RESPOND: '+voice;}});
 assert.equal(result.result.decision,'RESPOND');assert(prompt.includes('主动发起'));assert(!prompt.includes('群聊默认安静旁观'));
});
