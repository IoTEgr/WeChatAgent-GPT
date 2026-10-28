import {LIVE_VOICES} from '../../../../public/console/live-voices.mjs';
// Keep each enclosing deadline larger than the operation it contains.
export const VOICE_TIMING=Object.freeze({renderMs:90000,renderProcessMs:98000,encodeMs:6000,synthesisMs:106000,actionMs:145000});
const marker=/\[语音(TTS|回复)[:：]\s*([^\]\r\n]{1,600})\]/g;
export const hasVoiceControl=text=>/\[\s*语音(?:TTS|回复)?\s*[:：]/i.test(String(text??''));
// A voice is always its own delivery, even when the model forgets blank lines.
export function splitVoiceReply(text){
 const source=String(text??'');if(!hasVoiceControl(source))return null;
 const matches=[...source.matchAll(marker)];if(matches.length!==1||/```|~~~/.test(source))throw Error('VOICE_MARKER_INVALID');
 const m=matches[0],spoken=m[2].trim();
 if(!spoken||hasVoiceControl(source.slice(0,m.index)+source.slice(m.index+m[0].length))||/\[STICKER\s*[:：]/i.test(source))throw Error('VOICE_MARKER_INVALID');
 if(m[1]==='回复'&&(source.slice(0,m.index).trim()||source.slice(m.index+m[0].length).trim()))throw Error('VOICE_MARKER_INVALID');
 return [source.slice(0,m.index).trim(),'[语音'+m[1]+':'+spoken+']',source.slice(m.index+m[0].length).trim()].filter(Boolean);
}
export function voiceText(text){const parts=splitVoiceReply(text);if(!parts||parts.length!==1||!parts[0].startsWith('[语音TTS:'))throw Error('VOICE_MARKER_INVALID');return parts[0].slice(7,-1);}
export function voiceRequest(text){const parts=splitVoiceReply(text);if(!parts||parts.length!==1)throw Error('VOICE_MARKER_INVALID');return parts[0].startsWith('[语音回复:')?{mode:'conversation',summary:parts[0].slice(6,-1)}:{mode:'read',text:voiceText(text)};}
export const CONTEXT_VOICE_NOTICE="[本轮回应选择]\n文字默认传递信息，微信黄脸或颜文字表达轻微语气，表情包表达情绪和接梗，语音传递声音里的感情。普通日常、询问事情、表达观点、认真讨论和复杂说明默认文字；按需少量黄脸或颜文字，不必每条装饰。玩笑、调侃、好消息和斗图可以用贴切的单张表情包，能单图表达就到图为止，认真求助不敷衍发图。私聊关心以自然文字为主；亲近关系的心情、故事、安慰等声音明显更有表现力、且对方方便听时可用简短语音。群聊文字为主，表情包接梗，语音更克制；对方明确要求出声、语音、唱两句且你愿意接时用语音。早安晚安和主动问候默认短文字配可选黄脸，少量声音有意义时再用语音。形式按内容、关系、对方习惯和场合选择，无固定比例或轮换次序，不把普通文字草稿一律改语音。日常黄脸用微信原生方括号名称，颜文字和非黄脸 emoji 可按语境使用；形式、措辞和素材避免机械重复。本地表情包优先，其次微信本机合集，再考虑共享池。群聊先判断是否在对你说话，有必要或贴题有趣时再加入，别人互聊时可 SILENT；明确让你安静时停下。保留判断，合理邀请可配合，不合理要求可反问或幽默回怼。选择语音时输出 RESPOND: [语音回复:当前话题、回应对象、潜台词、情绪和已核实事实的简短概要]，只交代理解依据，不拟写答案、不指定逐字台词，不放方括号或换行；GPT-Live 结合消息和人格自主表达。只输出选定回复，不解释选择过程。";
export const NONVOICE_REPLY_NOTICE="[本轮替代表达]\n本机刚才的语音生成未成功，已确认尚未提交微信。这是投递状态，不是群友的新消息。结合真正的聊天上下文，重新选择适合的非语音回复：本轮可用的一张表情包、自然文字、微信原生黄脸、颜文字，或者文字配表情。声音本轮不可用，不输出任何语音标记，不再重试语音；围绕群友的话题接话，不向群友播报语音故障，不发固定失败提示，不复述内部上下文概要，不声称已经说过或发过语音。延续当前人格和群聊参与分寸，该安静时仍可 SILENT。";
export const PROACTIVE_VOICE_NOTICE="本轮可用语音，也可用文字。主动问候默认自然短文字，可按语境配微信黄脸或颜文字；只有分享心情、小故事、亲近关系等声音明显更合适且方便收听时再选语音，群聊更克制。若选语音，输出 RESPOND: [语音回复:主动话题、关系、情绪和已核实背景的简短概括]，只交代背景不拟台词。这是主动发起，没有新的好友消息，旧记录不当作待回答问题；语音独立成条，不重复附正文。";
export function validateVoiceSettings(value){
 if(value===undefined)return;
 if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.enabled!=='boolean')throw Error('INVALID_VOICE_SETTINGS');
 if(value.backend!==undefined&&value.backend!=='gpt-live')throw Error('INVALID_VOICE_SETTINGS');
 if(value.replyMode!==undefined&&!['conversation','read'].includes(value.replyMode))throw Error('INVALID_VOICE_SETTINGS');
 if(value.liveVoice!==undefined&&!LIVE_VOICES.includes(value.liveVoice))throw Error('INVALID_VOICE_SETTINGS');
 if(value.voice!==undefined&&!/^[a-z]{2}-[A-Z]{2}-[A-Za-z]+Neural$/.test(value.voice))throw Error('INVALID_VOICE_SETTINGS');
 if(value.pitch!==undefined&&!/^[+-](?:\d|[1-3]\d|40)Hz$/.test(value.pitch))throw Error('INVALID_VOICE_SETTINGS');
 if(value.rate!==undefined&&!/^[+-](?:\d|[1-2]\d|30)%$/.test(value.rate))throw Error('INVALID_VOICE_SETTINGS');
}
