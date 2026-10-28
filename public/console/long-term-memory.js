export function createLongMemoryUI({api,state,escapeHtml:esc,renderPage,toast}){
  let selected='',mode='',data,scope='',query='';
  const labels={fact:'事实与偏好',note:'重要事情',loop:'未完成约定'};
  const messages={MEMORY_REVISION_CHANGED:'记忆刚被更新，请刷新后再保存。',MEMORY_BUSY:'记忆正在写入，请稍后重试；如果曾异常退出，请检查记忆目录的锁文件。',MEMORY_CAPACITY_REACHED:'此类记忆已满，请先删除过时记录。',MEMORY_FILE_INVALID:'记忆文件无法解析，原文件已保留，请先修复文件。'};
  const errorText=error=>messages[error.message]??error.message;
  async function page(){
    const overview=await api('/api/memory');if(!overview.available)return `<section class="card"><h2>先连接微信账号</h2><p>${esc(overview.message)}</p></section>`;
    scope=overview.accountScope;const chats=overview.chats;
    if(!chats.some(row=>row.key===selected)){selected=chats[0]?.key??'';mode='';}
    if(!selected)return '<section class="card"><p>请先添加允许的聊天范围。</p></section>';
    if(!mode)mode=state.config?.wechat.workModes?.[selected]??'social';
    try{data=await api('/api/memory/long-term?'+new URLSearchParams({scope,conversationKey:selected,mode}));}catch(error){return `<section class="card"><h2>长期记忆暂时无法读取</h2><p>${esc(errorText(error))}</p><button class="button" data-long-memory-refresh>刷新</button></section>`;}
    const rows=data.entries.filter(row=>!query||[row.subject,row.topic,row.text].join(' ').toLocaleLowerCase().includes(query.toLocaleLowerCase())).sort((a,b)=>b.updatedAt-a.updatedAt);
    return `<div class="section-stack"><section class="card"><form id="long-memory-filter" class="field-grid"><div class="field"><label for="long-memory-chat">聊天</label><select id="long-memory-chat">${chats.map(chat=>`<option value="${esc(chat.key)}" ${selected===chat.key?'selected':''}>${esc(state.names.get(chat.key)||chat.key)}</option>`).join('')}</select></div><div class="field"><label for="long-memory-mode">记忆空间</label><select id="long-memory-mode">${[['social','聊天模式'],['assistant','助手任务']].map(([id,label])=>`<option value="${id}" ${mode===id?'selected':''}>${label}</option>`).join('')}</select></div><div class="field"><label for="long-memory-query">查找记忆</label><input id="long-memory-query" type="search" maxlength="100" value="${esc(query)}"></div><button class="button">查找</button></form></section>
    <section class="card"><h2>聊天信息卡</h2><p class="subtle">各账号、群聊、私聊和工作模式分别保存。每轮只带入少量相关记忆，完整内容留在本机。日记仍在“鱼的记事本”，旧聊天仍可从档案检索。</p><form id="long-memory-settings"><label><input id="long-memory-enabled" type="checkbox" ${data.enabled?'checked':''}> 启用此会话的长期记忆</label><div class="field"><label for="long-memory-card">人工补充（最多 1600 字）</label><textarea id="long-memory-card" maxlength="1600" rows="5" placeholder="重要关系、背景、称呼等事实；不要在这里填写密钥。">${esc(data.card)}</textarea></div><button class="button primary">保存信息卡</button></form></section>
    <section class="card"><h2>记一件事</h2><form id="long-memory-add"><div class="field-grid"><div class="field"><label for="long-memory-kind">类型</label><select id="long-memory-kind">${Object.entries(labels).map(([kind,label])=>`<option value="${kind}">${label}</option>`).join('')}</select></div><div class="field"><label for="long-memory-subject">涉及谁</label><input id="long-memory-subject" required maxlength="100" placeholder="昵称和成员标识"></div><div class="field"><label for="long-memory-topic">主题</label><input id="long-memory-topic" required maxlength="80" placeholder="同一人同一主题会更新原记录"></div></div><div class="field"><label for="long-memory-text">内容</label><textarea id="long-memory-text" required maxlength="500" rows="3"></textarea></div><button class="button">保存记忆</button></form></section>
    ${Object.entries(labels).map(([kind,label])=>`<section class="card"><h2>${label} · ${data.entries.filter(row=>row.kind===kind).length}</h2>${rows.filter(row=>row.kind===kind).map(row=>`<article class="memory-member"><h3>${esc(row.subject)} · ${esc(row.topic)}${row.status==='done'?' · 已完成':''}</h3><p style="white-space:pre-wrap">${esc(row.text)}</p><small class="subtle">${new Date(row.updatedAt).toLocaleString('zh-CN')}</small>${row.evidence?`<details><summary>原话依据</summary><p>${esc(row.evidence)}</p></details>`:''}<div class="button-row"><button class="button small" data-long-memory-edit="${esc(row.id)}">编辑</button>${kind==='loop'&&row.status==='open'?`<button class="button small" data-long-memory-complete="${esc(row.id)}">标为完成</button>`:''}<button class="button small" data-long-memory-forget="${esc(row.id)}">遗忘</button></div></article>`).join('')||'<p class="subtle">暂无记录</p>'}</section>`).join('')}</div>`;
  }
  async function save(operation,button){
    if(button)button.disabled=true;
    try{data=await api('/api/memory/long-term',{scope,conversationKey:selected,mode,revision:data.revision,operation});toast('记忆已更新');await renderPage();}
    catch(error){toast(errorText(error));}finally{if(button)button.disabled=false;}
  }
  function mount(){
    const filter=document.getElementById('long-memory-filter');if(!filter)return;
    filter.onsubmit=event=>{event.preventDefault();query=document.getElementById('long-memory-query').value;void renderPage();};
    document.getElementById('long-memory-chat').onchange=event=>{selected=event.target.value;mode='';void renderPage();};
    document.getElementById('long-memory-mode').onchange=event=>{mode=event.target.value;void renderPage();};
    document.getElementById('long-memory-settings').onsubmit=event=>{event.preventDefault();void save({op:'settings',enabled:document.getElementById('long-memory-enabled').checked,card:document.getElementById('long-memory-card').value},event.submitter);};
    document.getElementById('long-memory-add').onsubmit=event=>{event.preventDefault();void save({op:'remember',items:[{kind:document.getElementById('long-memory-kind').value,subject:document.getElementById('long-memory-subject').value,topic:document.getElementById('long-memory-topic').value,text:document.getElementById('long-memory-text').value}]},event.submitter);};
  }
  function click(button){
    if(button.hasAttribute('data-long-memory-refresh')){void renderPage();return true;}
    const editId=button.getAttribute('data-long-memory-edit');if(editId){const row=data?.entries.find(entry=>entry.id===editId);if(row){for(const field of ['kind','subject','topic','text'])document.getElementById('long-memory-'+field).value=row[field];document.getElementById('long-memory-text').focus();document.getElementById('long-memory-add').scrollIntoView({block:'center'});}return true;}
    for(const op of ['forget','complete']){const id=button.getAttribute('data-long-memory-'+op);if(id){void save({op,id},button);return true;}}
    return false;
  }
  return {page,mount,click};
}
