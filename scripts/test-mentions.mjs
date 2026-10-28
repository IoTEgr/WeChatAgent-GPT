import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {parseSocialDecision} from '../components/qq-bridge/src/core/decision-format.js';
import {internalInteraction,interactionDisplay} from '../components/qq-bridge/src/core/interaction-protocol.js';
import {HookOneBot} from './hook-onebot.mjs';
import {TextDeliveryStore} from './text-delivery-store.mjs';
const a='a'.repeat(64),b='b'.repeat(64),d='d'.repeat(64),options={autoMention:true,interactionCapabilities:{mention:true},interactionCandidates:[{ref:'M1',id:a},{ref:'M2',id:b}]};
test('ordinary group text never auto mentions, including a stale autoMention option',()=>{
 for(const text of ['收到啦','打工人的命也是命啊[破涕为笑]','我也这么觉得','你准备去哪座山？']){
  const value=parseSocialDecision('RESPOND: '+text,{},options);assert.equal(value.text,text);assert.equal(internalInteraction(value.textParts?.[0]??value.text),null);
 }
});
test('an explicit contextual mention can select the intended speaker rather than the latest',()=>{
 const other=parseSocialDecision('RESPOND: [AT:M1]\n我接你刚才那句',{},options);assert.equal(internalInteraction(other.textParts[0]).reference,a);
 assert.equal(interactionDisplay(other.textParts[0]),'我接你刚才那句');
});
test('no automatic mention on voice, standalone sticker, silence, private or unavailable backend',()=>{
 assert(!parseSocialDecision('RESPOND: [语音回复:聊聊刚才的趣事]',{},options).text.includes('WX_AT'));
 assert.equal(parseSocialDecision('RESPOND: [STICKER:'+a+']',{},options).decision,'STICKER');
 assert.equal(parseSocialDecision('SILENT',{},options).text,'');
 assert.equal(parseSocialDecision('RESPOND: 好',{}, {...options,autoMention:false}).text,'好');
 assert.equal(parseSocialDecision('RESPOND: 好',{}, {...options,interactionCapabilities:{}}).text,'好');
 for(const output of ['RESPOND: [AT:M9]\n好','RESPOND: [WX_AT:'+a+']\n好','RESPOND: [AT:M1]\n[语音回复:问候]'])assert.equal(parseSocialDecision(output,{},options).decision,'INVALID');
});
function fixture(t){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'wca-mention-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const row={wechatagentMessageId:a,senderUsername:'wxid_peer',senderDisplay:'群友甲',createTime:Date.now()/1000,isSend:false};let sent=[],reads=0;
 const adapter=Object.create(HookOneBot.prototype);Object.assign(adapter,{directory,targetsSending:new Set(),hook:{receiptTimeoutMs:50},pollMs:1,stopped:false,ownWxid:'wxid_me',project:{wechat:{interactions:{enabled:true}}},status:{native_mention_send:true,confirmed_sends:0},textDeliveries:new TextDeliveryStore(path.join(directory,'deliveries')),reload(){},allowed:()=>true,checkNative:async()=>({account:'account-a'}),resolveTarget:async()=> 'room@chatroom',messages:async()=>{reads++;return sent.length?[row,{isSend:true,localType:1,localId:101,createTime:Date.now()/1000,fullText:sent[0].text,serverId:'12345'}]:[row];},mentionCommand:async(_root,request)=>{sent.push(request);return {ret:0,attempted:true};}});
 return {adapter,row,sent,reads:()=>reads};
}
test('mention binds a current same-chat sender, requires receipt, durable replay does not resend',async t=>{
 const f=fixture(t),result=await f.adapter.send('group','123','你好',d,undefined,a);assert.equal(result.receipt,'wechat-server-id');assert.equal(f.sent[0].member,'wxid_peer');assert.equal(f.sent[0].text,'@群友甲\u2005你好');
 f.row.senderDisplay='已改名';f.row.createTime=1;const replay=await f.adapter.send('group','123','你好',d,undefined,a);assert.equal(replay.reused,true);assert.equal(f.sent.length,1);
 await assert.rejects(f.adapter.send('group','123','不同内容',d,undefined,a),/CONFLICT/);
 await assert.rejects(f.adapter.send('group','123','你好',d,undefined,b),/CONFLICT/);
});
test('mention rejects private, stale, outgoing, self, invented and notify-all targets before submission',async t=>{
 const f=fixture(t);await assert.rejects(f.adapter.send('private','123','你好',d,undefined,a));
 for(const change of [{createTime:1},{createTime:Date.now()/1000+3600},{isSend:true},{senderUsername:'wxid_me'},{senderUsername:'notify_all'},{senderUsername:'bad@chatroom'},{wechatagentMessageId:b}]){
  const copy={...f.row};Object.assign(f.row,change);await assert.rejects(f.adapter.send('group','123','你好',d,undefined,a));Object.assign(f.row,copy);
 }assert.equal(f.sent.length,0);
});
