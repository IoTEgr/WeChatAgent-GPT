import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {bindStickerPacks,createStickerPacks,stickerPacksAllowed,STICKER_PACK_POLICY} from '../packages/dsh-social-bridge-plugin/sticker-packs.mjs';

const key='wechat:group:123',candidate='a'.repeat(64),ready='b'.repeat(64);
function binding(library){
  const tools=new Map(),ctx={tools:{register:definition=>{tools.set(definition.name,definition);return ()=>tools.delete(definition.name);}}};
  let turn={controller:new AbortController(),choices:[],calls:0};
  const dispose=bindStickerPacks(ctx,library,key,()=>turn);
  return {ctx,dispose,tools,get turn(){return turn;},next(){turn={controller:new AbortController(),choices:[],calls:0};},call:async(name,args)=>JSON.parse((await tools.get(name).execute(args)).content)};
}
test('installed collections use native sticker permission independently of meme library and web search',()=>{
  const wechat={whitelist:{groups:[123]},stickers:{enabled:true},search:{enabled:false},memeLibrary:{enabled:false}};
  assert(stickerPacksAllowed(wechat,key));assert(!stickerPacksAllowed(wechat,'wechat:group:456'));
  assert(!stickerPacksAllowed({...wechat,stickers:{enabled:true,chats:{[key]:false}}},key));
});
test('candidate IDs are limited to the current turn and selection is shared with existing meme tools',async()=>{
  let sends=0;const library={check(){},async search(){return [{id:candidate,caption:'哈哈',packName:'月薪喵'}];},async select(){sends++;return {id:ready,source:'wechat-installed-packs',description:'哈哈',tags:['daily']};}};
  const b=binding(library);
  assert.equal((await b.call('wechat_sticker_pack_select',{id:candidate})).error,'STICKER_PACK_CANDIDATE_NOT_IN_TURN');
  b.next();await b.call('wechat_sticker_pack_search',{query:'笑'});
  const result=await b.call('wechat_sticker_pack_select',{id:candidate});assert.equal(result.reply,'RESPOND: [STICKER:'+ready+']');assert.equal(b.turn.choices.length,1);
  assert.equal((await b.call('wechat_sticker_pack_select',{id:candidate})).error,'STICKER_PACK_ONE_SELECTION_PER_TURN');assert.equal(sends,1);
  b.next();assert.equal((await b.call('wechat_sticker_pack_select',{id:candidate})).error,'STICKER_PACK_CANDIDATE_NOT_IN_TURN');
  assert(b.ctx[STICKER_PACK_POLICY].names().has('wechat_sticker_pack_search'));
  b.dispose();assert.equal(b.tools.size,0);assert.equal(b.ctx[STICKER_PACK_POLICY],undefined);
});
test('revocation and a late result after turn cancellation cannot offer a send resource',async()=>{
  let allowed=true,release;const library={check(){if(!allowed)throw Error('STICKER_PACK_CHAT_NOT_ALLOWED');},async search(){await new Promise(resolve=>release=resolve);return [{id:candidate}];}};
  const b=binding(library),request=b.call('wechat_sticker_pack_search',{query:'笑'});
  b.next();release();assert.equal((await request).error,'STICKER_PACK_TURN_CHANGED');assert.equal(b.turn.packCandidates,undefined);
  allowed=false;assert.equal(b.ctx[STICKER_PACK_POLICY].names().size,0);assert.equal((await b.call('wechat_sticker_pack_search',{query:'笑'})).error,'STICKER_PACK_CHAT_NOT_ALLOWED');b.dispose();
});
test('reader requests remain loopback authenticated, bounded, and contain three text candidates only',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'installed-sticker-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(path.join(root,'config'));fs.mkdirSync(path.join(root,'state'));
  fs.writeFileSync(path.join(root,'config/wechatagent.json'),JSON.stringify({wechat:{whitelist:{groups:[123]},stickers:{enabled:true}}}));
  const io=path.join(root,'state/wechat-io-config.json');fs.writeFileSync(io,JSON.stringify({reader_base_url:'http://127.0.0.1:1234',reader_token:'synthetic-token'}));
  const calls=[];const library=createStickerPacks({root,fetchImpl:async(url,options)=>{calls.push({url,options});return Response.json(options.method==='GET'?{sendSupported:true,candidates:[{id:candidate,caption:'哈哈',packName:'月薪喵',privatePath:'not-returned'}]}:{ready:true,id:ready,source:'wechat-installed-packs',description:'哈哈'});}});
  const result=await library.search(key,'笑');assert.deepEqual(result,[{id:candidate,caption:'哈哈',packName:'月薪喵'}]);
  await library.select(key,candidate);assert.equal(calls[0].options.headers.authorization,'Bearer synthetic-token');assert(calls[0].url.includes('limit=3'));
  assert.deepEqual(JSON.parse(calls[1].options.body),{conversationKey:key,id:candidate});
  fs.writeFileSync(io,JSON.stringify({reader_base_url:'https://example.com',reader_token:'synthetic-token'}));
  await assert.rejects(library.search(key,'笑'),/STICKER_PACK_READER_INVALID/);assert.equal(calls.length,2);
});


test('selected installed-pack resources reach the existing text and sticker delivery lanes',async t=>{
  const {SocialEngine}=await import('../components/qq-bridge/src/core/social-engine.js');
  const {MessageBuffer}=await import('../components/qq-bridge/src/core/message-buffer.js');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'installed-sticker-delivery-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const buffer=new MessageBuffer(path.join(root,'messages.json')),sent=[];
  const engine=new SocialEngine({buffer,batchMs:1,minIntervalMs:0,privateMinIntervalMs:0,maxPerMinute:100,maxPerTenMinutes:1000,
    decide:async(_key,_prompt,metadata)=>{metadata.memeChoices=[{id:ready,source:'wechat-installed-packs',description:'哈哈',tags:['daily']}];return 'RESPOND: 哈哈哈\n[STICKER:'+ready+']';},
    send:async(_message,text)=>{sent.push({text});return {delivered:'database-confirmed'};},
    sendSticker:async(_message,id)=>{sent.push({id});return {delivered:'database-confirmed'};}});t.after(()=>engine.stop());
  engine.receive({platform:'wechat',kind:'private',conversation_id:'123',sender_id:'456',self_id:'99',message_id:'installed-pack-fixture',text:'笑死了',direct_mention:true,timestamp:Date.now()/1000});
  for(let i=0;i<250&&sent.length<2;i++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.deepEqual(sent,[{text:'哈哈哈'},{id:ready}]);
});
