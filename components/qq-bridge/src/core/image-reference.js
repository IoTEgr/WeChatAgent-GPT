// Completed images are offloaded from the model. An explicit follow-up can
// reattach a bounded recent image from this conversation's own buffer.
export function recentImageReferences(history,current){
 if(!current.length||current.some(row=>(row.images??[]).some(image=>image.kind!=='sticker')))return [];
 const text=current.map(row=>row.text??'').join('\n');
 if(!/(?:图片|照片|截图|图里|图中|图上|画面|这张|那张|上一张|刚才.{0,8}图|上面.{0,8}图|这[两几]张)/.test(text))return [];
 const limit=/(?:两张|几张|对比|比较|分别|这些|这几)/.test(text)?2:1;
 const latest=current.at(-1),mode=latest.work_mode??'social',now=Number(latest.timestamp),seen=new Set(current.flatMap(row=>(row.images??[]).map(image=>image.id))),result=[];
 for(const row of [...history].reverse()){
  if(row.outgoing||(row.work_mode??'social')!==mode||row.platform!==latest.platform||row.kind!==latest.kind||String(row.conversation_id)!==String(latest.conversation_id)||!Number.isFinite(Number(row.timestamp))||now-Number(row.timestamp)>300||Number(row.timestamp)>now)continue;
  for(const image of row.images??[]){
   if(image.kind==='sticker'||seen.has(image.id)||!/^[a-f0-9]{64}$/.test(image.id??''))continue;
   seen.add(image.id);result.push({...image,referenced:true});if(result.length===limit)return result;
  }
 }
 return result;
}
