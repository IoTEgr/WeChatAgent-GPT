import {LIVE_VOICES} from './live-voices.mjs';
export function createVoiceSettingsUI({api,state,escapeHtml:esc,header,toggle}){
 function card(){const voice=state.draft.wechat.voice?.liveVoice??'maple';
  return `<section class="card">${header('语音回复','GPT-Live · 使用这台电脑已登录的 ChatGPT 账号')}${toggle('允许语音回复','wechat.voice.enabled','一轮最多一条语音，也可以只发语音。')}<div class="field"><label for="voice-live-name">音色</label><select id="voice-live-name" data-path="wechat.voice.liveVoice">${LIVE_VOICES.map(name=>`<option value="${name}" ${voice===name?'selected':''}>${esc(name)}${name==='maple'?'（默认）':''}</option>`).join('')}</select></div><p class="subtle">通过本机 Codex 官方登录组件连接 ChatGPT 语音，不需要填写 API Key。每条语音使用独立短会话；根据当前聊天摘要、相关消息和人格自主接话。账号额度和服务可用性以实际调用为准。</p><p id="voice-login-status" role="status">正在检查 ChatGPT 登录…</p><p class="subtle">更换音色后保存并应用设置，无需重开 DSH。</p></section>`;
 }
 function mount(){const status=document.querySelector('#voice-login-status');if(!status)return;api('/api/voice/login').then(data=>{status.textContent=data.configured?'已检测到 ChatGPT 登录，可使用 Maple 等音色。':'尚未检测到可用的 ChatGPT 登录，请先在本机 Codex 中登录同一账号。';}).catch(()=>{status.textContent='暂时无法检查 ChatGPT 登录状态';});}
 return {card,mount};
}
