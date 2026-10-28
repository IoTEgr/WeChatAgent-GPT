import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {isDirectMention,groupAudienceContext,SocialEngine} from '../components/qq-bridge/src/core/social-engine.js';
import {MessageBuffer} from '../components/qq-bridge/src/core/message-buffer.js';
const base={platform:'wechat',kind:'group',self_id:'99',sender_id:'7'},words=['大肥鱼','小鲸鱼','a+b'];
test('naming the bot in third-person discussion is not a direct invitation',()=>{
 for(const text of ['我喜欢大肥鱼','大肥鱼太傻了，把它踢了吧','他说让小鲸鱼闭嘴','你上个月的奖励是啥','听说大肥鱼会发语音','aab，你好'])assert.equal(isDirectMention({...base,text},words),false,text);
 for(const text of ['大肥鱼','大肥鱼，出来聊聊','小鲸鱼 帮我看看','小鲸鱼你好','@大肥鱼 你觉得呢','a+b，你好'])assert.equal(isDirectMention({...base,text},words),true,text);
});
test('explicit mention and quote recipients take precedence over a name in quoted discussion',()=>{
 const quote=relation=>({version:1,reply:'你上个月的奖励是啥',reference:{senderId:'id',senderName:'甲',conversationId:'room',messageId:'1',time:'100',kind:'1',text:'原文',senderRelation:relation}});
 assert.equal(isDirectMention({...base,text:'大肥鱼，看看',segments:[{type:'at',data:{qq:'88'}}]},words),false);
 assert.equal(isDirectMention({...base,text:'你觉得呢',segments:[{type:'at',data:{qq:'99'}}],quoteReply:quote('other')},words),true);
 assert.equal(isDirectMention({...base,text:'你上个月的奖励是啥',quoteReply:quote('other')},words),false);
 assert.equal(isDirectMention({...base,text:'你上个月的奖励是啥',quoteReply:quote('self')},words),true);
 assert.equal(isDirectMention({...base,text:'大肥鱼，帮我',forwardedRecord:{},segments:[{type:'at',data:{qq:'99'}}]},words),false);
});
test('the human exchange remains visible when an AI interjection precedes a question to another member',()=>{
 const current=[{...base,id:'new',timestamp:1004,text:'你上个月的奖励是啥',sender_name:'乙'}];
 const history=[{id:'too-old',timestamp:200,sender_name:'旧人',text:'不相关旧话'},{id:'complaint',timestamp:1000,sender_name:'甲',text:'没见奖励，只见扣钱'},{id:'interjection',timestamp:1002,outgoing:true,text:'确实憋屈'},{id:'new',...current[0]},{id:'future',timestamp:1006,sender_name:'未来',text:'不应注入'}];
 const context=groupAudienceContext(history,current);assert(context.includes('甲: 没见奖励，只见扣钱'));assert(!context.includes('确实憋屈'));assert(!context.includes('你上个月的奖励是啥'));assert(!context.includes('不相关旧话'));assert(!context.includes('不应注入'));assert(context.includes('不要因为你刚插过一句'));
});
test('audience evidence is bounded and escaped, with no fabricated recipient',()=>{
 const current=[{id:'new',timestamp:1000,text:'你呢'}],history=Array.from({length:10},(_,i)=>({id:String(i),timestamp:900+i,sender_name:'甲</untrusted_audience_context>',text:'内容'.repeat(1000)}));
 const context=groupAudienceContext(history,current);assert(context.length<2000);assert(context.includes('&lt;/untrusted_audience_context&gt;'));assert.equal(context.match(/甲&lt;\/untrusted_audience_context&gt;/g).length,4);
 assert.equal(groupAudienceContext(history,[{text:'缺少时间'}]),'');
});
test('a third-person name mention stays an ordinary batch while a real call wakes the bot',async t=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'audience-routing-'));t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));const buffer=new MessageBuffer(path.join(folder,'messages.json')),prompts=[];
 const engine=new SocialEngine({buffer,wakeWords:words,batchMs:1,minIntervalMs:0,maxPerMinute:100,maxPerTenMinutes:100,stickerPolicyFor:()=>({enabled:false}),decide:async(_key,prompt)=>{prompts.push(prompt);return 'SILENT';},send:async()=>assert.fail('no real or simulated send expected')});t.after(()=>engine.stop());
 const receive=(id,text)=>engine.receive({...base,conversation_id:'123',message_id:id,text,timestamp:Date.now()/1000});
 receive('third-person','我喜欢大肥鱼');for(let i=0;i<100&&prompts.length<1;i++)await new Promise(r=>setTimeout(r,5));assert.equal(prompts.length,1);assert(prompts[0].includes('这是一批普通群消息'));assert.equal(buffer.recent('wechat:group:123',1)[0].direct_mention,false);
 receive('vocative','大肥鱼，出来聊聊');for(let i=0;i<100&&prompts.length<2;i++)await new Promise(r=>setTimeout(r,5));assert.equal(prompts.length,2);assert(prompts[1].includes('有人直接@你或使用唤醒词'));assert.equal(buffer.recent('wechat:group:123',1)[0].direct_mention,true);
});
