(() => {
  const VERSION='0.12.0';
  if(globalThis.__textMemoryAdapterV2?.version===VERSION)return;
  globalThis.__textMemoryAdapterV2?.dispose?.();
  const pageKey=crypto.randomUUID();let composing=false,last=null,failedWrite=null,operationInFlight=false;
  const compositionStart=()=>{composing=true;},compositionEnd=()=>{composing=false;};
  document.addEventListener('compositionstart',compositionStart,true);
  document.addEventListener('compositionend',compositionEnd,true);
  const specs={
    // Additional textarea observed on ChatGPT's mobile composer, 2026-09-07.
    'chatgpt.com':{id:'chatgpt',selectors:['#prompt-textarea[contenteditable="true"]','textarea#prompt-textarea','textarea#mobile-composer-prompt[data-mobile-composer-prompt]']},
    'chat.deepseek.com':{id:'deepseek',selectors:['textarea#chat-input','textarea[placeholder*="DeepSeek"]','textarea[placeholder*="发送消息"]']},
    // Observed on the real sites on 2026-09-05. Editor discovery is not proof
    // of extension installation, framework acceptance, or message delivery.
    'www.kimi.com':{id:'kimi',selectors:['div.chat-input-editor[contenteditable="true"][role="textbox"]']},
    'grok.com':{id:'grok',selectors:['div.tiptap.ProseMirror[contenteditable="true"][role="textbox"][aria-label="Ask Grok anything"]','textarea[aria-label="Ask Grok anything"]']},
    'claude.ai':{id:'claude',selectors:['div.tiptap.ProseMirror[contenteditable="true"][role="textbox"]']},
    // Public editor DOM observed on 2026-09-08. These exact shapes are not a
    // claim that a framework accepted a write or that a model received it.
    'www.qianwen.com':{id:'qianwen',selectors:['div[role="textbox"][data-slate-editor="true"][data-slate-node="value"][contenteditable="true"]']},
    'gemini.google.com':{id:'gemini',selectors:['rich-textarea.text-input-field_textarea.ql-container > div.ql-editor[contenteditable="true"][role="textbox"]']}
  };
  function spec(){return specs[location.hostname]||null;}
  function fail(status,message){return{status,message};}
  function verificationShown(){
    return[...document.querySelectorAll('iframe[id="baxia-dialog-content"]')].some(frame=>{
      if(!frame.getClientRects().length)return false;
      for(let node=frame;node;node=node.parentElement){const style=globalThis.getComputedStyle?.(node);if(node.hidden||node.getAttribute?.('aria-hidden')==='true'||node.hasAttribute?.('inert')||style?.display==='none'||['hidden','collapse'].includes(style?.visibility))return false;}
      return true;
    });
  }
  function target(){
    const adapter=spec();if(!adapter)throw fail('unsupported','本站没有已实现的输入框适配器，可使用复制');
    if(adapter.id==='qianwen'&&verificationShown())throw fail('unsupported','千问正在要求网页人机验证，请先在原网页完成验证后再连接');
    const candidates=[...new Set(adapter.selectors.flatMap(s=>[...document.querySelectorAll(s)]))].filter(e=>e.getClientRects().length&&!e.disabled&&!e.readOnly&&e.getAttribute('aria-hidden')!=='true');
    if(candidates.length!==1)throw fail(candidates.length?'ambiguous_target':'unsupported',candidates.length?'检测到多个输入框，已停止':'未找到兼容输入框，仍可复制');
    const modal=[...document.querySelectorAll('dialog[open],[aria-modal="true"]')].find(e=>e.getClientRects().length);
    if(modal&&!modal.contains(candidates[0]))throw fail('unsupported','页面有模态窗口遮挡输入框，请先完成或关闭窗口');
    return candidates[0];
  }
  function read(element){
    if(element instanceof HTMLTextAreaElement)return element.value;
    // Chromium's innerText double-counts a blank <div><br></div> between
    // blocks. Serialize editor paragraphs explicitly, preserving blank lines.
    function content(node){
      if(node.nodeType===Node.TEXT_NODE)return node.textContent;
      if(node.nodeType!==Node.ELEMENT_NODE&&node.nodeType!==11)return '';
      // Slate inserts a visible placeholder and a zero-width sentinel for an
      // empty paragraph. Neither belongs to the user's draft. Keep this
      // projection host-scoped and never strip legitimate FEFF text globally.
      if(node.nodeType===Node.ELEMENT_NODE&&spec()?.id==='qianwen'&&(node.getAttribute('data-slate-placeholder')==='true'||node.hasAttribute('data-slate-zero-width')))return '';
      if(node.tagName==='BR')return node.classList.contains('ProseMirror-trailingBreak')||(['P','DIV'].includes(node.parentElement.tagName)&&node.parentElement.childNodes.length===1)?'':'\n';
      let out='';let previousBlock=false;
      [...node.childNodes].forEach((child,index)=>{const block=child.nodeType===Node.ELEMENT_NODE&&['DIV','P','LI','PRE','BLOCKQUOTE'].includes(child.tagName);
        if(index&&(block||previousBlock))out+='\n';out+=content(child);previousBlock=block;});
      return out;
    }
    return content(element).replace(/\r\n/g,'\n');
  }
  async function hash(text){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));return Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');}
  function identity(){const temporary=location.pathname==='/'||location.hostname==='claude.ai'&&location.pathname==='/new'||location.hostname==='gemini.google.com'&&location.pathname==='/app';return{url:location.href,pageKey,conversation:temporary?'temporary:'+pageKey:location.pathname,temporary,adapter:spec()?.id||'unsupported',adapterVersion:VERSION};}
  function sameTarget(element){try{return target()===element;}catch{return false;}}
  function visible(){return document.visibilityState!=='hidden';}
  function mobileTextarea(element){return spec()?.id==='chatgpt'&&element.matches?.('textarea#mobile-composer-prompt[data-mobile-composer-prompt]');}
  function mobileReady(element,url){return visible()&&!composing&&location.href===url&&sameTarget(element);}
  function hiddenPage(){return fail('stale_target','目标网页已切换到后台，已停止。切回要使用的 AI 网页后，再次点击“连接当前网页并加入草稿”。');}
  function emptySlateSentinelRange(root,range){
    const text=range.startContainer,span=text?.parentElement;
    return text===range.endContainer&&text?.nodeType===Node.TEXT_NODE&&text.textContent==='\ufeff'&&range.startOffset===0&&range.endOffset===1&&
      span?.tagName==='SPAN'&&span.getAttribute('data-slate-zero-width')==='n'&&span.getAttribute('data-slate-length')==='0'&&
      span.parentElement?.getAttribute('data-slate-leaf')==='true'&&root.contains(span);
  }
  async function write(element,text){
    if(!visible())throw hiddenPage();
    if(mobileTextarea(element)){
      const editor=globalThis.__textMemoryMobileTextarea,url=location.href;
      if(typeof editor?.write!=='function')throw fail('unsupported','输入框编辑组件未加载，请重新连接当前网页');
      return editor.write(element,text,{ready:()=>mobileReady(element,url),readText:()=>read(element)});
    }
    if(['kimi','qianwen'].includes(spec()?.id)){
      const before=read(element),url=location.href,editor=globalThis.__textMemorySelectionPaste;
      if(typeof editor?.selectAll!=='function'||typeof editor?.covers!=='function'||typeof editor?.paste!=='function'||typeof editor?.erase!=='function')throw fail('unsupported','选区编辑组件未加载，请重新连接当前网页');
      const ready=()=>visible()&&!composing&&location.href===url&&sameTarget(element)&&read(element)===before;
      const qianwen=spec()?.id==='qianwen',projection=qianwen?read:undefined,selectionOptions=qianwen?{resetFullSelection:true,nativeFullSelection:true,isEmptySentinelRange:emptySlateSentinelRange,selectionStableMs:150,timeoutMs:1000,pollIntervalMs:50}:{},selected=await editor.selectAll(element,ready,projection,selectionOptions);
      if(!visible())throw hiddenPage();
      if(!selected||!ready()||element.ownerDocument.activeElement!==element||!editor.covers(element,element.ownerDocument.getSelection(),projection,selectionOptions))throw fail('stale_target','编辑器选区尚未同步，或草稿/页面已改变；未继续写入');
      if(text)editor.paste(element,text);else editor.erase(element);
      return;
    }
    element.focus();
    if(element instanceof HTMLTextAreaElement){Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(element,text);element.dispatchEvent(new Event('input',{bubbles:true}));element.dispatchEvent(new Event('change',{bubbles:true}));}
    else{
      const selection=getSelection(),range=document.createRange();range.selectNodeContents(element);selection.removeAllRanges();selection.addRange(range);
      // Chromium insertText rewrites repeated ASCII spaces as NBSP. Feed fully
      // escaped text through an editing command with whitespace preservation;
      // retain exact readback, including literal NBSP. Never assign innerHTML.
      const accepted=text?document.execCommand('insertHTML',false,globalThis.__textMemoryPlainTextHTML(text)):document.execCommand('delete',false);
      if(!accepted)throw fail('transient_failure','富文本编辑器未接受插入，请使用复制');
    }
  }
  function unresolved(text){
    if(failedWrite&&!failedWrite.strict&&(text===failedWrite.before||text===''))failedWrite=null;
    return !!failedWrite;
  }
  async function recoverFailure(element,text){
    if(failedWrite?.strict&&(text===failedWrite.before||text==='')){
      const failure=failedWrite,url=location.href,editor=globalThis.__textMemoryMobileTextarea;
      if(spec()?.id==='qianwen'){
        const checked=await readback(element,text,url);
        if(checked.stable&&failedWrite===failure&&visible()&&!composing&&location.href===url&&sameTarget(element)&&read(element)===text)failedWrite=null;
      }else if(typeof editor?.check==='function'){
        const checked=await editor.check(element,text,{ready:()=>mobileReady(element,url),readText:()=>read(element)});
        if(checked.stable&&failedWrite===failure&&mobileReady(element,url)&&read(element)===text)failedWrite=null;
      }
    }
    return unresolved(read(element));
  }
  async function readback(element,expected,url,written){
    if(mobileTextarea(element))return written?.stable&&mobileReady(element,url)&&read(element)===expected?written:{stable:false,text:read(element)};
    if(['kimi','qianwen'].includes(spec()?.id))return globalThis.__textMemorySelectionPaste.readback(element,expected,
      ()=>visible()&&location.href===url&&!composing&&sameTarget(element),()=>read(element),spec()?.id==='qianwen'?{stableMs:600,timeoutMs:1800,pollIntervalMs:50}:{});
    await new Promise(requestAnimationFrame);const text=read(element);return{stable:text===expected,text};
  }
  function mismatch(before,expected,actual,stable,strict=false){
    if(actual!==before)failedWrite={before,strict};
    return fail('transient_failure',`写入读回${actual===expected&&!stable?'未能在时限内稳定':'不一致'}（预期 ${expected.length} 字符，实际 ${actual.length} 字符）；${actual!==before?'草稿已改变，已停止连续写入，请核对并恢复原草稿或清空测试残留后再试':'草稿仍为写入前内容'}；未发送`);
  }
  async function snapshot(){const element=target();await recoverFailure(element,read(element));const text=read(element);return{status:unresolved(text)?'unresolved_write':'ready',...identity(),draft:text,draftHash:await hash(text),composing,
    ...(failedWrite?{message:'上次写入失败后的草稿尚未处理。请核对并恢复原草稿或清空测试残留后再试。'}:{})};}
  function readSelection(request){
    const current=identity();
    if(!spec())return fail('unsupported','本站没有已实现的页面适配器');
    if(Object.keys(current).some(key=>request.identity?.[key]!==current[key]))return fail('stale_target','页面或会话已改变，请重新读取并绑定');
    const selection=document.getSelection();
    if(!selection||selection.rangeCount!==1||selection.isCollapsed)return fail('no_selection','请先在网页回复正文中选中需要保存的记忆候选');
    const range=selection.getRangeAt(0),editable=node=>{
      for(let element=node?.nodeType===Node.ELEMENT_NODE?node:node?.parentElement;element;element=element.parentElement){
        const attribute=element.getAttribute?.('contenteditable');
        if(['INPUT','TEXTAREA','SELECT'].includes(element.tagName)||element.isContentEditable||attribute!==null&&attribute!==undefined&&attribute.toLowerCase()!=='false')return true;
      }
      return false;
    };
    if(!document.documentElement.contains(range.startContainer)||!document.documentElement.contains(range.endContainer))return fail('invalid_selection','选区不属于当前网页');
    if(editable(range.startContainer)||editable(range.endContainer)||[...document.querySelectorAll('input,textarea,select,[contenteditable]')].some(element=>editable(element)&&range.intersectsNode(element)))return fail('editable_selection','不能从输入框或可编辑区域读取候选，请选中网页回复正文或在扩展中手动粘贴');
    const text=selection.toString();
    if(!text.trim())return fail('no_selection','选区没有文本');
    if(text.length>100000)return fail('selection_too_large','选中文字超过 100000 字符，请仅选择记忆候选段');
    return{status:'selected',text,...current};
  }
  function replySource(source){
    const clean=Object.fromEntries(['adapter','author','selector','sourceEvidence','messageKey'].filter(key=>typeof source[key]==='string').map(key=>[key,source[key].slice(0,500)]));
    const check=source.generationCheck,allowed=['data-is-streaming','data-streaming','aria-busy','data-perf-row-streaming'];
    if(check&&['explicit_false','no_observed_busy_signal'].includes(check.basis)&&Array.isArray(check.attributes)&&check.attributes.length<=4&&new Set(check.attributes).size===check.attributes.length&&check.attributes.every(name=>allowed.includes(name))&&check.stableSamples===2&&check.minIntervalMs===1000&&(check.basis==='explicit_false'?check.attributes.length>0:check.attributes.length===0))clean.generationCheck={basis:check.basis,attributes:[...check.attributes],stableSamples:2,minIntervalMs:1000};
    return clean;
  }
  async function readLatestReply(request){
    if(!spec())return fail('unsupported','本站没有已实现的页面适配器');
    if(!visible())return hiddenPage();
    const before=identity();
    if(Object.keys(before).some(key=>request.identity?.[key]!==before[key]))return fail('stale_target','页面或会话已改变，请重新连接当前网页');
    const reader=globalThis.__textMemoryReplyReader;
    if(typeof reader?.read!=='function')return fail('unsupported','当前网页尚未加载回复读取器，请重新连接网页或手动粘贴协议');
    let result;try{result=await reader.read({expected:request.expected,...(request.includeDisplay===true?{includeDisplay:true}:{})});}catch{return fail('invalid_reply','回复读取失败，请重试或手动粘贴协议');}
    const after=identity();
    if(!visible()||Object.keys(before).some(key=>before[key]!==after[key]))return fail('stale_target','读取期间页面或会话已改变，已丢弃回执内容');
    const status={status:typeof result?.status==='string'?result.status:'invalid_reply'};
    for(const key of ['message','reason'])if(typeof result?.[key]==='string')status[key]=result[key].slice(0,1000);
    if(Number.isFinite(result?.retryAfterMs)&&result.retryAfterMs>=0)status.retryAfterMs=result.retryAfterMs;
    const display=request.includeDisplay===true?replyDisplay(result):null;
    const diagnostic=request.includeDisplay===true?replyDiagnostic(result,request.expected):null;
    if(result?.status!=='reply_ready')return{...status,...after,...(display?{display}:{}),...(diagnostic?{diagnostic}:{})};
    if(typeof result.text!=='string'||!result.text.trim()||result.text.length>100000||!['UPDATE','SEARCH'].includes(result.kind)||Object.hasOwn(result,'answerText')&&(typeof result.answerText!=='string'||result.answerText.length>100000))return fail('invalid_reply','回复读取器返回了无效协议内容');
    return{...status,text:result.text,kind:result.kind,...after,...(display?{display}:{}),
      ...(typeof result.answerText==='string'?{answerText:result.answerText}:{}),
      ...(typeof result.fingerprint==='string'&&/^[a-f0-9]{64}$/.test(result.fingerprint)?{fingerprint:result.fingerprint}:{}),
      ...(Number.isFinite(result.stableForMs)&&result.stableForMs>=0?{stableForMs:result.stableForMs}:{}),
      ...(result.source&&typeof result.source==='object'?{source:replySource(result.source)}:{}),
      ...(typeof result.note==='string'?{note:result.note.slice(0,1000)}:{})};
  }
  // Display is opt-in presentation data, never a receipt or a memory update.
  function replyDisplay(result){
    const value=result?.display;
    if(!['reply_ready','waiting','invalid_reply','ambiguous'].includes(result?.status)||!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==4||!['text','phase','pairing','messageKey'].every(key=>Object.hasOwn(value,key)))return null;
    if(typeof value.text!=='string'||!value.text.trim()||value.text.length>100000||!['streaming','settling','stable'].includes(value.phase)||!['protocol','user_pack'].includes(value.pairing)||typeof value.messageKey!=='string'||!value.messageKey.trim()||value.messageKey.length>500)return null;
    return{text:value.text,phase:value.phase,pairing:value.pairing,messageKey:value.messageKey};
  }
  // Malformed receipts are opt-in diagnostics only. Never promote them to valid text.
  // Injected adapters cannot import modules; keep this filter aligned with core/rejected-reply.js.
  function rejectedReplyBlock(full,expected){
    if(typeof full!=='string'||full.length>100000||!expected||/^[ \t]*(?:END-)?TEXT-MEMORY-PACK(?:[ \t]+[^\n]*)?[ \t]*\r?$/m.test(full))return null;
    const markers=[...full.matchAll(/^[ \t]*(END-)?TEXT-MEMORY-(UPDATE|SEARCH)[ \t]*\r?$/gm)];
    if(markers.length!==2||markers[0][1]||!markers[1][1]||markers[0][2]!==markers[1][2])return null;
    const [start,end]=markers,json=full.slice(start.index+start[0].length,end.index).trim();
    const tokens=json.match(/"(?:[^"\\]|\\[\s\S])*"|[{}\[\],:]|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\S/g)||[];
    if(tokens[0]!=='{'||tokens.at(-1)!=='}')return null;
    let depth=0;const found=new Map();
    for(let index=0;index<tokens.length;index++){
      const token=tokens[index];
      if(token==='{'||token==='['){depth++;continue;}
      if(token==='}'||token===']'){depth--;if(depth<0||depth===0&&index!==tokens.length-1)return null;continue;}
      if(token[0]!=='"'||tokens[index+1]!==':')continue;
      let key;try{key=JSON.parse(token);}catch{return null;}
      if(!['taskId','baseVersion','packId'].includes(key))continue;
      if(depth!==1||found.has(key))return null;
      let value;try{value=JSON.parse(tokens[index+2]);}catch{return null;}
      if(value!==expected[key])return null;found.set(key,value);
    }
    if(depth!==0||found.size!==3)return null;
    return{text:full.slice(start.index,end.index+end[0].length).trim(),kind:start[2]};
  }
  
  function replyDiagnostic(result,expected){
    const value=result?.diagnostic;
    if(result?.status!=='invalid_reply'||result.reason!=='invalid_json'||!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==4||!['text','phase','pairing','messageKey'].every(key=>Object.hasOwn(value,key)))return null;
    if(value.phase!=='stable'||value.pairing!=='user_pack'||typeof value.messageKey!=='string'||!value.messageKey.trim()||value.messageKey.length>500)return null;
    const block=rejectedReplyBlock(value.text,expected);if(!block||block.text!==value.text)return null;
    return{text:block.text,phase:'stable',pairing:'user_pack',messageKey:value.messageKey};
  }
  async function execute(request){
    let ownsOperation=false;
    try{
      if(request.action==='show_test_report'){
        if(!['isolated_library_real_editor_check','isolated_memory_functional_check','isolated_restart_persistence_check'].includes(request.report?.kind))return fail('invalid_input','无效的自检报告');
        document.querySelector('[data-text-memory-self-test]')?.remove();
        const panel=document.createElement('aside');panel.setAttribute('data-text-memory-self-test',request.report.id);panel.setAttribute('role','status');panel.setAttribute('aria-label','Text Memory 网页自检结果');panel.setAttribute('translate','no');
        panel.style.cssText='position:fixed;right:18px;bottom:18px;width:min(430px,90vw);max-height:70vh;overflow:auto;z-index:2147483647;padding:18px;background:#fff;color:#123044;border:2px solid #087c91;border-radius:12px;box-shadow:0 8px 30px #0003;font:14px/1.5 system-ui';
        const labels={isolated_memory_functional_check:'功能验收',isolated_restart_persistence_check:'重启验收',isolated_library_real_editor_check:'网页自检'};
        const status=request.report.status==='pass'?'通过':request.report.status==='prepared'?'检查点已准备':request.report.status==='restart_not_observed'?'尚未观察到浏览器重启':'未通过，请查看原因';
        const title=document.createElement('strong');title.textContent='Text Memory '+labels[request.report.kind]+'：'+status;
        const body=document.createElement('pre');body.style.cssText='white-space:pre-wrap;word-break:break-word;font:12px/1.5 monospace';body.textContent=JSON.stringify(request.report,null,2);
        const close=document.createElement('button');close.textContent='关闭自检结果';close.onclick=()=>panel.remove();panel.append(title,body,close);document.body.append(panel);return{status:'shown'};
      }
      if(request.action==='snapshot')return await snapshot();
      if(request.action==='verify_sent_transition'){
        const control=globalThis.__textMemorySendControl;
        if(typeof control?.verifyEcho!=='function')return{status:'not_observed'};
        const result=await control.verifyEcho({packId:request.packId});
        return result?.status==='send_echo'&&result.packId===request.packId?{status:'send_echo',packId:request.packId}:{status:'not_observed'};
      }
      if(request.action==='read_selection')return readSelection(request);
      if(request.action==='read_latest_reply')return await readLatestReply(request);
      if(!['insert','undo','send'].includes(request.action))return fail('unsupported','不支持的页面操作');
      if(operationInFlight)return fail('busy','输入框操作尚未完成，请稍候');
      operationInFlight=true;ownsOperation=true;
      if(!visible())return hiddenPage();
      if(composing)return fail('composition_active','输入法正在组合输入，请完成输入后重新预览');
      const element=target(),text=read(element),identityNow=identity();
      if(await recoverFailure(element,text))return fail('unresolved_write','上次写入失败后的草稿尚未处理，已阻止再次写入。');
      if(request.identity?.url!==identityNow.url||request.identity?.pageKey!==pageKey||request.identity?.adapterVersion!==VERSION)return fail('stale_target','页面或会话已经变化');
      if(request.action==='send'){
        if(typeof request.text!=='string'||request.text.length>100000||text!==request.text||await hash(text)!==request.draftHash)return fail('not_sent','草稿与本次问题不同，尚未发送，请核对原网页');
        if(mobileTextarea(element)){
          const editor=globalThis.__textMemoryMobileTextarea;
          if(typeof editor?.check!=='function')return fail('unsupported','输入框编辑组件未加载，请重新连接当前网页');
          const checked=await editor.check(element,request.text,{ready:()=>mobileReady(element,identityNow.url),readText:()=>read(element)});
          if(!checked.stable){failedWrite={before:last?.before??text,strict:true};return fail('not_sent','发送前草稿未保持稳定，已停止；请核对原网页');}
        }
        if(spec()?.id==='qianwen'){
          const checked=await readback(element,request.text,identityNow.url);
          if(!checked.stable){failedWrite={before:last?.before??text,strict:true};return fail('not_sent','千问草稿在发送前未保持稳定，已停止；请核对原网页');}
        }
        const control=globalThis.__textMemorySendControl;if(typeof control?.send!=='function')return fail('unsupported','当前网页未加载发送适配器，请重新连接');
        const result=await control.send({element,expectedText:request.text,read,attemptId:request.attemptId,canProceed:()=>visible()&&!composing&&sameTarget(element)&&identity().url===identityNow.url&&identity().pageKey===pageKey&&read(element)===request.text});
        if(!['send_invoked','send_uncertain','not_sent','unsupported','busy'].includes(result?.status))return fail('send_uncertain','发送结果无法识别，请核对原网页，未自动重试');
        return{status:result.status,attemptId:request.attemptId,serverReceipt:'unknown',
          ...(typeof result.message==='string'?{message:result.message.slice(0,1000)}:{}),
          ...(typeof result.reason==='string'?{reason:result.reason.slice(0,100)}:{}),
          ...(typeof result.draftCleared==='boolean'?{draftCleared:result.draftCleared}:{}),
          ...(result.pageChanged===true?{pageChanged:true}:{}),...(result.duplicate===true?{duplicate:true}:{})};
      }
      if(request.action==='undo'){
        if(!last||last.operationId!==request.operationId)return fail('unsupported','没有此页面可撤销的写入；刷新后不自动重放');
        if(await hash(text)!==last.afterHash)return fail('stale_target','写入后草稿已被编辑，自动撤销会覆盖新内容，已停止');
        if(!visible())return hiddenPage();
        if(read(element)!==text||identity().url!==identityNow.url||composing)return fail('stale_target','草稿或会话在核对时改变');
        const written=await write(element,last.before),checked=await readback(element,last.before,identityNow.url,written);
        if(!checked.stable||checked.text!==last.before){failedWrite={before:last.before,strict:mobileTextarea(element)||spec()?.id==='qianwen'};return fail('transient_failure','撤销后读回不一致或未稳定，已停止后续写入，请核对草稿');}last=null;return{status:'undone',...identityNow};
      }
      if(typeof request.text!=='string'||request.text.length>100000||typeof request.packId!=='string')return fail('invalid_input','资料包形状无效');
      const marker=`TEXT-MEMORY-PACK ${request.packId}`;
      if(text.includes(marker))return last?.packId===request.packId&&text===last.after?{status:'already_present',operationId:last.operationId,...identityNow}:fail('stale_target','草稿已含同一包标识，但内容不能确认，请人工核对');
      if(await hash(text)!==request.draftHash)return fail('stale_target','草稿在预览后已改变，请重新读取');
      if(!visible())return hiddenPage();
      if(read(element)!==text||identity().url!==identityNow.url||composing)return fail('stale_target','草稿或会话在核对时改变');
      const next=text+(text?'\n\n':'')+request.text;
      if(element.maxLength>0&&next.length>element.maxLength)return fail('unsupported','超过网站输入框长度限制');
      const written=await write(element,next);
      const checked=await readback(element,next,identityNow.url,written),actual=checked.text;
      if(!checked.stable||actual!==next){
        if(mobileTextarea(element)&&written?.commandAttempted)failedWrite={before:text,strict:true};
        return mismatch(text,next,actual,checked.stable,mobileTextarea(element)||spec()?.id==='qianwen');
      }
      const afterHash=await hash(actual);
      if(!visible()||composing||!sameTarget(element)||identity().url!==identityNow.url||read(element)!==actual){
        if(mobileTextarea(element)&&written?.commandAttempted)failedWrite={before:text,strict:true};
        return mismatch(text,next,read(element),false,mobileTextarea(element)||spec()?.id==='qianwen');
      }
      last={before:text,after:actual,afterHash,packId:request.packId,operationId:request.operationId};
      return{status:'written',operationId:request.operationId,draftHash:last.afterHash,characters:actual.length,...identityNow};
    }catch(error){return error?.status?error:fail('transient_failure',error?.message||'页面操作失败');}
    finally{if(ownsOperation)operationInFlight=false;}
  }
  globalThis.__textMemoryAdapterV2={execute,version:VERSION,dispose(){document.removeEventListener('compositionstart',compositionStart,true);document.removeEventListener('compositionend',compositionEnd,true);}};
})();
