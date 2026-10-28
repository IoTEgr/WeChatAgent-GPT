import {HookOneBot} from './hook-onebot.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {MessageBuffer} from '../components/qq-bridge/src/core/message-buffer.js';
import {SocialEngine} from '../components/qq-bridge/src/core/social-engine.js';
import {normalizeOneBotEvent} from '../components/qq-bridge/src/onebot/normalize.js';
const key='wechat:group:123';
const msg=(id,text,extra={})=>({platform:'wechat',kind:'group',conversation_id:'123',sender_id:'456',self_id:'99',message_id:id,text,timestamp:1000,...extra});
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sync-test-'));t.after(()=>{if(!dir.startsWith(os.tmpdir()+path.sep))throw Error('bad fixture');fs.rmSync(dir,{recursive:true,force:true});});return {dir,buffer:new MessageBuffer(path.join(dir,'messages.json'))};}
async function until(check){for(let i=0;i<300;i++){if(check())return;await new Promise(r=>setTimeout(r,5));}throw Error('Fixture timeout');}
test('historical background is persisted as read and never triggers a reply',async t=>{
 const {dir,buffer}=fixture(t);let calls=0;const engine=new SocialEngine({buffer,decide:async()=>{calls++;return 'SILENT';},send:async()=>assert.fail('Unexpected send')});t.after(()=>engine.stop());
 engine.receive(msg('history','旧的聊天',{context_only:true}));engine.replay(key);await new Promise(r=>setTimeout(r,15));assert.equal(calls,0);assert.equal(buffer.unread(key).length,0);
 const restored=new MessageBuffer(path.join(dir,'messages.json'));assert.equal(restored.recent(key)[0].context_only,true);assert.equal(restored.unread(key).length,0);
});
test('recovered questions are batched once with background and can be marked read without sending',async t=>{
 const {buffer}=fixture(t);let calls=0,prompt='';const engine=new SocialEngine({buffer,batchMs:10,wakeWords:['小鲸鱼'],decide:async(_key,text)=>{calls++;prompt=text;return 'SILENT';},send:async()=>assert.fail('Unexpected send')});t.after(()=>engine.stop());
 engine.receive(msg('context','刚才的问题已经有人处理了',{context_only:true,timestamp:1010}));
 engine.receive(msg('q1','小鲸鱼怎么看',{recovered_unread:true}));engine.receive(msg('q2','小鲸鱼补充一句',{recovered_unread:true,timestamp:1001}));
 await until(()=>calls===1&&buffer.unread(key).length===0&&!engine.running.has(key));assert.match(prompt,/最近补读的聊天背景/);assert.match(prompt,/已解决、过时/);assert.match(prompt,/刚才的问题已经有人处理了/);
 assert.deepEqual(buffer.recent(key).map(row=>row.message_id),['q1','q2','context']);
 engine.receive(msg('q1','小鲸鱼怎么看',{recovered_unread:true}));await new Promise(r=>setTimeout(r,15));assert.equal(calls,1);
});
test('only WeChat transport carries recovery flags',()=>{
 const event={message_type:'group',group_id:123,user_id:456,message:[{type:'text',data:{text:'你好'}}],wechatagent:{historyContext:true,recoveredUnread:true}};
 assert.equal(normalizeOneBotEvent('wechat','test',event).context_only,true);assert.equal(normalizeOneBotEvent('qq','test',event).context_only,undefined);
});

test('reader stream is not consumed until the persistent OneBot receiver connects',async()=>{
 let calls=0;const adapter={stopped:false,socket:null,fetch:async()=>{calls++;throw Error('Must not consume');}};
 const task=HookOneBot.prototype.receiveSse.call(adapter);await new Promise(r=>setTimeout(r,10));adapter.stopped=true;await task;assert.equal(calls,0);
});


test('recovered social questions survive a DSH reconnect and are reviewed once ready',async t=>{
 const {buffer}=fixture(t);const {DshConnectionGuard}=await import('../components/qq-bridge/src/core/dsh-connection.js');
 let online=false,calls=0;const guard=new DshConnectionGuard({buffer,probe:async()=>({ready:online,instanceId:'sync-fixture'})});
 const engine=new SocialEngine({buffer,connection:guard,batchMs:1,wakeWords:['小鲸鱼'],decide:async()=>{calls++;return 'SILENT';},send:async()=>assert.fail('Unexpected send')});t.after(()=>{engine.stop();guard.stop();});
 await guard.check();engine.receive(msg('recovered','小鲸鱼怎么看',{recovered_unread:true}));
 await new Promise(r=>setTimeout(r,15));assert.equal(calls,0);assert.equal(buffer.unread(key).length,1);
 online=true;await guard.check({force:true});assert.equal(buffer.unread(key).length,1);engine.replay(key);
 await until(()=>calls===1&&buffer.unread(key).length===0&&!engine.running.has(key));
});
