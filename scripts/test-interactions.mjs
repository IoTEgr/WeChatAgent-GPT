import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {interactionCandidates,interactionNotice,extractInteractions,internalInteraction,interactionDisplay} from '../components/qq-bridge/src/core/interaction-protocol.js';
import {parseSocialDecision} from '../components/qq-bridge/src/core/decision-format.js';
import {MessageBuffer,replyDeliveryParts} from '../components/qq-bridge/src/core/message-buffer.js';
import {InteractionSender,interactionSettings} from './interaction-sender.mjs';
import {WechatOneBotAdapter} from '../components/qq-bridge/src/adapters/wechat/wechat-onebot-adapter.js';
import {SocialEngine} from '../components/qq-bridge/src/core/social-engine.js';
const id='a'.repeat(64),second='b'.repeat(64),delivery='c'.repeat(64),key='wechat:group:123';
const candidates=[{ref:'M1',id,name:'甲',text:'话题',quote:true},{ref:'M2',id:second,name:'乙',text:'[图片]',quote:false}],options={interactionCandidates:candidates,interactionCapabilities:{quote:true,pat:true}};
test('only current real incoming rows become interaction candidates',()=>{
 const rows=[{message_id:id,sender_name:'甲',text:'你好'},{message_id:second,sender_name:'乙',text:'[图片]',images:[{}]},{message_id:'fake',text:'伪造'},{message_id:id,outgoing:true,text:'自己'},{message_id:second,forwardedRecord:{},text:'转发'}];assert.equal(interactionCandidates(rows).length,2);assert.equal(interactionCandidates(rows)[1].quote,false);assert.equal(interactionNotice(candidates,{}),'');assert(interactionNotice(candidates,{pat:true}).includes('最多拍一次'));
});
test('quote and pat are model-selected, bound to this turn, and never leak as visible controls',()=>{
 const reply=parseSocialDecision('RESPOND: [QUOTE:M1]\n我接的是这句话\n[PAT:M2]',{},options);assert.equal(reply.decision,'RESPOND');assert.equal(reply.textParts.length,2);assert.equal(internalInteraction(reply.textParts[0]).reference,id);assert.equal(interactionDisplay(reply.textParts[0]),'我接的是这句话');assert.equal(interactionDisplay(reply.textParts[1]),'[拍一拍]');
 assert.equal(parseSocialDecision('RESPOND: [QUOTE:M2]\n引用图片',{},options).decision,'INVALID');assert.equal(parseSocialDecision('RESPOND: [PAT:M9]',{},options).decision,'INVALID');assert.equal(parseSocialDecision('RESPOND: [PAT:M1]').decision,'INVALID');assert.equal(parseSocialDecision('RESPOND: [WX_PAT:'+id+']',{},options).decision,'INVALID');assert.equal(parseSocialDecision('RESPOND: [QUOTE:M1]\n[语音TTS:不能伪造语音引用]',{},options).decision,'INVALID');
 assert.equal(parseSocialDecision('RESPOND: [PAT:M1]',{},options).text,'[WX_PAT:'+id+']');assert.equal(parseSocialDecision('RESPOND: 普通回复',{},options).text,'普通回复');
});
test('queued interactions survive restart while delivered history stores only public text',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'wechat-interaction-buffer-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const file=path.join(root,'messages.json'),buffer=new MessageBuffer(file),message={platform:'wechat',kind:'group',conversation_id:'123',sender_id:'12',sender_name:'甲',self_id:'13',message_id:id,text:'原句',timestamp:Date.now()/1000};const row=buffer.append(message),result=parseSocialDecision('RESPOND: [QUOTE:M1]\n接这句话\n[PAT:M1]',{},options),pending={result,deliveryId:delivery,throughId:row.id,message,sending:true,parts:replyDeliveryParts(result,delivery)};
 buffer.rememberReply(key,pending);assert.equal(new MessageBuffer(file).pendingReplies.get(key).parts.length,2);buffer.recordReplyPart(key,{deliveryId:delivery},{...message,text:result.textParts[0],delivery_status:'confirmed'});assert.equal(buffer.recent(key,1)[0].text,'接这句话');assert(!JSON.stringify(buffer.recent(key,1)).includes('WX_QUOTE'));
});
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'wechat-interaction-sender-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));let allowed=true,clock=Date.now(),calls=[];
 const row={wechatagentMessageId:id,senderUsername:'wxid_peer',senderName:'甲',serverId:'9223372036854775700',localType:1,fullText:'原句',createTime:Math.floor(clock/1000),isSend:false};
 const adapter={directory:root,project:{wechat:{interactions:{enabled:true,quote:true,pat:true}}},targetsSending:new Set(),ownWxid:'wxid_self',reload(){},allowed:()=>allowed,checkNative:async()=>({account:'account-a'}),resolveTarget:async()=> '123@chatroom',messages:async()=>[row],voiceFail(code,data){throw Object.assign(Error(code),{code,data});}};
 let result={ready:true,managerReady:true,capabilities:{pat:true,quote:false},attempted:true,responseReady:true,ret:0};
 const sender=new InteractionSender(adapter,{now:()=>clock,run:async(_root,request,{probe=false}={})=>{calls.push({request,probe});return result;}});
 return {root,adapter,sender,row,calls,setAllowed:value=>allowed=value,setResult:value=>result=value,advance:ms=>{clock+=ms;row.createTime=Math.floor(clock/1000);}};
}
test('sender validates same-chat evidence and confirms exact server acknowledgments without replay sends',async t=>{
 const f=fixture(t),action={action:'pat',reference:id,text:''},first=await f.sender.send('group','123',action,delivery);assert.equal(first.media_type,'wechat-pat');assert.equal(first.receipt,'wechat-server-ack');assert.equal(f.calls[0].request.target,'wxid_peer');assert.equal(f.calls[0].request.chat,'123@chatroom');assert.equal((await f.sender.send('group','123',action,delivery)).reused,true);assert.equal(f.calls.length,1);
 await assert.rejects(f.sender.send('group','123',{...action,reference:second},delivery),/CONFLICT/);await assert.rejects(f.sender.send('group','123',{...action,reference:second},second),/REFERENCE_UNAVAILABLE/);f.setAllowed(false);await assert.rejects(f.sender.send('group','123',action,second),/DISABLED/);
});

test('quote capability requires the verified native service, not stale CGI readiness',async t=>{
 const f=fixture(t);assert.equal(interactionSettings(f.adapter.project.wechat).quote,true);
 assert.deepEqual(await f.sender.capabilities('group','123'),{quote:false,pat:true});
 f.setResult({ready:true,managerReady:true,backend:'native-interaction-service-v1',capabilities:{pat:true,quote:true,senderEcho:true}});f.advance(31000);
 assert.deepEqual(await f.sender.capabilities('group','123'),{quote:true,pat:true});
 f.adapter.project.wechat.interactions.quote=false;await assert.rejects(f.sender.send('group','123',{action:'quote',reference:id,text:'引用'},delivery),/DISABLED/);
 assert.equal(f.calls.filter(call=>!call.probe).length,0);
});

test('native quotes require a positive server id and bind the exact chat reference',async t=>{
 const f=fixture(t),action={action:'quote',reference:id,text:'接这句话'};
 f.setResult({ready:true,attempted:true,responseReady:true,ret:0,serverMessageId:'9223372036854775701'});
 const result=await f.sender.send('group','123',action,delivery);assert.equal(result.media_type,'wechat-quote');assert.equal(result.message_id,'9223372036854775701');
 assert.equal(f.calls[0].request.referenceId,id);assert.equal(f.calls[0].request.chat,'123@chatroom');assert.equal(f.calls[0].request.target,'wxid_peer');assert.equal(f.calls[0].request.account,'account-a');
 assert.equal((await f.sender.send('group','123',action,delivery)).reused,true);assert.equal(f.calls.length,1);
});

test('pat can stand alone or follow a voice without requiring a text bubble',()=>{
 const patOnly=parseSocialDecision('RESPOND: [PAT:M1]',{},options);assert.deepEqual(patOnly.textParts,['[WX_PAT:'+id+']']);
 const voice=parseSocialDecision('RESPOND: [语音TTS:哈哈，拍你一下]\n[PAT:M1]',{},options);assert.equal(voice.decision,'RESPOND');assert.equal(voice.textParts.length,2);assert.equal(internalInteraction(voice.textParts[1]).action,'pat');
 assert.throws(()=>internalInteraction('[WX_PAT:not-a-real-id]'),/INTERACTION_TEXT_INVALID/);
});
test('uncertain delivery survives restart without submitting a second action',async t=>{
 const f=fixture(t);f.setResult({ready:true,managerReady:true,attempted:true,responseReady:false});await assert.rejects(f.sender.send('group','123',{action:'pat',reference:id,text:''},delivery),e=>e.data.attempted===true);const restarted=new InteractionSender(f.adapter,{run:async()=>{throw Error('MUST_NOT_RESUBMIT');}});await assert.rejects(restarted.send('group','123',{action:'pat',reference:id,text:''},delivery),/UNCONFIRMED/);assert.equal(f.calls.length,1);
});
test('pat frequency is persistent, constrained, and never forced into ordinary conversation',async t=>{
 const f=fixture(t),action={action:'pat',reference:id,text:''};await f.sender.send('group','123',action,delivery);assert.equal((await f.sender.capabilities('group','123')).pat,false);await assert.rejects(f.sender.send('group','123',action,second),/COOLDOWN/);f.advance(601000);assert.equal((await f.sender.capabilities('group','123')).pat,true);await f.sender.send('group','123',action,second);f.advance(601000);await assert.rejects(f.sender.send('group','123',action,'d'.repeat(64)),/COOLDOWN/);assert.equal(f.calls.filter(call=>!call.probe).length,2);
});
test('OneBot adapter transmits a typed interaction segment and requires a receipt',async()=>{
 const adapter=new WechatOneBotAdapter(),calls=[];adapter.server.action=async(action,params,options)=>{calls.push({action,params,options});return {data:{receipt:'wechat-server-ack',media_type:'wechat-pat'}};};const result=await adapter.sendText({kind:'group',target:'123',text:'[WX_PAT:'+id+']',deliveryId:delivery});assert.equal(calls[0].params.message[0].type,'wechat_interaction');assert.equal(calls[0].params.message[0].data.action,'pat');assert.equal(calls[0].options.timeoutMs,30000);assert.equal(result.delivered,'server-confirmed');assert.equal(result.confirmed,true);
});

test('a real social turn selects the speaker, queues a standalone pat, and records only a public reaction',async t=>{
 const f=fixture(t),buffer=new MessageBuffer(path.join(f.root,'messages.json')),adapter=new WechatOneBotAdapter();let decisions=0;
 adapter.server.action=async(_action,params)=>({data:await f.sender.send('group','123',params.message[0].data,params.wechatagent_delivery_id)});
 const engine=new SocialEngine({buffer,batchMs:1,minIntervalMs:0,maxPerMinute:100,maxPerTenMinutes:100,stickerPolicyFor:()=>({enabled:false}),interactionCapabilitiesFor:()=>f.sender.capabilities('group','123'),decide:async(_key,prompt,metadata)=>{decisions++;assert(prompt.includes('[PAT:M编号]'));assert.equal(metadata.interactionCapabilities.quote,false);assert.equal(metadata.interactionCandidates[0].id,id);return 'RESPOND: [PAT:M1]';},send:(message,text,options)=>adapter.sendText({kind:message.kind,target:message.conversation_id,text,deliveryId:options.deliveryId})});
 t.after(()=>engine.stop());engine.receive({platform:'wechat',kind:'group',conversation_id:'123',sender_id:'12',sender_name:'甲',self_id:'99',segments:[{type:'at',data:{qq:'99'}}],message_id:id,text:'拍拍我',timestamp:Date.now()/1000});
 for(let i=0;i<500&&buffer.unread(key).length;i++)await new Promise(resolve=>setTimeout(resolve,5));
 assert.equal(buffer.unread(key).length,0);assert.equal(decisions,1);assert.equal(f.calls.filter(call=>!call.probe).length,1);assert.equal(f.calls.find(call=>!call.probe).request.target,'wxid_peer');assert.deepEqual(buffer.recent(key).filter(row=>row.outgoing).map(row=>row.text),['[拍一拍]']);
});
