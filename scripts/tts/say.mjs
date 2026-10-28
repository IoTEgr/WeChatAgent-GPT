import {spawn} from 'node:child_process';
import {VOICE_TIMING} from '../../components/qq-bridge/src/core/voice-protocol.js';
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),output=path.join(root,'state/voice-out');
const arg=name=>{const index=process.argv.indexOf(name);return index<0?undefined:process.argv[index+1];};
const read=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const project=read(path.join(root,'config/wechatagent.json')),settings=project.wechat?.voice??{};
const python=project.runtime.python;
const voip=path.join(path.dirname(path.resolve(root,project.hook.wechatExecutable)),'4.1.10.27/VoipEngine.dll');
function run(exe,args,timeoutMs,env={}){return new Promise((resolve,reject)=>{
 const child=spawn(exe,args,{windowsHide:true,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',...env}});let stdout='',stderr='',done=false;
 const finish=(error)=>{if(done)return;done=true;clearTimeout(timer);error?reject(error):resolve(stdout);};
 const timer=setTimeout(()=>{child.kill();finish(Error('TTS_TIMEOUT'));},timeoutMs);
 child.stdout.on('data',chunk=>{stdout+=chunk;if(stdout.length>65536){child.kill();finish(Error('TTS_OUTPUT_LIMIT'));}});
 child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-2000);});child.on('error',()=>finish(Error('TTS_PROCESS_FAILED')));
 child.on('close',code=>{let reported;try{reported=JSON.parse(stdout.trim().split(/\r?\n/).at(-1));}catch{}finish(code===0?null:Error(/^VOICE_[A-Z_]+$/.test(reported?.error??'')?reported.error:'TTS_PROCESS_EXIT_'+code));});
});}
fs.mkdirSync(output,{recursive:true});const base=path.join(output,'tts-'+crypto.randomUUID()),files=Object.fromEntries(['txt','wav','silk'].map(ext=>[ext,base+'.'+ext]));
try{
 const conversation=!!arg('--request-file');
 const text=conversation?fs.readFileSync(arg('--request-file'),'utf8'):String(arg('--text-file')?fs.readFileSync(arg('--text-file'),'utf8'):arg('--text')??'').replace(/[\u0000-\u001f]/g,' ').trim();
 if(!text||text.length>(conversation?120000:600))throw Error('TTS_TEXT_INVALID');if(conversation&&JSON.parse(text).mode!=='conversation')throw Error('VOICE_CONTEXT_INVALID');fs.writeFileSync(files.txt,text,{mode:0o600});
 const engine='gpt-live';const response=await run(python,[path.join(root,'scripts/tts/gpt_live.py'),files.txt,files.wav,...(conversation?['--conversation']:[]),'--timeout-ms',String(VOICE_TIMING.renderMs)],VOICE_TIMING.renderProcessMs);
 const rendered=JSON.parse(response.trim().split(/\r?\n/).at(-1));if(rendered.ok!==true)throw Error(rendered.error??'VOICE_LIVE_FAILED');
 const encoded=await run(python,[path.join(root,'scripts/tts/silk_enc.py'),files.wav,files.silk,'24000','16000'],VOICE_TIMING.encodeMs,{WECHATAGENT_VOIP_DLL:voip});
 const info=/frames=(\d+) dur_ms=(\d+) bytes=(\d+)/.exec(encoded);if(!info)throw Error('TTS_ENCODE_FAILED');
 console.log(JSON.stringify({ok:true,path:files.silk,durationMs:Math.max(1000,Number(info[2])),engine,mode:rendered.mode,transcript:rendered.transcript}));
}catch(error){try{fs.unlinkSync(files.silk);}catch{}console.log(JSON.stringify({ok:false,error:/^[A-Z_0-9]+$/.test(error.message)?error.message:'TTS_FAILED'}));}
finally{for(const ext of ['txt','wav'])try{fs.unlinkSync(files[ext]);}catch{}}
