/* Localhost-only extension-port substitute. The production client and webpage
 * renderer exchange actual snapshots and render receipts across real iframes.
 * Layout/authorization are test-host capabilities, never native Edge evidence. */
import {validPresentationSnapshot} from '../product/soft-body/presentation.js';

export const PANEL_PORT='text-memory-soft-body-v1';
export const PAGE_PORT='text-memory-soft-feedback-v1';
const sites=new Set(['chatgpt','deepseek','claude','grok','kimi','qianwen','gemini']);
const clone=value=>JSON.parse(JSON.stringify(value));
const exact=(value,keys)=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
function event(){const listeners=new Set();return{addListener:fn=>listeners.add(fn),removeListener:fn=>listeners.delete(fn),emit:value=>{for(const fn of [...listeners])fn(value);}};}
export function localPortPair(name,schedule=queueMicrotask){
  let closed=false;const ends=[0,1].map(()=>({name,onMessage:event(),onDisconnect:event()}));
  ends.forEach((port,index)=>{
    port.postMessage=value=>{if(closed)throw Error('Local feedback port is closed');const copied=clone(value);schedule(()=>{if(!closed)ends[1-index].onMessage.emit(clone(copied));});};
    port.disconnect=()=>{if(closed)return;closed=true;ends.forEach(endpoint=>endpoint.onDisconnect.emit());};
  });
  return ends;
}

export function createLocalFeedbackHost(root,{uuid=()=>root.crypto.randomUUID(),now=()=>Date.now(),setTimer=setTimeout,clearTimer=clearTimeout,Observer=root.MutationObserver}={}){
  if(!['localhost','127.0.0.1'].includes(root.location.hostname))throw Error('Feedback test bridge requires localhost');
  const doc=root.document,records=new Set(),samples=[];let disposed=false;
  const frame=id=>doc.getElementById(id);
  const post=(port,message)=>{try{port?.postMessage(message);return true;}catch{return false;}};
  const ownPanel=win=>frame('managerFrame')?.contentWindow===win&&win.location.origin===root.location.origin&&win.location.pathname==='/product/sidepanel.html';
  function capability(win){
    const panel=frame('managerFrame'),page=frame('mockFrame');
    if(!ownPanel(win))return{mode:'internal',reason:'local_not_sidepanel',side:'unknown'};
    if(panel.hidden||page?.hidden||!panel.classList.contains('sidebar-preview'))return{mode:'internal',reason:'local_split_not_visible',side:'unknown'};
    if(!frame('simulateSiteGrant')?.checked)return{mode:'internal',reason:'local_permission_denied',side:'right'};
    return{mode:'external',reason:'',side:'right'};
  }
  const persona=record=>sites.has(record.win.document.documentElement.dataset.site)?record.win.document.documentElement.dataset.site:'chatgpt';
  function active(record,context){
    return !disposed&&records.has(record)&&record.context===context&&ownPanel(record.win)&&context.pageWindow===frame('mockFrame')?.contentWindow&&context.pageUrl===context.pageWindow.location.href&&context.siteId===persona(record)&&capability(record.win).mode==='external';
  }
  function settle(context,reason){for(const wait of context?.pending.values()||[]){clearTimer(wait.timer);wait.resolve({mode:'internal',reason,renderedAt:now()});}context?.pending.clear();for(const hold of context?.heldReceipts||[]){clearTimer(hold.timer);hold.resolve();}context?.heldReceipts.clear();}
  function clearContext(record,reason,notify=true){
    const previous=record.context;record.context=null;record.epoch++;
    if(previous){settle(previous,reason);post(previous.pagePort,{type:'close',contextKey:previous.key,pageSession:previous.pageSession});previous.pagePort?.disconnect();}
    if(notify&&previous)post(record.port,{type:'context_invalidated',contextKey:previous.key,reason});
  }
  function remove(record){if(!records.delete(record))return;clearContext(record,'local_panel_closed',false);record.observer?.disconnect();record.win.removeEventListener?.('pagehide',record.unload);record.port.disconnect();}
  const publicContext=context=>({key:context.key,windowId:1,tabId:1,documentId:context.documentId,pageSession:context.pageSession,siteId:context.siteId});
  async function hello(record){
    clearContext(record,'local_reconnecting',false);const epoch=record.epoch,mode=capability(record.win);
    if(mode.mode!=='external'){post(record.port,{type:'context',context:null,capability:mode});return;}
    const page=frame('mockFrame').contentWindow;
    if(page.location.origin!==root.location.origin||page.location.pathname!=='/web/mock-site.html'||!page.__textMemorySoftFeedback||!page.__textMemorySoftFace){post(record.port,{type:'context',context:null,capability:{mode:'internal',side:'right',reason:'local_renderer_not_ready'}});return;}
    const context={key:'local-feedback-'+uuid(),pageSession:'local-page-'+uuid(),documentId:'local-document-'+uuid(),siteId:persona(record),pageWindow:page,pageUrl:page.location.href,pagePort:null,lastRevision:0,pending:new Map(),heldReceipts:new Set(),lastAck:null};record.context=context;
    // Only this local frame receives the substitute. Production extension files
    // are not changed and no top-level/remote browser runtime is emulated.
    page.chrome.runtime.connect=options=>connectPage(page,options);
    let mounted;
    try{mounted=page.__textMemorySoftFeedback.mount({contextKey:context.key,pageSession:context.pageSession,url:context.pageUrl});}catch{mounted=null;}
    await Promise.resolve();
    if(record.epoch!==epoch||record.context!==context)return;
    if(mounted?.status!=='mounted'||!context.pagePort){clearContext(record,'local_mount_failed',false);post(record.port,{type:'context',context:null,capability:{mode:'internal',side:'right',reason:'local_mount_failed'}});return;}
    post(record.port,{type:'context',context:publicContext(context),capability:{mode:'external',side:'right',reason:'',environment:'local_split_iframes'}});
  }
  async function publish(record,snapshot){
    const context=record.context;
    if(!context||!validPresentationSnapshot(snapshot)||snapshot.contextKey!==context.key||snapshot.personaId!==context.siteId||snapshot.revision<=context.lastRevision){post(record.port,{type:'rejected',contextKey:context?.key??null,reason:'invalid_or_stale_presentation'});return;}
    context.lastRevision=snapshot.revision;
    if(!active(record,context)){clearContext(record,'local_target_changed');return;}
    const result=await new Promise(resolve=>{
      const timer=setTimer(()=>{context.pending.delete(snapshot.revision);resolve({mode:'internal',reason:'render_ack_timeout',renderedAt:now()});},750);timer?.unref?.();
      context.pending.set(snapshot.revision,{resolve,timer});
      if(!post(context.pagePort,{type:'presentation',snapshot})){clearTimer(timer);context.pending.delete(snapshot.revision);resolve({mode:'internal',reason:'overlay_disconnected',renderedAt:now()});}
    });
    // Delay only an actual render receipt, after the normal render timeout.
    // Disconnect still invalidates the context immediately and cancels holds.
    if(result.mode==='external'&&frame('delayFeedbackReceipt')?.checked)await new Promise(resolve=>{
      const hold={resolve,timer:null};hold.timer=setTimer(()=>{context.heldReceipts.delete(hold);resolve();},2000);context.heldReceipts.add(hold);
    });
    if(!active(record,context)||context.lastRevision!==snapshot.revision)return;
    context.lastAck={revision:snapshot.revision,...result};
    post(record.port,{type:'presented',contextKey:context.key,revision:snapshot.revision,...result});
    samples.push({at:now(),contextKey:context.key,revision:snapshot.revision,recipeId:snapshot.recipeId,phase:snapshot.phase,statusCode:snapshot.statusCode,...result});if(samples.length>100)samples.shift();
  }
  function connectPage(win,options){
    if(options?.name!==PAGE_PORT||win!==frame('mockFrame')?.contentWindow)throw Error('Unrecognized local page port');
    const [client,server]=localPortPair(PAGE_PORT);let record=null,context=null;
    server.onMessage.addListener(message=>{
      if(!context){
        if(!exact(message,['type','contextKey','pageSession'])||message.type!=='ready'){server.disconnect();return;}
        record=[...records].find(item=>item.context?.key===message.contextKey);context=record?.context;
        if(!context||context.pageSession!==message.pageSession||context.pageWindow!==win||context.pagePort||!active(record,context)){context=null;server.disconnect();return;}
        context.pagePort=server;return;
      }
      if(!active(record,context)){server.disconnect();return;}
      if(message.contextKey!==context.key||message.pageSession!==context.pageSession){server.disconnect();return;}
      if(exact(message,['type','contextKey','pageSession'])&&message.type==='page_changed'){clearContext(record,'local_page_changed');return;}
      if(exact(message,['type','contextKey','pageSession','revision'])&&message.type==='dismiss'&&message.revision===context.lastRevision){post(record.port,{type:'dismiss_requested',contextKey:context.key,revision:message.revision});return;}
      if(exact(message,['type','contextKey','pageSession','revision','renderedAt','mode','reason'])&&message.type==='rendered'&&Number.isFinite(message.renderedAt)&&['external','internal'].includes(message.mode)&&['','narrow_viewport','renderer_unavailable'].includes(message.reason)){
        const waiting=context.pending.get(message.revision);if(!waiting)return;context.pending.delete(message.revision);clearTimer(waiting.timer);waiting.resolve({mode:message.mode,reason:message.reason,renderedAt:message.renderedAt});return;
      }
      if(exact(message,['type','contextKey','pageSession','revision','mode','reason'])&&message.type==='availability'&&message.revision===context.lastRevision&&((message.mode==='external'&&message.reason==='')||(message.mode==='internal'&&message.reason==='narrow_viewport'))){
        context.lastAck={revision:message.revision,mode:message.mode,reason:message.reason,renderedAt:now()};post(record.port,{type:'presented',contextKey:context.key,...context.lastAck});return;
      }
      server.disconnect();
    });
    server.onDisconnect.addListener(()=>{if(context?.pagePort===server){context.pagePort=null;if(record?.context===context)clearContext(record,'overlay_disconnected');}});
    return client;
  }
  function connect(win,options){
    if(disposed||options?.name!==PANEL_PORT||!ownPanel(win))throw Error('Local feedback is available only to the actual sidepanel iframe');
    for(const previous of [...records])if(previous.win===win)remove(previous);
    const [client,port]=localPortPair(PANEL_PORT),record={win,port,context:null,epoch:0,observer:null,unload:null};records.add(record);
    port.onMessage.addListener(message=>{
      if(!records.has(record))return;
      if(exact(message,['type'])&&message.type==='hello'){void hello(record);return;}
      if(exact(message,['type'])&&message.type==='check_layout'){if(record.context&&!active(record,record.context))clearContext(record,'local_layout_changed');return;}
      if(exact(message,['type','snapshot'])&&message.type==='presentation'){void publish(record,message.snapshot);return;}
      if(exact(message,['type'])&&message.type==='close'){remove(record);return;}
      if(exact(message,['type','contextKey','revision'])&&message.type==='dismiss'&&message.contextKey===record.context?.key&&message.revision===record.context?.lastRevision){post(port,{type:'dismiss_requested',contextKey:record.context.key,revision:message.revision});return;}
      post(port,{type:'rejected',contextKey:record.context?.key??null,reason:'invalid_message'});
    });
    port.onDisconnect.addListener(()=>remove(record));record.unload=()=>remove(record);win.addEventListener?.('pagehide',record.unload,{once:true});
    if(Observer){record.observer=new Observer(()=>{if(record.context&&record.context.siteId!==persona(record))clearContext(record,'local_persona_changed');});record.observer.observe(win.document.documentElement,{attributes:true,attributeFilter:['data-site']});}
    return client;
  }
  function layoutChanged(){for(const record of [...records]){
    if(record.context&&!active(record,record.context))clearContext(record,'local_layout_changed');
    else if(!record.context&&capability(record.win).mode==='external')void hello(record);
  }}
  function disconnectPage(){
    let disconnected=0;
    for(const record of [...records]){const port=record.context?.pagePort;if(port){disconnected++;port.disconnect();}}
    return{disconnected};
  }
  const rect=node=>{const r=node?.getBoundingClientRect?.();return r?Object.fromEntries(['left','right','top','bottom','width','height'].map(key=>[key,r[key]])):null;};
  function sample(){
    const record=[...records].find(item=>item.context),context=record?.context,panel=frame('managerFrame'),page=frame('mockFrame'),overlay=page?.contentDocument?.querySelector('[data-text-memory-soft-feedback]');
    const panelRect=rect(panel),pageRect=rect(page),localRect=rect(overlay),overlayRect=localRect&&pageRect?{...localRect,left:localRect.left+pageRect.left,right:localRect.right+pageRect.left,top:localRect.top+pageRect.top,bottom:localRect.bottom+pageRect.top}:null;
    const main=record?.win.__textMemorySoftBodyDiagnostics?.snapshot?.()||null;
    const visible=!!overlay&&!overlay.hidden&&!page.hidden&&!!overlayRect?.width&&!!overlayRect?.height;
    return{environment:'local_split_iframes',nativeExtensionVerified:false,panelRect,pageRect,overlayRect,visible,contextKey:context?.key??null,main:main&&{contextKey:main.contextKey,revision:main.revision,recipeId:main.recipeId,phase:main.phase,statusCode:main.statusCode},external:overlay&&{contextKey:overlay.getAttribute('data-context-key'),revision:Number(overlay.getAttribute('data-revision')),recipeId:overlay.getAttribute('data-recipe-id'),phase:overlay.getAttribute('data-phase')},ack:context?.lastAck??null,leftOutside:visible&&overlayRect.right<=panelRect.left,midpointDelta:visible?(overlayRect.top+overlayRect.bottom-panelRect.top-panelRect.bottom)/2:null,rightGap:visible?panelRect.left-overlayRect.right:null,samples:samples.slice(-12)};
  }
  return{connect,layoutChanged,disconnectPage,sample,dispose(){disposed=true;for(const record of [...records])remove(record);}};
}
