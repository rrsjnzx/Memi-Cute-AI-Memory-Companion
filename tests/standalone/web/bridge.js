/* Standalone test transport. Local originals only: this is not an extension
 * permission implementation and it never contacts an AI provider. Business
 * stores, pack validation and reply validation are the unchanged product code. */
import {Repository} from '../product/storage.js';
import {id,now,equal} from '../product/core/base.js';
import {validatePack} from '../product/core/pack.js';
import {activeRound,resumeRound} from '../product/core/rounds.js';
import {validateInboxReply} from '../product/core/reply-inbox.js';
import {rejectedReplyBlock} from '../product/core/rejected-reply.js';
import {createChatViewStore} from '../product/core/chat-view.js';
import {createReplyDraftStore} from '../product/core/reply-drafts.js';
import {createSendLedger} from '../product/core/send-ledger.js';
import {runFunctionalCheck} from '../product/core/functional-check.js';
import {runLiveCheck} from '../product/core/live-check.js';
import {createLocalFeedbackHost} from './local-feedback.js';

const PREFIX='text-memory-web-test-0.12.1:';
const copy=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
const root=window.top;
if(root.location.origin!==location.origin)throw Error('测试桥只允许同源本地页面');
if(!root.__tmLocalFeedbackBridge)root.__tmLocalFeedbackBridge=createLocalFeedbackHost(root);
// Shared same-origin bus substitutes chrome.storage.onChanged in this test host.
const storageListeners=root.__tmLocalStorageListeners||(root.__tmLocalStorageListeners=new Set());
const ownStorageListeners=new Set();
globalThis.addEventListener?.('pagehide',()=>{for(const listener of ownStorageListeners)storageListeners.delete(listener);ownStorageListeners.clear();},{once:true});
function emitStorageChanges(changes,area){if(!Object.keys(changes).length)return;queueMicrotask(()=>{for(const listener of [...storageListeners]){try{listener(copy(changes),area);}catch{}}});}
const identity=value=>Object.fromEntries(['tabId','documentId','url','pageKey','conversation','temporary','adapter','adapterVersion'].map(key=>[key,value?.[key]]));
const assertion=(condition,message)=>{if(!condition)throw Error(message);};
function host(){const value=root.__tmWebHost;assertion(value,'本地模拟网页尚未就绪，请稍候重试');return value;}

function storageArea(area){
  const prefix=PREFIX+area+':';
  const read=key=>{const raw=root.localStorage.getItem(prefix+key);return raw===null?undefined:JSON.parse(raw);};
  return{
    async get(keys){
      const result={};
      const names=keys==null?Object.keys(root.localStorage).filter(key=>key.startsWith(prefix)).map(key=>key.slice(prefix.length)):typeof keys==='string'?[keys]:Array.isArray(keys)?keys:Object.keys(keys);
      for(const key of names){const value=read(key);if(value!==undefined)result[key]=value;else if(keys&&typeof keys==='object'&&!Array.isArray(keys)&&Object.hasOwn(keys,key))result[key]=copy(keys[key]);}
      return result;
    },
    async set(values){
      assertion(values&&typeof values==='object'&&!Array.isArray(values),'测试存储写入格式无效');
      // Pre-serialize before changing any key; the product stores each CAS
      // envelope in one key so a quota failure cannot half-write its envelope.
      const entries=Object.entries(values).map(([key,value])=>[key,JSON.stringify(value)]);
      const changes={};for(const [key,value] of entries){const oldValue=read(key),newValue=JSON.parse(value);if(JSON.stringify(oldValue)!==value)changes[key]={oldValue,newValue};}
      for(const [key,value] of entries){assertion(value!==undefined,'不支持存储 undefined');root.localStorage.setItem(prefix+key,value);}
      emitStorageChanges(changes,area);
    },
    async remove(keys){for(const key of typeof keys==='string'?[keys]:keys)root.localStorage.removeItem(prefix+key);},
    async clear(){for(const key of Object.keys(root.localStorage))if(key.startsWith(prefix))root.localStorage.removeItem(key);},
    async setAccessLevel(){/* No extension contexts exist in this test host. */},
  };
}
const local=storageArea('local'),session=storageArea('session');

function cleanStatus(result){
  const value={status:typeof result?.status==='string'?result.status:'invalid_reply'};
  for(const key of ['message','reason'])if(typeof result?.[key]==='string')value[key]=result[key].slice(0,1000);
  if(Number.isFinite(result?.retryAfterMs)&&result.retryAfterMs>=0)value.retryAfterMs=result.retryAfterMs;
  return value;
}
function displayOf(result){
  const value=result?.display;
  if(!['reply_ready','waiting','invalid_reply','ambiguous'].includes(result?.status)||!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==4||!['text','phase','pairing','messageKey'].every(key=>Object.hasOwn(value,key)))return null;
  if(typeof value.text!=='string'||!value.text.trim()||value.text.length>100000||!['streaming','settling','stable'].includes(value.phase)||!['protocol','user_pack'].includes(value.pairing)||typeof value.messageKey!=='string'||!value.messageKey.trim()||value.messageKey.length>500)return null;
  return copy(value);
}
function diagnosticOf(result,expected){
  const value=result?.diagnostic;
  if(result?.status!=='invalid_reply'||result.reason!=='invalid_json'||!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==4||!['text','phase','pairing','messageKey'].every(key=>Object.hasOwn(value,key)))return null;
  if(value.phase!=='stable'||value.pairing!=='user_pack'||typeof value.messageKey!=='string'||!value.messageKey.trim()||value.messageKey.length>500)return null;
  const block=rejectedReplyBlock(value.text,expected);if(!block||block.text!==value.text)return null;
  return{text:block.text,phase:'stable',pairing:'user_pack',messageKey:value.messageKey};
}
function sourceOf(source){
  const clean=Object.fromEntries(['adapter','author','selector','sourceEvidence','messageKey'].filter(key=>typeof source[key]==='string').map(key=>[key,source[key].slice(0,500)]));
  const check=source.generationCheck,allowed=['data-is-streaming','data-streaming','aria-busy','data-perf-row-streaming'];
  if(check&&['explicit_false','no_observed_busy_signal'].includes(check.basis)&&Array.isArray(check.attributes)&&check.attributes.length<=4&&new Set(check.attributes).size===check.attributes.length&&check.attributes.every(name=>allowed.includes(name))&&check.stableSamples===2&&check.minIntervalMs===1000&&(check.basis==='explicit_false'?check.attributes.length>0:check.attributes.length===0))clean.generationCheck={basis:check.basis,attributes:[...check.attributes],stableSamples:2,minIntervalMs:1000};
  return clean;
}
function receiptState(state,expected,binding){
  assertion(expected&&typeof expected==='object'&&!Array.isArray(expected)&&Object.keys(expected).length===3&&['taskId','baseVersion','packId'].every(key=>Object.hasOwn(expected,key))&&typeof expected.taskId==='string'&&expected.taskId.trim()&&expected.taskId.length<=200&&typeof expected.packId==='string'&&expected.packId.trim()&&expected.packId.length<=199&&Number.isSafeInteger(expected.baseVersion)&&expected.baseVersion>=1,'网页回执的任务、版本或资料包 ID 无效');
  const task=state.tasks.find(row=>row.id===expected.taskId),round=activeRound(state,expected.taskId);
  assertion(task&&task.version===expected.baseVersion&&round&&round.baseVersion===expected.baseVersion&&round.packSnapshot.id===expected.packId,'任务或轮次资料包已改变，旧回复不能写入记忆');
  assertion(binding.libraryIds.includes(task.libraryId),'模拟网页未绑定当前任务所属库');
  resumeRound(state,round.id);
  return{roundId:round.id,roundVersion:round.version,packId:round.packSnapshot.id};
}

function createService(){
  const repository=new Repository();
  const chatViews=createChatViewStore({local,repository});
  const replyDrafts=createReplyDraftStore({local,repository});
  const sendLedger=createSendLedger({local});
  let pageWriteRunning=false,functionalRunning=false,siteTestRunning=false,accessGeneration=0;
  const target=async()=>copy(await host().target());
  const pageCall=async request=>copy(await host().pageCall(copy(request)));
  const report=event=>{host().log?.('测试桥操作',{at:now(),boundary:'local_simulation',...event});};
  async function readLatestReply(message){
    const generation=accessGeneration,{binding}=await session.get('binding');
    if(!binding||!binding.libraryIds?.length||!equal(binding.identity,message.identity))return{status:'stale_target',message:'请先连接本地模拟网页与任务资料库'};
    let receipt;try{receipt=receiptState(await repository.snapshot(),message.expected,binding);}catch(error){return{status:'stale_reply',message:error.message};}
    const before=await target();if(before.status!=='ready'||!equal(identity(before),binding.identity))return{status:'stale_target',message:'本地模拟页面已改变'};
    const result=await pageCall({action:'read_latest_reply',identity:binding.identity,expected:message.expected,...(message.includeDisplay===true?{includeDisplay:true}:{})});
    const state=await repository.snapshot(),current=(await session.get('binding')).binding,after=await target();
    if(generation!==accessGeneration||!equal(current,binding)||!equal(identity(after),binding.identity))return{status:'stale_target',message:'读取期间连接已改变，已丢弃内容'};
    try{assertion(equal(receiptState(state,message.expected,binding),receipt),'读取期间轮次已改变');}catch(error){return{status:'stale_reply',message:error.message};}
    const display=message.includeDisplay===true&&activeRound(state,message.expected.taskId)?.status==='delivered'?displayOf(result):null;
    const diagnostic=message.includeDisplay===true&&activeRound(state,message.expected.taskId)?.status==='delivered'?diagnosticOf(result,message.expected):null;
    if(result.status!=='reply_ready'){
      if(!display&&!diagnostic)return cleanStatus(result);
      if(!equal(identity(result),binding.identity))return{status:'stale_target',message:'回复不属于当前模拟文档'};
      return{...cleanStatus(result),...identity(result),...(display?{display}:{}),...(diagnostic?{diagnostic}:{})};
    }
    if(!equal(identity(result),binding.identity))return{status:'stale_target',message:'回执不属于当前模拟文档'};
    if(typeof result.text!=='string'||!result.text.trim()||result.text.length>100000||Object.hasOwn(result,'answerText')&&(typeof result.answerText!=='string'||result.answerText.length>100000))return{status:'invalid_reply',message:'回执正文无效或过长'};
    try{
      const round=activeRound(state,message.expected.taskId),checked=validateInboxReply(state,message.expected.taskId,result.text,{...round.packSnapshot.options,libraryIds:binding.libraryIds});
      assertion(checked.taskId===message.expected.taskId&&checked.baseVersion===message.expected.baseVersion&&checked.packId===message.expected.packId&&checked.kind.toUpperCase()===result.kind,'回执身份与当前轮次不一致');
    }catch(error){return{status:'invalid_reply',message:error.message};}
    const clean={...cleanStatus(result),...identity(result),text:result.text,kind:result.kind,...(display?{display}:{})};
    if(typeof result.answerText==='string')clean.answerText=result.answerText;
    if(typeof result.fingerprint==='string'&&/^[a-f0-9]{64}$/.test(result.fingerprint))clean.fingerprint=result.fingerprint;
    if(Number.isFinite(result.stableForMs)&&result.stableForMs>=0)clean.stableForMs=result.stableForMs;
    if(result.source&&typeof result.source==='object')clean.source=sourceOf(result.source);
    if(typeof result.note==='string')clean.note=result.note.slice(0,1000);
    return clean;
  }
  async function insert(message){
    const generation=accessGeneration,before=await target();if(before.status!=='ready')return before;
    const state=await repository.snapshot(),pack=state.packs.find(row=>row.id===message.packId);assertion(pack,'资料包不存在');
    const {binding}=await session.get('binding');
    if(!binding||!equal(binding.identity,pack.binding)||!equal(binding.libraryIds,pack.options.libraryIds))return{status:'stale_target',message:'当前模拟会话未绑定此资料范围'};
    const current=identity(before),errors=validatePack(state,pack,{...pack.options,binding:current});
    if(errors.length)return{status:'stale_pack',message:errors.join('；')};
    if(generation!==accessGeneration)return{status:'stale_target',message:'写入前连接已改变'};
    const operationId=id('web_operation');await session.set({lastDraft:{operationId,packId:pack.id,status:'pending',identity:current}});
    const result=await pageCall({action:'insert',identity:current,draftHash:message.draftHash,text:pack.text,packId:pack.id,operationId});
    if(generation===accessGeneration)await session.set({lastDraft:{operationId:result.operationId||operationId,packId:pack.id,status:result.status,identity:current}});
    await repository.mutate(state=>state.events.push({id:id('event'),type:'draft_write',objectId:pack.id,result:result.status,at:now()}));
    report({type:'draft_write',status:result.status});return result;
  }
  async function send(message){
    let attempt,pageAttempted=false;const generation=accessGeneration;
    try{
      const before=await target();if(before.status!=='ready')return before;
      if(!equal(identity(before),message.identity))return{status:'not_sent',message:'模拟页面已变化，尚未发送'};
      let state=await repository.snapshot();const pack=state.packs.find(row=>row.id===message.packId),round=pack?.memoryTask&&activeRound(state,pack.memoryTask.id);
      if(!pack?.memoryTask||round?.packSnapshot.id!==pack.id)return{status:'not_sent',message:'当前任务资料已变化'};
      const {binding}=await session.get('binding');
      if(!binding||!equal(binding.identity,message.identity)||!equal(binding.libraryIds,pack.options.libraryIds))return{status:'not_sent',message:'模拟网页或任务范围未连接'};
      const errors=validatePack(state,pack,{...pack.options,binding:message.identity,memoryTaskId:pack.memoryTask.id});if(errors.length)return{status:'not_sent',message:errors.join('；')};
      const destinationOrigin=new URL(message.identity.url).origin,prior=await sendLedger.lookup({packId:pack.id,url:message.identity.url});
      if(prior&&prior.status!=='not_sent')return{status:prior.status==='send_invoked'?'send_invoked':'send_uncertain',attemptId:prior.attemptId,destinationOrigin,duplicate:true,message:'已有本地模拟发送记录，未重复点击'};
      if(before.draft!==pack.text)return{status:'not_sent',message:'本地模拟草稿与本轮资料不一致'};
      assertion(await host().authorizeFloating(message.floatingToken),'测试浮窗未连接');
      const started=await sendLedger.begin({packId:pack.id,taskId:pack.memoryTask.id,identity:message.identity,draftHash:before.draftHash,retainedPackIds:[...state.packs.map(row=>row.id),...state.rounds.map(row=>row.packSnapshot.id)]});attempt=started.attempt;
      if(started.duplicate)return{status:attempt.status==='send_invoked'?'send_invoked':'send_uncertain',attemptId:attempt.attemptId,destinationOrigin,duplicate:true};
      state=await repository.snapshot();const finalBinding=(await session.get('binding')).binding,finalRound=activeRound(state,pack.memoryTask.id),finalTarget=await target();
      const finalErrors=validatePack(state,pack,{...pack.options,binding:message.identity,memoryTaskId:pack.memoryTask.id});
      assertion(generation===accessGeneration&&equal(binding,finalBinding)&&equal(identity(finalTarget),message.identity)&&equal(state.packs.find(row=>row.id===pack.id),pack)&&finalRound?.id===round.id&&finalRound?.version===round.version&&!finalErrors.length,'发送前任务、资料或连接已改变');
      assertion(await host().authorizeFloating(message.floatingToken),'测试浮窗已关闭');
      pageAttempted=true;
      const result=await pageCall({action:'send',identity:message.identity,packId:pack.id,text:pack.text,draftHash:before.draftHash,attemptId:attempt.attemptId});
      const noClick=['not_sent','unsupported','busy','stale_target','composition_active','unresolved_write','invalid_input'].includes(result.status),sameDocument=result.tabId===message.identity.tabId&&result.documentId===message.identity.documentId;
      const status=noClick?'not_sent':result.status==='send_invoked'&&sameDocument?'send_invoked':'send_uncertain';
      await sendLedger.finish({packId:pack.id,attemptId:attempt.attemptId,status,draftCleared:result.draftCleared===true});
      report({type:'send',status,packId:pack.id});
      return{status,attemptId:attempt.attemptId,destinationOrigin,draftCleared:result.draftCleared===true,message:result.message||'本地模拟发送完成；没有联系任何 AI 网站'};
    }catch(error){
      if(attempt&&!pageAttempted)await sendLedger.finish({packId:attempt.packId,attemptId:attempt.attemptId,status:'not_sent'}).catch(()=>{});
      return{status:pageAttempted?'send_uncertain':'not_sent',...(attempt?{attemptId:attempt.attemptId}:{}),message:error.message};
    }
  }
  async function handle(message){
    if(typeof message?.type!=='string'||JSON.stringify(message).length>(message.type==='SAVE_CHAT_VIEW'?600000:120000))return{status:'rejected',message:'测试请求类型或长度无效'};
    if(message.floatingToken!==undefined&&!await host().authorizeFloating(message.floatingToken))return{status:'rejected',message:'本地浮窗已关闭或未连接，请重新打开'};
    if(message.type==='FLOATING_HELLO')return message.floatingToken?{status:'authorized',simulation:true}:{status:'rejected',message:'缺少本地浮窗连接标识'};
    if(message.type==='OPEN_FLOATING')return host().openFloating();
    if(message.type==='FLOATING_STATUS')return host().floatingStatus(message.floating);
    if(message.type==='CLOSE_FLOATING')return host().closeFloating(message.floatingToken);
    if(message.type==='OPEN_MANAGER'){await host().openManager();return{status:'opened'};}
    if(message.type==='SAVE_REPLY_DRAFT')return{status:'saved',record:await replyDrafts.save(message.payload)};
    if(message.type==='LOAD_CHAT_VIEW')return{status:'loaded',view:await chatViews.load(message.payload)};
    if(message.type==='SAVE_CHAT_VIEW')return{status:'saved',view:await chatViews.save(message.payload)};
    if(message.type==='LIST_REPLY_DRAFTS')return{status:'listed',records:await replyDrafts.list(message.payload)};
    if(message.type==='CLAIM_REPLY_DRAFT')return{status:'claimed',record:await replyDrafts.claim(message.payload)};
    if(message.type==='SETTLE_REPLY_DRAFT')return{status:'settled',record:await replyDrafts.settle(message.payload)};
    if(message.type==='TARGET')return target();
    if(message.type==='PAUSE'){accessGeneration++;await session.set({binding:null,lastDraft:null});return{status:'paused'};}
    if(message.type==='BIND'){
      const generation=++accessGeneration,actual=await target();if(actual.status!=='ready')return actual;
      if(!equal(identity(actual),message.identity))return{status:'stale_target',message:'模拟页面已改变，请重新读取'};
      const state=await repository.snapshot();assertion(Array.isArray(message.libraryIds)&&message.libraryIds.every(key=>state.libraries.some(row=>row.id===key)),'库选择无效');
      if(generation!==accessGeneration)return{status:'stale_target',message:'绑定期间连接已变化'};
      const binding={identity:identity(actual),libraryIds:[...message.libraryIds].sort()};await session.set({binding});return{status:'bound',binding};
    }
    if(message.type==='READ_LATEST_REPLY')return readLatestReply(message);
    if(message.type==='READ_SELECTION'){
      const generation=accessGeneration;
      const {binding}=await session.get('binding');if(!binding||!binding.libraryIds?.length||!equal(binding.identity,message.identity))return{status:'stale_target',message:'请先绑定模拟页面'};
      const before=await target();if(!equal(identity(before),binding.identity))return{status:'stale_target',message:'模拟页面已变化'};
      const result=await pageCall({action:'read_selection',identity:message.identity});if(result.status!=='selected')return cleanStatus(result);
      const after=await target(),current=(await session.get('binding')).binding;
      if(generation!==accessGeneration||!equal(binding,current)||!equal(identity(after),binding.identity)||!equal(identity(result),binding.identity))return{status:'stale_target',message:'读取期间连接已变化，已丢弃选区'};
      if(typeof result.text!=='string'||!result.text.trim()||result.text.length>100000)return{status:'invalid_selection',message:'选区为空或超过长度限制'};
      return{...cleanStatus(result),...identity(result),text:result.text};
    }
    if(['INSERT','UNDO','SEND_PACK'].includes(message.type)){
      if(pageWriteRunning)return{status:'busy',message:'另一次模拟草稿操作尚未结束'};pageWriteRunning=true;
      try{
        if(message.type==='INSERT')return await insert(message);
        if(message.type==='SEND_PACK'){assertion(message.floatingToken,'模拟发送只接受当前浮窗');return await send(message);}
        const {lastDraft}=await session.get('lastDraft');if(!lastDraft||!['written','already_present'].includes(lastDraft.status))return{status:'unsupported',message:'没有可以确认的本次写入'};
        const result=await pageCall({action:'undo',identity:lastDraft.identity,operationId:lastDraft.operationId});if(result.status==='undone')await session.remove('lastDraft');return result;
      }finally{pageWriteRunning=false;}
    }
    if(message.type==='FUNCTIONAL_TEST'){
      if(functionalRunning)return{status:'busy',message:'本地功能验收尚未结束'};functionalRunning=true;
      try{const result=await runFunctionalCheck({createRepository:name=>new Repository(name)});result.environment='standalone_local_browser';result.note+=' 本次运行在独立 localhost 页面，不代表安装扩展或真实模型验收。';await local.set({lastFunctionalTest:result});return result;}finally{functionalRunning=false;}
    }
    if(message.type==='SELF_TEST'){
      if(siteTestRunning||pageWriteRunning)return{status:'busy',message:'本地自检或草稿操作尚未结束'};siteTestRunning=true;pageWriteRunning=true;
      try{const first=await target(),result=await runLiveCheck({repository:new Repository('text-memory-web-isolated-live-tests'),first,identity:identity(first),call:pageCall});result.environment='standalone_mock_dom';result.site='local_mock';result.note+=' 这是原创本地模拟 DOM，不代表真实网站兼容性。';await local.set({lastSiteSelfTest:result});return result;}finally{siteTestRunning=false;pageWriteRunning=false;}
    }
    if(message.type==='LAST_FUNCTIONAL_TEST')return(await local.get('lastFunctionalTest')).lastFunctionalTest||{status:'not_run'};
    if(message.type==='LAST_SELF_TEST')return(await local.get('lastSiteSelfTest')).lastSiteSelfTest||{status:'not_run'};
    if(['PREPARE_RESTART_CHECK','VERIFY_RESTART_CHECK','LAST_RESTART_CHECK'].includes(message.type))return{status:'unsupported',message:'独立网页无法观察扩展 runtime.onStartup；请使用普通页面重载验收持久化，不能冒充浏览器重启验收'};
    return{status:'unsupported',message:'独立测试桥尚未实现此请求：'+message.type};
  }
  return{
    async dispatch(message){try{return copy(await handle(copy(message)));}catch(error){return{status:'error',message:error.message||String(error)};}},
    local,session,
    async inspect(){const state=await repository.snapshot();return{environment:'local_simulation',counts:Object.fromEntries(Object.entries(state).map(([table,rows])=>[table,rows.length])),tasks:state.tasks.map(({id,name,version,goal,progress,coreEntryIds})=>({id,name,version,goal,progress,coreEntryIds})),rounds:state.rounds.map(({id,taskId,status,baseVersion,version})=>({id,taskId,status,baseVersion,version}))};},
  };
}

if(!root.__tmWebBridge)root.__tmWebBridge=createService();
// Conversion at both boundaries keeps own-realm plain-object checks identical
// to extension messages, even when an iframe calls the shared top-level store.
window.chrome={
  runtime:{
    id:'text-memory-web-test',
    connect(options){return root.__tmLocalFeedbackBridge.connect(window,options);},
    getURL:path=>new URL('../product/'+String(path||''),import.meta.url).href,
    async sendMessage(message){return copy(await root.__tmWebBridge.dispatch(copy(message)));},
    async openOptionsPage(){return host().openManager();},
  },
  storage:{local,session,onChanged:{addListener(listener){ownStorageListeners.add(listener);storageListeners.add(listener);},removeListener(listener){ownStorageListeners.delete(listener);storageListeners.delete(listener);}}},
  permissions:{async request(options){const allowed=root.document.getElementById('simulateSiteGrant')?.checked===true;host().log('站点连接模拟',{origins:options.origins,allowed,boundary:'local_simulation',realNavigation:false});return allowed;},async contains(){return root.document.getElementById('simulateSiteGrant')?.checked===true;}},
  tabs:{async query(){return[];},async create(options){host().log('模拟打开站点',{url:options.url,boundary:'local_simulation',realNavigation:false,sends:0});return{id:101};},async update(id){return{id};}},
};
window.__TEXT_MEMORY_STANDALONE_TEST__=true;
