const faces=new Map(Object.entries({
 '😀':'呲牙','😁':'呲牙','😃':'呲牙','😄':'憨笑','😆':'偷笑','🙂':'微笑','😊':'愉快',
 '😂':'破涕为笑','🤣':'破涕为笑','🥲':'苦涩','😭':'大哭','😢':'流泪','🥺':'可怜',
 '😔':'难过','😞':'难过','😏':'坏笑','😎':'得意','🤔':'疑问','🤨':'疑问',
 '😳':'害羞','😅':'尴尬','😓':'流汗','😮':'惊讶','😯':'惊讶','😱':'惊恐','😨':'惊恐',
 '😴':'睡','😪':'困','🙄':'白眼','😤':'傲慢','😡':'发怒','🤬':'咒骂','😒':'鄙视','🤦':'捂脸',
}));
const pattern=new RegExp('['+[...faces.keys()].join('')+'](?:[\\uFE0E\\uFE0F]|\\p{Emoji_Modifier})*(?:\\u200D[♂♀]\\uFE0F?)?','gu');
// Quoted examples and code retain literal symbols; ordinary face decorations
// become WeChat's native shortcodes. Non-face emoji and kaomoji stay intact.
const literal=/(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\r\n]*`|“[^”\r\n]*”|「[^」\r\n]*」|"(?:\\.|[^"\\\r\n])*"|'(?:\\.|[^'\\\r\n])*')/g;
export function nativeWechatFaces(text){
 return String(text??'').split(literal).map((part,index)=>index%2?part:part.replace(pattern,match=>'['+faces.get(String.fromCodePoint(match.codePointAt(0)))+']')).join('');
}

// The model has used a bare reversed bracket pair as a facial decoration.
// Remove only that incomplete suffix; keep real kaomoji, brackets, examples,
// code, voice payloads and the punctuation after an otherwise meaningful reply.
export function cleanMalformedChatDecoration(text){
 const value=String(text??'');
 if(/\[语音|(?:字符|字符串|符号|括号|颜文字|正则|Unicode|unicode)/u.test(value))return value;
 return value.split(literal).map((part,index)=>{
   if(index%2)return part;
   return part.replace(/(?:[、，,]?[ \t]*】[ \t]*【)+(?=[ \t]*[。.!！?？…]*[ \t]*$)/u,'');
 }).join('').trim();
}
