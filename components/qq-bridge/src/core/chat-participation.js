import fs from 'node:fs';import path from 'node:path';
export const GROUP_PARTICIPATION_NOTICE='[群聊参与]\n先确定谁在对谁说话，再决定是否参与。“你”、问号、情绪表达、提到 AI 或你的名字，都不能单独证明是在找你；你刚发过话也不代表后续消息都在回复你。人格里的“对方”是正在与你交流的人，不是每一个群友。未被明确叫到时默认安静旁观：群友互相问答、交代行程、普通感叹、重复表情和已经有人接住的话题，通常 SILENT；只有真正贴合语境的新梗、有价值的补充、需要关心或纠正重要误解时偶尔加入。被真实 @、明确点名提问或上下文清楚地在接你的话时，优先简短回应那条仍未回答的消息，可以文字、表情或合适的语音；少插嘴、刚发过言和后续有人笑了一句，都不是忽略这条直接互动的理由。别人引用或 @ 另一个群友时，先按他们之间的对话理解；对他人的经历提问，不要拿自己的设定作答。只是提到你的名字、转述别人的 @、已回答的重复问题或已经过时解决的消息，仍结合上下文决定是否安静，不为每个名字强行开口。拿不准对象时倾向 SILENT，不通过追问“你在问我吗”插话。听懂一个梗不代表每次都要接，普通互聊仍给群友空间。对方明确让你安静时，直接停止，不再发最后一句、解释或换表情继续搭话；权限、免打扰与安全要求仍然有效。';
export function asksForQuiet(message,direct=false){
 if(message.kind!=='group'||message.forwardedRecord||message.context_only)return false;
 let text=String(message.text??'').trim();
 if(direct)text=text.replace(/^@\S+\s+/u,'');
 text=text.replace(/^@?(?:大肥鱼|小鲸鱼|肥鱼|助手)[\s，,:：]*/u,'');
 return /^(?:(?:你先|你|请你|麻烦你|请|先|麻烦|拜托)[\s，,]*)?(?:闭嘴|闭麦|安静(?:点|一下|一会儿?|会儿)?|别(?:再|老)?(?:说(?:话)?|插嘴|回复|吵)|不要(?:再|老)?(?:说(?:话)?|插嘴|回复|吵)|少说(?:点|两句))(?:[吧啦了啊呀哦哈]|\s|[。！!~～…，,])*$/u.test(text);
}
export class ChatParticipation{
 constructor(file){this.file=file;this.state=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{version:1,chats:{}};if(this.state.version!==1||!this.state.chats||Array.isArray(this.state.chats))throw Error('CHAT_PARTICIPATION_INVALID');}
 entry(key,selfId){const row=this.state.chats[key];return row&&String(row.selfId)===String(selfId)?row:null;}
 quiet(key,selfId){return this.entry(key,selfId)?.quiet===true;}
 epoch(key,selfId){return this.entry(key,selfId)?.epoch??0;}
 set(key,selfId,quiet){this.state.chats[key]={selfId:String(selfId),quiet,epoch:this.epoch(key,selfId)+1,at:Date.now()};fs.mkdirSync(path.dirname(this.file),{recursive:true});const temp=this.file+'.'+process.pid+'.tmp';fs.writeFileSync(temp,JSON.stringify(this.state),{mode:0o600});fs.renameSync(temp,this.file);}
}
