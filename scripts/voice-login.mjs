import fs from 'node:fs';import path from 'node:path';import {spawn} from 'node:child_process';
export function createVoiceLogin(root,{probe}={}){
 let cached=null,inflight=null,expires=0;
 const run=probe??(()=>new Promise(resolve=>{
  let python;try{python=JSON.parse(fs.readFileSync(path.join(root,'config/wechatagent.json'),'utf8')).runtime.python;}catch{return resolve({configured:false,error:'VOICE_CHATGPT_LOGIN_COMPONENT_MISSING'});}
  const child=spawn(python,[path.join(root,'scripts/tts/gpt_live.py'),'--status'],{windowsHide:true,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});let stdout='',done=false;
  const finish=result=>{if(done)return;done=true;clearTimeout(timer);resolve({configured:result?.configured===true,source:'chatgpt-login',transport:'webrtc',...(result?.configured?{defaultVoice:'maple'}:{error:/^VOICE_[A-Z_]+$/.test(result?.error??'')?result.error:'VOICE_CHATGPT_LOGIN_REQUIRED'})});};
  const timer=setTimeout(()=>{child.kill();finish({error:'VOICE_LIVE_TIMEOUT'});},12000);
  child.stdout.on('data',c=>{stdout+=c;if(stdout.length>32768){child.kill();finish({});}});child.stderr.on('data',()=>{});child.on('error',()=>finish({}));child.on('close',()=>{try{finish(JSON.parse(stdout.trim().split(/\r?\n/).at(-1)));}catch{finish({});}});
 }));
 async function status(){if(cached&&Date.now()<expires)return cached;if(inflight)return inflight;inflight=Promise.resolve().then(run).then(result=>{cached={configured:result?.configured===true,source:'chatgpt-login',transport:'webrtc',...(result?.configured?{defaultVoice:'maple'}:{error:/^VOICE_[A-Z_]+$/.test(result?.error??'')?result.error:'VOICE_CHATGPT_LOGIN_REQUIRED'})};expires=Date.now()+30000;return cached;}).catch(()=>({configured:false,source:'chatgpt-login',error:'VOICE_CHATGPT_LOGIN_REQUIRED'})).finally(()=>{inflight=null;});return inflight;}
 return {status};
}
