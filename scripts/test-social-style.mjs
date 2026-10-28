import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {nativeWechatFaces} from '../components/qq-bridge/src/core/wechat-faces.js';
import {asksForQuiet,ChatParticipation} from '../components/qq-bridge/src/core/chat-participation.js';
import {reconsiderVoice} from '../components/qq-bridge/src/core/voice-choice.js';
import {SocialEngine,buildSocialPrompt} from '../components/qq-bridge/src/core/social-engine.js';import {MessageBuffer} from '../components/qq-bridge/src/core/message-buffer.js';
const wait=async predicate=>{for(let i=0;i<500&&!predicate();i++)await new Promise(r=>setTimeout(r,5));assert(predicate());};
test('a direct mention remains the response focus when another member appends a laugh',()=>{
 const rows=[{text:'@大肥鱼 还不谢谢我',sender_id:'7',self_id:'99',sender_name:'群友',direct_mention:true,segments:[{type:'at',data:{qq:'99'}}]},{text:'哈哈哈',sender_id:'8',self_id:'99',sender_name:'另一人'}];
 const prompt=buildSocialPrompt({key:'wechat:group:123',rows,direct:true,lastReplyAt:Date.now()});
 assert.match(prompt,/直接互动在下方聊天原文第 1 条/);assert.match(prompt,/不只看最后一条普通附和/);
 const ordinary=buildSocialPrompt({key:'wechat:group:123',rows:[rows[1]],direct:false});assert.doesNotMatch(ordinary,/直接互动在下方/);
 const forwarded=buildSocialPrompt({key:'wechat:group:123',rows:[{...rows[0],forwardedRecord:{}}],direct:true});assert.doesNotMatch(forwarded,/直接互动在下方/);
});
function fixture(t,options={}){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fish-social-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const buffer=new MessageBuffer(path.join(dir,'messages.json')),sent=[],calls=[];const engine=new SocialEngine({buffer,batchMs:1,minIntervalMs:0,privateMinIntervalMs:0,maxPerMinute:100,maxPerTenMinutes:100,stickerPolicyFor:()=>({enabled:false}),personaNameFor:()=> '大肥鱼',decide:async(...args)=>{calls.push(args);return 'RESPOND: 好呀😂';},send:async(_m,text)=>{sent.push(text);return {confirmed:true};},...options});t.after(()=>engine.stop());let seq=0;return {buffer,sent,calls,engine,message(text,direct=false){return {platform:'wechat',kind:'group',conversation_id:'123',sender_id:'7',self_id:'99',message_id:String(++seq).padStart(64,'a'),text,direct_mention:direct,...(direct?{segments:[{type:'at',data:{qq:'99'}}]}:{}),timestamp:Date.now()/1000};}};}
test('face decorations become native WeChat shortcodes while code, quoted examples, kaomoji and non-face emoji remain literal',()=>{assert.equal(nativeWechatFaces('哈哈😂 苦笑🥲 坏笑😏 尴尬😅 🤦🏻‍♂️'),'哈哈[破涕为笑] 苦笑[苦涩] 坏笑[坏笑] 尴尬[尴尬] [捂脸]');assert.equal(nativeWechatFaces('`😂` “🥲” 🍎 ❤️ (￣▽￣) [微笑]'),'`😂` “🥲” 🍎 ❤️ (￣▽￣) [微笑]');});
test('quiet commands are anchored, ignore quotes and forwarded logs, and are scoped to groups',()=>{for(const text of ['闭嘴','你先别说话了','不要再说了','别老插嘴','@大肥鱼\u2005安静一下','大肥鱼闭嘴吧'])assert(asksForQuiet({kind:'group',text},true),text);for(const text of ['他说让我闭嘴了','“闭嘴”是什么意思','我刚才问你别人的事'])assert(!asksForQuiet({kind:'group',text},true),text);assert(!asksForQuiet({kind:'private',text:'闭嘴'},true));assert(!asksForQuiet({kind:'group',text:'闭嘴',forwardedRecord:{}},true));});
test('persistent quiet state remains isolated by account and conversation',t=>{const f=fixture(t),state=f.engine.participation;state.set('wechat:group:123','99',true);assert(new ChatParticipation(state.file).quiet('wechat:group:123','99'));assert(!state.quiet('wechat:group:456','99'));assert(!state.quiet('wechat:group:123','100'));state.set('wechat:group:123','99',false);assert(!new ChatParticipation(state.file).quiet('wechat:group:123','99'));});
test('a quiet request sends no final acknowledgment, suppresses ordinary chatter, and a direct call resumes',async t=>{const f=fixture(t);f.engine.receive(f.message('闭嘴'));await new Promise(r=>setTimeout(r,20));f.engine.receive(f.message('别人接着聊天'));await new Promise(r=>setTimeout(r,20));assert.equal(f.calls.length,0);assert.equal(f.sent.length,0);f.engine.receive(f.message('@大肥鱼\u2005回来聊聊',true));await wait(()=>f.sent.length===1);assert.equal(f.sent[0],'好呀[破涕为笑]');});
test('a stop arriving during model generation discards the result',async t=>{let release;const pending=new Promise(r=>{release=r;});const f=fixture(t,{decide:async()=>pending});f.engine.receive(f.message('聊一聊',true));await wait(()=>f.engine.running.size===1);f.engine.receive(f.message('先别插嘴了'));release('RESPOND: 我还想说😂');await wait(()=>f.engine.running.size===0);assert.equal(f.sent.length,0);});
test('only an explicit current voice request receives a modality review',()=>{assert(!reconsiderVoice({decision:'RESPOND',text:'今天真累😂'},[{text:'累瘫了'}]));assert(reconsiderVoice({decision:'RESPOND',text:'先歇一会儿'},[{text:'请用语音安慰我'}]));assert(!reconsiderVoice({decision:'RESPOND',text:'先歇一会儿'},[{text:'请发语音'},{text:'改用文字吧'}]));for(const result of [{decision:'RESPOND',text:'[语音回复:对方累了]'},{decision:'RESPOND',text:'[微笑]'},{decision:'RESPOND',text:'(T_T)'},{decision:'STICKER',stickerId:'a'.repeat(64)},{decision:'RESPOND',text:'https://example.com'}])assert(!reconsiderVoice(result,[{text:'你好'}]));assert(!reconsiderVoice({decision:'RESPOND',text:'可以这样做'},[{text:'我现在不方便听语音，用文字'}]));});
test('voice review chooses a context summary rather than sending the original prewritten text',async t=>{let calls=0;const f=fixture(t,{contextVoiceFor:()=>true,decide:async()=>++calls===1?'RESPOND: 今天真累😂':'RESPOND: [语音回复:群友刚下班，抱怨今天累，熟人间接话安慰]',send:async(_m,text)=>{f.sent.push(text);return {confirmed:true,spokenText:'累啦，先歇一会儿。'};}});f.engine.receive(f.message('今天累瘫了，请用语音安慰我',true));await wait(()=>f.sent.length===1);assert.equal(calls,2);assert.match(f.sent[0],/^\[语音回复:/);assert(!f.sent[0].includes('今天真累'));const outgoing=f.buffer.recent('wechat:group:123').find(r=>r.outgoing);assert.equal(outgoing.reply_kind,'voice');assert.equal(outgoing.text,'累啦，先歇一会儿。');});
test('a voice review failure preserves the valid original reply and normalizes its face',async t=>{let calls=0;const f=fixture(t,{contextVoiceFor:()=>true,decide:async()=>{if(++calls===2)throw Error('temporary');return 'RESPOND: 收到😏';}});f.engine.receive(f.message('请发语音',true));await wait(()=>f.sent.length===1);assert.equal(f.sent[0],'收到[坏笑]');});

for(const reviewed of ['SILENT','OBSERVE','DEFER'])test('modality review cannot discard an unsent response: '+reviewed,async t=>{
 let calls=0;const f=fixture(t,{contextVoiceFor:()=>true,decide:async()=>++calls===1?'RESPOND: 来啦，找鱼什么事[偷笑]':reviewed});f.engine.receive(f.message('@大肥鱼 请用语音说一句',true));await wait(()=>f.sent.length===1);
 assert.equal(calls,2);assert.equal(f.sent[0],'来啦，找鱼什么事[偷笑]');assert.equal(f.buffer.unread('wechat:group:123').length,0);
});

test('a real quiet command arriving during modality review still cancels the response',async t=>{
 let calls=0;const f=fixture(t,{contextVoiceFor:()=>true,decide:async()=>{if(++calls===1)return 'RESPOND: 来啦';f.engine.receive(f.message('先别说话了',true));return 'SILENT';}});f.engine.receive(f.message('请用语音聊聊',true));await wait(()=>calls===2&&f.engine.running.size===0);assert.equal(f.sent.length,0);
});

test('scheduled proactive chatter respects the current account quiet state',async()=>{
 const {ProactiveEngine}=await import('../components/qq-bridge/src/core/proactive-engine.js');const fake={buffer:{recent:()=>[],maxPerChat:300},social:{participation:{quiet:(key,self)=>key==='wechat:group:123'&&self==='99'}},selfIdFor:()=> '99'};assert.equal(ProactiveEngine.prototype.eligible.call(fake,'wechat:group:123',{enabled:true},Date.now()),false);
});

test('ordinary direct group questions keep text without a forced voice review',async t=>{let calls=0;const f=fixture(t,{contextVoiceFor:()=>true,decide:async()=>{calls++;return 'RESPOND: 来啦，什么事？';}});f.engine.receive(f.message('@大肥鱼 快出来',true));await wait(()=>f.sent.length===1);assert.equal(calls,1);assert.equal(f.sent[0],'来啦，什么事？');});

for(const targeted of [false,true])test('native mention capability permits contextual selection without forcing ordinary text: '+targeted,async t=>{
 const f=fixture(t,{interactionCapabilitiesFor:()=>({mention:true,quote:false,pat:false}),decide:async(_key,prompt,metadata)=>{
  assert(prompt.includes('默认直接接话，不自动 @ 最后一位发言人'));assert(prompt.includes('对方未回应不反复 @ 催促'));assert.equal(metadata.autoMention,undefined);
  return targeted?'RESPOND: [AT:M1]\n你准备去哪座山？':'RESPOND: 打工人的命也是命啊[破涕为笑]';
 }});
 const input=f.message(targeted?'我周末去爬山':'今天上班累死了',true);f.engine.receive(input);await wait(()=>f.sent.length===1);
 assert.equal(f.sent[0],targeted?'[WX_AT:'+input.message_id+']\n你准备去哪座山？':'打工人的命也是命啊[破涕为笑]');
});
