(() => {
  const VERSION='0.9.5',MAX_TEXT=100000,MAX_ATTEMPTS=512,SEND_OBSERVATION_MS=1000,SEND_POLL_MS=100;
  if(globalThis.__textMemorySendControl?.version===VERSION)return;
  // Read-only observation on 2026-09-07, not a real send or end-to-end test.
  // This exact DeepSeek shape/icon must also be inside this editor's observed
  // third ancestor. A generic arrow, circular button, or submit is insufficient.
  const deepSeekSendSelector='[role="button"].ds-button.ds-button--primary.ds-button--filled.ds-button--circle';
  const deepSeekSendPath='M8.3125 0.981587C8.66767 1.0545 8.97902 1.20558 9.2627 1.43374C9.48724 1.61438 9.73029 1.85933 9.97949 2.10854L14.707 6.83608L13.293 8.25014L9 3.95717V15.0431H7V3.95717L2.70703 8.25014L1.29297 6.83608L6.02051 2.10854C6.26971 1.85933 6.51277 1.61438 6.7373 1.43374C6.97662 1.24126 7.28445 1.04542 7.6875 0.981587C7.8973 0.94841 8.1031 0.956564 8.3125 0.981587Z';
  // Explicit public-DOM candidates, not production-site compatibility claims.
  // Never guess a submit control from its visual icon or press Enter.
  const specs={
    'chatgpt.com':{id:'chatgpt',editors:['#prompt-textarea[contenteditable="true"]','textarea#prompt-textarea','textarea#mobile-composer-prompt[data-mobile-composer-prompt]'],buttons:['button[data-testid="send-button"]','button[aria-label="Send prompt"]','button[aria-label="Send message"]','button[aria-label="发送提示"]','button[aria-label="发送消息"]']},
    'chat.deepseek.com':{id:'deepseek',editors:['textarea#chat-input','textarea[placeholder*="DeepSeek"]','textarea[placeholder*="发送消息"]'],buttons:['button[data-testid="send-button"]','button[aria-label="Send message"]','button[aria-label="发送消息"]','[role="button"][aria-label="Send message"]','[role="button"][aria-label="发送消息"]',deepSeekSendSelector]},
    'www.kimi.com':{id:'kimi',editors:['div.chat-input-editor[contenteditable="true"][role="textbox"]'],buttons:['button[data-testid="send-button"]','button[aria-label="Send message"]','button[aria-label="发送消息"]','button.send-button','[role="button"].send-button']},
    'grok.com':{id:'grok',editors:['div.tiptap.ProseMirror[contenteditable="true"][role="textbox"][aria-label="Ask Grok anything"]','textarea[aria-label="Ask Grok anything"]'],buttons:['button[data-testid="send-button"]','button[aria-label="Send message"]','button[aria-label="Submit"]','button[aria-label="发送消息"]']},
    'claude.ai':{id:'claude',editors:['div.tiptap.ProseMirror[contenteditable="true"][role="textbox"]'],buttons:['button[data-testid="send-button"]','button[aria-label="Send message"]','button[aria-label="发送消息"]']},
    // Exact public composer/submit shapes observed on 2026-09-08. User echo
    // adapters remain separate; a cleared draft is only local DOM evidence.
    'www.qianwen.com':{id:'qianwen',editors:['div[role="textbox"][data-slate-editor="true"][data-slate-node="value"][contenteditable="true"]'],buttons:['button[type="button"][aria-label="发送消息"][data-session-switch-target="send-query"]']},
    'gemini.google.com':{id:'gemini',editors:['rich-textarea.text-input-field_textarea.ql-container > div.ql-editor[contenteditable="true"][role="textbox"]'],buttons:['gem-icon-button.send-button.submit > button[aria-label="发送"]']},
  };
  const stopSelectors=['button[data-testid="stop-button"]','button[aria-label="Stop generating"]','button[aria-label="Stop response"]','button[aria-label="停止生成"]','[role="button"][aria-label="Stop generating"]','[role="button"][aria-label="停止生成"]'];
  const roleAttributes=['data-message-author-role','data-message-role','data-author-role'];
  const userSelectors=[...roleAttributes.map(name=>`[${name}="user"]`),'[data-role="user"]','[data-testid="user-message"]','[data-testid="transcript-row"][data-perf-row="human"]'];
  const qianwenUserSelector='.chat-question-card-wrap[data-chat-question-wrap]';
  const qianwenUserBodySelector='.message-card-wrap.question[data-mt="text/plain"] > .question-text-card';
  const ignoredTags=new Set(['INPUT','TEXTAREA','SELECT','BUTTON','SCRIPT','STYLE','NOSCRIPT','TEMPLATE']);
  const blockTags=new Set(['DIV','P','PRE','BLOCKQUOTE','LI','UL','OL','SECTION','ARTICLE','H1','H2','H3','H4','TABLE','TR']);
  const attempts=new Map(),packs=new Map(),rejections=new WeakSet();
  const result=(status,attemptId,reason,message,extra={})=>({status,attemptId,reason,message,...extra});
  const reject=(status,reason,message)=>{const error={status,reason,message};rejections.add(error);throw error;};
  function visible(node){
    if(!node?.isConnected||!node.getClientRects?.().length||node.ownerDocument!==document)return false;
    for(let current=node;current;current=current.parentElement){
      const style=globalThis.getComputedStyle?.(current);
      if(current.hidden||current.getAttribute?.('aria-hidden')==='true'||current.hasAttribute?.('inert')||style?.display==='none'||['hidden','collapse'].includes(style?.visibility))return false;
    }
    return true;
  }
  const selected=selectors=>[...new Set(selectors.flatMap(selector=>[...document.querySelectorAll(selector)]))].filter(visible);
  const hasBusyAttribute=node=>['aria-busy','data-is-streaming','data-streaming','data-perf-row-streaming'].some(name=>node.getAttribute?.(name)==='true');
  function observedDeepSeekSend(element,button){
    const composer=element.parentElement?.parentElement?.parentElement;
    if(!composer?.contains(button))return false;
    const paths=[...button.querySelectorAll('svg path')].filter(visible);
    return paths.length===1&&paths[0].getAttribute('d')===deepSeekSendPath;
  }
  function locate(element,site,url,doc){
    if(document!==doc||location.href!==url||document.visibilityState!=='visible')reject('not_sent','page_changed','网页已切换或不可见，未点击发送');
    if(site.id==='qianwen'&&selected(['iframe[id="baxia-dialog-content"]']).length)reject('busy','site_verification','千问正在要求网页人机验证，请先在原网页完成验证；未点击发送');
    if(!visible(element)||element.disabled||element.readOnly)reject('not_sent','editor_changed','输入框已变化或不可编辑，未点击发送');
    const editors=selected(site.editors);if(editors.length!==1||editors[0]!==element)reject('not_sent','editor_changed','当前输入框不唯一或已被替换，未点击发送');
    const buttons=selected(site.buttons).filter(button=>site.id!=='deepseek'||!button.matches(deepSeekSendSelector)||observedDeepSeekSend(element,button));
    if(!buttons.length)reject('unsupported','send_button_missing','未找到明确的发送按钮，请在原网页自行发送');
    if(buttons.length!==1)reject('unsupported','send_button_ambiguous','检测到多个发送按钮，未自动选择，请在原网页自行发送');
    const button=buttons[0];
    if(site.id==='gemini'){
      const composer=element.closest?.('.text-input-field');
      if(!composer||!composer.contains(button))reject('unsupported','unrelated_composer','发送按钮不属于当前 Gemini 输入区域，未点击发送');
    }
    if(button.disabled||button.getAttribute('aria-disabled')==='true'||button.closest?.('fieldset[disabled]')||site.id==='deepseek'&&button.classList?.contains('ds-button--disabled'))reject('busy','send_disabled','发送按钮尚不可用，未点击发送');
    if(typeof button.click!=='function')reject('unsupported','send_button_invalid','网页发送控件不支持已验证的点击操作，请自行发送');
    for(let node=element;node;node=node.parentElement)if(hasBusyAttribute(node))reject('busy','streaming','网页仍在生成内容，未点击发送');
    const qianwenStop=site.id==='qianwen'&&selected(['button[aria-label="停止回答"]']).some(node=>!node.disabled&&node.getAttribute('aria-disabled')!=='true');
    if(hasBusyAttribute(button)||selected(stopSelectors).length||qianwenStop)reject('busy','streaming','网页仍在生成内容，未点击发送');
    const editorForm=element.form||element.closest?.('form'),buttonForm=button.form||button.closest?.('form');
    if((editorForm||buttonForm)&&editorForm!==buttonForm)reject('unsupported','unrelated_form','发送按钮与当前输入框不属于同一表单，未点击发送');
    const dialogs=selected(['dialog[open]','[aria-modal="true"]']);
    if(dialogs.some(dialog=>!dialog.contains(element)||!dialog.contains(button)))reject('busy','modal','网页弹窗遮挡了输入框或发送按钮，未点击发送');
    return button;
  }
  function packIdentity(text){
    if(typeof text!=='string'||!text||text.length>MAX_TEXT)return null;
    const lines=text.replace(/\r\n/g,'\n').trim().split('\n'),first=/^TEXT-MEMORY-PACK ([A-Za-z0-9_-]{1,199})$/.exec(lines[0]);
    if(!first||lines.length<3||lines.at(-1)!=='END-TEXT-MEMORY-PACK '+first[1]||!lines.slice(1,-1).join('\n').trim())return null;
    const markers=lines.filter(line=>/^[ \t]*(?:END-)?TEXT-MEMORY-PACK(?:[ \t]+[^\n]*)?[ \t]*$/.test(line));
    return markers.length===2?first[1]:null;
  }
  function duplicate(previous,attemptId){
    return{...previous.result,attemptId,originalAttemptId:previous.attemptId,duplicate:true,reason:'already_attempted',message:'此资料包已经触发过一次发送操作，未重复点击；请查看原网页确认实际结果'};
  }
  function observedDeepSeekUser(node){
    if(location.hostname!=='chat.deepseek.com'||!node.classList?.contains('ds-collapsible-text')||node.classList.contains('ds-collapsible-text-toggle-button'))return false;
    const body=node.parentElement,message=body?.parentElement,row=message?.parentElement,list=row?.parentElement;
    // Exact user-content chain observed read-only on 2026-09-07. The sibling
    // toggle and unrelated collapsible/assistant-thinking text are not read.
    return body?.tagName==='DIV'&&body.classList.contains('fbb737a4')&&message?.classList.contains('ds-message')&&message.classList.contains('d29f3d7d')&&row?.hasAttribute('data-virtual-list-item-key')&&list?.classList.contains('ds-virtual-list-visible-items');
  }
  function role(node){
    const values=roleAttributes.map(name=>node.getAttribute?.(name)).filter(Boolean),generic=node.getAttribute?.('data-role');if(generic)values.push(generic);
    const testId=node.getAttribute?.('data-testid');if(testId==='user-message')values.push('user');if(['assistant-message','assistant-response'].includes(testId))values.push('assistant');
    if(location.hostname==='claude.ai'&&testId==='transcript-row'&&node.getAttribute('data-perf-row')==='human')values.push('user');
    if(location.hostname==='claude.ai'&&node.classList?.contains('font-claude-response'))values.push('assistant');
    if(observedDeepSeekUser(node))values.push('user');
    if(location.hostname==='www.qianwen.com'){
      if(node.matches?.(qianwenUserSelector))values.push('user');
      if(node.matches?.('.chat-answers-card-wrap[data-chat-answers-wrap]'))values.push('assistant');
    }
    const distinct=[...new Set(values.map(value=>value.toLowerCase()))];return distinct.length>1?'conflicting':distinct[0]||null;
  }
  function ignoredEcho(node,allowedButton=null){
    if(node.nodeType!==1)return false;
    const editable=node.getAttribute('contenteditable');
    return!echoVisible(node)||ignoredTags.has(node.tagName)&&node!==allowedButton||node.isContentEditable||editable!==null&&editable.toLowerCase()!=='false'||
      ['assistant','tool','system','developer','conflicting'].includes(role(node))||hasBusyAttribute(node)||
      location.hostname==='chat.deepseek.com'&&node.classList?.contains('ds-collapsible-text-toggle-button')||
      ['data-text-memory-injected','data-text-memory-self-test','data-text-memory-floating'].some(name=>node.hasAttribute(name));
  }
  function echoVisible(node){
    if(visible(node))return true;
    // An observed ChatGPT message ancestor uses display:contents: it has no
    // box, while its user-message children remain rendered. This exception is
    // limited to echo traversal; editor/button selection still requires boxes.
    if(!node?.isConnected||node.ownerDocument!==document||globalThis.getComputedStyle?.(node)?.display!=='contents')return false;
    for(let current=node;current;current=current.parentElement){
      const style=globalThis.getComputedStyle?.(current);
      if(current.hidden||current.getAttribute?.('aria-hidden')==='true'||current.hasAttribute?.('inert')||style?.display==='none'||['hidden','collapse'].includes(style?.visibility))return false;
    }
    return true;
  }
  function observedChatGptUserBody(root){
    if(location.hostname!=='chatgpt.com'||root.tagName!=='LI'||root.getAttribute('data-message-role')!=='user')return null;
    const children=[...root.children],containers=children.filter(node=>node.tagName==='DIV'&&node.hasAttribute('data-submit-message-animation-target'));
    if(containers.length!==1)return null;
    const container=containers[0],heading=children[children.indexOf(container)-1];
    if(heading?.tagName!=='H4'||!heading.hasAttribute('data-message-attribution'))return null;
    const bubbles=[...container.children].filter(node=>node.tagName==='BUTTON'&&node.hasAttribute('data-user-message-bubble')&&node.getAttribute('type')==='button');
    if(bubbles.length!==1)return null;
    const bubble=bubbles[0],bodies=[...bubble.children].filter(node=>node.tagName==='P'&&node.hasAttribute('data-user-message-copy'));
    if(bodies.length!==1||bubble.children.length!==1)return null;
    const body=bodies[0];
    // Only this observed user-message button is readable. All normal button,
    // editable, hidden, assistant and extension-generated exclusions remain.
    for(let node=body;node;node=node.parentElement){if(ignoredEcho(node,bubble))return null;if(node===root)break;}
    return body;
  }
  function observedQianwenUserBody(root){
    if(!root.matches(qianwenUserSelector))return null;
    const bodies=[...root.querySelectorAll(qianwenUserBodySelector)].filter(visible);
    if(bodies.length!==1)return null;
    for(let node=bodies[0];node;node=node.parentElement){if(ignoredEcho(node))return null;if(node===root)break;}
    return bodies[0];
  }
  function echoText(root){
    let count=0,visits=0;const parts=[];
    const append=value=>{count+=value.length;if(count>MAX_TEXT)throw Error('echo_limit');parts.push(value);};
    function walk(node,depth){
      if(++visits>50000||depth>128)throw Error('echo_limit');
      if(node.nodeType===3){append(node.textContent||'');return;}
      if(node.nodeType!==1||ignoredEcho(node))return;
      if(node.tagName==='BR'){append('\n');return;}
      const block=blockTags.has(node.tagName);if(block&&parts.length&&parts.at(-1)!=='\n')append('\n');
      for(const child of node.childNodes)walk(child,depth+1);
      if(block&&parts.length&&parts.at(-1)!=='\n')append('\n');
    }
    walk(root,0);return parts.join('').replace(/\r\n?/g,'\n');
  }
  function echoEvidence(packId){
      // New editor support must not promote generic role-shaped page content
      // into a user echo before the site's message DOM has been observed.
      if(location.hostname==='gemini.google.com')return null;
      // Generic role attributes are unverified selector candidates. Claude's
      // human transcript row was observed on 2026-09-06. Neither is proof of
      // server receipt: this reports only a visible, user-authored DOM echo.
      const dialogs=selected(['dialog[open]','[aria-modal="true"]']);
      const qianwen=location.hostname==='www.qianwen.com';
      const candidates=selected(qianwen?[qianwenUserSelector]:location.hostname==='chat.deepseek.com'?[...userSelectors,'.ds-collapsible-text']:userSelectors).filter(node=>{
        if(role(node)!=='user')return false;
        for(let current=node;current;current=current.parentElement)if(ignoredEcho(current))return false;
        return !dialogs.some(dialog=>!dialog.contains(node));
      });
      const matches=[];
      for(const node of candidates.filter(node=>!candidates.some(parent=>parent!==node&&parent.contains(node)))){
        const body=qianwen?observedQianwenUserBody(node):observedChatGptUserBody(node)||node;if(!body)continue;
        const lines=echoText(body).trim().split('\n'),markers=[];
        const markerPattern=qianwen?/^[ \t\u00a0]*(END-)?TEXT-MEMORY-PACK[ \u00a0]([A-Za-z0-9_-]{1,199})[ \t\u00a0]*$/:/^[ \t]*(END-)?TEXT-MEMORY-PACK ([A-Za-z0-9_-]{1,199})[ \t]*$/;
        for(let index=0;index<lines.length;index++){const match=markerPattern.exec(lines[index]);if(match)markers.push({end:!!match[1],packId:match[2],index});}
        if(!markers.some(marker=>marker.packId===packId))continue;
        if(markers.length!==2||markers[0].end||!markers[1].end||markers.some(marker=>marker.packId!==packId)||!lines.slice(markers[0].index+1,markers[1].index).join('\n').trim())return null;
        matches.push({node,text:lines.slice(markers[0].index,markers[1].index+1).join('\n').trim()});
      }
      return matches.length===1?matches[0]:null;
  }
  async function fingerprint(text){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));return Array.from(new Uint8Array(bytes),value=>value.toString(16).padStart(2,'0')).join('');}
  async function verifyEcho({packId}={}){
    const absent={status:'not_observed'},record=packs.get(packId),url=location.href,doc=document;
    if(typeof packId!=='string'||!record||!specs[location.hostname]||document.visibilityState!=='visible')return absent;
    try{
      const evidence=echoEvidence(packId);if(!evidence)return absent;
      const digest=await fingerprint(evidence.text);
      if(digest!==record.echoDigest&&(location.hostname!=='www.qianwen.com'||digest!==record.renderedEchoDigest))return absent;
      if(document!==doc||location.href!==url||document.visibilityState!=='visible'||packs.get(packId)!==record)return absent;
      const latest=echoEvidence(packId);
      return latest?.node===evidence.node&&latest.text===evidence.text?{status:'send_echo',packId}:absent;
    }catch{return absent;}
  }
  async function boundedEcho(packId,remaining){
    if(remaining<=0)return{status:'not_observed'};
    // Avoid installing a deadline timer for an empty observation. Only an
    // actual candidate can require asynchronous fingerprint work.
    try{if(!echoEvidence(packId))return{status:'not_observed'};}catch{return{status:'not_observed'};}
    let timer;try{return await Promise.race([verifyEcho({packId}),new Promise(resolve=>{timer=setTimeout(()=>resolve({status:'not_observed'}),remaining);})]);}
    finally{clearTimeout(timer);}
  }
  async function send(request){
    const attemptId=typeof request?.attemptId==='string'&&/^[A-Za-z0-9_-]{1,200}$/.test(request.attemptId)?request.attemptId:null;
    if(!attemptId)return result('not_sent',null,'invalid_attempt','发送请求缺少有效的一次性操作编号');
    const {element,expectedText,read,canProceed}=request,packId=packIdentity(expectedText),site=specs[location.hostname],url=location.href,doc=document;
    if(!site)return result('unsupported',attemptId,'site','本站没有明确的发送按钮候选，请在原网页自行发送');
    if(!packId)return result('not_sent',attemptId,'whole_pack_required','仅能发送完整且唯一的资料包；草稿包含其他文字或包装不完整时，请自行核对发送');
    if(typeof read!=='function'||typeof canProceed!=='function')return result('not_sent',attemptId,'missing_guard','发送前的编辑器校验不可用，未点击发送');
    let digest,echoDigest,renderedEchoDigest;
    try{
      digest=await fingerprint(expectedText);const normalized=expectedText.replace(/\r\n?/g,'\n').trim();echoDigest=normalized===expectedText?digest:await fingerprint(normalized);
      // Observed Qianwen user bubbles replace each ASCII space with NBSP,
      // including indentation. Hash this one expected display projection; do
      // not rewrite the draft, the DOM body, or compare arbitrary normalized
      // messages. Original content/deduplication fingerprints remain unchanged.
      if(site?.id==='qianwen')renderedEchoDigest=await fingerprint(normalized.replace(/ /g,'\u00a0'));
    }
    catch{return result('not_sent',attemptId,'fingerprint_failed','无法核对发送草稿，未点击发送');}
    const priorAttempt=attempts.get(attemptId),priorPack=packs.get(packId);
    if(priorAttempt&&(priorAttempt.packId!==packId||priorAttempt.digest!==digest)||priorPack&&priorPack.digest!==digest)return result('not_sent',attemptId,'attempt_conflict','发送操作或资料包编号被重复用于不同内容，已停止');
    if(priorAttempt||priorPack)return duplicate(priorAttempt||priorPack,attemptId);
    if(attempts.size>=MAX_ATTEMPTS)return result('unsupported',attemptId,'attempt_limit','本页面发送记录已达上限，请先核对已有发送结果');
    let button;
    try{
      button=locate(element,site,url,doc);
      if(canProceed(element)!==true)reject('not_sent','guard_changed','输入法、页面或草稿状态已变化，未点击发送');
      if(read(element)!==expectedText)reject('not_sent','draft_changed','草稿与已确认资料包不一致，未点击发送');
      if(locate(element,site,url,doc)!==button)reject('not_sent','send_button_changed','发送按钮在核对期间已变化，未点击发送');
    }catch(error){return rejections.has(error)?result(error.status,attemptId,error.reason,error.message):result('not_sent',attemptId,'verification_failed','发送前校验失败，未点击发送');}
    // Reserve both identities BEFORE click. An exception, navigation, or retry
    // cannot prove no message was sent, so this reservation is never rolled back.
    // Only fingerprints and result metadata are retained, never draft text.
    const record={attemptId,packId,digest,echoDigest,...(renderedEchoDigest?{renderedEchoDigest}:{}),result:result('send_uncertain',attemptId,'invocation_pending','发送操作正在执行，请勿重复发送',{clickInvoked:true,serverReceipt:'unknown'})};
    attempts.set(attemptId,record);packs.set(packId,record);
    try{button.click();}catch{record.result=result('send_uncertain',attemptId,'click_threw','网页点击发送时发生异常；可能已触发发送，请查看原网页，勿自动重试',{clickInvoked:true,serverReceipt:'unknown'});return record.result;}
    await Promise.resolve();
    const deadline=Date.now()+SEND_OBSERVATION_MS;let pageChanged=false;
    // Poll only for visible effects of this one click. A no-effect click is
    // uncertain, never not_sent, and the reserved attempt cannot be replayed.
    for(let sample=0;sample<=SEND_OBSERVATION_MS/SEND_POLL_MS;sample++){
      pageChanged=location.href!==url;let sameOrigin=false;try{sameOrigin=new URL(location.href).origin===new URL(url).origin;}catch{}
      if(document!==doc||document.visibilityState!=='visible'||!sameOrigin){
        record.result=result('send_uncertain',attemptId,'page_changed_after_click','已调用发送，但页面随后变化；请查看原网页确认结果，勿自动重试',{clickInvoked:true,serverReceipt:'unknown'});return record.result;
      }
      let after;try{if(visible(element))after=read(element);}catch{record.result=result('send_uncertain',attemptId,'readback_failed','已调用发送，但无法读取后续草稿；请查看原网页确认结果，勿自动重试',{clickInvoked:true,serverReceipt:'unknown'});return record.result;}
      // The old editor may be removed before its SPA route changes. Observe
      // without touching a replacement editor or clicking again. A new empty
      // composer alone is not evidence that this particular message was sent.
      const draftCleared=after==='',userEchoObserved=!draftCleared&&(await boundedEcho(packId,deadline-Date.now())).status==='send_echo';
      let stillSameOrigin=false;try{stillSameOrigin=new URL(location.href).origin===new URL(url).origin;}catch{}
      if(document!==doc||document.visibilityState!=='visible'||!stillSameOrigin){
        record.result=result('send_uncertain',attemptId,'page_changed_after_click','已调用发送，但页面随后变化；请查看原网页确认结果，勿自动重试',{clickInvoked:true,serverReceipt:'unknown'});return record.result;
      }
      pageChanged=location.href!==url;
      if(Date.now()>deadline)break;
      if(draftCleared||userEchoObserved){
        // A normal click may create a conversation via a same-document SPA
        // route. The caller still verifies its allowed transition separately.
        record.result=result('send_invoked',attemptId,'send_effect_observed','已调用发送，并观察到草稿清空或本次用户消息；这不证明服务器已经接收，请查看原网页结果',{clickInvoked:true,serverReceipt:'unknown',draftCleared,...(userEchoObserved?{userEchoObserved:true}:{}),...(pageChanged?{pageChanged:true}:{})});return record.result;
      }
      const remaining=deadline-Date.now();if(remaining<=0||sample===SEND_OBSERVATION_MS/SEND_POLL_MS)break;
      await new Promise(resolve=>setTimeout(resolve,Math.min(SEND_POLL_MS,remaining)));
    }
    record.result=result('send_uncertain',attemptId,'no_send_effect','已调用按钮，但未观察到发出效果；请核对原网页，未重发',{clickInvoked:true,serverReceipt:'unknown',draftCleared:false,...(pageChanged?{pageChanged:true}:{})});return record.result;
  }
  globalThis.__textMemorySendControl={version:VERSION,send,verifyEcho};
})();
