import {hasVoiceControl} from './voice-protocol.js';
export function reconsiderVoice(result,rows){
 if(result.decision!=='RESPOND'||result.stickerId||hasVoiceControl(result.text))return false;
 const input=rows.findLast(row=>!row.outgoing&&!row.forwardedRecord)?.text??'';
 if(/(?:文字|打字|原样|原文|逐字|复制|代码|源码|命令|链接|地址|参数|列表|不方便听|不能听|(?:别|不要|不用).{0,4}语音)/u.test(input))return false;
 const text=result.text??'';
 if(text.trim().length<=26&&/^(?:[（(][^()（）\r\n]{1,24}[）)]|T_T|Q[Aa]Q|orz|\^[_ .-]?\^)$/u.test(text.trim()))return false;
 if(/https?:\/\/|```|~~~|(?:^|\n)\s*(?:\d+[.)、]|[-*]\s)/u.test(text))return false;
 return /(?:发(?:一|个|条|段|点)?|用|改成|换成|给我发|来(?:一|个|条|段|点)?).{0,6}语音|语音(?:回复|回答|说|讲|安慰|解释|念|读)|(?:想|要|可以).{0,4}听.{0,4}(?:你|声音|说)|开口|出声|唱(?:歌|两句|一首|个)|念给我听|读给我听/u.test(input);
}
export const VOICE_CHOICE_NOTICE='本机发送形式复核：对方本轮明确要求语音，刚才的文字草稿尚未发送。本轮仅复核形式，不取消已经决定发送的回应。愿意接这个请求时，用 RESPOND: [语音回复:话题、回应对象、潜台词、情绪和已核实背景的概要]，将具体措辞交给 GPT-Live，不预写台词。若有明确原因适合文字，就保留有效文字；本轮可用的贴切表情也可按场合选择。不再搜索或调用其他工具，不把草稿当成已经回复，不把复核当成新的群友消息，只输出最终回复。';
