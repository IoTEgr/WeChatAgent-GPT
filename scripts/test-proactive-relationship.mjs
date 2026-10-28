import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {MessageBuffer} from '../components/qq-bridge/src/core/message-buffer.js';
import {ProactiveEngine,buildProactivePrompt} from '../components/qq-bridge/src/core/proactive-engine.js';
import {proactivePolicy,proactivePolicyKey,proactiveContactState} from '../components/qq-bridge/src/core/proactive-policy.js';
const key='wechat:private:123',group='wechat:group:456',start=Date.UTC(2026,9,27,4),hash=n=>String(n).padStart(64,'0');
const incoming=(at,text='喜欢羽毛球和狗狗')=>({platform:'wechat',kind:'private',conversation_id:'123',sender_id:'7',self_id:'99',message_id:hash(at),text,timestamp:at/1000});
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'proactive-relationship-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const buffer=new MessageBuffer(path.join(root,'messages.json')),row=buffer.append(incoming(start-3600000));buffer.markProcessed(key,row.id);
 const settings={wechat:{whitelist:{private:[123],groups:[]},proactive:{enabled:true,mode:'greeting',intervalMinutes:30,idleMinutes:5,jitterMinutes:0,startTime:'00:00',endTime:'23:59',chats:{[key]:true},useSearch:false}}};
 const calls=[],sent=[];let now=start,decide=async()=> 'RESPOND: 第'+(calls.length)+'个轻松小笑点';
 const options={stateFile:path.join(root,'proactive.json'),buffer,social:{noteOutgoing(){},withConversationLock:async(_key,fn)=>fn(),participation:{quiet:()=>false}},settingsFor:async()=>settings,personaFor:async()=>({personaName:'专属大肥鱼',persona:'温柔机灵，有一点小脾气，对方喜欢羽毛球和狗狗。'}),selfIdFor:()=> '99',now:()=>now,random:()=>0,decide:async(...args)=>{calls.push(args);return decide(...args);},send:async(message,text,metadata)=>{sent.push({message,text,metadata});return {confirmed:true};}};
 const engine=new ProactiveEngine(options);engine.state.chats[key]={nextAt:now-1,cycles:0,history:[],signature:proactivePolicyKey(proactivePolicy(settings.wechat,key))};
 return {engine,buffer,calls,sent,settings,options,advance(ms){now+=ms;},setDecide(fn){decide=fn;},get now(){return now;}};
}

test('unanswered counts actual deliveries, deduplicates history, and resets on a new peer message',()=>{
 const rows=[{outgoing:false,timestamp:10},{outgoing:true,proactive:true,timestamp:11,delivery_id:'first'}];
 const history=[{at:11000,deliveryId:'first',text:'第一条'},{at:12000,deliveryId:'second',text:'第二条'}];
 assert.equal(proactiveContactState(key,rows,history).unanswered,2);
 assert.equal(proactiveContactState(group,rows,history).unanswered,0);
 assert.equal(proactiveContactState(key,[...rows,{outgoing:false,timestamp:20}],history).unanswered,0);
 assert.equal(proactiveContactState(key,[],history).unanswered,2);
});

test('private unanswered context changes the opening rather than preferring silence or a cooldown',()=>{
 const rows=[{outgoing:false,timestamp:start/1000-7200,text:'叫我甲'},{outgoing:true,proactive:true,timestamp:start/1000-3600,text:'早呀',delivery_id:'a'}];
 const prompt=buildProactivePrompt({key,rows,mode:'greeting',now:start,topics:'羽毛球、狗狗',recentTopics:[{at:start-3600000,text:'早呀',deliveryId:'a'}]});
 assert(prompt.includes('连续 1 次'));assert(prompt.includes('不因未回复而自动暂停'));assert(prompt.includes('羽毛球、狗狗'));assert(prompt.includes('俏皮反问'));
 assert(!prompt.includes('本轮优先 SILENT'));assert(!prompt.includes('2至8字'));assert(!prompt.includes('最后一次轻松冒泡'));
});

test('three or more unanswered private messages still get their configured opportunities across restart',async t=>{
 const f=fixture(t);for(let i=0;i<3;i++){await f.engine.tick();f.advance(30*60000);}
 assert.equal(f.sent.length,3);assert.equal(f.calls.length,3);assert.equal(f.calls[0][2].personaName,'专属大肥鱼');assert(f.calls[0][2].persona.includes('羽毛球'));
 assert(f.calls[2][1].includes('连续 2 次'));assert(f.calls.every(([,prompt])=>!prompt.includes('本轮优先 SILENT')));
 const restored=new ProactiveEngine(f.options);await restored.tick();assert.equal(f.sent.length,4);assert(f.calls.at(-1)[1].includes('连续 3 次'));
 f.advance(60000);await restored.tick();assert.equal(f.sent.length,4,'must not increase configured frequency');
});

test('peer re-engagement clears unanswered context without requiring an explicit resume phrase',async t=>{
 const f=fixture(t);await f.engine.tick();f.advance(30*60000);await f.engine.tick();f.advance(30*60000);
 const row=f.buffer.append(incoming(f.now-6*60000,'哈哈，刚看到'));f.buffer.markProcessed(key,row.id);
 await f.engine.tick();assert.equal(f.sent.length,3);assert(!f.calls.at(-1)[1].includes('次主动发言还没有等到'));
});

test('an explicit request not to be contacted still stops proactive delivery',async t=>{
 const f=fixture(t);const row=f.buffer.append(incoming(start-6*60000,'不要主动找我'));f.buffer.markProcessed(key,row.id);
 await f.engine.tick();assert.equal(f.calls.length,0);assert.equal(f.sent.length,0);
});

test('a new incoming message during generation cancels the unsent proactive draft',async t=>{
 const f=fixture(t);f.setDecide(async()=>{const row=f.buffer.append(incoming(f.now,'现在聊点别的'));f.buffer.markProcessed(key,row.id);return 'RESPOND: 还没发出的旧开场';});
 await f.engine.tick();assert.equal(f.calls.length,1);assert.equal(f.sent.length,0);
});

test('SILENT does not count as a sent message and does not disable later opportunities',async t=>{
 const f=fixture(t);f.setDecide(async()=> 'SILENT');await f.engine.tick();assert.equal(f.sent.length,0);assert.equal(f.engine.state.chats[key].history.length,0);
 f.advance(30*60000);f.setDecide(async()=> 'RESPOND: 换个有趣的切口');await f.engine.tick();assert.equal(f.sent.length,1);
});

test('unconfirmed delivery still blocks a second proactive message',async t=>{
 const f=fixture(t);f.options.send=async()=>({delivered:'unconfirmed'});const engine=new ProactiveEngine({...f.options,stateFile:f.engine.stateFile});engine.state=f.engine.state;
 await engine.tick();f.advance(30*60000);await engine.tick();assert.equal(f.calls.length,1);
});

test('group unanswered behavior stays conservative',()=>{
 const prompt=buildProactivePrompt({key:group,rows:[{outgoing:true,proactive:true,text:'一个群话题',timestamp:start/1000-3600}],mode:'greeting',now:start});
 assert(prompt.includes('本轮优先 SILENT'));assert(!prompt.includes('这是私聊'));
});
