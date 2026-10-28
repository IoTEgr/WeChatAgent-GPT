const ID=/^[a-f0-9]{64}$/;
export function interactionCandidates(rows){
  const selected=rows.filter(row=>!row.outgoing&&!row.forwardedRecord&&ID.test(row.message_id??'')).slice(-12);
  return selected.map((row,index)=>({ref:'M'+(index+1),id:row.message_id,name:String(row.sender_name||row.sender_id).slice(0,80),text:String(row.text??'').slice(0,160),quote:!row.quoteReply&&!row.interaction&&!row.images?.length&&!row.files?.length&&!!row.text?.trim()}));
}
export function interactionNotice(candidates,capabilities){
  if(!capabilities?.quote&&!capabilities?.pat&&!capabilities?.mention||!candidates.length)return '';
  return '\n[本轮微信交互能力]\n候选是当前聊天真实入站消息，不采用历史编号。'+JSON.stringify(candidates.map(({ref,name,text,quote})=>({ref,name,text,canQuote:quote&&capabilities.quote===true})))+'\n'+
    (capabilities.mention?'@ 用来引起特定人的注意、邀请对方参与，不是每次回复的署名。默认直接接话，不自动 @ 最后一位发言人。向特定的人提问、请求帮忙或处理事情、提醒重要消息，或多人交错而交流对象确实容易混淆时，才按需使用真正的 @：在 RESPOND: 后第一行写 [AT:M编号]，下一行写正文，选择该人的本轮消息编号。普通闲聊、接梗、赞同反对、发表感想通常不 @；熟人调侃偶尔可点名，但不随意公开点名不熟悉的人，涉及外貌、感情和隐私的话题尤其慎重。不频繁 @ 同一个人，对方未回应不反复 @ 催促。只是接旧话时，引用能力可用才按需引用；不可用就自然接话或带称呼，不用 @ 代替每次引用。不要自行写无提醒效果的 @昵称，不 @所有人；纯表情和语音不额外发 @ 文字。':'')+
    (capabilities.quote?'引用表示“我在回应你这句话”。回答之前的问题、赞同或反驳观点、针对某句话接梗，或刷屏后接前面的消息，都可用引用保持上下文清楚；它可以比 @ 和拍一拍更常用，只在确实帮助理解时自然使用，不设固定频率。普通顺着话题接话仍可直接回复。需要引用时，在 RESPOND: 后第一行写 [QUOTE:M编号]，下一行写回复文字，只引用 canQuote=true 的真实消息。引用是原生文字气泡；纯语音或纯表情不强行引用，语音可自然带上对方称呼。':'本轮不能发引用气泡。')+
    (capabilities.pat?'拍一拍表示“我想和你互动”，适合熟人群轻松打招呼、逗人开玩笑、回应吹牛整活，或者对方让你拍、想拍回时偶尔使用。需要某个人回答、帮忙或注意重要消息时用 @；针对一句话回应时优先引用。可以单独回复 RESPOND: [PAT:M编号]，或者在普通回复末尾另起一行写 [PAT:M编号]，拍该消息的真实发言人。一次回复最多拍一次，后台冷却和次数上限是保护措施，不是要用满的频率目标。不反复拍，不把严肃求助、争执当成玩笑；写标记即可，不在正文里抢先声称已拍。':'本轮不能实际拍一拍。')+'\n普通接话不需要刻意使用任何交互功能。对方迟迟不回应，通常不 @、不拍一拍，也不用引用旧话催促。编号只能取本轮候选，不能输出其他交互标记。';
}
export function extractInteractions(output,candidates=[],capabilities={}){
  let text=String(output??'').trim(),quote,pat,mention;
  if(/\[WX_(?:QUOTE|PAT|AT):/i.test(text))return {invalid:true};
  const at=/^((?:RESPOND|回复)\s*[:：]\s*)\[AT:(M[1-9]\d?)\]\s*\n/i.exec(text);
  if(at){mention=candidates.find(row=>row.ref===at[2]);if(!capabilities.mention||!mention||!ID.test(mention.id))return {invalid:true};text=at[1]+text.slice(at[0].length);}
  const leading=/^((?:RESPOND|回复)\s*[:：]\s*)\[QUOTE:(M[1-9]\d?)\]\s*\n/i.exec(text);
  if(leading){quote=candidates.find(row=>row.ref===leading[2]);if(!capabilities.quote||!quote?.quote||!ID.test(quote.id))return {invalid:true};text=leading[1]+text.slice(leading[0].length);}
  const trailing=/(?:\n|^|(?:RESPOND|回复)\s*[:：]\s*)\[PAT:(M[1-9]\d?)\]\s*$/i.exec(text);
  if(trailing){pat=candidates.find(row=>row.ref===trailing[1]);if(!capabilities.pat||!pat||!ID.test(pat.id))return {invalid:true};const start=trailing.index;text=text.slice(0,start).trim();if(!text||/^(?:RESPOND|回复)\s*[:：]\s*$/i.test(text))text='SILENT';}
  if(/\[(?:QUOTE|PAT|AT):/i.test(text)||mention&&quote)return {invalid:true};
  return {text,quote:quote?.id,pat:pat?.id,mention:mention?.id};
}
export function internalInteraction(text){
  const match=/^\[WX_(QUOTE|PAT|AT):([a-f0-9]{64})\](?:\n([\s\S]*))?$/.exec(String(text??''));
  if(!match){if(/\[WX_(?:QUOTE|PAT|AT):/i.test(String(text??'')))throw Error('INTERACTION_TEXT_INVALID');return null;}
  if(match[1]!=='PAT'&&!match[3]?.trim()||match[1]==='PAT'&&match[3])throw Error('INTERACTION_TEXT_INVALID');
  return {action:match[1]==='AT'?'mention':match[1].toLowerCase(),reference:match[2],text:match[3]?.trim()??''};
}
export function interactionDisplay(text){const value=internalInteraction(text);return value?value.action==='pat'?'[拍一拍]':value.text:text;}
