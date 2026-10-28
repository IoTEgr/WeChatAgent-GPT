import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {cleanMalformedChatDecoration} from '../components/qq-bridge/src/core/wechat-faces.js';
import {SocialEngine} from '../components/qq-bridge/src/core/social-engine.js';import {MessageBuffer} from '../components/qq-bridge/src/core/message-buffer.js';
test('observed broken bracket decorations are removed without inventing a replacement emotion',()=>{
 assert.equal(cleanMalformedChatDecoration('嗯，确实挺憋屈的】【。'),'嗯，确实挺憋屈的。');
 assert.equal(cleanMalformedChatDecoration('唉，听着确实挺让人泄气的】【、】【'),'唉，听着确实挺让人泄气的');
 assert.equal(cleanMalformedChatDecoration('好呀 】【'),'好呀');assert.equal(cleanMalformedChatDecoration('】【'),'');
});
test('valid kaomoji, WeChat faces, adjacent bracketed text, code and literal discussion are preserved',()=>{
 for(const text of ['好呀 (≧▽≦)','唉 (T_T)','（>_<）','[害羞]','【甲】【乙】','`】【`','“】【”','「】【」','符号是 】【。','```text\n】【\n```','[语音回复:有人发了】【，问你怎么看]'])assert.equal(cleanMalformedChatDecoration(text),text,text);
});
test('warm-whale replies and quoted replies are cleaned before delivery and persisted as actual sent text',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'chat-decoration-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const buffer=new MessageBuffer(path.join(dir,'messages.json')),sent=[];let count=0;
 const engine=new SocialEngine({buffer,personaNameFor:()=> '暖宝小鲸鱼',batchMs:1,minIntervalMs:0,maxPerMinute:100,maxPerTenMinutes:100,stickerPolicyFor:()=>({enabled:false}),interactionCapabilitiesFor:()=>({quote:true}),decide:async()=>++count===1?'RESPOND: 嗯，确实挺憋屈的】【。':'RESPOND: [QUOTE:M1]\n唉，听着确实挺让人泄气的】【、】【',send:async(_m,text)=>{sent.push(text);return{delivered:'database-confirmed'};}});t.after(()=>engine.stop());
 const input=id=>({platform:'wechat',kind:'group',conversation_id:'123',sender_id:'7',self_id:'99',sender_name:'甲',message_id:id.repeat(64),text:'你好',segments:[{type:'at',data:{qq:'99'}}],timestamp:Date.now()/1000});
 engine.receive(input('a'));for(let i=0;i<150&&sent.length<1;i++)await new Promise(r=>setTimeout(r,5));assert.deepEqual(sent,['嗯，确实挺憋屈的。']);
 for(let i=0;i<100&&engine.running.size;i++)await new Promise(r=>setTimeout(r,5));engine.receive(input('b'));for(let i=0;i<150&&sent.length<2;i++)await new Promise(r=>setTimeout(r,5));assert.equal(sent.length,2);assert.match(sent[1],/^\[WX_QUOTE:[a-f0-9]{64}\]\n唉，听着确实挺让人泄气的$/);assert(!buffer.recent('wechat:group:123').filter(r=>r.outgoing).some(r=>r.text.includes('】【')));
});
