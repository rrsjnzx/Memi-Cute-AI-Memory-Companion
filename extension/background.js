import {Repository} from './storage.js';
import {validatePack} from './core/pack.js';
import {id,now,equal} from './core/base.js';
import {trustedSender} from './core/trust.js';
import {runLiveCheck} from './core/live-check.js';
import {runFunctionalCheck} from './core/functional-check.js';
import {prepareRestartCheck,verifyRestartCheck} from './core/restart-check.js';
import {supportedSites} from './core/sites.js';
import {activeRound,resumeRound} from './core/rounds.js';
import {validateInboxReply} from './core/reply-inbox.js';
import {rejectedReplyBlock} from './core/rejected-reply.js';
import {createReplyDraftStore} from './core/reply-drafts.js';
import {createFloatingSessions} from './core/floating-session.js';
import {createSendLedger} from './core/send-ledger.js';
import {createChatViewStore} from './core/chat-view.js';
import {installSoftFeedbackRouter} from './soft-body/transport-router.js';

installSoftFeedbackRouter();

const repository=new Repository();
const replyDraftStore=createReplyDraftStore({local:chrome.storage.local,repository});
const sendLedger=createSendLedger({local:chrome.storage.local});
const chatViews=createChatViewStore({local:chrome.storage.local,repository});
const floatingSessions=createFloatingSessions({sessionStorage:chrome.storage.session,runtimeId:chrome.runtime.id,getActiveTab:currentTab,verifyTopDocument,verifySentTransition});
let floatingOpening=false;
const floatingReadyChecks=40,floatingReadyIntervalMs=400;
const floatingFrameFailures=new Set(['floating_document_replaced','floating_source_changed','floating_frame_restricted','floating_frame_removed']);
function floatingFailure(result,fallback){
  const error=Error(result?.message||fallback);
  if(floatingFrameFailures.has(result?.reason))error.code=result.reason;
  return error;
}
const liveTestRepository=new Repository('text-memory-live-tests-v1');
let liveTestRunning=false;
let functionalTestRunning=false;
let restartCheckRunning=false,pageWriteRunning=false,accessGeneration=0;
chrome.permissions?.onRemoved?.addListener(()=>{accessGeneration++;});
let startupWrite=Promise.resolve();
let sessionWrite=Promise.resolve();
function changeSession(generation,write){
  const pending=sessionWrite.catch(()=>{}).then(()=>generation===accessGeneration?write().then(()=>true):false);
  sessionWrite=pending;return pending;
}
chrome.runtime.onStartup.addListener(()=>{
  startupWrite=chrome.storage.local.set({browserStartup:{id:id('startup'),at:now(),event:'runtime.onStartup'}});
  // Keep a rejection observable to a subsequent explicit check, without an
  // unhandled background promise when no check is requested.
  void startupWrite.catch(()=>{});
});
const allowedOrigins=new Set(supportedSites.map(site=>site.origin));
chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'}).catch(()=>{});
chrome.storage.session.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'}).catch(()=>{});
chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:true}).catch(()=>{});
chrome.runtime.onInstalled.addListener(()=>chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:true}));

async function currentTab(){const tabs=await chrome.tabs.query({active:true,lastFocusedWindow:true});return tabs[0]||null;}
async function verifyTopDocument(record){
  try{const result=await chrome.scripting.executeScript({target:{tabId:record.tabId,documentIds:[record.documentId]},func:()=>({url:location.href,visible:document.visibilityState!=='hidden'})});return result.length===1&&result[0].frameId===0&&result[0].documentId===record.documentId&&result[0].result?.url===record.url&&result[0].result?.visible===true;}catch{return false;}
}
async function verifySentTransition(record,candidateUrl){
  try{
    const results=await chrome.scripting.executeScript({target:{tabId:record.tabId,documentIds:[record.documentId]},func:args=>{
      if(location.href!==args.url||document.visibilityState==='hidden')return{status:'not_observed'};
      return globalThis.__textMemoryAdapterV2?.execute({action:'verify_sent_transition',packId:args.packId})||{status:'not_observed'};
    },args:[{url:candidateUrl,packId:record.sentTransition?.packId}]});
    return results.length===1&&results[0].frameId===0&&results[0].documentId===record.documentId&&results[0].result?.status==='send_echo'&&results[0].result.packId===record.sentTransition?.packId;
  }catch{return false;}
}
async function shellCall(record,action){
  const args={action,token:record.token,...(action==='open'?{url:chrome.runtime.getURL('floating.html')+'?token='+record.token,pageUrl:record.url}:action==='accept_url'?{pageUrl:record.url}:{})};
  const result=await chrome.scripting.executeScript({target:{tabId:record.tabId,documentIds:[record.documentId]},func:args=>{
    const shell=globalThis.__textMemoryFloatingShell;if(!shell)return{status:'not_found'};
    return args.action==='open'?shell.open(args):args.action==='close'?shell.close(args.token):args.action==='close_if_loading'?shell.closeIfLoading?.(args.token)||{status:'unsupported'}:args.action==='accept_url'?shell.acceptPageUrl?.({token:args.token,pageUrl:args.pageUrl})||{status:'not_found'}:shell.check(args.token);
  },args:[args]});
  if(result.length!==1||result[0].frameId!==0||result[0].documentId!==record.documentId)throw Error('浮窗执行目标已改变');return result[0].result;
}
async function openFloating(){
  if(floatingOpening)return{status:'busy',message:'正在打开网页浮窗，请稍候'};floatingOpening=true;let record;
  try{
    const target=await snapshot();if(target.status!=='ready')return target;
    record=await floatingSessions.open({tabId:target.tabId,url:target.url,documentId:target.documentId});
    await chrome.scripting.executeScript({target:{tabId:record.tabId,documentIds:[record.documentId]},files:['adapters/floating-shell.js']});
    if(!await verifyTopDocument(record))throw Error('网页已变化，请重新打开浮窗');
    const mounted=await shellCall(record,'open');if(mounted?.status!=='mounted')throw Error(mounted?.message||'浮窗未能挂载');
    // Every caller, including document-extraction launchers, receives success
    // only after the frame has initialized. Mounting an iframe can succeed even
    // when a browser or page prevents its extension document from loading.
    for(let attempt=0;attempt<floatingReadyChecks;attempt++){
      if(!await verifyTopDocument(record))throw Error('浮窗加载期间网页已切换或刷新，请回到目标 AI 网页重新打开');
      const result=await shellCall(record,'check');
      if(result?.status==='ready'){if(!await verifyTopDocument(record))throw Error('浮窗加载完成时网页已切换或刷新，请回到目标 AI 网页');return{status:'opened',floating:record};}
      if(result?.status!=='loading')throw floatingFailure(result,'浮窗已关闭或加载期间网页已变化，请重新打开');
      await new Promise(resolve=>setTimeout(resolve,floatingReadyIntervalMs));
    }
    // Check and close inside one page call. A late ready message or replacement
    // frame must win over this old timeout; neither may lose its authorization.
    const cleanup=await shellCall(record,'close_if_loading');
    if(cleanup?.status==='ready'){if(!await verifyTopDocument(record))throw Error('浮窗加载完成时网页已切换或刷新，请回到目标 AI 网页');return{status:'opened',floating:record};}
    if(cleanup?.status==='unavailable')throw floatingFailure(cleanup,'浮窗页面已不可用，请关闭后重新打开');
    await floatingSessions.close({tabId:record.tabId,token:record.token}).catch(()=>{});
    return{status:'error',reason:'floating_load_timeout',message:'浮窗尚未完成加载，可能被页面或浏览器限制。'+(cleanup?.status==='closed'?'已关闭未加载的空白窗口。':'未能确认空白窗口已关闭。')+'可重新打开浮窗或继续使用侧栏；未发送消息，网页草稿未改动。'};
  }catch(error){
    let cleanup;
    if(record){cleanup=await shellCall(record,'close_if_loading').catch(()=>null);if(cleanup?.status!=='ready')await floatingSessions.close({tabId:record.tabId,token:record.token}).catch(()=>{});}
    return{status:'error',...(error.code?{reason:error.code}:{}),message:(error.message||'无法打开浮窗')+(cleanup?.status==='closed'?'；已关闭未加载的空白窗口':'')+'。可回到目标 AI 网页重新打开浮窗，或继续使用侧栏。'};
  }
  finally{floatingOpening=false;}
}
async function pageCall(tabId,request,documentId=null,canProceed=()=>true){
  const tab=await chrome.tabs.get(tabId);let url;try{url=new URL(tab.url);}catch{return{status:'permission_required',message:'请在目标 AI 网页点击扩展图标，或授予该站点权限'};}
  if(url.protocol==='chrome-extension:')return{status:'unsupported',message:'当前活动页是扩展管理页。请切换到 AI 网页，在该网页打开扩展侧栏后点击自检。'};
  if(!allowedOrigins.has(url.origin))return{status:'unsupported',message:'当前网页不在支持列表中。请切换到 GPT、DeepSeek、Kimi、Grok 或 Claude 的对话页后重试。'};
  const target=documentId?{tabId,documentIds:[documentId]}:{tabId,frameIds:[0]};
  try{
    if(['insert','undo','send','read_latest_reply'].includes(request.action)){
      const active=await currentTab();
      if(!canProceed()||active?.id!==tabId||active?.url!==request.identity?.url||tab.url!==request.identity?.url)return{status:'stale_target',message:'目标网页已切换，已停止。切回要使用的 AI 网页后，再次点击“连接当前网页并加入草稿”。'};
    }
    if(!canProceed())return{status:'stale_target',message:'访问范围已改变，已停止本次操作'};
    if(!documentId)await chrome.scripting.executeScript({target,files:['adapters/plain-text.js','adapters/selection-paste.js','adapters/mobile-textarea.js','adapters/reply-reader.js','adapters/send-control.js','adapters/content.js']});
    if(!canProceed())return{status:'stale_target',message:'访问范围已改变，已停止本次操作'};
    const results=await chrome.scripting.executeScript({target,func:request=>globalThis.__textMemoryAdapterV2?.execute(request)||{status:'stale_target',message:'页面已刷新，请重新读取'},args:[request]});
    if(results.length!==1||results[0].frameId!==0)return{status:'ambiguous_target',message:'页面执行目标不唯一'};
    return{...results[0].result,tabId,documentId:results[0].documentId};
  }catch{return{status:'permission_required',message:'页面不可访问或权限已失效；请在目标网页点击扩展图标后重试'};}
}
async function snapshot(canProceed=()=>true){const tab=await currentTab();if(!tab)return{status:'unsupported',message:'没有活动标签页'};return pageCall(tab.id,{action:'snapshot'},null,canProceed);}
function replyStatus(result){
  const value={status:typeof result?.status==='string'?result.status:'invalid_reply'};
  for(const key of ['message','reason'])if(typeof result?.[key]==='string')value[key]=result[key].slice(0,1000);
  if(Number.isFinite(result?.retryAfterMs)&&result.retryAfterMs>=0)value.retryAfterMs=result.retryAfterMs;
  return value;
}
function replySource(source){
  const clean=Object.fromEntries(['adapter','author','selector','sourceEvidence','messageKey'].filter(key=>typeof source[key]==='string').map(key=>[key,source[key].slice(0,500)]));
  const check=source.generationCheck,allowed=['data-is-streaming','data-streaming','aria-busy','data-perf-row-streaming'];
  if(check&&['explicit_false','no_observed_busy_signal'].includes(check.basis)&&Array.isArray(check.attributes)&&check.attributes.length<=4&&new Set(check.attributes).size===check.attributes.length&&check.attributes.every(name=>allowed.includes(name))&&check.stableSamples===2&&check.minIntervalMs===1000&&(check.basis==='explicit_false'?check.attributes.length>0:check.attributes.length===0))clean.generationCheck={basis:check.basis,attributes:[...check.attributes],stableSamples:2,minIntervalMs:1000};
  return clean;
}
function receiptState(state,expected,binding){
  if(!expected||typeof expected!=='object'||Array.isArray(expected)||Object.keys(expected).length!==3||!['taskId','baseVersion','packId'].every(key=>Object.hasOwn(expected,key))||typeof expected.taskId!=='string'||!expected.taskId.trim()||expected.taskId.length>200||typeof expected.packId!=='string'||!expected.packId.trim()||expected.packId.length>199||!Number.isSafeInteger(expected.baseVersion)||expected.baseVersion<1)throw Error('网页回执的任务、基础版本或资料包 ID 无效');
  const task=state.tasks.find(task=>task.id===expected.taskId),round=activeRound(state,expected.taskId);
  if(!task||task.version!==expected.baseVersion||!round||round.baseVersion!==expected.baseVersion||round.packSnapshot.id!==expected.packId)throw Error('当前任务或轮次资料包已改变，请使用当前轮次最新资料包的回复');
  if(!binding.libraryIds.includes(task.libraryId))throw Error('当前网页未绑定任务所属资料库');
  resumeRound(state,round.id);
  return{roundId:round.id,roundVersion:round.version,packId:round.packSnapshot.id};
}
function replyDisplay(result){
  const value=result?.display;
  if(!['reply_ready','waiting','invalid_reply','ambiguous'].includes(result?.status)||!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==4||!['text','phase','pairing','messageKey'].every(key=>Object.hasOwn(value,key)))return null;
  if(typeof value.text!=='string'||!value.text.trim()||value.text.length>100000||!['streaming','settling','stable'].includes(value.phase)||!['protocol','user_pack'].includes(value.pairing)||typeof value.messageKey!=='string'||!value.messageKey.trim()||value.messageKey.length>500)return null;
  return{text:value.text,phase:value.phase,pairing:value.pairing,messageKey:value.messageKey};
}
function replyDiagnostic(result,expected){
  const value=result?.diagnostic;
  if(result?.status!=='invalid_reply'||result.reason!=='invalid_json'||!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==4||!['text','phase','pairing','messageKey'].every(key=>Object.hasOwn(value,key)))return null;
  if(value.phase!=='stable'||value.pairing!=='user_pack'||typeof value.messageKey!=='string'||!value.messageKey.trim()||value.messageKey.length>500)return null;
  const block=rejectedReplyBlock(value.text,expected);if(!block||block.text!==value.text)return null;
  return{text:block.text,phase:'stable',pairing:'user_pack',messageKey:value.messageKey};
}
async function testCurrentSite(){
  if(liveTestRunning||pageWriteRunning)return{status:'busy',message:'当前草稿操作或自检尚未结束'};
  liveTestRunning=true;pageWriteRunning=true;const generation=accessGeneration;
  try{
    const first=await snapshot(()=>generation===accessGeneration),identity=actualIdentity(first);
    const report=await runLiveCheck({repository:liveTestRepository,first,identity,call:async request=>{
      if(request.action==='insert'){
        const tab=await currentTab();if(generation!==accessGeneration||tab?.id!==first.tabId)return{status:'stale_target',message:'活动标签页或资料绑定已改变'};
      }
      return pageCall(first.tabId,request,first.documentId,()=>request.action!=='insert'||generation===accessGeneration);
    }});
    await chrome.storage.local.set({lastSiteSelfTest:report});
    if(first.documentId)await pageCall(first.tabId,{action:'show_test_report',report},first.documentId);
    return report;
  }finally{liveTestRunning=false;pageWriteRunning=false;}
}
async function handle(message){
  if(['INSERT','UNDO'].includes(message.type)){
    if(pageWriteRunning)return{status:'busy',message:'另一次草稿写入或撤销尚未结束，请稍后重试'};
    pageWriteRunning=true;try{return await handleMessage(message);}finally{pageWriteRunning=false;}
  }
  return handleMessage(message);
}
async function handleMessage(message){
  if(message.type==='OPEN_FLOATING')return openFloating();
  if(message.type==='FLOATING_STATUS'){
    const record=message.floating;
    if(!record||!Number.isSafeInteger(record.tabId)||typeof record.token!=='string'||!/^[a-f0-9]{64}$/.test(record.token)||typeof record.documentId!=='string'||!await verifyTopDocument(record))return{status:'not_found',message:'网页已变化，请重新打开浮窗'};
    const result=await shellCall(record,'check');
    if(result?.status==='unavailable')await floatingSessions.close({tabId:record.tabId,token:record.token});
    return result;
  }
  if(message.type==='SAVE_REPLY_DRAFT')return{status:'saved',record:await replyDraftStore.save(message.payload)};
  if(message.type==='LOAD_CHAT_VIEW')return{status:'loaded',view:await chatViews.load(message.payload)};
  if(message.type==='SAVE_CHAT_VIEW')return{status:'saved',view:await chatViews.save(message.payload)};
  if(message.type==='LIST_REPLY_DRAFTS')return{status:'listed',records:await replyDraftStore.list(message.payload)};
  if(message.type==='CLAIM_REPLY_DRAFT')return{status:'claimed',record:await replyDraftStore.claim(message.payload)};
  if(message.type==='SETTLE_REPLY_DRAFT')return{status:'settled',record:await replyDraftStore.settle(message.payload)};
  if(['PREPARE_RESTART_CHECK','VERIFY_RESTART_CHECK'].includes(message.type)){
    if(restartCheckRunning)return{status:'busy',message:'重启检查尚未结束'};
    restartCheckRunning=true;
    try{
      await startupWrite;
      const {browserStartup}=await chrome.storage.local.get('browserStartup');
      const action=message.type==='PREPARE_RESTART_CHECK'?prepareRestartCheck:verifyRestartCheck;
      const report=await action({createRepository:name=>new Repository(name),local:chrome.storage.local,startupMarker:browserStartup});
      await chrome.storage.local.set({lastRestartCheck:report});
      const tab=await currentTab();if(tab)await pageCall(tab.id,{action:'show_test_report',report});
      return report;
    }finally{restartCheckRunning=false;}
  }
  if(message.type==='LAST_RESTART_CHECK')return (await chrome.storage.local.get('lastRestartCheck')).lastRestartCheck||{status:'not_run'};
  if(message.type==='FUNCTIONAL_TEST'){
    if(functionalTestRunning)return{status:'busy',message:'功能验收尚未结束'};
    functionalTestRunning=true;
    try{
      const report=await runFunctionalCheck({createRepository:name=>new Repository(name)});
      await chrome.storage.local.set({lastFunctionalTest:report});
      const tab=await currentTab();if(tab)await pageCall(tab.id,{action:'show_test_report',report});
      return report;
    }finally{functionalTestRunning=false;}
  }
  if(message.type==='LAST_FUNCTIONAL_TEST')return (await chrome.storage.local.get('lastFunctionalTest')).lastFunctionalTest||{status:'not_run'};
  if(message.type==='SELF_TEST')return testCurrentSite();
  if(message.type==='LAST_SELF_TEST')return (await chrome.storage.local.get('lastSiteSelfTest')).lastSiteSelfTest||{status:'not_run'};
  if(message.type==='TARGET'){const generation=accessGeneration;return snapshot(()=>generation===accessGeneration);}
  if(message.type==='READ_LATEST_REPLY'){
    const generation=accessGeneration,{binding}=await chrome.storage.session.get('binding');
    if(!binding||!Array.isArray(binding.libraryIds)||!binding.libraryIds.length||!equal(binding.identity,message.identity))return{status:'stale_target',message:'请先明确连接目标网页与任务资料库，再读取 AI 回执'};
    const identity=binding.identity,state=await repository.snapshot();let receipt;
    try{receipt=receiptState(state,message.expected,binding);}catch(error){return{status:'stale_reply',message:error.message};}
    const tab=await currentTab();
    if(generation!==accessGeneration||tab?.id!==identity.tabId||tab?.url!==identity.url)return{status:'stale_target',message:'当前网页或访问授权已改变，未读取回执'};
    const result=await pageCall(identity.tabId,{action:'read_latest_reply',identity,expected:message.expected,...(message.includeDisplay===true?{includeDisplay:true}:{})},identity.documentId,()=>generation===accessGeneration);
    const latestState=await repository.snapshot(),latest=await chrome.storage.session.get('binding'),active=await currentTab();
    if(generation!==accessGeneration||active?.id!==identity.tabId||active?.url!==identity.url||!equal(latest.binding,binding))return{status:'stale_target',message:'读取期间网页或访问授权已改变，已丢弃回执内容'};
    try{if(!equal(receiptState(latestState,message.expected,binding),receipt))throw Error('读取期间轮次已改变，已丢弃回执内容');}catch(error){return{status:'stale_reply',message:error.message};}
    const display=message.includeDisplay===true&&activeRound(latestState,message.expected.taskId)?.status==='delivered'?replyDisplay(result):null;
    const diagnostic=message.includeDisplay===true&&activeRound(latestState,message.expected.taskId)?.status==='delivered'?replyDiagnostic(result,message.expected):null;
    if(result.status!=='reply_ready'){
      if(!display&&!diagnostic)return replyStatus(result);
      if(!equal(actualIdentity(result),identity))return{status:'stale_target',message:'回复来自不同页面或文档，已丢弃回复正文'};
      return{...replyStatus(result),...actualIdentity(result),...(display?{display}:{}),...(diagnostic?{diagnostic}:{})};
    }
    if(!equal(actualIdentity(result),identity))return{status:'stale_target',message:'回复来自不同页面或文档，已丢弃回执内容'};
    if(typeof result.text!=='string'||!result.text.trim()||result.text.length>100000||Object.hasOwn(result,'answerText')&&(typeof result.answerText!=='string'||result.answerText.length>100000))return{status:'invalid_reply',message:'回执或回复正文为空、无效或超过长度限制'};
    try{
      const round=activeRound(latestState,message.expected.taskId),checked=validateInboxReply(latestState,message.expected.taskId,result.text,{...round.packSnapshot.options,libraryIds:binding.libraryIds});
      if(checked.taskId!==message.expected.taskId||checked.baseVersion!==message.expected.baseVersion||checked.packId!==message.expected.packId||checked.kind.toUpperCase()!==result.kind)throw Error('回执类型或身份与当前轮次不一致');
    }catch(error){return{status:'invalid_reply',message:error.message};}
    return{...replyStatus(result),...actualIdentity(result),text:result.text,kind:result.kind,...(display?{display}:{}),
      ...(typeof result.answerText==='string'?{answerText:result.answerText}:{}),
      ...(typeof result.fingerprint==='string'&&/^[a-f0-9]{64}$/.test(result.fingerprint)?{fingerprint:result.fingerprint}:{}),
      ...(Number.isFinite(result.stableForMs)&&result.stableForMs>=0?{stableForMs:result.stableForMs}:{}),
      ...(result.source&&typeof result.source==='object'?{source:replySource(result.source)}:{}),
      ...(typeof result.note==='string'?{note:result.note.slice(0,1000)}:{})};
  }
  if(message.type==='READ_SELECTION'){
    const generation=accessGeneration;
    const {binding}=await chrome.storage.session.get('binding');
    if(!binding||!binding.libraryIds?.length||!equal(binding.identity,message.identity))return{status:'stale_target',message:'请先在目标网页读取草稿并绑定所选资料库，再读取网页选区'};
    const tab=await currentTab(),identity=binding.identity;
    if(generation!==accessGeneration||tab?.id!==identity.tabId||tab?.url!==identity.url)return{status:'stale_target',message:'当前标签页或会话与绑定不一致，请重新读取并绑定'};
    const result=await pageCall(identity.tabId,{action:'read_selection',identity},identity.documentId,()=>generation===accessGeneration);
    if(result.status!=='selected')return result;
    const active=await currentTab(),latest=await chrome.storage.session.get('binding');
    if(generation!==accessGeneration||active?.id!==identity.tabId||active?.url!==identity.url||!equal(latest.binding,binding)||!equal(actualIdentity(result),identity))return{status:'stale_target',message:'读取期间网页或资料绑定已改变，已丢弃选区内容'};
    if(typeof result.text!=='string'||!result.text.trim()||result.text.length>100000)return{status:'invalid_selection',message:'网页选区为空或超过长度限制'};
    return result;
  }
  if(message.type==='OPEN_MANAGER'){await chrome.runtime.openOptionsPage();return{status:'opened'};}
  if(message.type==='PAUSE'){const generation=++accessGeneration;await changeSession(generation,()=>chrome.storage.session.set({binding:null,lastDraft:null}));return{status:'paused'};}
  if(message.type==='BIND'){
    const generation=++accessGeneration;
    const actual=await snapshot(()=>generation===accessGeneration);if(actual.status!=='ready')return actual;
    if(!equal(actualIdentity(actual),message.identity))return{status:'stale_target',message:'绑定目标已改变，请重新读取'};
    const state=await repository.snapshot();if(!Array.isArray(message.libraryIds)||!message.libraryIds.every(x=>state.libraries.some(l=>l.id===x)))throw Error('库选择无效');
    if(generation!==accessGeneration)return{status:'stale_target',message:'绑定过程中访问范围已改变，请重新读取'};
    const binding={identity:actualIdentity(actual),libraryIds:[...message.libraryIds].sort()};
    const saved=await changeSession(generation,()=>chrome.storage.session.set({binding}));
    return saved&&generation===accessGeneration?{status:'bound',binding}:{status:'stale_target',message:'绑定过程中访问范围已改变，请重新读取'};
  }
  if(message.type==='INSERT'){
    const generation=accessGeneration;
    const target=await snapshot(()=>generation===accessGeneration);if(target.status!=='ready')return target;
    const state=await repository.snapshot(),pack=state.packs.find(p=>p.id===message.packId);if(!pack)throw Error('资料包不存在');
    const {binding}=await chrome.storage.session.get('binding');
    if(!binding||!equal(binding.identity,pack.binding)||!equal(binding.libraryIds,pack.options.libraryIds))return{status:'stale_target',message:'当前会话未绑定此资料范围'};
    const current=actualIdentity(target);
    const errors=validatePack(state,pack,{libraryIds:binding.libraryIds,scope:pack.options.scope,asOf:pack.options.asOf,binding:current});
    if(errors.length)return{status:'stale_pack',message:errors.join('；')};
    const operationId=id('operation');
    await changeSession(generation,()=>chrome.storage.session.set({lastDraft:{operationId,packId:pack.id,status:'pending',identity:current}}));
    const active=await currentTab();
    if(generation!==accessGeneration||active?.id!==current.tabId)return{status:'stale_target',message:'写入前活动标签页或资料绑定已改变，已停止'};
    const result=await pageCall(current.tabId,{action:'insert',identity:current,draftHash:message.draftHash,text:pack.text,packId:pack.id,operationId},current.documentId,()=>generation===accessGeneration);
    await changeSession(generation,()=>chrome.storage.session.set({lastDraft:{operationId:result.operationId||operationId,packId:pack.id,status:result.status,identity:current}}));
    await repository.mutate(s=>s.events.push({id:id('event'),type:'draft_write',objectId:pack.id,result:result.status,at:now()}));
    return result;
  }
  if(message.type==='UNDO'){
    const generation=accessGeneration;
    const {lastDraft}=await chrome.storage.session.get('lastDraft');if(!lastDraft||!['written','already_present'].includes(lastDraft.status))return{status:'unsupported',message:'没有可以确认的本次写入；未确认操作不会自动重放'};
    const tab=await currentTab();if(generation!==accessGeneration||tab?.id!==lastDraft.identity.tabId)return{status:'stale_target',message:'活动标签页或资料绑定已切换'};
    const result=await pageCall(tab.id,{action:'undo',identity:lastDraft.identity,operationId:lastDraft.operationId},lastDraft.identity.documentId,()=>generation===accessGeneration);
    if(result.status==='undone')await changeSession(generation,()=>chrome.storage.session.remove('lastDraft'));return result;
  }
  throw Error('不允许的请求类型');
}
export function actualIdentity(snapshot){return Object.fromEntries(['tabId','documentId','url','pageKey','conversation','temporary','adapter','adapterVersion'].map(k=>[k,snapshot[k]]));}
async function authorizeFloating(message,sender,hello=false){
  const record=await floatingSessions.authorize(message,sender,{hello});
  // Only background injection may update the shell's accepted page URL.
  const result=await shellCall(record,'accept_url');
  if(result?.status!=='accepted'&&message.type!=='CLOSE_FLOATING'){
    if(result?.status==='unavailable')await floatingSessions.close({tabId:record.tabId,token:record.token});
    throw floatingFailure(result,'网页浮窗已关闭或连接已变化，请从当前网页重新打开');
  }
  return record;
}
async function sendFromFloating(message,sender,record){
  if(pageWriteRunning||liveTestRunning)return{status:'busy',message:'另一项网页操作尚未完成，请稍候'};
  pageWriteRunning=true;const generation=accessGeneration;let attempt,pageAttempted=false;
  try{
    const actual=await snapshot(()=>generation===accessGeneration);
    if(actual.status!=='ready')return actual;
    if(!equal(actualIdentity(actual),message.identity))return{status:'not_sent',message:'网页已变化，尚未发送，请重新连接'};
    let state=await repository.snapshot();const round=activeRound(state,state.packs.find(item=>item.id===message.packId)?.memoryTask?.id),pack=state.packs.find(item=>item.id===message.packId);
    if(!pack?.memoryTask||round?.packSnapshot.id!==pack.id)return{status:'not_sent',message:'当前任务资料已变化，尚未发送'};
    const {binding}=await chrome.storage.session.get('binding');
    if(!binding||!equal(binding.identity,message.identity)||!equal(binding.libraryIds,pack.options.libraryIds))return{status:'not_sent',message:'网页或任务范围未连接，尚未发送'};
    const errors=validatePack(state,pack,{...pack.options,binding:message.identity,memoryTaskId:pack.memoryTask.id});
    if(errors.length)return{status:'not_sent',message:errors.join('；')};
    const destinationOrigin=new URL(message.identity.url).origin,prior=await sendLedger.lookup({packId:pack.id,url:message.identity.url});
    if(prior&&prior.status!=='not_sent')return{status:prior.status==='send_invoked'?'send_invoked':'send_uncertain',attemptId:prior.attemptId,destinationOrigin,duplicate:true,message:'这份资料在当前网站已有发送记录，未再次点击发送；请等待或读取原网页回复。'};
    if(actual.draft!==pack.text)return{status:'not_sent',message:'网页草稿含手动内容或与本轮资料不同，尚未发送；请先核对原网页草稿'};
    record=await authorizeFloating(message,sender);
    const started=await sendLedger.begin({packId:pack.id,taskId:pack.memoryTask.id,identity:message.identity,draftHash:actual.draftHash,retainedPackIds:[...state.packs.map(row=>row.id),...state.rounds.map(row=>row.packSnapshot.id)]});attempt=started.attempt;
    if(started.duplicate)return{status:attempt.status==='send_invoked'?'send_invoked':'send_uncertain',attemptId:attempt.attemptId,destinationOrigin,duplicate:true,message:'这份资料在当前网站已有发送记录，未再次点击发送。请等待或读取原网页回复。'};
    state=await repository.snapshot();
    if(generation!==accessGeneration||!equal(state.packs.find(item=>item.id===pack.id),pack)||activeRound(state,pack.memoryTask.id)?.packSnapshot.id!==pack.id)throw Error('发送前资料或授权已变化，尚未点击发送');
    await authorizeFloating(message,sender);
    await floatingSessions.allowSentTransition({tabId:record.tabId,token:record.token,fromUrl:record.url,documentId:record.documentId,attemptId:attempt.attemptId,packId:pack.id});
    const finalBinding=(await chrome.storage.session.get('binding')).binding,finalState=await repository.snapshot(),finalRound=activeRound(finalState,pack.memoryTask.id);
    const finalErrors=validatePack(finalState,pack,{...pack.options,binding:message.identity,memoryTaskId:pack.memoryTask.id});
    if(generation!==accessGeneration||!equal(finalBinding,binding)||!equal(finalState.packs.find(item=>item.id===pack.id),pack)||finalRound?.id!==round.id||finalRound.version!==round.version||finalErrors.length)throw Error('发送前任务、规则或资料已变化，未点击发送；请重新准备当前问题');
    pageAttempted=true;
    const result=await pageCall(record.tabId,{action:'send',identity:message.identity,packId:pack.id,text:pack.text,draftHash:actual.draftHash,attemptId:attempt.attemptId},record.documentId,()=>generation===accessGeneration);
    const noClick=['not_sent','unsupported','busy','stale_target','composition_active','unresolved_write','invalid_input'].includes(result.status);
    const sameDocument=result.tabId===record.tabId&&result.documentId===record.documentId;
    const status=noClick?'not_sent':result.status==='send_invoked'&&sameDocument?'send_invoked':'send_uncertain';
    await sendLedger.finish({packId:pack.id,attemptId:attempt.attemptId,status,draftCleared:result.draftCleared===true});
    if(status==='not_sent')await floatingSessions.clearSentTransition({tabId:record.tabId,token:record.token,attemptId:attempt.attemptId});
    return{status,attemptId:attempt.attemptId,destinationOrigin,draftCleared:result.draftCleared===true,message:result.message||(status==='send_invoked'?'已点击网页发送，正在等待回复。':status==='not_sent'?'未能发送，请查看连接状态。':'发送结果不确定，未自动重发；请核对原网页或读取回复。')};
  }catch(error){
    if(attempt&&!pageAttempted){await sendLedger.finish({packId:attempt.packId,attemptId:attempt.attemptId,status:'not_sent'}).catch(()=>{});await floatingSessions.clearSentTransition({tabId:record.tabId,token:record.token,attemptId:attempt.attemptId}).catch(()=>{});}
    return{status:pageAttempted?'send_uncertain':'not_sent',...(attempt?{attemptId:attempt.attemptId}:{}),message:pageAttempted?'发送结果无法确认，已停止重发；请核对原网页或读取回复。':error.message};
  }finally{pageWriteRunning=false;}
}
chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
  const trusted=trustedSender(sender,chrome.runtime.id,chrome.runtime.getURL(''));
  if(!message||typeof message.type!=='string'||JSON.stringify(message).length>(message.type==='SAVE_CHAT_VIEW'?600000:120000)){sendResponse({status:'rejected',message:'只接受扩展可信面板的有限请求'});return false;}
  if(trusted){handle(message).then(sendResponse).catch(error=>sendResponse({status:'error',message:error.message}));return true;}
  if(typeof message.floatingToken!=='string'){sendResponse({status:'rejected',message:'只接受已授权浮窗或扩展可信面板的请求'});return false;}
  (async()=>{
    const record=await authorizeFloating(message,sender,message.type==='FLOATING_HELLO');
    if(message.type==='FLOATING_HELLO')return{status:'authorized'};
    if(message.type==='CLOSE_FLOATING'){await floatingSessions.close({tabId:record.tabId,token:record.token});await shellCall(record,'close').catch(()=>{});return{status:'closed'};}
    if(message.type==='SEND_PACK'){
      const result=await sendFromFloating(message,sender,record);
      try{await authorizeFloating(message,sender);}catch{return{...result,connectionPending:true};}
      return result;
    }
    const result=await handle(message);
    // Opening the manager deliberately changes the active page. All other
    // replies must still belong to this authorized frame after async work.
    if(message.type!=='OPEN_MANAGER')await authorizeFloating(message,sender);
    return result;
  })().then(sendResponse).catch(error=>sendResponse({status:error.code==='floating_transition_pending'?'waiting':'rejected',reason:error.code,message:error.message}));return true;
});
chrome.tabs.onRemoved?.addListener(tabId=>{void floatingSessions.close({tabId}).catch(()=>{});});
chrome.commands.onCommand.addListener(command=>{
  if(command==='run-site-self-test')void testCurrentSite().catch(error=>chrome.storage.local.set({lastSiteSelfTest:{status:'error',message:error.message}}));
});
