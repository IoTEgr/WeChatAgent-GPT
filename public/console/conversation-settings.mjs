const adminOnly=(config,key)=>!key.startsWith('wechat:group:')||config.wechat.assistant?.adminOnlyGroups?.[key]!==false;
const fileTransfer=(config,key)=>config.wechat.assistant?.fileTransferChats?.[key]===true;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const own = (object, key) => Object.hasOwn(object ?? {}, key);

export function chatSettingsSnapshot(config, key, mode=config.wechat.workModes?.[key]??'social') {
  const active=config.wechat.workModes?.[key]??'social';
  if(mode!==active){const stored=config.wechat.modeSettings?.[key]?.[mode];return stored?{...structuredClone(stored),settings:{proactiveMode:null,proactiveTopics:'',...structuredClone(stored.settings),adminOnly:adminOnly(config,key),fileTransfer:fileTransfer(config,key)}}:{settings:{fileTransfer:fileTransfer(config,key),adminOnly:adminOnly(config,key),workMode:mode,persona:null,mode:null,stickers:null,search:null,proactive:false,proactiveMode:null,proactiveTopics:'',context:null},access:{skills:[],tools:[]}};}
  const w = config.wechat;
  return {
    settings: {
      persona: config.persona.chats?.[key] ?? null,
      workMode: w.workModes?.[key] ?? 'social',
      adminOnly:adminOnly(config,key),
      fileTransfer:fileTransfer(config,key),
      mode: w.chatModes?.[key] ?? null,
      stickers: w.stickers?.chats?.[key] ?? null,
      search: w.search?.chats?.[key] ?? null,
      proactive: w.proactive?.chats?.[key] === true,
      proactiveMode:w.proactive?.chatSettings?.[key]?.mode??null,
      proactiveTopics:w.proactive?.chatSettings?.[key]?.topics??'',
      context: w.context?.chats?.[key] ?? null,
    },
    access: {...w.dshAccess?.chats?.[key],...Object.fromEntries(['skills', 'tools'].map(kind => [kind, [...w.dshAccess?.chats?.[key]?.[kind] ?? []].sort()]))},
  };
}

export function applyChatSettings(config, key, settings, access) {
  const fail = message => { throw Object.assign(new Error(message), {status: 400}); };
  if (!settings || Array.isArray(settings) || ![6,7,8,9,10,11].includes(Object.keys(settings).length) || Object.keys(settings).some(name=>!['persona','workMode','adminOnly','fileTransfer','mode','stickers','search','proactive','proactiveMode','proactiveTopics','context'].includes(name)) ||
      !['persona', 'mode', 'stickers', 'search', 'proactive', 'context'].every(name => own(settings, name))) fail('会话设置不完整，请重新打开。');
  if(own(settings,'fileTransfer')&&typeof settings.fileTransfer!=='boolean')fail('微信文件收发必须使用开关值。');
  if(own(settings,'adminOnly')&&(typeof settings.adminOnly!=='boolean'||!key.startsWith('wechat:group:')&&!settings.adminOnly))fail('私聊助手仅允许管理员，群管理员模式必须使用开关值。');
  if (settings.persona !== null && (typeof settings.persona !== 'string' || !settings.persona)) fail('请选择有效人格。');
  if(own(settings,'workMode')&&!['social','assistant'].includes(settings.workMode))fail('请选择聊天模式或助手模式。');
  if (settings.mode !== null && (!key.startsWith('wechat:group:') || !['hybrid', 'mention'].includes(settings.mode))) fail('请选择有效的群聊回复方式。');
  if (['stickers', 'search'].some(name => settings[name] !== null && typeof settings[name] !== 'boolean') || typeof settings.proactive !== 'boolean') fail('功能设置必须使用开关值。');
  if(own(settings,'proactiveMode')&&settings.proactiveMode!==null&&!['mixed','greeting','news','meme','tech'].includes(settings.proactiveMode))fail('请选择有效的主动聊天内容。');
  if(own(settings,'proactiveTopics')&&(typeof settings.proactiveTopics!=='string'||settings.proactiveTopics.length>160||/[\u0000-\u001f<>]|https?:\/\/|wxid_|@chatroom|[\w.+-]+@[\w.-]+\.\w+|\d{7,}/i.test(settings.proactiveTopics)))fail('关注主题请填160字以内的公开关键词，不填账号或聊天原文。');
  if (settings.context !== null && (!Number.isSafeInteger(settings.context) || settings.context !== 0 && (settings.context < 4000 || settings.context > 2000000))) fail('上下文阈值为 4,000–2,000,000 token；填 0 关闭，留空继承默认。');
  if (!access || !Array.isArray(access.skills) || !Array.isArray(access.tools) || Object.keys(access).some(name => !['skills','tools','mode','preset','remoteApproval','timeoutMinutes','toolLimit'].includes(name))) fail('技能与工具列表无效，请重新打开。');
  if(access.preset!==undefined&&(typeof access.preset!=='string'||!/^[\w.:-]{1,120}$/.test(access.preset)))fail('DSH 预设无效。');
  if(access.mode!==undefined&&!['custom','native'].includes(access.mode)||access.remoteApproval!==undefined&&typeof access.remoteApproval!=='boolean'||access.timeoutMinutes!==undefined&&(!Number.isInteger(access.timeoutMinutes)||access.timeoutMinutes<5||access.timeoutMinutes>120)||access.toolLimit!==undefined&&(!Number.isInteger(access.toolLimit)||access.toolLimit<10||access.toolLimit>1000))fail('助手能力设置无效。');
  if(settings.workMode!=='assistant'&&(access.mode==='native'||access.remoteApproval===true||access.preset!==undefined))fail('DSH 完整能力及微信审批仅适用于助手模式。');
  if(own(settings,'adminOnly')&&key.startsWith('wechat:group:')){config.wechat.assistant??={};config.wechat.assistant.adminOnlyGroups??={};config.wechat.assistant.adminOnlyGroups[key]=settings.adminOnly;}
  if(own(settings,'fileTransfer')&&(settings.fileTransfer||own(config.wechat.assistant?.fileTransferChats,key))){config.wechat.assistant??={};config.wechat.assistant.fileTransferChats??={};config.wechat.assistant.fileTransferChats[key]=settings.fileTransfer;}
  const previous=chatSettingsSnapshot(config,key);
  const saveModes=own(settings,'workMode')&&settings.workMode!==previous.settings.workMode||!!config.wechat.modeSettings?.[key];
  if(saveModes){config.wechat.modeSettings??={};config.wechat.modeSettings[key]??={};config.wechat.modeSettings[key][previous.settings.workMode]=previous;}
  const put = (map, value) => { if (value === null) delete map[key]; else map[key] = value; };
  config.persona.chats ??= {}; put(config.persona.chats, settings.persona);
  if(own(settings,'workMode')&&(settings.workMode!=='social'||config.wechat.workModes)){config.wechat.workModes??={};config.wechat.workModes[key]=settings.workMode;}
  config.wechat.chatModes ??= {}; put(config.wechat.chatModes, settings.mode);
  for (const name of ['stickers', 'search', 'proactive', 'context']) {
    config.wechat[name] ??= {}; config.wechat[name].chats ??= {};
    put(config.wechat[name].chats, settings[name]);
  }
  if(own(settings,'proactiveMode')||own(settings,'proactiveTopics')){
    const map=config.wechat.proactive.chatSettings??={},local={...map[key]};
    if(own(settings,'proactiveMode')){if(settings.proactiveMode===null)delete local.mode;else local.mode=settings.proactiveMode;}
    if(own(settings,'proactiveTopics')){if(settings.proactiveTopics.trim())local.topics=settings.proactiveTopics.trim();else delete local.topics;}
    if(Object.keys(local).length)map[key]=local;else delete map[key];
  }
  config.wechat.dshAccess ??= { chats: {} }; config.wechat.dshAccess.chats ??= {};
  config.wechat.dshAccess.chats[key] = structuredClone(access);
  if(saveModes)config.wechat.modeSettings[key][config.wechat.workModes?.[key]??'social']=chatSettingsSnapshot(config,key);
  return config;
}

// Rebase pending edits onto the server result, then accept only this chat's saved fields.
export function mergeConversationSave(previous, draft, saved, key) {
  const merge = (before, pending, current) => {
    if (same(before, pending)) return structuredClone(current);
    if (!pending || typeof pending !== 'object' || Array.isArray(pending) || !before || typeof before !== 'object') return structuredClone(pending);
    const result = structuredClone(current ?? {});
    for (const name of new Set([...Object.keys(before), ...Object.keys(pending)])) {
      if (!own(pending, name)) delete result[name];
      else result[name] = merge(before[name], pending[name], current?.[name]);
    }
    return result;
  };
  const result = merge(previous, draft, saved);
  const accept = (target, source) => { if (own(source, key)) target[key] = structuredClone(source[key]); else delete target[key]; };
  result.persona.chats ??= {}; accept(result.persona.chats, saved.persona.chats);
  for (const name of ['modeSettings','workModes','chatModes', 'stickers', 'search', 'proactive', 'context']) {
    if (name === 'chatModes'||name==='workModes'||name==='modeSettings') { if(result.wechat[name]||saved.wechat[name]){result.wechat[name] ??= {}; accept(result.wechat[name], saved.wechat[name]);} }
    else { result.wechat[name] ??= {}; result.wechat[name].chats ??= {}; accept(result.wechat[name].chats, saved.wechat[name]?.chats); }
  }
  if(result.wechat.proactive?.chatSettings||saved.wechat.proactive?.chatSettings){result.wechat.proactive??={};result.wechat.proactive.chatSettings??={};accept(result.wechat.proactive.chatSettings,saved.wechat.proactive?.chatSettings);}
  if(saved.wechat.assistant?.adminOnlyGroups||result.wechat.assistant?.adminOnlyGroups){result.wechat.assistant??={};result.wechat.assistant.adminOnlyGroups??={};accept(result.wechat.assistant.adminOnlyGroups,saved.wechat.assistant?.adminOnlyGroups);}
  if(saved.wechat.assistant?.fileTransferChats||result.wechat.assistant?.fileTransferChats){result.wechat.assistant??={};result.wechat.assistant.fileTransferChats??={};accept(result.wechat.assistant.fileTransferChats,saved.wechat.assistant?.fileTransferChats);}
  result.wechat.dshAccess ??= { chats: {} }; result.wechat.dshAccess.chats ??= {};
  accept(result.wechat.dshAccess.chats, saved.wechat.dshAccess?.chats);
  return result;
}
