(()=>{
  const $=id=>document.getElementById(id),editor=$('prompt-textarea'),form=$('mockComposer'),sendButton=form.querySelector('button');
  const names={valid:'有效记忆更新',clear_progress:'建议清空进度',plain:'只有普通正文',stream:'流式正文与完整更新',search:'检索补充后记忆更新',search_loop:'持续检索请求（检查两次上限）',extraction_valid:'原文提炼：有效精确引用',extraction_mixed:'原文提炼：有效、疑点和虚构引用',malformed:'JSON 格式损坏',old:'旧资料包回执',no_effect:'发送按钮无效果'};
  let scenario='valid',count=0,generation=0,previousPayload=null,editorMode='desktop';
  const log=(kind,details={})=>parent.__tmWebHost?.log(kind,details);
  function setEditorMode(value){
    if(!['desktop','mobile'].includes(value))throw Error('未知模拟输入框类型');
    if(sendButton.disabled||editor.value){$('editor-mode').value=editorMode;$('mockStatus').textContent='请先处理已有草稿并等待当前回复完成，再切换模拟输入框。';return false;}
    editorMode=value;editor.id=value==='mobile'?'mobile-composer-prompt':'prompt-textarea';
    if(value==='mobile')editor.setAttribute('data-mobile-composer-prompt','');else editor.removeAttribute('data-mobile-composer-prompt');
    $('editor-mode').value=value;$('mockStatus').textContent=value==='mobile'?'已切换移动 textarea：使用真实浏览器编辑命令；这是本地 DOM 夹具，不模拟 ChatGPT 的完整框架状态。':'已切换桌面 textarea；回复场景与发送计数保留。';
    log('切换模拟输入框',{editorMode,valueWrites:0,modelCalls:0});return true;
  }
  function setScenario(value){if(!Object.hasOwn(names,value))throw Error('未知模拟场景');scenario=value;$('scenarioLabel').textContent='场景：'+names[value];if(['search','search_loop'].includes(value))$('mockStatus').textContent='检索目标：青梧匣编号。请在原管理页建立已审核的普通事实，内容为“青梧匣编号是 L-73，放在北侧架第二层。”，不要将它固定为任务核心。模拟器只检查本次实际发送包中的引用资料。';}
  function message(author,text){
    $('empty')?.remove();const wrap=document.createElement('div'),label=document.createElement('div'),article=document.createElement('article'),body=document.createElement('pre');
    wrap.className='message '+author;label.className='label';label.textContent=author==='user'?'已实际发送的原始资料包':'本地脚本生成的原始回答';
    article.setAttribute('data-message-author-role',author);article.setAttribute('data-message-id','local-'+count+'-'+author);article.setAttribute('data-is-streaming','false');body.textContent=text;article.append(body);wrap.append(label,article);$('transcript').append(wrap);return{article,body};
  }
  function parseRequest(text){
    const match=text.match(/^TEXT-MEMORY-PACK ([A-Za-z0-9_-]+)\r?\n/),protocol=text.match(/(?:^|\n)TEXT-MEMORY-UPDATE\r?\n([\s\S]*?)\r?\nEND-TEXT-MEMORY-UPDATE(?:\r?\n|$)/);
    const question=text.match(/(?:^|\n)本轮任务：([^\n]*(?:\n(?!\n)[^\n]*)*)/)?.[1]?.trim()||'普通测试问题';
    let payload=null;try{payload=protocol?JSON.parse(protocol[1]):null;}catch{}
    let task=null;try{const body=text.match(/用户保存的持续任务档案（可跨 AI 网站使用）：\r?\n([\s\S]*?)\r?\n\r?\n记忆更新格式：/)?.[1];task=body?JSON.parse(body):null;}catch{}
    if(!match||!text.trim().endsWith('END-TEXT-MEMORY-PACK '+match[1])||!payload||payload.packId!==match[1])return{question,payload:null,task};
    return{question,payload,task};
  }
  function reply(text,selected){
    if(['extraction_valid','extraction_mixed'].includes(selected))return globalThis.__tmMockExtraction.reply({text,scenario:selected,count});
    const request=parseRequest(text),{question,payload,task}=request;
    const body=`本地模拟回答 · 第 ${count} 次请求\n\n收到的问题：${question}\n${task?'本轮任务目标：'+task.goal:'此条消息未包含有效的持续任务档案。'}\n\n这段正文由本地固定脚本生成，用于检查浮窗接收、协议隐藏和任务流程。${selected==='clear_progress'?'\n本地测试建议：将任务进度清空，保留原未解决事项。这只是待审核建议，尚未保存到记忆库。':''}`;
    if(selected==='plain'||!payload)return{body,full:body,payload:null};
    if(['search','search_loop'].includes(selected)){
      const searched=globalThis.__tmMockSearch.reply({text,task,payload,question,count,loop:selected==='search_loop'});
      if(searched)return searched;
      return{body,full:body,payload:null,statusText:'本次资料包缺少可核对的任务身份；未生成检索请求或记忆更新。'};
    }
    const current={taskId:payload.taskId,baseVersion:payload.baseVersion,packId:payload.packId,progress:selected==='clear_progress'?'':((task?.progress?task.progress+'\n':'')+'本地模拟已处理第 '+count+' 次请求：'+question).slice(0,12000),openQuestions:task?.openQuestions||'',facts:$('includeFact').checked?[$('repeatFact')?.checked?{title:'固定观察候选',content:'原创测试：灯塔备用钥匙放在北侧柜子里，仍待核实。',aliases:['备用钥匙']}:{title:'本地模拟观察候选 '+count,content:'原创软件测试候选：第 '+count+' 次本地请求已由脚本生成回复，此内容仍需审核。',aliases:['本地模拟候选']}]:[]};
    let returned=current;if(selected==='old')returned=previousPayload?{...previousPayload}:{...current,packId:'pack_web_test_previous_not_current'};
    previousPayload=structuredClone(current);
    const json=selected==='malformed'?JSON.stringify(returned,null,2).replace(/\n}$/,',\n}'):JSON.stringify(returned,null,2);
    return{body,full:body+'\n\nTEXT-MEMORY-UPDATE\n'+json+'\nEND-TEXT-MEMORY-UPDATE',payload:returned};
  }
  async function submit(event){
    event.preventDefault();const text=editor.value;if(!text.trim()||sendButton.disabled)return;
    const selected=scenario;count++;$('sendCount').textContent='实际发送点击 '+count+' 次';log('模拟发送控件点击',{number:count,scenario:selected,characters:text.length,modelCalls:0});
    if(selected==='no_effect'){$('mockStatus').textContent='故障场景：按钮已收到点击，但草稿保留且没有新增消息，用于检查不确定状态与防重复发送。';return;}
    editor.value='';editor.dispatchEvent(new Event('input',{bubbles:true}));message('user',text);const output=reply(text,selected),rendered=message('assistant',''),run=++generation;
    sendButton.disabled=true;rendered.article.setAttribute('data-is-streaming','true');$('mockStatus').textContent='本地脚本正在生成回复…';
    if(selected==='stream'){
      const cut=Math.floor(output.body.length/2),pieces=[output.body.slice(0,cut),output.body,output.body+'\n\nTEXT-MEM',output.body+'\n\nTEXT-MEMORY-UPDATE\n{',output.full.slice(0,-22),output.full];
      for(const piece of pieces){if(run!==generation)return;rendered.body.textContent=piece;await new Promise(resolve=>setTimeout(resolve,1400));}
    }else{await new Promise(resolve=>setTimeout(resolve,300));if(run!==generation)return;rendered.body.textContent=output.full;}
    if(run!==generation)return;rendered.article.setAttribute('data-is-streaming','false');sendButton.disabled=false;$('mockStatus').textContent=output.statusText||'本地脚本已生成 '+names[selected]+'。请检查浮窗和任务实际状态。';
    log('模拟回答已写入 DOM',{number:count,scenario:selected,characters:output.full.length,protocol:!!output.payload,...(output.diagnostic?{[output.diagnostic.kind==='extraction'?'extraction':'search']:output.diagnostic}:{}),modelCalls:0});
  }
  form.addEventListener('submit',submit);
  $('editor-mode').addEventListener('change',event=>setEditorMode(event.target.value));
  $('resetPage').addEventListener('click',()=>{generation++;sendButton.disabled=false;editor.value='';$('transcript').replaceChildren();$('mockStatus').textContent='仅清空模拟网页对话；本地资料库、任务、浮窗历史与发送记录保留。';log('清空模拟网页消息');});
  globalThis.__tmMockSite={setScenario,setEditorMode,execute:request=>globalThis.__textMemoryAdapterV2.execute(request),get shell(){return globalThis.__textMemoryFloatingShell;},get state(){return{scenario,editorMode,count,generating:sendButton.disabled,modelCalls:0};}};
})();
