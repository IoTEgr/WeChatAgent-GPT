import fs from 'node:fs';import path from 'node:path';
import {selectRoleText} from '../components/qq-bridge/src/role-card.js';
import {validVoiceObservations} from '../components/qq-bridge/src/core/voice-images.js';
export const VOICE_CONTEXT_LIMITS=Object.freeze({messages:100,rowChars:1600,startupBytes:24000});
const clean=(value,limit)=>String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,limit).replace(/[\uD800-\uDBFF]$/u,'');
export function conversationVoiceRequest(adapter,{kind,target,anchor,summary='',identity,rows,previousVoices=[],visualFacts=[],proactive}){
 if(proactive&&(!/^[a-f0-9]{64}$/.test(proactive.contextId??'')||anchor))throw Error('VOICE_PROACTIVE_CONTEXT_INVALID');
 if(!proactive&&!/^[a-f0-9]{64}$/.test(anchor??''))throw Error('VOICE_CONTEXT_ANCHOR_REQUIRED');
 const ordered=[...rows].sort((a,b)=>Number(a.createTime)-Number(b.createTime)||Number(a.localId)-Number(b.localId)),at=proactive?ordered.length-1:ordered.findIndex(row=>row.wechatagentMessageId===anchor),current=ordered[at];
 if(!proactive&&(!current||current.isSend||!Number.isFinite(Number(current.createTime))||Date.now()/1000-Number(current.createTime)>3600||Number(current.createTime)>Date.now()/1000+60))throw Error('VOICE_CONTEXT_ANCHOR_UNAVAILABLE');
 if(proactive&&current&&(!Number.isFinite(Number(current.createTime))||Number(current.createTime)>Date.now()/1000+60))throw Error('VOICE_PROACTIVE_CONTEXT_INVALID');
 const visualRows=ordered.slice(0,at+1).filter(row=>!row.isSend&&([3,47].includes(Number(row.localType))||row.stickerKind==='appmsg-8'));
 if(!validVoiceObservations(visualFacts)||visualFacts.some(fact=>!visualRows.some(row=>row.wechatagentMessageId===fact.messageId)))throw Error('VOICE_IMAGE_CONTEXT_INVALID');
 const key='wechat:'+kind+':'+target,name=adapter.project.persona?.chats?.[key]??adapter.project.persona?.default;
 if(typeof name!=='string'||!/^[^\\/\0.][^\\/\0]{0,60}$/.test(name)||name.includes('..'))throw Error('VOICE_CONTEXT_PERSONA_INVALID');
 const role=selectRoleText(fs.readFileSync(path.join(adapter.directory,'roles',name+'.md'),'utf8'),'v2');
 let skip=false;const persona=role.split('\n').filter(line=>{if(/^##\s/.test(line))skip=/发送格式|说话的声音|找表情|表情包|表达的选择|查信息|知识、才艺|怎么回应/.test(line);return !skip;}).join('\n').slice(0,2000);
 const voices=new Map(previousVoices.filter(v=>v.account===identity.account&&typeof v.spokenText==='string').map(v=>[String(v.response?.message_id),v.spokenText]));
 const summaryText=clean(summary,600),observations=visualFacts.map(fact=>({ref:fact.ref,messageId:fact.messageId,description:fact.description===null?null:clean(fact.description,600)}));
 const messages=[];let budget=VOICE_CONTEXT_LIMITS.startupBytes-Buffer.byteLength(summaryText)-Buffer.byteLength(JSON.stringify(observations))-1500;
 const relevant=new Map(observations.map(fact=>[fact.messageId,fact]));
 for(const row of ordered.slice(0,at+1).slice(-VOICE_CONTEXT_LIMITS.messages).reverse()){
  let text;
  if(Number(row.localType)===1)text=clean(row.fullText??row.content??row.parsedContent,VOICE_CONTEXT_LIMITS.rowChars);
  else if(Number(row.localType)===34)text=row.isSend?voices.get(String(row.localId)):'[语音消息，含义参考摘要]';
  else {const fact=relevant.get(row.wechatagentMessageId);text=fact?'[附图 '+fact.ref+'，画面事实见视觉观察]':Number(row.localType)===47?'[表情包，未附画面]':Number(row.localType)===3?'[历史图片，本轮未附画面，不推测图中细节]':'[卡片或互动消息，含义参考摘要]';}
  text=clean(text??'[语音消息]',VOICE_CONTEXT_LIMITS.rowChars);if(!text)continue;
  const speaker=clean(row.isSend?name:(row.senderDisplayName??row.senderName??'群友'),80),cost=Buffer.byteLength(speaker+'：'+text);
  if(cost>budget)break;budget-=cost;
  messages.unshift({role:row.isSend?'assistant':'user',speaker,text});
 }
 if(!proactive&&(!messages.length||messages.at(-1).role!=='user'))throw Error('VOICE_CONTEXT_EMPTY');
 return {mode:'conversation',...(proactive?{purpose:'proactive'}:{}),persona,personaName:clean(name,60),summary:summaryText,messages,replyTo:proactive?null:messages.at(-1),...(observations.length?{visualFacts:observations}:{}),contextWindow:{available:at+1,included:messages.length,truncated:messages.length<at+1}};
}
