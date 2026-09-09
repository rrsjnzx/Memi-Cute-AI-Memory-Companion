(() => {
  // Isolated-world content script. The page sees only preset artwork/status.
  const VERSION='3';
  if(globalThis.__textMemorySoftFeedback?.version===VERSION)return;
  globalThis.__textMemorySoftFeedback?.dispose?.();
  const KEYS=['contextKey','operationId','attemptId','eventId','revision','personaId','semanticState','recipeId','phase','startedAt','duration','feedbackVisible','statusCode'];
  // Classic content scripts cannot import the presentation module. The production
  // adapter regression checks this complete preset table against STATUS_TEXT.
  const TEXT={idle:'等待操作',attentive:'正在关注',expectant:'准备操作',rest:'暂时休息',loading:'正在读取或连接',thinking:'正在整理资料',validating:'正在核验',awaiting_result:'等待实际结果',save_success:'已保存到本地库',package_success:'资料包已生成，尚未发送',insert_success:'已插入草稿，尚未发送',send_success:'已核实网页发送效果',copy_success:'已复制到剪贴板',conflict_resolved:'已保存冲突处理选择',task_success:'本次必要步骤已完成',missing_field:'请补全必填内容',target_unselected:'请先选择目标站点',page_not_ready:'目标页面尚未就绪',permission_required:'等待网页访问授权',conflict_detected:'资料有冲突，等待处理',unverified:'操作结果尚未确认',partial_success:'部分完成，请查看原提示',network_error:'连接异常，结果待核实',write_error:'写入未确认，请查看原因',insert_error:'未能确认插入，请检查草稿',parse_error:'内容未能识别，请检查格式',permission_error:'网页访问权限不足',timeout:'等待超时，结果未确认',canceled:'已停止本次操作',send_requested:'已调用发送，等待回复',draft_already_present:'此资料已在草稿中，未重复加入',saved_refresh_pending:'资料已保存，界面刷新未完成',copied_tracking_pending:'已复制，交付记录未保存',stopped_waiting:'已停止等待，后台结果未确认',core_draft_updated:'重要记忆草稿已修改，保存任务后生效',site_connected:'已授权并打开站点，尚未发送',operation_completed:"本次操作已完成",operation_failed:"操作未完成，请查看原因",editor_unsupported:"当前网页输入框不兼容，未执行写入",floating_opened:"网页浮窗已打开",draft_read:"已读取当前网页草稿",page_bound:"已绑定当前网页与所选资料库",access_paused:"网页访问已暂停",draft_restored:"已恢复写入前草稿",web_check_passed:"本次网页自检通过，未发送消息",functional_check_passed:"本次隔离功能验收通过",restart_check_passed:"本次重启数据核验通过",saved_report_read:"已读取保存的检查记录，未重新运行",view_updated:"界面已更新；资料以保存结果为准",reply_received:"已接收网页回复，待核对记忆",download_requested:"已请求下载，等待浏览器保存",target_ambiguous:'检测到多个目标，请明确选择',empty_result:'已完成检查，当前没有匹配内容',feedback_connection_lost:'反馈连接已断开，业务结果仍需原处核对',feedback_reconnecting:'正在重新连接反馈显示',feedback_reconnected:'反馈显示已重新接通',repeat_click:'操作仍在进行，重复触发已拦截'};
  let current=null;
  const exact=(value,keys)=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
  function post(instance,message){try{instance.port.postMessage({...message,contextKey:instance.contextKey,pageSession:instance.pageSession});}catch{dispose();}}
  function dispose(){const previous=current;if(!previous)return;current=null;previous.host?.remove();clearInterval(previous.checkTimer);removeEventListener('pagehide',dispose);removeEventListener('popstate',checkPage);removeEventListener('hashchange',checkPage);removeEventListener('resize',position);document.removeEventListener('visibilitychange',checkPage);globalThis.visualViewport?.removeEventListener('resize',position);globalThis.visualViewport?.removeEventListener('scroll',position);try{previous.port.disconnect();}catch{}}
  function checkPage(){if(current&&(location.href!==current.url||document.visibilityState==='hidden')){post(current,{type:'page_changed'});dispose();}}
  function viewport(){const view=globalThis.visualViewport;return{width:view?.width||innerWidth,height:view?.height||innerHeight,left:view?.offsetLeft||0,top:view?.offsetTop||0};}
  function position(){
    if(!current?.host)return false;const view=viewport(),valid=view.width>=200&&view.height>=180;
    current.host.hidden=!valid||!current.renderable||!current.snapshot?.feedbackVisible;
    // Fixed offsets use the CSS containing block, which excludes a classic
    // scrollbar. innerWidth includes it and would subtract that width twice.
    const layoutWidth=document.documentElement.clientWidth||innerWidth;
    Object.assign(current.host.style,{right:Math.max(10,layoutWidth-view.left-view.width+10)+'px',top:(view.top+view.height/2)+'px',width:Math.min(240,view.width-20)+'px'});
    if(current.renderable&&current.snapshot?.feedbackVisible){
      const changed=current.available!==null&&current.available!==valid;current.available=valid;
      if(changed)post(current,{type:'availability',revision:current.revision,mode:valid?'external':'internal',reason:valid?'':'narrow_viewport'});
    }
    return valid;
  }
  function ensureHost(instance){
    if(instance.host)return;
    const host=document.createElement('div');host.setAttribute('data-text-memory-soft-feedback','');
    Object.assign(host.style,{position:'fixed',zIndex:'2147483646',pointerEvents:'none',transform:'translateY(-50%)',height:'140px',display:'block',boxSizing:'border-box'});
    const shadow=host.attachShadow({mode:'closed'}),style=document.createElement('style');
    style.textContent=':host([hidden]){display:none!important}.bubble{position:relative;box-sizing:border-box;height:140px;border:1px solid #c6c1d5;border-radius:22px;background:#fbfaff;box-shadow:0 6px 24px #20203025;color:#343044;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:6px 12px 10px;font:12px/1.4 system-ui,sans-serif;pointer-events:none}.bubble:after{content:"";position:absolute;right:-7px;top:calc(50% - 6px);width:12px;height:12px;background:#fbfaff;border-right:1px solid #c6c1d5;border-top:1px solid #c6c1d5;transform:rotate(45deg)}.face{height:97px;width:160px;display:grid;place-items:center;pointer-events:none}.face svg{display:block;width:160px;height:97px;overflow:visible}.text{max-height:34px;overflow:hidden;text-align:center;margin:0;pointer-events:none}.close{position:absolute;top:6px;right:8px;width:25px;height:25px;border:0;border-radius:50%;background:transparent;color:#554e64;cursor:pointer;pointer-events:auto;font:18px/25px system-ui}.close:focus-visible{outline:2px solid #625c91;outline-offset:2px}';
    const bubble=document.createElement('section');bubble.className='bubble';bubble.setAttribute('aria-label','操作表情反馈');
    const face=document.createElement('div');face.className='face';face.setAttribute('aria-hidden','true');
    const text=document.createElement('p');text.className='text';// Main panel owns live announcements; do not announce twice.
    const close=document.createElement('button');close.className='close';close.type='button';close.textContent='×';close.setAttribute('aria-label','收起表情反馈');
    close.addEventListener('click',event=>{if(!event.isTrusted||current!==instance||!instance.snapshot)return;post(instance,{type:'dismiss',revision:instance.snapshot.revision});});
    bubble.append(face,text,close);shadow.append(style,bubble);document.documentElement.append(host);Object.assign(instance,{host,face,text});
  }
  function valid(snapshot,instance){return exact(snapshot,KEYS)&&snapshot.contextKey===instance.contextKey&&Number.isSafeInteger(snapshot.revision)&&snapshot.revision>instance.revision&&typeof snapshot.feedbackVisible==='boolean'&&Object.hasOwn(TEXT,snapshot.statusCode)&&typeof snapshot.recipeId==='string'&&snapshot.recipeId.length<=160&&typeof snapshot.personaId==='string'&&['enter','main','hold','recover'].includes(snapshot.phase)&&Number.isFinite(snapshot.startedAt)&&Number.isFinite(snapshot.duration);}
  function render(instance,snapshot){
    if(current!==instance||!valid(snapshot,instance))return;
    checkPage();if(current!==instance)return;
    instance.revision=snapshot.revision;instance.snapshot=snapshot;instance.renderable=false;let mode='external',reason='';
    if(snapshot.feedbackVisible){
      try{
        const svg=globalThis.__textMemorySoftFace?.renderFeedback({document,snapshot});
        if(!svg||svg.namespaceURI!=='http://www.w3.org/2000/svg')throw Error('renderer_unavailable');
        ensureHost(instance);instance.face.replaceChildren(svg);instance.text.textContent=TEXT[snapshot.statusCode];instance.renderable=true;
        instance.host.setAttribute('data-context-key',snapshot.contextKey);instance.host.setAttribute('data-recipe-id',snapshot.recipeId);instance.host.setAttribute('data-phase',snapshot.phase);instance.host.setAttribute('data-revision',String(snapshot.revision));
        if(!position()){mode='internal';reason='narrow_viewport';}
        if(!instance.checkTimer)instance.checkTimer=setInterval(checkPage,250);
      }catch{mode='internal';reason='renderer_unavailable';if(instance.host)instance.host.hidden=true;}
    }else{if(instance.host)instance.host.hidden=true;clearInterval(instance.checkTimer);instance.checkTimer=null;}
    requestAnimationFrame(()=>{if(current===instance&&instance.revision===snapshot.revision)post(instance,{type:'rendered',revision:snapshot.revision,renderedAt:Date.now(),mode,reason});});
  }
  function mount(args){
    if(!exact(args,['contextKey','pageSession','url'])||!['contextKey','pageSession'].every(key=>typeof args[key]==='string'&&args[key].length>0&&args[key].length<=160)||args.url!==location.href||document.visibilityState==='hidden')return{status:'unavailable'};
    dispose();const port=chrome.runtime.connect({name:'text-memory-soft-feedback-v1'});const instance={...args,port,revision:0,host:null,snapshot:null,checkTimer:null,renderable:false,available:null};current=instance;
    port.onMessage.addListener(message=>{if(current!==instance)return;if(exact(message,['type','snapshot'])&&message.type==='presentation')render(instance,message.snapshot);else if(exact(message,['type','contextKey','pageSession'])&&message.type==='close'&&message.contextKey===instance.contextKey&&message.pageSession===instance.pageSession)dispose();});
    port.onDisconnect.addListener(()=>{if(current===instance)dispose();});
    addEventListener('pagehide',dispose);addEventListener('popstate',checkPage);addEventListener('hashchange',checkPage);addEventListener('resize',position);document.addEventListener('visibilitychange',checkPage);globalThis.visualViewport?.addEventListener('resize',position);globalThis.visualViewport?.addEventListener('scroll',position);
    post(instance,{type:'ready'});return{status:'mounted'};
  }
  globalThis.__textMemorySoftFeedback=Object.freeze({version:VERSION,mount,dispose});
})();
