import {supportedSites} from '../core/sites.js';
import {validPresentationSnapshot} from './presentation.js';

export const PANEL_PORT='text-memory-soft-body-v1';
export const PAGE_PORT='text-memory-soft-feedback-v1';
const aliases={ChatGPT:'chatgpt',DeepSeek:'deepseek',Gemini:'gemini',Claude:'claude',Grok:'grok',Kimi:'kimi','千问':'qianwen'};
const exact=(value,keys)=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const supported=url=>{try{const parsed=new URL(url);return !parsed.username&&!parsed.password&&supportedSites.find(site=>site.origin===parsed.origin);}catch{return null;}};
const safeId=value=>typeof value==='string'&&value.length>0&&value.length<=160;
const safePost=(port,message)=>{try{port.postMessage(message);return true;}catch{return false;}};

// A separate presentation channel. It never calls the existing memory RPCs.
export function installSoftFeedbackRouter(api=globalThis.chrome,{uuid=()=>crypto.randomUUID(),now=()=>Date.now(),setTimer=setTimeout,clearTimer=clearTimeout}={}){
  if(!api?.runtime?.onConnect?.addListener)return{dispose(){}};
  const records=new Set(),cleanups=[],confirmedLayouts=new Map();
  let disposed=false;
  function listen(event,fn){if(!event?.addListener)return;event.addListener(fn);cleanups.push(()=>event.removeListener?.(fn));}
  function publicContext(context){return context?{key:context.key,windowId:context.windowId,tabId:context.tabId,documentId:context.documentId,pageSession:context.pageSession,siteId:context.siteId}:null;}
  function capability(context){return context?.capability||{mode:'internal',reason:'context_unavailable',side:'unknown'};}
  function settlePending(context,reason){for(const pending of context?.pending?.values()||[]){clearTimer(pending.timer);pending.resolve({mode:'internal',reason});}context?.pending?.clear();if(context?.readyWait){clearTimer(context.readyWait.timer);context.readyWait.resolve(false);context.readyWait=null;}}
  function clearContext(record,reason,notify=true){
    const context=record.context;record.epoch++;record.context=null;
    if(context){settlePending(context,reason);safePost(context.pagePort,{type:'close',contextKey:context.key,pageSession:context.pageSession});try{context.pagePort?.disconnect();}catch{}}
    if(notify)safePost(record.port,{type:'context_invalidated',contextKey:context?.key??null,reason});
  }
  function remove(record,reason='panel_closed'){
    if(!records.has(record))return;clearContext(record,reason,false);records.delete(record);try{record.port.disconnect();}catch{}
  }
  async function authenticate(port){
    const sender=port.sender;
    if(sender?.id!==api.runtime.id||sender.url!==api.runtime.getURL('sidepanel.html')||!safeId(sender.documentId)||!api.runtime.getContexts)throw Error('untrusted_panel');
    const contexts=await api.runtime.getContexts({contextTypes:['SIDE_PANEL'],documentIds:[sender.documentId]});
    if(contexts.length!==1||contexts[0].contextType!=='SIDE_PANEL'||contexts[0].documentId!==sender.documentId||contexts[0].documentUrl!==sender.url||!Number.isSafeInteger(contexts[0].windowId)||contexts[0].windowId<0)throw Error('panel_context_unverified');
    return contexts[0].windowId;
  }
  async function currentTab(windowId){const tabs=await api.tabs.query({active:true,windowId});return tabs.length===1?tabs[0]:null;}
  const layoutKey=record=>Number.isSafeInteger(record.windowId)&&safeId(record.panelDocumentId)?`${record.windowId}:${record.panelDocumentId}`:null;
  function rememberRight(record,confirmed){
    const key=layoutKey(record);record.confirmedRight=confirmed;
    if(!key)return;
    if(confirmed)confirmedLayouts.set(key,{windowId:record.windowId,documentId:record.panelDocumentId});
    else{confirmedLayouts.delete(key);for(const other of records)if(layoutKey(other)===key)other.confirmedRight=false;}
  }
  function forgetWindowLayout(windowId){
    for(const[key,value]of confirmedLayouts)if(value.windowId===windowId)confirmedLayouts.delete(key);
    for(const record of records)if(record.windowId===windowId)record.confirmedRight=false;
  }
  async function panelLayout(record){
    let side='unknown',reason='layout_unknown';
    if(api.sidePanel?.getLayout){
      try{const layout=await api.sidePanel.getLayout();if(['left','right'].includes(layout?.side)){side=layout.side;reason=side==='right'?'':'panel_on_left';}}
      catch{reason='layout_query_failed';}
    }
    // Old browser versions lack getLayout. Only this authenticated, open
    // sidebar may explicitly confirm its position; never infer it from a page.
    // Browser evidence always wins, including a later move to the left.
    if(side==='left')forgetWindowLayout(record.windowId);
    if(side==='unknown'&&record.confirmedRight)return{side:'right',reason:'',layoutSource:'user_confirmed'};
    return{side,reason,layoutSource:side==='unknown'?'unavailable':'browser'};
  }
  async function confirmRightLayout(record){
    const epoch=record.epoch;
    try{
      await record.authentication;
      if(!records.has(record)||record.epoch!==epoch)return;
      const layout=await panelLayout(record);
      if(!records.has(record)||record.epoch!==epoch)return;
      if(layout.side==='left'){
        safePost(record.port,{type:'rejected',contextKey:record.context?.key??null,reason:'panel_on_left'});
        return;
      }
      rememberRight(record,layout.layoutSource!=='browser');
      await hello(record);
    }catch{remove(record,'untrusted_panel');}
  }
  async function validCurrent(record,context){
    if(record.context!==context||!records.has(record))return false;
    const tab=await currentTab(context.windowId);
    if(tab?.id!==context.tabId||tab.url!==context.url)return false;
    const granted=await api.permissions.contains({origins:[context.origin+'/*']});
    if(!granted||record.context!==context)return false;
    const results=await api.scripting.executeScript({target:{tabId:context.tabId,documentIds:[context.documentId]},func:()=>({url:location.href,visible:document.visibilityState!=='hidden'})});
    return record.context===context&&results.length===1&&results[0].frameId===0&&results[0].documentId===context.documentId&&results[0].result?.url===context.url&&results[0].result?.visible===true;
  }
  async function hello(record){
    clearContext(record,'reconnecting',false);const epoch=record.epoch;
    let reason='context_unavailable';
    try{
      const windowId=await record.authentication;if(!records.has(record)||epoch!==record.epoch)return;
      record.windowId=windowId;const tab=await currentTab(windowId),site=supported(tab?.url);
      if(!site){reason='unsupported_site';throw Error(reason);}
      if(!await api.permissions.contains({origins:[site.origin+'/*']})){reason='permission_required';throw Error(reason);}
      const results=await api.scripting.executeScript({target:{tabId:tab.id,frameIds:[0]},func:()=>({url:location.href,visible:document.visibilityState!=='hidden'})});
      const result=results[0];
      if(results.length!==1||result.frameId!==0||!safeId(result.documentId)||result.result?.url!==tab.url||result.result?.visible!==true){reason='page_not_ready';throw Error(reason);}
      const {side,reason:layoutReason,layoutSource}=await panelLayout(record);
      if(epoch!==record.epoch||!records.has(record))return;
      const context={key:uuid(),pageSession:uuid(),windowId,tabId:tab.id,documentId:result.documentId,url:tab.url,origin:site.origin,siteId:aliases[site.name],lastRevision:0,pagePort:null,readyWait:null,pending:new Map(),capability:{mode:side==='right'?'external':'internal',reason:layoutReason,side,layoutSource}};
      record.context=context;
      if(!await validCurrent(record,context)){reason='page_changed';throw Error(reason);}
      if(side==='right'){
        try{
          await api.scripting.executeScript({target:{tabId:context.tabId,documentIds:[context.documentId]},files:['soft-body/feedback-bundle.js','adapters/soft-feedback.js']});
          if(!await validCurrent(record,context)){reason='page_changed';throw Error(reason);}
          const mounted=await api.scripting.executeScript({target:{tabId:context.tabId,documentIds:[context.documentId]},func:args=>globalThis.__textMemorySoftFeedback?.mount(args)||{status:'unavailable'},args:[{contextKey:context.key,pageSession:context.pageSession,url:context.url}]});
          if(mounted.length!==1||mounted[0].documentId!==context.documentId||mounted[0].result?.status!=='mounted')throw Error('overlay_unavailable');
          // executeScript returning "mounted" is not the page port handshake.
          // Wait for its authenticated ready message before accepting snapshots.
          if(!context.pagePort){
            const ready=await new Promise(resolve=>{const timer=setTimer(()=>{context.readyWait=null;resolve(false);},750);timer?.unref?.();context.readyWait={resolve,timer};});
            if(!ready)throw Error('overlay_not_connected');
          }
        }catch(error){if(record.context===context)context.capability={mode:'internal',reason:error.message==='overlay_not_connected'?'overlay_not_connected':'injection_unavailable',side,layoutSource};}
      }
      if(epoch!==record.epoch||record.context!==context)return;
      safePost(record.port,{type:'context',context:publicContext(context),capability:capability(context)});
    }catch{
      if(epoch!==record.epoch||!records.has(record))return;
      clearContext(record,reason,false);safePost(record.port,{type:'context',context:null,capability:{mode:'internal',reason,side:'unknown'}});
    }
  }
  async function publish(record,snapshot){
    const context=record.context;
    if(!context||!validPresentationSnapshot(snapshot)||snapshot.contextKey!==context.key||snapshot.personaId!==context.siteId||snapshot.revision<=context.lastRevision){safePost(record.port,{type:'rejected',contextKey:context&&snapshot?.contextKey===context.key?context.key:null,reason:'invalid_or_stale_presentation'});return;}
    // Reserve sequence before asynchronous verification: an older continuation
    // can never overtake a newer phase or a retry.
    context.lastRevision=snapshot.revision;
    try{
      if(!await validCurrent(record,context)){if(record.context===context)clearContext(record,'page_changed');return;}
      if(!await checkLayout(record,context))return;
      if(context.lastRevision!==snapshot.revision)return;
      if(context.capability.mode!=='external'||!context.pagePort){safePost(record.port,{type:'presented',contextKey:context.key,revision:snapshot.revision,mode:'internal',reason:context.capability.reason||'overlay_not_connected',renderedAt:now()});return;}
      const result=await new Promise(resolve=>{
        const timer=setTimer(()=>{context.pending.delete(snapshot.revision);resolve({mode:'internal',reason:'render_ack_timeout'});},750);timer?.unref?.();
        context.pending.set(snapshot.revision,{resolve,timer});
        if(!safePost(context.pagePort,{type:'presentation',snapshot})){clearTimer(timer);context.pending.delete(snapshot.revision);resolve({mode:'internal',reason:'overlay_disconnected'});}
      });
      if(record.context===context&&context.lastRevision===snapshot.revision)safePost(record.port,{type:'presented',contextKey:context.key,revision:snapshot.revision,...result,renderedAt:result.renderedAt??now()});
    }catch{if(record.context===context)clearContext(record,'page_access_lost');}
  }
  async function checkLayout(record,context=record.context){
    if(!context||record.context!==context)return false;
    const {side}=await panelLayout(record);
    if(record.context!==context)return false;
    if(side!==context.capability.side){clearContext(record,'layout_changed');return false;}
    return true;
  }
  function connectPanel(port){
    const record={port,context:null,windowId:null,panelDocumentId:null,epoch:0,authentication:null,confirmedRight:false};records.add(record);
    // authenticate queries getContexts on every new port. A cached assumption
    // belongs only to that still-live SIDE_PANEL document in its own window.
    record.authentication=authenticate(port).then(windowId=>{if(records.has(record)){record.windowId=windowId;record.panelDocumentId=port.sender.documentId;record.confirmedRight=confirmedLayouts.has(layoutKey(record));}return windowId;});record.authentication.catch(()=>remove(record,'untrusted_panel'));
    port.onDisconnect.addListener(()=>remove(record));
    port.onMessage.addListener(message=>{
      if(!records.has(record))return;
      if(exact(message,['type'])&&message.type==='hello'){void hello(record);return;}
      if(exact(message,['type'])&&message.type==='confirm_right_layout'){void confirmRightLayout(record);return;}
      if(exact(message,['type'])&&message.type==='check_layout'){void checkLayout(record);return;}
      if(exact(message,['type','snapshot'])&&message.type==='presentation'){void publish(record,message.snapshot);return;}
      if(exact(message,['type'])&&message.type==='close'){remove(record);return;}
      if(exact(message,['type','contextKey','revision'])&&message.type==='dismiss'&&message.contextKey===record.context?.key&&message.revision===record.context?.lastRevision){safePost(record.port,{type:'dismiss_requested',contextKey:record.context.key,revision:message.revision});return;}
      safePost(port,{type:'rejected',contextKey:record.context?.key??null,reason:'invalid_message'});
    });
  }
  function connectPage(port){
    const sender=port.sender;
    if(sender?.id!==api.runtime.id||sender.frameId!==0||!safeId(sender.documentId)||!Number.isSafeInteger(sender.tab?.id)){try{port.disconnect();}catch{}return;}
    let record=null,context=null;
    function reject(){try{port.disconnect();}catch{}}
    port.onMessage.addListener(message=>{
      if(!context){
        if(!exact(message,['type','contextKey','pageSession'])||message.type!=='ready')return reject();
        record=[...records].find(item=>item.context?.key===message.contextKey);context=record?.context;
        if(!context||context.pageSession!==message.pageSession||context.tabId!==sender.tab.id||context.windowId!==sender.tab.windowId||context.documentId!==sender.documentId||context.url!==sender.url||context.pagePort){context=null;return reject();}
        context.pagePort=port;if(context.readyWait){clearTimer(context.readyWait.timer);context.readyWait.resolve(true);context.readyWait=null;}return;
      }
      if(record.context!==context)return reject();
      if(exact(message,['type','contextKey','pageSession','revision','mode','reason'])&&message.type==='availability'&&message.contextKey===context.key&&message.pageSession===context.pageSession&&message.revision===context.lastRevision&&((message.mode==='external'&&message.reason==='')||(message.mode==='internal'&&message.reason==='narrow_viewport'))){safePost(record.port,{type:'presented',contextKey:context.key,revision:message.revision,mode:message.mode,reason:message.reason,renderedAt:now()});return;}
      if(exact(message,['type','contextKey','pageSession','revision','renderedAt','mode','reason'])&&message.type==='rendered'&&message.contextKey===context.key&&message.pageSession===context.pageSession&&Number.isFinite(message.renderedAt)&&['external','internal'].includes(message.mode)&&['','narrow_viewport','renderer_unavailable'].includes(message.reason)){
        const pending=context.pending.get(message.revision);if(!pending)return;context.pending.delete(message.revision);clearTimer(pending.timer);pending.resolve({mode:message.mode,reason:message.reason,renderedAt:message.renderedAt});return;
      }
      if(exact(message,['type','contextKey','pageSession','revision'])&&message.type==='dismiss'&&message.contextKey===context.key&&message.pageSession===context.pageSession&&message.revision===context.lastRevision){safePost(record.port,{type:'dismiss_requested',contextKey:context.key,revision:message.revision});return;}
      if(exact(message,['type','contextKey','pageSession'])&&message.type==='page_changed'&&message.contextKey===context.key&&message.pageSession===context.pageSession){clearContext(record,'page_changed');return;}
      reject();
    });
    port.onDisconnect.addListener(()=>{if(context?.pagePort===port){context.pagePort=null;settlePending(context,'overlay_disconnected');if(record?.context===context)clearContext(record,'overlay_disconnected');}});
  }
  listen(api.runtime.onConnect,port=>{if(disposed)return;if(port.name===PANEL_PORT)connectPanel(port);else if(port.name===PAGE_PORT)connectPage(port);});
  listen(api.tabs.onActivated,info=>{for(const record of records)if(record.context?.windowId===info.windowId&&record.context.tabId!==info.tabId)clearContext(record,'tab_changed');});
  listen(api.tabs.onUpdated,(tabId,change)=>{if(change.status!=='loading'&&typeof change.url!=='string')return;for(const record of records)if(record.context?.tabId===tabId)clearContext(record,'page_changed');});
  listen(api.tabs.onRemoved,tabId=>{for(const record of records)if(record.context?.tabId===tabId)clearContext(record,'tab_closed');});
  listen(api.permissions.onRemoved,()=>{for(const record of records)if(record.context)clearContext(record,'permission_changed');});
  listen(api.sidePanel?.onClosed,info=>{if(!info.path||info.path==='sidepanel.html')forgetWindowLayout(info.windowId);for(const record of [...records])if(record.windowId===info.windowId&&(!info.path||info.path==='sidepanel.html')&&(info.tabId===undefined||record.context?.tabId===info.tabId))remove(record);});
  listen(api.windows?.onRemoved,windowId=>{forgetWindowLayout(windowId);for(const record of [...records])if(record.windowId===windowId)remove(record,'window_closed');});
  return{dispose(){if(disposed)return;disposed=true;for(const record of [...records])remove(record);confirmedLayouts.clear();for(const cleanup of cleanups)cleanup();}};
}
