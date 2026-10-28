export function validateTypingSettings(settings){
  if(settings===undefined)return;
  if(!settings||typeof settings!=='object'||Array.isArray(settings)||Object.keys(settings).some(key=>!['enabled','start_ms','char_ms','max_ms','jitter_ms'].includes(key)))throw Error('Invalid typing settings');
  if(settings.enabled!==undefined&&typeof settings.enabled!=='boolean')throw Error('Invalid typing switch');
  for(const [key,min,max]of [['start_ms',100,5000],['char_ms',30,250],['max_ms',1000,20000],['jitter_ms',0,1500]])if(settings[key]!==undefined&&(!Number.isInteger(settings[key])||settings[key]<min||settings[key]>max))throw Error('Invalid typing timing');
}

export function typingDelayMs(text,settings,random=Math.random){
  validateTypingSettings(settings);if(settings?.enabled!==true)return 0;
  // WeChat faces are one gesture; an internal marker is never counted as text.
  const characters=Array.from(String(text??'').replace(/\[[^\]\r\n]{1,12}\]/g,'🙂').replace(/\s+/g,' ').trim()).length;
  const start=settings.start_ms??1600,perChar=settings.char_ms??100,maximum=settings.max_ms??12000,jitter=settings.jitter_ms??700;
  return Math.round(Math.max(300,Math.min(maximum,start+characters*perChar+(random()*2-1)*jitter)));
}
