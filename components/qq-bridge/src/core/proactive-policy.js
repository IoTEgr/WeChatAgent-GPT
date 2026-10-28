import crypto from 'node:crypto';
export const PROACTIVE_DEFAULTS=Object.freeze({enabled:false,mode:'mixed',intervalMinutes:240,idleMinutes:120,
  startTime:'09:00',endTime:'22:00',useSearch:true,jitterMinutes:15,topics:''});
const chatKey=/^wechat:(private|group):[1-9]\d{0,15}$/;
export const PROACTIVE_MODES=['mixed','greeting','news','meme','tech'];
export function validateProactiveTopics(value){if(typeof value!=='string'||value.length>160||/[\u0000-\u001f<>]|https?:\/\/|wxid_|@chatroom|[\w.+-]+@[\w.-]+\.\w+|\d{7,}|(?:token|password|密码|密钥)\s*[:=]/i.test(value))throw Error('Invalid proactive topics');}
const clock=/^(?:[01]\d|2[0-3]):[0-5]\d$/;
export function validateProactiveSettings(value){
  if(value===undefined)return;
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid proactive settings');
  for(const key of ['enabled','useSearch'])if(value[key]!==undefined&&typeof value[key]!=='boolean')throw Error('Invalid proactive '+key);
  if(value.mode!==undefined&&!PROACTIVE_MODES.includes(value.mode))throw Error('Invalid proactive mode');
  for(const [key,min,max] of [['intervalMinutes',30,1440],['idleMinutes',5,1440],['jitterMinutes',0,60]])
    if(value[key]!==undefined&&(!Number.isSafeInteger(value[key])||value[key]<min||value[key]>max))throw Error('Invalid proactive '+key);
  for(const key of ['startTime','endTime'])if(value[key]!==undefined&&(typeof value[key]!=='string'||!clock.test(value[key])))throw Error('Invalid proactive '+key);
  if((value.startTime??PROACTIVE_DEFAULTS.startTime)===(value.endTime??PROACTIVE_DEFAULTS.endTime))throw Error('Invalid proactive window');
  if(value.topics!==undefined)validateProactiveTopics(value.topics);
  if(value.chatSettings!==undefined){
    if(!value.chatSettings||typeof value.chatSettings!=='object'||Array.isArray(value.chatSettings))throw Error('Invalid proactive chat settings');
    for(const [key,setting] of Object.entries(value.chatSettings)){
      if(!chatKey.test(key)||!Number.isSafeInteger(Number(key.split(':').at(-1)))||!setting||typeof setting!=='object'||Array.isArray(setting)||Object.keys(setting).some(name=>!['mode','topics'].includes(name))||setting.mode!==undefined&&!PROACTIVE_MODES.includes(setting.mode))throw Error('Invalid proactive chat settings');
      if(setting.topics!==undefined)validateProactiveTopics(setting.topics);
    }
  }
  if(value.chats!==undefined&&(!value.chats||typeof value.chats!=='object'||Array.isArray(value.chats)||Object.entries(value.chats)
    .some(([key,flag])=>!chatKey.test(key)||!Number.isSafeInteger(Number(key.split(':').at(-1)))||typeof flag!=='boolean')))throw Error('Invalid proactive chats');
}
export function proactivePolicy(wechat,key){
  const settings=wechat?.proactive;validateProactiveSettings(settings);
  const values=Object.fromEntries(Object.entries(PROACTIVE_DEFAULTS).map(([name,value])=>[name,settings?.[name]??value]));
  const local=settings?.chatSettings?.[key];if(local?.mode)values.mode=local.mode;if(local?.topics)values.topics=local.topics;
  return {...values,enabled:values.enabled===true&&settings?.chats?.[key]===true};
}
export const proactivePolicyKey=policy=>JSON.stringify(policy);
// Count actual proactive deliveries after the peer's last message, not timer
// opportunities or SILENT drafts. The scheduler history survives buffer eviction.
export function proactiveContactState(key,rows,recentTopics=[]){
  if(!/^wechat:private:/.test(key))return {unanswered:0,lastAt:0};
  const lastIncoming=rows.findLastIndex(row=>!row.outgoing),incomingAt=lastIncoming<0?0:Number(rows[lastIncoming].timestamp)*1000;
  const delivered=new Map(),visible=new Set(rows.filter(row=>row.outgoing&&row.proactive).map(row=>row.delivery_id).filter(Boolean));
  const add=(id,at,text)=>{if(Number.isFinite(at)&&at>0)delivered.set(id||String(at)+'\0'+String(text),at);};
  for(const row of rows.slice(lastIncoming+1))if(row.outgoing&&row.proactive)add(row.delivery_id,Number(row.timestamp)*1000,row.text);
  for(const entry of recentTopics){
    if(visible.has(entry.deliveryId))continue;
    // Incoming WeChat timestamps may have only second precision. Favor the
    // peer's response when delivery and reply happen within the same second.
    if(lastIncoming>=0&&(!Number.isFinite(incomingAt)||entry.at<=incomingAt+1000))continue;
    add(entry.deliveryId,entry.at,entry.text);
  }
  return {unanswered:delivered.size,lastAt:Math.max(0,...delivered.values())};
}
const minute=time=>Number(time.slice(0,2))*60+Number(time.slice(3));
export function withinProactiveWindow(now,policy){
  const local=new Date(now+8*3600000),current=local.getUTCHours()*60+local.getUTCMinutes(),start=minute(policy.startTime),end=minute(policy.endTime);
  return start<end?current>=start&&current<end:current>=start||current<end;
}
export function nextProactiveAt(now,policy,random=()=>0){
  const proposed=now+(policy.intervalMinutes+random()*policy.jitterMinutes)*60000;
  if(withinProactiveWindow(proposed,policy))return proposed;
  const local=new Date(proposed+8*3600000),start=minute(policy.startTime),midnight=Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate())-8*3600000;
  let at=midnight+start*60000;if(at<=proposed)at+=86400000;return at;
}
export function conversationSnapshot(rows){return crypto.createHash('sha256').update(JSON.stringify(rows.slice(-5).map(row=>[row.id,row.message_id,row.timestamp,row.delivery_id??'']))).digest('hex');}
export function declinedProactive(rows){
  const latest=rows.findLast(row=>!row.outgoing&&!row.interaction);
  return !!latest&&(latest.kind==='private'||latest.direct_mention)&&/^(?:先|暂时|以后|今后)?(?:别|不要|不用).{0,12}(?:主动找我|主动发|打扰我|给我发|找话题)/.test(String(latest.text).trim());
}
