// Public DOM APIs only. No editor instances, page globals, or system clipboard.
(() => {
  function read(node){
    if(node.nodeType===3)return node.textContent;
    if(node.nodeType!==1&&node.nodeType!==11)return '';
    if(node.tagName==='BR')return node.classList.contains('ProseMirror-trailingBreak')||
      (['P','DIV'].includes(node.parentElement?.tagName)&&node.parentElement.childNodes.length===1)?'':'\n';
    let out='',previousBlock=false;
    [...node.childNodes].forEach((child,index)=>{
      const block=child.nodeType===1&&['DIV','P','LI','PRE','BLOCKQUOTE'].includes(child.tagName);
      if(index&&(block||previousBlock))out+='\n';out+=read(child);previousBlock=block;
    });
    return out;
  }
  function covers(root,selection,readText=read,options={}){
    if(!selection||selection.rangeCount!==1)return false;
    const selected=selection.getRangeAt(0);
    if(!root.contains(selected.startContainer)||!root.contains(selected.endContainer))return false;
    const whole=readText(root);
    // A native text-boundary range can clone only a zero-width text node,
    // losing the original editor sentinel wrapper. Only an opt-in caller that
    // validates that exact original DOM range may recognize this empty case.
    if(whole===''&&typeof options.isEmptySentinelRange==='function'&&options.isEmptySentinelRange(root,selected)===true)return true;
    if(whole&&selection.isCollapsed)return false;
    const before=root.ownerDocument.createRange(),after=root.ownerDocument.createRange();
    before.selectNodeContents(root);before.setEnd(selected.startContainer,selected.startOffset);
    after.selectNodeContents(root);after.setStart(selected.endContainer,selected.endOffset);
    return readText(selected.cloneContents())===whole&&readText(before.cloneContents())===''&&readText(after.cloneContents())==='';
  }
  async function selectAll(root,guard,readText=read,options={}){
    const doc=root.ownerDocument,stableMs=options.selectionStableMs??0,timeoutMs=options.timeoutMs??350,pollMs=options.pollIntervalMs??0;
    if(!Number.isFinite(stableMs)||stableMs<0||!Number.isFinite(timeoutMs)||timeoutMs<=stableMs||!Number.isFinite(pollMs)||pollMs<0||pollMs>=timeoutMs||stableMs>0&&typeof doc.defaultView.performance?.now!=='function')return false;
    let listener,timer,frameId,sampleTimer,eventResolve=null,frameResolve=null,active=true,stabilityCheck=null,selectionInvalid=false,stableSince=null;
    // Real selectionchange is queued as a task; merely waiting for a frame does
    // not establish that the editor has observed the DOM Selection.
    const changed=()=>new Promise(resolve=>{eventResolve=resolve;});
    listener=event=>{
      if(!active||event.target!==doc||!event.isTrusted)return;
      if(stabilityCheck){if(!ready()||!stabilityCheck(doc.getSelection()))selectionInvalid=true;else stableSince=doc.defaultView.performance.now();}
      if(eventResolve){const resolve=eventResolve;eventResolve=null;resolve(true);}
    };
    doc.addEventListener('selectionchange',listener);
    // The deadline also covers a suspended animation frame in a background tab.
    // Both Qianwen selection transitions share one bounded deadline. Its Slate
    // editor was observed reconciling a caret 9-92ms after selectionchange.
    const deadline=new Promise(resolve=>{timer=doc.defaultView.setTimeout(()=>{active=false;resolve(false);},timeoutMs);});
    const ready=()=>active&&root.isConnected&&doc.activeElement===root&&guard();
    async function synchronize(range,selection,check,native=false){
      if(!ready())return false;
      const event=changed();
      if(native){if(doc.execCommand('selectAll',false)!==true)return false;}
      else{selection.removeAllRanges();selection.addRange(range);}
      if(!await event||!ready())return false;
      if(stableMs>0){if(!check(doc.getSelection()))return false;stabilityCheck=check;selectionInvalid=false;stableSince=doc.defaultView.performance.now();}
      try{
        do{
          // DOM state need not wait for paint. Qianwen opts into bounded timer
          // sampling because the in-app browser visibly throttled RAF to 1fps.
          // A timer never replaces the required trusted selectionchange event.
          const sampled=await new Promise(resolve=>{frameResolve=resolve;const sample=()=>{frameResolve=null;resolve(true);};if(pollMs>0)sampleTimer=doc.defaultView.setTimeout(sample,pollMs);else frameId=doc.defaultView.requestAnimationFrame(sample);});
          if(!sampled||!ready()||selectionInvalid||!check(doc.getSelection()))return false;
          if(stableMs===0)return true;
          const now=doc.defaultView.performance.now();if(!Number.isFinite(now)||!Number.isFinite(stableSince)||now<stableSince)return false;
          if(now-stableSince>=stableMs)return true;
        }while(active);
        return false;
      }finally{stabilityCheck=null;}
    }
    try{
      root.focus();
      const selection=doc.getSelection();if(!selection||!ready())return false;
      const synchronized=(async()=>{
        // Re-selecting an already selected Slate document can emit no new
        // selectionchange. Only Qianwen opts into a real collapsed transition,
        // followed by a separately witnessed full selection. covers() alone is
        // never accepted as evidence that the framework observed this operation.
        if(options.resetFullSelection===true&&!selection.isCollapsed&&covers(root,selection,readText,options)){
          const collapsed=selection.getRangeAt(0).cloneRange();collapsed.collapse(true);
          const synced=await synchronize(collapsed,selection,current=>{
            if(!current||current.rangeCount!==1||!current.isCollapsed)return false;
            const range=current.getRangeAt(0);return root.contains(range.startContainer)&&root.contains(range.endContainer);
          });
          if(!synced||!ready())return false;
        }
        const range=doc.createRange();range.selectNodeContents(root);
        // The native selection command chooses actual editable text endpoints;
        // Slate can normalize a root-DIV boundary range back into a caret.
        // This is selection only, never an HTML insertion or write fallback.
        return synchronize(range,selection,current=>covers(root,current,readText,options),options.nativeFullSelection===true);
      })();
      return await Promise.race([synchronized,deadline]);
    }finally{
      active=false;
      doc.removeEventListener('selectionchange',listener);doc.defaultView.clearTimeout(timer);
      if(frameId!==undefined)doc.defaultView.cancelAnimationFrame(frameId);
      if(sampleTimer!==undefined)doc.defaultView.clearTimeout(sampleTimer);
      eventResolve?.(false);frameResolve?.(false);
    }
  }
  async function readback(root,expected,guard,readText=()=>read(root),options={}){
    const view=root.ownerDocument.defaultView;
    const stableMs=options.stableMs??0,timeoutMs=options.timeoutMs??350,pollMs=options.pollIntervalMs??0;
    if(!Number.isFinite(stableMs)||stableMs<0||!Number.isFinite(timeoutMs)||timeoutMs<=stableMs||!Number.isFinite(pollMs)||pollMs<0||pollMs>=timeoutMs||stableMs>0&&typeof view.performance?.now!=='function')return{stable:false,text:readText()};
    const started=stableMs>0?view.performance.now():null;
    let timer,frameId,sampleTimer,done=false,matches=0,since=null;
    return new Promise(resolve=>{
      const finish=stable=>{
        if(done)return;done=true;
        view.clearTimeout(timer);if(frameId!==undefined)view.cancelAnimationFrame(frameId);if(sampleTimer!==undefined)view.clearTimeout(sampleTimer);
        resolve({stable,text:readText()});
      };
      timer=view.setTimeout(()=>finish(false),timeoutMs);
      const check=()=>{
        if(done)return;
        if(!root.isConnected||!guard())return finish(false);
        const equal=readText()===expected;
        if(stableMs>0&&!equal)return finish(false);
        matches=equal?matches+1:0;
        if(stableMs>0){const now=view.performance.now();if(!Number.isFinite(now)||!Number.isFinite(started)||now<started||now-started>timeoutMs||since!==null&&now<since)return finish(false);since??=now;if(matches>=2&&now-since>=stableMs)return finish(true);}
        else if(matches===2)return finish(true);
        if(pollMs>0)sampleTimer=view.setTimeout(check,pollMs);else frameId=view.requestAnimationFrame(check);
      };
      if(pollMs>0)sampleTimer=view.setTimeout(check,pollMs);else frameId=view.requestAnimationFrame(check);
    });
  }
  function paste(root,text){
    if(!text)throw Error('空文本必须使用单独的删除路径');
    const view=root.ownerDocument.defaultView,data=new view.DataTransfer();
    data.setData('text/plain',text);
    root.dispatchEvent(new view.ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true,composed:true}));
  }
  function erase(root){
    // An empty paste does not remove Lexical's selected nodes. Ask its public
    // beforeinput handler to delete the synchronized selection instead.
    const view=root.ownerDocument.defaultView;
    root.dispatchEvent(new view.InputEvent('beforeinput',{inputType:'deleteContentBackward',bubbles:true,cancelable:true,composed:true}));
  }
  globalThis.__textMemorySelectionPaste={read,covers,selectAll,readback,paste,erase};
})();
