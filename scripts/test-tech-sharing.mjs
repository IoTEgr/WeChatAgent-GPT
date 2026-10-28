import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {parseTechNewsFeed,createTechNewsResearch,selectTechNewsEvidence,buildTechNewsPrompt,techNewsDigest} from '../components/qq-bridge/src/core/tech-news.js';
import {proactivePolicy,validateProactiveSettings} from '../components/qq-bridge/src/core/proactive-policy.js';
import {MessageBuffer} from '../components/qq-bridge/src/core/message-buffer.js';import {ProactiveEngine} from '../components/qq-bridge/src/core/proactive-engine.js';
import {chatSettingsSnapshot,applyChatSettings,mergeConversationSave} from '../public/console/conversation-settings.mjs';
const now=Date.parse('2026-10-23T08:00:00Z'),key='wechat:group:123',other='wechat:group:456';
const feed={id:'fixture',name:'示例官方',url:'https://example.com/feed',hosts:['example.com'],tags:'AI 人工智能 模型'};
const entry=(id,at=now-3600000,title='New AI model')=>`<item><title>${title}</title><link>https://example.com/news/${id}</link><pubDate>${new Date(at).toUTCString()}</pubDate><description><![CDATA[<p>Official model release &amp; tools.</p>]]></description></item>`;
const xml=items=>'<rss><channel>'+items+'</channel></rss>';
const research=()=>({status:'ready',items:parseTechNewsFeed(xml(entry('new')),feed,now)});
const config=()=>({persona:{default:'测试人格'},wechat:{whitelist:{private:[],groups:['123','456']},proactive:{enabled:true,mode:'greeting',intervalMinutes:30,idleMinutes:5,jitterMinutes:0,startTime:'09:00',endTime:'22:00',useSearch:true,chats:{[key]:true,[other]:true},chatSettings:{[key]:{mode:'tech',topics:'AI、模型'}}}}});
test('per-chat directions and topics inherit independently without changing another group',()=>{
 const c=config();assert.equal(proactivePolicy(c.wechat,key).mode,'tech');assert.equal(proactivePolicy(c.wechat,other).mode,'greeting');
 const previous=structuredClone(c),draft=structuredClone(c);draft.wechat.proactive.intervalMinutes=90;
 const snapshot=chatSettingsSnapshot(c,other);snapshot.settings.proactiveMode='tech';snapshot.settings.proactiveTopics='苹果、手机';applyChatSettings(c,other,snapshot.settings,snapshot.access);
 assert.equal(proactivePolicy(c.wechat,key).topics,'AI、模型');assert.equal(proactivePolicy(c.wechat,other).topics,'苹果、手机');
 const merged=mergeConversationSave(previous,draft,c,other);assert.equal(merged.wechat.proactive.intervalMinutes,90);assert.deepEqual(merged.wechat.proactive.chatSettings[other],{mode:'tech',topics:'苹果、手机'});
 const inherit=chatSettingsSnapshot(c,other);inherit.settings.proactiveMode=null;inherit.settings.proactiveTopics='';applyChatSettings(c,other,inherit.settings,inherit.access);assert.equal(proactivePolicy(c.wechat,other).mode,'greeting');
});
test('invalid modes and sensitive topic strings are rejected, while legacy boolean switches remain valid',()=>{
 for(const value of [{mode:'unknown'},{chatSettings:{[key]:{mode:'unknown'}}},{topics:'https://example.com'},{chatSettings:{[key]:{topics:'wxid_private'}}}])assert.throws(()=>validateProactiveSettings(value));
 assert.doesNotThrow(()=>validateProactiveSettings({chats:{[key]:true},mode:'mixed'}));assert.doesNotThrow(()=>validateProactiveSettings(config().wechat.proactive));
});
test('dated RSS and Atom sources are bounded and old, undated, future, entity and foreign links cannot become news',()=>{
 const rows=parseTechNewsFeed(xml(entry('new')+entry('old',now-4*86400000)+entry('future',now+86400000)+'<item><title>No date</title><link>https://example.com/no-date</link></item>'+entry('foreign').replace('https://example.com/news/foreign','https://evil.example.net/news/foreign')),feed,now);
 assert.equal(rows.length,1);assert.equal(rows[0].snippet,'Official model release & tools.');
 const atom=`<feed><entry><title>Atom release</title><link rel="alternate" href="https://example.com/atom"/><published>${new Date(now).toISOString()}</published><summary>New product.</summary></entry></feed>`;
 assert.equal(parseTechNewsFeed(atom,feed,now)[0].url,'https://example.com/atom');assert.throws(()=>parseTechNewsFeed('<!DOCTYPE rss>'+xml(entry('new')),feed,now));
});
test('research caches official feeds but rechecks freshness, per-chat topics, exclusions and revoked access',async()=>{
 let calls=0,time=now,allowed=true;
 const collect=createTechNewsResearch({feeds:[feed],now:()=>time,fetchImpl:async()=>{calls++;return new Response(xml(entry('new')));}});
 assert.equal((await collect({topics:'AI'})).items.length,1);assert.equal((await collect({topics:'苹果'})).status,'empty');assert.equal(calls,1);
 assert.equal((await collect({excludeDigests:[techNewsDigest('https://example.com/news/new')]})).items.length,0);
 assert.equal((await collect({isAllowed:()=>false})).status,'disabled');assert.equal(calls,1);
 const revoke=createTechNewsResearch({feeds:[feed],now:()=>now,fetchImpl:async()=>{allowed=false;return new Response(xml(entry('new')));}});
 assert.equal((await revoke({isAllowed:()=>allowed})).status,'disabled');time+=4*86400000;assert.equal((await collect()).items.length,0);
});
test('technology drafts must bind one current source and never substitute a fabricated or stale link',()=>{
 const data=research(),url=data.items[0].url;assert(selectTechNewsEvidence('刚看到这个模型有新变化：'+url,data,now));
 assert.equal(selectTechNewsEvidence('下午好',data,now),null);assert.equal(selectTechNewsEvidence(url+' https://unknown.example/news',data,now),null);assert.equal(selectTechNewsEvidence(url,data,now+4*86400000),null);
 const prompt=buildTechNewsPrompt({key,rows:[],now,news:data,topics:'AI、模型'});assert.match(prompt,/不退成早安/);assert.match(prompt,/文章发布时间和事件发生日期/);assert.match(prompt,/不编造排名/);
});
function fixture(t,{available=true,useSearch=true,valid=true}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tech-sharing-'));t.after(()=>{assert(dir.startsWith(os.tmpdir()+path.sep));fs.rmSync(dir,{recursive:true,force:true});});
 const settings=config();settings.wechat.whitelist.groups=['123'];settings.wechat.proactive.useSearch=useSearch;
 const buffer=new MessageBuffer(path.join(dir,'messages.json'));let time=now,calls=0,searches=0;const sent=[];
 const engine=new ProactiveEngine({stateFile:path.join(dir,'proactive.json'),buffer,social:{withConversationLock:async(_key,fn)=>fn(),noteOutgoing(){}},settingsFor:()=>settings,personaFor:()=>({persona:'测试人格',personaName:'测试'}),selfIdFor:()=> '99',now:()=>time,random:()=>0,
   techNewsFor:async()=>{searches++;return available?research():{status:'empty',items:[]};},decide:async(_key,prompt)=>{calls++;assert.match(prompt,/科技类分享/);return valid?'RESPOND: 刚看到这个模型更新，有个新功能挺有意思。 https://example.com/news/new':'RESPOND: 下午好';},send:async(_message,text)=>{sent.push(text);return {delivered:'database-confirmed'};}});
 return {engine,settings,sent,get calls(){return calls;},get searches(){return searches;},advance:()=>{time+=31*60000;}};
}
test('technology mode researches first, sends one source-bound event, then suppresses that event on later cycles',async t=>{
 const f=fixture(t);await f.engine.tick();f.advance();await f.engine.tick();assert.equal(f.sent.length,1);assert.equal(f.calls,1);assert.equal(f.searches,1);
 assert.equal(f.engine.state.chats[key].history[0].topicDigest,techNewsDigest('https://example.com/news/new'));
 f.advance();await f.engine.tick();assert.equal(f.sent.length,1);
});
test('no source, disabled search and unsupported drafts stay quiet instead of greeting',async t=>{
 for(const options of [{available:false},{useSearch:false},{valid:false}]){const f=fixture(t,options);await f.engine.tick();f.advance();await f.engine.tick();assert.deepEqual(f.sent,[]);if(options.useSearch===false)assert.equal(f.searches,0);if(options.available===false)assert.equal(f.calls,0);}
});
