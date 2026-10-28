import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {LongTermMemory,LONG_MEMORY_POLICY,MEMORY_CONTEXT_CHARS} from '../packages/dsh-social-bridge-plugin/long-term-memory.mjs';
import {bindLongMemory,injectLongMemory} from '../packages/dsh-social-bridge-plugin/long-term-memory-tools.mjs';
import {createMemoryConsole} from './memory-console.mjs';
import {createLongMemoryUI} from '../public/console/long-term-memory.js';
const account='a'.repeat(64),other='b'.repeat(64),key='wechat:group:123';
const item=(changes={})=>({kind:'fact',subject:'小明 · 101',topic:'饮料偏好',text:'喜欢无糖可乐',evidence:'我喜欢无糖可乐',...changes});
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'wechat-long-memory-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return {root,store:new LongTermMemory(root,account)};}
test('plain memory survives process recreation, scopes accounts, chats and modes and deduplicates replay',t=>{
 const {root,store}=fixture(t),first=store.mutate(key,'social',{op:'remember',items:[item()]},{requireEvidence:true,source:'小明说：我喜欢无糖可乐',now:100});
 const replay=store.mutate(key,'social',{op:'remember',items:[item()]},{now:200});assert.equal(replay.revision,first.revision);assert.equal(replay.entries[0].updatedAt,100);
 assert.equal(new LongTermMemory(root,account).recall(key,'social','无糖')[0].text,'喜欢无糖可乐');assert.equal(new LongTermMemory(root,other).read(key).entries.length,0);assert.equal(store.read('wechat:group:456').entries.length,0);assert.equal(store.read(key,'assistant').entries.length,0);
 const revised=store.mutate(key,'social',{op:'remember',items:[item({text:'现在改喝茶',evidence:'我现在改喝茶'})]},{requireEvidence:true,source:'我现在改喝茶',now:300});assert.equal(revised.entries.length,1);assert.equal(revised.entries[0].id,first.entries[0].id);assert.equal(revised.entries[0].createdAt,100);
 assert.throws(()=>store.mutate(key,'social',{op:'remember',items:[item({evidence:'模型自己编的'})]},{requireEvidence:true,source:'没有说这个'}),/EVIDENCE_REQUIRED/);assert.equal(store.read(key).revision,revised.revision);
});
test('stale UI edits, concurrent writes and corrupt files fail without data loss',t=>{
 const {store}=fixture(t),old=store.read(key),saved=store.mutate(key,'social',{op:'settings',enabled:true,card:'记得叫他小明'},{revision:old.revision});
 assert.throws(()=>store.mutate(key,'social',{op:'settings',enabled:false,card:''},{revision:old.revision}),/REVISION_CHANGED/);
 const file=store.file(key);fs.writeFileSync(file+'.lock','');assert.throws(()=>store.mutate(key,'social',{op:'forget',id:'c'.repeat(64)}),/MEMORY_BUSY/);assert.equal(store.read(key).revision,saved.revision);fs.unlinkSync(file+'.lock');
 fs.writeFileSync(file,'{malformed');assert.throws(()=>store.mutate(key,'social',{op:'settings',enabled:false,card:''}),/FILE_INVALID/);assert.equal(fs.readFileSync(file,'utf8'),'{malformed');assert(!fs.existsSync(file+'.lock'));
 assert.throws(()=>store.read('../elsewhere'),/SCOPE_INVALID/);assert.throws(()=>store.read(key,'../../elsewhere'),/SCOPE_INVALID/);
});
test('bounded context selects relevant older facts, preserves source messages, and toggles off',t=>{
 const {store}=fixture(t);for(let n=0;n<20;n++)store.mutate(key,'social',{op:'remember',items:[item({topic:'主题'+n,text:n===0?'小明喜欢无糖可乐':'其他事情'.repeat(30)+n})]},{now:n+1});
 const original=[{role:'system',content:[{type:'text',text:'system'}]},{role:'user',content:[{type:'text',text:'问一下无糖可乐'}]}],before=JSON.stringify(original),options={messages:original};
 injectLongMemory(options,{store,key,mode:'social',query:'小明喜欢喝什么无糖可乐',createUserMessage:value=>({role:'user',...value})});
 assert.equal(options.messages[0],original[0]);assert.equal(JSON.stringify(original),before);assert.equal(original.length,2);assert(options.messages[1].source.socialLongMemory);assert(options.messages[1].content[0].text.includes('小明喜欢无糖可乐'));assert(store.context(key,'social','可乐').length<=MEMORY_CONTEXT_CHARS);
 injectLongMemory(options,{store,key,mode:'social',query:'可乐',createUserMessage:value=>({role:'user',...value})});assert.equal(options.messages.filter(m=>m.source?.socialLongMemory).length,1);
 store.mutate(key,'social',{op:'settings',enabled:false,card:''});assert.equal(store.context(key,'social','可乐'),'');assert.equal(injectLongMemory({messages:original},{store,key,mode:'social',createUserMessage:value=>value}),false);
});
test('capacity is bounded and a failed multi-item transaction cannot partially persist',t=>{
 const {store}=fixture(t);for(let n=0;n<80;n++)store.mutate(key,'social',{op:'remember',items:[item({topic:'偏好'+n})]});const before=store.read(key);
 assert.throws(()=>store.mutate(key,'social',{op:'remember',items:[item({topic:'偏好0',text:'不能半写入'}),item({topic:'偏好81'})]}),/CAPACITY_REACHED/);assert.equal(store.read(key).revision,before.revision);
});
test('tool is scoped to a live turn, validates evidence, limits calls and permits requested forgetting',async t=>{
 const {root,store}=fixture(t),controller=new AbortController(),turn={controller,memoryEvidence:'我喜欢无糖可乐，记住了。'},registered=new Map(),ctx={tools:{register:definition=>{registered.set(definition.name,definition);return ()=>registered.delete(definition.name);}}};let allowed=true;
 const dispose=bindLongMemory(ctx,{root,accountScope:account,key,modeFor:()=> 'social',turnFor:()=>turn,isAllowed:()=>allowed}),tool=registered.get('wechat_memory');assert(ctx[LONG_MEMORY_POLICY].names().has(tool.name));
 assert.equal((await tool.execute({op:'remember',items:[item()]})).isError,false);const id=store.read(key).entries[0].id;
 assert.match((await tool.execute({op:'forget',id})).content,/FORGET_REQUEST_REQUIRED/);turn.memoryEvidence='忘掉我的饮料偏好';assert.equal((await tool.execute({op:'forget',id})).isError,false);assert.equal(store.read(key).entries.length,0);
 assert.match((await tool.execute({op:'recall'})).content,/TURN_LIMIT/);turn.memoryCalls=0;allowed=false;assert.equal(ctx[LONG_MEMORY_POLICY].names().size,0);assert.equal((await tool.execute({op:'recall'})).isError,true);allowed=true;controller.abort();assert.equal((await tool.execute({op:'recall'})).isError,true);dispose();assert.equal(registered.size,0);
});
test('loops complete idempotently, facts and other members cannot be accidentally overwritten',t=>{
 const {store}=fixture(t),state=store.mutate(key,'social',{op:'remember',items:[item({kind:'loop',topic:'周末约球',text:'周末一起打球'}),item(),item({subject:'另一位小明 · 102',text:'不喝可乐'})]});
 const loop=state.entries.find(r=>r.kind==='loop');store.mutate(key,'social',{op:'complete',id:loop.id},{now:100});const done=store.read(key);assert.equal(done.entries.length,3);assert(!store.context(key).includes('周末一起打球'));assert.throws(()=>store.mutate(key,'social',{op:'complete',id:state.entries.find(r=>r.kind==='fact').id}),/LOOP_REQUIRED/);assert.equal(store.mutate(key,'social',{op:'complete',id:loop.id},{now:200}).revision,done.revision);
});
test('console account freshness, whitelist and optimistic revision protect memory writes',t=>{
 const {root}=fixture(t);fs.mkdirSync(path.join(root,'state/weflow'),{recursive:true});const active=path.join(root,'state/weflow/active-account.json');fs.writeFileSync(active,JSON.stringify({id:account}));const config={wechat:{whitelist:{groups:['123'],private:[]}}},view=createMemoryConsole({root,configFor:()=>config,plugin:async()=>({})});
 const params=new URLSearchParams({scope:account,conversationKey:key}),current=view.longTerm(params),body={scope:account,conversationKey:key,revision:current.revision,operation:{op:'remember',items:[item()]}};assert.equal(view.updateLongTerm(body).entries.length,1);assert.throws(()=>view.updateLongTerm(body),/REVISION_CHANGED/);assert.throws(()=>view.longTerm(new URLSearchParams({scope:account,conversationKey:'wechat:group:999'})),/允许|范围|会话/);
 fs.writeFileSync(active,JSON.stringify({id:other}));assert.throws(()=>view.longTerm(params),/账号已切换/);assert.throws(()=>view.updateLongTerm(body),/账号已切换/);
});
test('memory UI escapes stored content and sends a structured console operation',async()=>{
 const row={id:'c'.repeat(64),kind:'fact',subject:'<script>',topic:'偏好',text:'<img src=x onerror=alert(1)>',evidence:'<svg>',updatedAt:100,status:'open'},requests=[],data={revision:'d'.repeat(64),enabled:true,card:'</textarea><script>',entries:[row]},esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
 const ui=createLongMemoryUI({api:async(route,body)=>{requests.push({route,body});return route==='/api/memory'?{available:true,accountScope:account,chats:[{key}]}:data;},state:{names:new Map(),config:{wechat:{}}},escapeHtml:esc,renderPage:async()=>{},toast:()=>{}}),html=await ui.page();assert(!html.includes('<script>'));assert(!html.includes('<img src=x'));assert(html.includes('&lt;img'));
 const button={hasAttribute:()=>false,getAttribute:name=>name==='data-long-memory-forget'?row.id:null};assert(ui.click(button));await new Promise(resolve=>setImmediate(resolve));const sent=requests.find(r=>r.body);assert.equal(sent.body.operation.op,'forget');assert.equal(sent.body.revision,data.revision);assert.equal(sent.body.scope,account);assert(!sent.body.method);
});
