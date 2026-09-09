import {Repository} from './storage.js';
import {id,now,clone,norm,equal,hash,requireThat} from './core/base.js';
import {createLibrary,entryErrors,templateFor,saveTemplate,setLifecycle,resolveConflict,deletionPreview,deleteEntry,migrationPreview,migrateEntries,event} from './core/library.js';
import {retrieve,reasons} from './core/retrieval.js';
import {buildPack,validatePack,rememberPack,diagnosePack} from './core/pack.js';
import {validateRule,checkStructured,diagnose} from './core/checks.js';
import {exportBackup,preflightBackup,prepareText,prepareRows,preflightExchange} from './core/imports.js';
import {demoText,populateDemo} from './core/demo.js';
import {describeLiveCheck} from './core/live-check.js';
import {supportedSites} from './core/sites.js';
import {renderBusinessFields,readBusinessFields,templateKey,editorTemplates} from './core/ui-fields.js';
import {revisionGate,importSession,requireImportLibrary,commitPreparedImport,captureEntryEdit,persistEntryEdit} from './core/ui-workflows.js';
import {saveTask,taskById,taskSelection} from './core/tasks.js';
import {describeCoreEligibility,addQuickMemory,createWorkspaceTask} from './core/workspace.js';
import {prepareMemoryUpdate,applyMemoryUpdate} from './core/memory-updates.js';
import {executeMemorySearch} from './core/memory-requests.js';
import {activeRound,prepareRound,resumeRound,markRoundDelivered,replaceRoundPack,validateRoundUpdate,completeRound,abandonRound,closedRoundsPreview,clearClosedRounds} from './core/rounds.js';
import {clipboardPack,retargetPack} from './core/delivery.js';
import {createReplyInbox,validateInboxReply} from './core/reply-inbox.js';
import {inspectMemoryReply} from './core/protocol.js';
import {reuseUnchangedRoundPack,refreshTaskRound} from './core/round-workflow.js';
import {browseEntries,browserFacets,entryExcerpt} from './core/library-browser.js';
import {prepareEntryBatch,applyEntryBatch} from './core/bulk-entries.js';
import {browseSources,sourceDetails,readingSourceSlice} from './core/source-browser.js';
import {createSourceExtraction,nextExtractionOffset} from './core/source-extraction.js';
import {inspectSourceCoverage} from './core/source-coverage.js';
import {activeExtractionQueue,completeQueuedSlice,pauseExtractionQueue,cancelExtractionQueue} from './core/extraction-queue.js';
import {browseExtractionCandidates,prepareCandidateReview,applyCandidateReview} from './core/candidate-review.js';
import {previewTaskHandoff,prepareTaskHandoff} from './core/handoff.js';
import {connectSite,connectionSite,SITE_PREFERENCE_KEY} from './site-connection.js';
import {mountSitePicker,applySiteTheme,normalizeSite} from './site-theme.js';

const $=selector=>document.querySelector(selector);
const repository=new Repository();let state,selectedEntry=null,editorToken=0,templateId=null,templateVersion=null,templateDraft=[],enabled=[],selected=new Set(),pinned=new Set(),retrieved=null,pack=null,target=null,binding=null,draftResult=null,checkRun=null,tab='memory',pendingLibrarySelection=null;
const refreshGate=revisionGate(),editorGate=revisionGate(),packGate=revisionGate(),imports=importSession();
let pendingDetailRefresh=null,refreshRead=Promise.resolve();
let noticeScope='general',noticeRevision=0;
let activeMemoryTaskId='',memoryEditorVersion=null,memoryDirty=false,memoryBusy=false,memoryPreview=null,memoryGeneration=0;
let memoryCoreDraft=new Set(),memoryAppliedCore=new Set();
const quickMemoryDrafts=new Map(),QUICK_MEMORY_DRAFT_LIMITS={tasks:64,characters:12000};let quickMemoryTaskId='';
const libraryViews=new Map(),entryBatchSelection=new Set();
let browserLibrary=null,entryPage=1,entryResult=null,entryBatchPreview=null,entryBatchBusy=false,entryBatchEpoch=0,corePage=1,corePageKey='';
let entryEditorBaseline='';
let entryBrowserMode='entries',sourcePage=1,selectedSource='',sourceOffset=0,sourceEntryPage=1,sourceBackOffsets=[],reviewQueue=null;
let sourceExtractionBusy=false;
let sourceCoverageView=null;
let sitePicker=null,siteConnectionBusy=false,handoffPreview=null,handoffEpoch=0,handoffTaskKey='';
let candidatePage=1,candidatePreview=null,candidateBusy=false,candidateEpoch=0;
const candidateSelection=new Set();
const browserControls=['#entry-search','#entry-source','#entry-kind','#entry-tag','#entry-filter','#entry-sort','#entry-page-size'];
const kindLabels={fact:'事实',entity:'对象',rule:'用户约束',event:'事件',preference:'偏好',note:'笔记'};
let memoryPreferenceWrite=Promise.resolve();
let memoryPreviewRound=null;
let lastPackFailure=null,feedbackSequence=0;
const buttonFeedback=new WeakMap();
const replyInbox=createReplyInbox();
let replyEpoch=0,replySession=null,replyAuto=false,replyTimer=null;
let replyBuffer=null,replyProcessingError=null;
const replyWriterId=id('reply_panel'),replyDraftRecords=new Map();
let replyDraftQueue=Promise.resolve(),replyRecoveryRows=[];
function cacheCurrentPack(snapshot,current){snapshot.packs=snapshot.packs.filter(item=>item.id!==current.id);rememberPack(snapshot,current);return current;}
function protectQueuedPack(snapshot,taskId,round,candidate){
  const queue=taskId&&activeExtractionQueue(snapshot,taskId);if(!queue)return candidate;
  const message='当前任务还有未结束的提炼批次。请保持当前资料包；若要更改问题、预算、原文范围或资料选择，先在“本轮记录与恢复”点击“取消提炼批次，保留当前片段”。';
  requireThat(round&&queue.activeRoundId===round.id,message,'queue_round_locked');
  const unchanged=reuseUnchangedRoundPack(snapshot,round.id,candidate);
  requireThat(unchanged.id===round.packSnapshot.id,message,'queue_round_locked');return unchanged;
}
function showReplySync(message){$('#reply-sync-help').hidden=false;$('#reply-sync-reason').textContent=message;}
function hideReplySync(){$('#reply-sync-help').hidden=true;$('#reply-sync-reason').textContent='';}
function element(tag,text,attrs={}){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;for(const [k,v]of Object.entries(attrs)){if(k==='class')e.className=v;else e.setAttribute(k,String(v));}return e;}
function notice(text,error=false,scope='general'){noticeScope=scope;noticeRevision++;const root=$('#notice');root.replaceChildren(element('div',text,{class:'notice'+(error?' error':'')}));}
function catchError(fn){return async(...args)=>{try{await fn(...args);}catch(error){notice(error.message||String(error),true);}};}
// Cosmetic bridge: fixed action/status identifiers only; never user data or error text.
// Results are published at confirmed business effects below, not inferred from a
// fulfilled callback or from notice/button wording. The receiver filters its list.
const softAttempts=new Map(),softOutcomes=new Map();
// Only these local view callbacks have a completion contract. A fulfilled
// arbitrary callback is never evidence of a save, send, download or model result.
const softViewActions=new Set(['task-browse-library','task-import','open-core-picker','handoff-toggle','memory-core-prev','memory-core-next','remember-core-selection','show-entry-view','show-source-view','show-candidate-view','entry-reset-filters','entry-clear-selection','entry-batch-cancel','entry-prev','entry-next','entry-page-go','source-prev','source-next','candidate-clear-selection','candidate-review-cancel','candidate-review-preview-button','candidate-prev','candidate-next','new-entry','add-field','view-imported-entries','view-action']);
const softTrueActions=new Set(['load-memory-task','reload-memory-task','preview-memory-update','read-memory-reply','read-and-process-memory','clear-memory-reply','restore-reply-draft','discard-reply-draft','entry-batch-add-tag','entry-batch-archive']);
function softAction(actionId,phase,semanticState='',statusCode='',attemptId='',destinationSiteId=''){
  if(phase==='begin'){if(softAttempts.has(actionId)){attemptId=softAttempts.get(actionId);if(!destinationSiteId)return attemptId;}else{attemptId=id('soft_attempt');softAttempts.set(actionId,attemptId);}}
  else if(!attemptId)return;
  if(phase==='result')softOutcomes.set(attemptId,semanticState);
  if(phase==='end'){if(softAttempts.get(actionId)===attemptId)softAttempts.delete(actionId);softOutcomes.delete(attemptId);}
  try{document.dispatchEvent(new CustomEvent('text-memory-soft-action',{detail:{actionId,phase,semanticState,statusCode,attemptId,...(actionId==='connect-site'&&phase==='begin'&&['chatgpt','deepseek','kimi','grok','claude','qianwen','gemini'].includes(destinationSiteId)?{destinationSiteId}:{})}}));}catch{}
  return attemptId;
}
// Capture once, before the first await. Late completions retain their original
// attempt even after tab changes or another operation starts.
function softReporter(actionIds){const attempts=actionIds.map(actionId=>[actionId,softAttempts.get(actionId)]);return(semantic,status='')=>{for(const[actionId,attemptId]of attempts)if(attemptId)softAction(actionId,'result',semantic,status,attemptId);};}
function softPageResult(report,result,successCode){
  if(successCode){report('task_success',successCode);return;}
  const code=result?.status;
  if(code==='unsupported')report('insert_error','editor_unsupported');
  else if(code==='ambiguous_target')report('target_unselected','target_ambiguous');
  else if(['permission_required','permission_denied'].includes(code))report('permission_error');
  else if(['stale_target','page_changed'].includes(code))report('page_not_ready');
  else if(code==='waiting'||code==='busy')report('awaiting_result');
  else report('insert_error','operation_failed');
}
function softPackIssues(report,issues){
  if(issues.some(issue=>issue.blocking&&issue.reason==='conflict')){report('conflict_detected','conflict_detected');return true;}
  return false;
}
function completeSoftButton(ticket,result,failed=false){
  if(!ticket)return;const previous=softOutcomes.get(ticket.softAttempt);if(previous){if(failed&&['save_success','copy_success','insert_success','package_success','task_success','conflict_resolved'].includes(previous))softAction(ticket.actionId,'result','partial_success','partial_success',ticket.softAttempt);return;}
  if(failed)softAction(ticket.actionId,'result','insert_error','operation_failed',ticket.softAttempt);
  else if(softViewActions.has(ticket.actionId)||softTrueActions.has(ticket.actionId)&&result===true)softAction(ticket.actionId,'result','task_success','view_updated',ticket.softAttempt);
}
function beginButtonFeedback(button){
  if(!button)return null;const previous=buttonFeedback.get(button);if(previous?.busy){softAction(previous.actionId,'repeat','awaiting_result','repeat_click',previous.softAttempt);return false;}
  if(previous?.timer)globalThis.clearTimeout?.(previous.timer);
  const ticket={id:++feedbackSequence,button,label:previous?.label||button.textContent||button.id||'操作',busy:true};
  buttonFeedback.set(button,ticket);button.setAttribute('data-feedback','busy');button.setAttribute('aria-busy','true');button.setAttribute('aria-disabled','true');button.textContent='… '+ticket.label;
  ticket.actionId=button.dataset?.softAction||button.id||'dynamic-action';ticket.softAttempt=softAction(ticket.actionId,'begin');const root=$('#action-feedback');root.hidden=false;root.setAttribute('data-feedback','busy');root.textContent=ticket.label+'：处理中';return ticket;
}
function finishButtonFeedback(ticket,ok){
  if(!ticket||buttonFeedback.get(ticket.button)!==ticket)return;const button=ticket.button,canceled=softOutcomes.get(ticket.softAttempt)==='canceled';ticket.busy=false;button.removeAttribute('aria-disabled');softAction(ticket.actionId,'end','','',ticket.softAttempt);
  const status=canceled?'canceled':ok?'success':'error';button.setAttribute('data-feedback',status);button.setAttribute('aria-busy','false');button.textContent=(canceled?'已取消 · ':ok?'✓ ':'! ')+ticket.label;
  if(ticket.id===feedbackSequence){const root=$('#action-feedback');root.hidden=false;root.setAttribute('data-feedback',status);root.textContent=ticket.label+(canceled?'：已取消':ok?'：已完成':'：未完成，请查看原因');}
  ticket.timer=globalThis.setTimeout?.(()=>{if(buttonFeedback.get(button)!==ticket)return;button.setAttribute('data-feedback','');button.textContent=ticket.label;},4000);ticket.timer?.unref?.();
}
async function runButtonAction(button,fn,args=[]){const ticket=beginButtonFeedback(button);if(ticket===false)return;try{const result=await fn(...args);completeSoftButton(ticket,result,result===false);finishButtonFeedback(ticket,result!==false);return result;}catch(error){notice(error.message||String(error),true);completeSoftButton(ticket,null,true);finishButtonFeedback(ticket,false);return false;}}
function runViewAction(button,fn){button.dataset.softAction='view-action';return runButtonAction(button,fn);}
function on(selector,eventName,fn){const control=$(selector);control.addEventListener(eventName,eventName==='click'?((...args)=>runButtonAction(control,fn,args)):eventName==='submit'?(async(...args)=>{const attempt=softAction(control.id,'begin');try{return await fn(...args);}catch(error){if(!softOutcomes.has(attempt))softAction(control.id,'result','insert_error','operation_failed',attempt);notice(error.message||String(error),true);}finally{softAction(control.id,'end','','',attempt);}}):catchError(fn));}
function startPackFeedback(text){notice(text,false,'pack');let revision=noticeRevision;return(message,error=false)=>{if(noticeScope==='pack'&&noticeRevision===revision){notice(message,error,'pack');revision=noticeRevision;}};}
async function runPackAction(fn,message='正在检查资料包…',button=null){const ticket=beginButtonFeedback(button);if(ticket===false)return;const publishNotice=startPackFeedback(message);let failed=false;const publish=(text,error=false)=>{if(error)failed=true;publishNotice(text,error);};try{const result=await fn(publish);completeSoftButton(ticket,result,failed||result===false);finishButtonFeedback(ticket,!failed&&result!==false);return result;}catch(error){publish(error.message||String(error),true);completeSoftButton(ticket,null,true);finishButtonFeedback(ticket,false);return false;}}
function onPack(selector,eventName,fn,message){const control=$(selector);control.addEventListener(eventName,()=>runPackAction(fn,message,control));}
function options(){return{libraryIds:[...enabled],scope:$('#scope').value,asOf:$('#as-of').value,includeDisputed:$('#include-disputed').checked};}
function coreOptions(){return{scope:$('#scope').value,asOf:$('#as-of').value};}
function identity(value){return Object.fromEntries(['tabId','documentId','url','pageKey','conversation','temporary','adapter','adapterVersion'].map(k=>[k,value[k]]));}
async function bridge(message){requireThat(globalThis.chrome?.runtime?.id,'页面接入仅在真实扩展内可用');return chrome.runtime.sendMessage(message);}
function invalidate(){packGate.next();pack=null;draftResult=null;checkRun=null;clearPackProblems();$('#pairing').checked=false;$('#pack-preview').value='';$('#pack-status').textContent='选择或范围已改变，请重新生成预览';$('#pack-exclusions').replaceChildren();if(noticeScope==='pack')notice('资料选择已改变，请重新生成预览。',false,'pack');}
function clearPackProblems(){lastPackFailure=null;$('#pack-problems').replaceChildren();$('#pack-problems').hidden=true;$('#use-recommended-budget').hidden=true;}
const diagnosticLabels={pending:'待审核',local_only:'仅限本地',missing:'条目不存在',library:'资料库不符',scope:'适用范围不符',date:'适用日期不符',conflict:'争议资料不完整',budget:'预算不足',invalid:'字段或引用无效',stale:'版本已变化',disabled:'条目已停用',archived:'条目已归档',superseded:'条目已替代',not_included:'必需资料未入包',integrity:'正文校验失败',empty:'没有可用资料'};
function packFailureMessage(diagnostic){const issues=diagnostic.issues.filter(issue=>issue.blocking);return issues.length?issues.slice(0,3).map(issue=>`${issue.title}（${diagnosticLabels[issue.reason]||issue.reason}）：${issue.action}`).join('；'):'资料包校验未通过，请检查条目与预算。';}
function showPackProblems(diagnostic,candidate){
  const root=$('#pack-problems');root.replaceChildren();const issues=diagnostic.issues.filter(issue=>issue.blocking);root.hidden=!issues.length;
  const round=activeMemoryTaskId?activeRound(state,activeMemoryTaskId):null;
  lastPackFailure=issues.length?{pack:clone(candidate),context:options(),taskId:activeMemoryTaskId,question:$('#memory-question').value,roundId:round?.id||null,roundVersion:round?.version||null}:null;
  if(issues.length){root.append(element('strong','本轮资料尚未准备好'));
    for(const issue of issues){const row=element('div',undefined,{class:'pack-problem'});row.append(element('strong',`${issue.kind==='core'?'长期核心 · ':''}${issue.title} · ${diagnosticLabels[issue.reason]||issue.reason}`),element('p',issue.action));
      const entry=state.entries.find(e=>e.id===issue.id);if(entry){const button=element('button','查看并处理条目');button.addEventListener('click',()=>runViewAction(button,()=>openLibraryEntry(entry.id,{edit:true})));row.append(button);}
      else if(issue.kind==='core'){const button=element('button','编辑长期核心');button.addEventListener('click',()=>runButtonAction(button,()=>{showTab('memory');$('#memory-editor').open=true;}));row.append(button);}
      root.append(row);
    }
    if(diagnostic.requiredChars!==null)root.append(element('p',`完整必需资料至少需要 ${diagnostic.requiredChars} 字符；当前预算 ${diagnostic.currentBudget}。`,{class:'hint'}));
  }
  const retry=$('#use-recommended-budget');retry.hidden=!(diagnostic.canResolveByBudget&&diagnostic.recommendedBudget);if(!retry.hidden)retry.textContent=`应用建议预算 ${diagnostic.recommendedBudget} 并重试`;
}
function checkedPreparedPack(state,candidate){const errors=validatePack(state,candidate,{...candidate.options,binding:candidate.binding,memoryTaskId:candidate.memoryTask?.id||''});if(errors.length){const error=Error(errors.join('；'));error.packDiagnostics=diagnosePack(state,candidate);error.diagnosticPack=clone(candidate);if(error.packDiagnostics.issues.some(issue=>issue.blocking))error.message=packFailureMessage(error.packDiagnostics);throw error;}return candidate;}
function freezeControls(root){const controls=[...root.querySelectorAll('input,textarea,select,button')].map(control=>[control,control.disabled]);for(const [control]of controls)control.disabled=true;return()=>{for(const [control,disabled]of controls)control.disabled=disabled;};}
function selectOptions(control,rows,{empty=false,preserve=true}={}){const previous=control.value;control.replaceChildren();if(empty)control.append(element('option','未指定',{value:''}));for(const row of rows)control.append(element('option',row.name||row.title,{value:row.id}));if(preserve&&[...control.options].some(o=>o.value===previous))control.value=previous;}
function latestTemplates(){const map=new Map();for(const t of state.templates)if(!map.has(t.id)||map.get(t.id).version<t.version)map.set(t.id,t);return[...map.values()];}
async function refresh({detail=false,editorSession=editorToken}={}){
  // A storage notification can supersede a save's detail refresh. Preserve its
  // editor-scoped intent for the winning read, but never replace another edit.
  if(detail&&selectedEntry)pendingDetailRefresh={entryId:selectedEntry,editorSession};
  const request=refreshGate.next();
  let reading=(async()=>{
  const latest=await repository.snapshot();if(!refreshGate.current(request))return;
  state=latest;enabled=enabled.filter(x=>state.libraries.some(l=>l.id===x));
  const previousImportLibrary=$('#import-library').value;
  renderLibraries();for(const control of ['#entry-library','#rule-library','#import-library'])selectOptions($(control),state.libraries);
  if(!state.libraries.length){const option=element('option','请先在左侧创建资料库',{value:''});option.disabled=true;$('#import-library').replaceChildren(option);}
  if(pendingLibrarySelection&&state.libraries.some(l=>l.id===pendingLibrarySelection)){
    $('#entry-library').value=pendingLibrarySelection;$('#import-library').value=pendingLibrarySelection;pendingLibrarySelection=null;
  }
  if(previousImportLibrary!==$('#import-library').value)invalidateImport();
  for(const control of ['#watch-entry','#rule-entry'])selectOptions($(control),state.entries.filter(e=>e.lifecycleStatus==='active'),{empty:control==='#rule-entry'});
  selectOptions($('#template-select'),latestTemplates().map(t=>({...t,name:`${t.name} · v${t.version}`})),{empty:true});
  renderList();renderRules();renderWatches();renderEvents();renderMemoryTasks();
  const detailRequest=pendingDetailRefresh;pendingDetailRefresh=null;
  if(detailRequest&&selectedEntry===detailRequest.entryId&&editorGate.current(detailRequest.editorSession))renderDetail(detailRequest.entryId);
  if(pack){const current=state.packs.find(p=>p.id===pack.id);if(current?.stale){pack=current;$('#pack-status').textContent='资料包已过期：条目发生修改，请重新生成';}}
  })();
  refreshRead=reading;
  try{
    await reading;
    // Keep a saving editor frozen until a superseding read has painted it.
    while(refreshRead!==reading){reading=refreshRead;await reading;}
  }catch(error){if(refreshGate.current(request))pendingDetailRefresh=null;throw error;}
}
function renderLibraries(){const root=$('#libraries');root.replaceChildren();if(!state.libraries.length)root.append(element('p','尚无资料库。先新建或载入示例。',{class:'hint'}));
  for(const library of state.libraries){const label=element('label',undefined,{class:'check library-label'}),input=element('input',undefined,{type:'checkbox','data-library':library.id});input.checked=enabled.includes(library.id);
    input.addEventListener('change',()=>{stopReplyReceiver('资料库选择已变化，接收已暂停。');memoryGeneration++;enabled=input.checked?[...enabled,library.id]:enabled.filter(x=>x!==library.id);binding=null;selected.clear();pinned.clear();retrieved=null;invalidate();void bridge({type:'PAUSE'}).catch(()=>{});});label.append(input,document.createTextNode(library.name));root.append(label);}
}
function clearEntryBatch(){entryBatchEpoch++;entryBatchSelection.clear();entryBatchPreview=null;$('#entry-batch-panel').hidden=true;}
function rememberLibraryView(){
  if(browserLibrary===null)return;
  libraryViews.delete(browserLibrary);libraryViews.set(browserLibrary,{values:browserControls.map(selector=>$(selector).value),page:entryPage,selectedEntry,scrollTop:$('#entry-list').scrollTop||0,sourceView:{mode:entryBrowserMode,page:sourcePage,id:selectedSource,offset:sourceOffset,backOffsets:[...sourceBackOffsets],entryPage:sourceEntryPage,query:$('#source-search').value,filter:$('#source-filter').value}});
  while(libraryViews.size>32)libraryViews.delete(libraryViews.keys().next().value);
}
function resetBrowserFilters(){
  for(const selector of ['#entry-search','#entry-source','#entry-kind','#entry-tag'])$(selector).value='';
  $('#entry-filter').value='all';$('#entry-sort').value='updated';entryPage=1;
}
function renderBrowserFacets(){
  const facets=browserFacets(state,$('#entry-library').value);
  const fill=(selector,rows,label)=>{const control=$(selector),old=control.value;control.replaceChildren(element('option',label,{value:''}));for(const row of rows)control.append(element('option',row.name,{value:row.id}));control.value=rows.some(row=>row.id===old)?old:'';};
  fill('#entry-source',[...facets.sources.map(row=>({id:row.id,name:`${row.name} · ${row.count} 条`})),...(facets.withoutSource?[{id:'__none__',name:`无来源文档 · ${facets.withoutSource} 条`}]:[])],'全部来源');
  fill('#entry-kind',facets.kinds.map(row=>({id:row.id,name:`${kindLabels[row.id]||row.id} · ${row.count}`})),'全部类型');
  fill('#entry-tag',facets.tags.map(row=>({id:row.name,name:`${row.name} · ${row.count}`})),'全部标签');
}
function renderEntryBatch(){
  const visibleIds=entryResult?.entries.map(entry=>entry.id)||[],checked=visibleIds.filter(key=>entryBatchSelection.has(key)).length;
  $('#entry-select-page').checked=!!visibleIds.length&&checked===visibleIds.length;$('#entry-select-page').indeterminate=checked>0&&checked<visibleIds.length;$('#entry-select-page').disabled=entryBatchBusy||!visibleIds.length;
  $('#entry-selection-count').textContent=`已选 ${entryBatchSelection.size} 条 / 最多 100 条`;
  for(const selector of ['#entry-batch-add-tag','#entry-batch-archive','#entry-clear-selection'])$(selector).disabled=entryBatchBusy||!entryBatchSelection.size;
  for(const control of $('#entry-list').querySelectorAll('input,button'))control.disabled=entryBatchBusy;
  $('#entry-prev').disabled=entryBatchBusy||entryPage<=1;$('#entry-next').disabled=entryBatchBusy||entryPage>=(entryResult?.pageCount||1);
}
function renderList({focusId='',resetFilters=false}={}){
  const library=$('#entry-library').value,root=$('#entry-list');let scrollTop=root.scrollTop||0,restoreDetail=false;
  if(library!==browserLibrary){
    sourceCoverageView=null;
    rememberLibraryView();browserLibrary=library;clearEntryBatch();resetBrowserFilters();
    renderBrowserFacets();const saved=libraryViews.get(library);if(saved){browserControls.forEach((selector,index)=>$(selector).value=saved.values[index]);entryPage=saved.page;selectedEntry=saved.selectedEntry;scrollTop=saved.scrollTop;}else{selectedEntry=null;scrollTop=0;}
    const sv=saved?.sourceView;entryBrowserMode=sv?.mode||'entries';sourcePage=sv?.page||1;selectedSource=sv?.id||'';sourceOffset=sv?.offset||0;sourceBackOffsets=[...(sv?.backOffsets||[])];sourceEntryPage=sv?.entryPage||1;$('#source-search').value=sv?.query||'';$('#source-filter').value=sv?.filter||'all';reviewQueue=null;
    clearCandidateSelection();candidatePage=1;for(const control of ['#candidate-source','#candidate-assessment','#candidate-search'])$(control).value='';
    restoreDetail=true;
  }
  if(resetFilters){resetBrowserFilters();clearEntryBatch();scrollTop=0;}
  if(focusId){selectedEntry=focusId;restoreDetail=true;scrollTop=0;}
  renderBrowserFacets();
  const task=taskById(state,activeMemoryTaskId);
  entryResult=browseEntries(state,{libraryId:library,query:$('#entry-search').value,sourceId:$('#entry-source').value,kind:$('#entry-kind').value,tag:$('#entry-tag').value,status:$('#entry-filter').value||'all',importantIds:task?.coreEntryIds||[],sort:$('#entry-sort').value||'updated',page:entryPage,pageSize:Number($('#entry-page-size').value)||50,focusId});
  entryPage=entryResult.page;
  for(const key of entryBatchSelection)if(!state.entries.some(entry=>entry.id===key&&entry.libraryId===library))entryBatchSelection.delete(key);
  $('#counts').textContent=`本库 ${entryResult.libraryTotal} 条 · ${entryResult.pendingCount} 条待审核 · 匹配 ${entryResult.total} 条 · 当前 ${entryResult.start}—${entryResult.end} 条`;
  const owner=(state.tasks||[]).filter(t=>t.libraryId===library),libraryName=state.libraries.find(l=>l.id===library)?.name||'全部资料';
  $('#library-context-header').textContent=`${libraryName}${owner.length?' · 用于任务：'+owner.map(t=>t.name).join('、'):''}。普通资料按问题检索；重要记忆每轮携带。`;
  root.replaceChildren();if(!entryResult.total)root.append(element('p','没有匹配资料。可清除筛选，或选择其他来源文档。',{class:'empty'}));
  const sourceNames=new Map(state.sources.map(source=>[source.id,source.name]));
  for(const e of entryResult.entries){
    const row=element('div',undefined,{class:'entry-row'+(selectedEntry===e.id?' selected':'')}),select=element('input',undefined,{type:'checkbox','data-batch-entry':e.id,'aria-label':'选择条目：'+e.title});
    select.checked=entryBatchSelection.has(e.id);select.disabled=entryBatchBusy;
    select.addEventListener('change',catchError(()=>{if(select.checked&&entryBatchSelection.size>=100){select.checked=false;throw Error('一次最多选择 100 条，请先处理已选资料。');}if(select.checked)entryBatchSelection.add(e.id);else entryBatchSelection.delete(e.id);entryBatchEpoch++;entryBatchPreview=null;$('#entry-batch-panel').hidden=true;renderEntryBatch();}));
    const card=element('button',undefined,{class:'entry-card'+(selectedEntry===e.id?' selected':''),'data-entry':e.id,'aria-pressed':String(selectedEntry===e.id)});card.append(element('strong',e.title));const badges=element('div',undefined,{class:'badges'});
    for(const [text,kind]of [[e.reviewStatus==='confirmed'?'已确认':'待审核',e.reviewStatus==='confirmed'?'ok':'warn'],[kindLabels[e.kind]||e.kind,''],...(e.lifecycleStatus!=='active'?[[e.lifecycleStatus==='archived'?'已归档':'已替代','']]:[]),...(e.conflictState==='unresolved'?[['存在冲突','danger']]:[]),...(e.sensitivity==='local_only'?[['仅限本地','warn']]:[]),...(task?.coreEntryIds.includes(e.id)?[['重要记忆','ok']]:[])])badges.append(element('span',text,{class:'badge '+kind}));
    const names=[...new Set(e.sourceRefs.map(ref=>sourceNames.get(ref.sourceId)).filter(Boolean))];
    card.append(badges,element('p',entryExcerpt(e,$('#entry-search').value)),element('small',`${names.join('、')||'无来源文档'} · v${e.version} · ${e.updatedAt.slice(0,10)}`));
    card.addEventListener('click',catchError(()=>{requireEntryNavigation();reviewQueue=null;selectedEntry=e.id;renderEntryRead(e.id);renderList();}));row.append(select,card);root.append(row);
  }
  root.scrollTop=scrollTop;
  $('#entry-page-info').textContent=`第 ${entryPage} / ${entryResult.pageCount} 页`;
  $('#entry-page-number').value=String(entryPage);$('#entry-page-number').max=String(entryResult.pageCount);
  $('#entry-prev').disabled=entryBatchBusy||entryPage<=1;$('#entry-next').disabled=entryBatchBusy||entryPage>=entryResult.pageCount;
  renderEntryBatch();
  if(selectedEntry&&!state.entries.some(entry=>entry.id===selectedEntry&&entry.libraryId===library)){selectedEntry=null;restoreDetail=true;}
  if(restoreDetail||!$('#entry-read-view').hidden&&selectedEntry)renderEntryRead(selectedEntry);
  renderSourceBrowser();rememberLibraryView();return entryResult;
}
function openLibraryEntry(entryId,{edit=false,review=false}={}){
  requireEntryNavigation();
  const entry=state.entries.find(item=>item.id===entryId);requireThat(entry,'条目已不存在');
  if(!review)reviewQueue=null;
  $('#entry-library').value=entry.libraryId;renderList({focusId:entryId,resetFilters:true});entryBrowserMode='entries';renderSourceBrowser();if(edit)renderDetail(entryId);showTab('entries');
}
function setEntryBrowserMode(mode){
  requireThat(!entryBatchBusy&&!candidateBusy,'批量操作正在保存');requireEntryNavigation();
  if(!$('#entry-detail').hidden)renderEntryRead(selectedEntry);
  reviewQueue=null;entryBrowserMode=mode;clearEntryBatch();clearCandidateSelection();renderSourceBrowser();rememberLibraryView();
}
function renderSourceBrowser(){
  const documents=entryBrowserMode==='sources',candidates=entryBrowserMode==='candidates';$('#entry-browser-pane').hidden=documents||candidates;$('#source-browser-pane').hidden=!documents;$('#candidate-browser-pane').hidden=!candidates;
  $('#counts').hidden=documents||candidates;
  $('#show-entry-view').setAttribute('aria-pressed',String(!documents&&!candidates));$('#show-source-view').setAttribute('aria-pressed',String(documents));$('#show-candidate-view').setAttribute('aria-pressed',String(candidates));
  if(candidates){renderCandidates();return;}
  if(!documents)return;
  const result=browseSources(state,{libraryId:$('#entry-library').value,query:$('#source-search').value,filter:$('#source-filter').value,page:sourcePage});sourcePage=result.page;
  $('#source-count').textContent=`本库 ${result.libraryTotal} 份文档 · 匹配 ${result.total} 份 · 当前 ${result.start}—${result.end} 份`;
  $('#source-page-info').textContent=`第 ${result.page} / ${result.pageCount} 页`;$('#source-prev').disabled=result.page<=1;$('#source-next').disabled=result.page>=result.pageCount;
  const root=$('#source-list');root.replaceChildren();if(!result.total)root.append(element('p','没有匹配文档。手动录入且没有原文引用的资料，请切到“按条目查看”。',{class:'empty'}));
  for(const row of result.sources){const card=element('button',undefined,{class:'source-card','data-source-id':row.id,'aria-pressed':String(selectedSource===row.id)});
    card.append(element('strong',row.name),element('small',`${row.characters.toLocaleString()} 字符 · ${row.entryCount} 条资料`),element('p',`${row.pendingCount} 条待审核 · ${row.confirmedCount} 条已审核 · ${row.archivedCount} 条已归档`));
    const total=row.pendingCount+row.confirmedCount;if(total)card.append(element('progress',undefined,{max:total,value:row.confirmedCount,'aria-label':`${row.name}：有效资料已审核 ${row.confirmedCount} / ${total}`}));
    card.onclick=()=>{selectedSource=row.id;sourceOffset=0;sourceBackOffsets=[];sourceEntryPage=1;renderSourceBrowser();rememberLibraryView();};root.append(card);
  }
  renderSourceDetail();
}
const assessmentLabels={supported:'AI 自评：有依据',uncertain:'AI 自评：不确定',conflict:'AI 自评：可能冲突',unknown:'AI 自评：未明确'};
function clearCandidateSelection(){candidateEpoch++;candidateSelection.clear();candidatePreview=null;$('#candidate-review-panel').hidden=true;}
function renderCandidateSelection(){
  $('#candidate-selection-count').textContent=`已选 ${candidateSelection.size} 条 / 最多 50 条`;
  $('#candidate-review-preview-button').disabled=candidateBusy||!candidateSelection.size;$('#candidate-clear-selection').disabled=candidateBusy||!candidateSelection.size;$('#candidate-review-confirm').disabled=candidateBusy||!candidatePreview;
}
function renderCandidates(){
  const libraryId=$('#entry-library').value,result=browseExtractionCandidates(state,{libraryId,sourceId:$('#candidate-source').value,assessment:$('#candidate-assessment').value,query:$('#candidate-search').value,page:candidatePage});candidatePage=result.page;
  const sourcePicker=$('#candidate-source'),previous=sourcePicker.value;sourcePicker.replaceChildren(element('option','全部来源',{value:''}));for(const source of result.sources)sourcePicker.append(element('option',source.name,{value:source.id}));
  if(previous&&!result.sources.some(row=>row.id===previous))sourcePicker.append(element('option','原筛选来源已无待审候选',{value:previous}));sourcePicker.value=previous;
  for(const entryId of candidateSelection)if(!state.entries.some(entry=>entry.id===entryId&&entry.libraryId===libraryId&&entry.reviewStatus==='pending'&&entry.lifecycleStatus==='active'&&entry.evidenceKind==='inferred'&&entry.tags.includes('原文提炼'))){candidateSelection.delete(entryId);candidatePreview=null;candidateEpoch++;$('#candidate-review-panel').hidden=true;}
  $('#candidate-count').textContent=`本库 ${result.libraryTotal} 条提炼候选 · 匹配 ${result.total} 条 · 当前 ${result.start}—${result.end} 条`;
  $('#candidate-page-info').textContent=`第 ${result.page} / ${result.pageCount} 页`;$('#candidate-prev').disabled=candidateBusy||result.page<=1;$('#candidate-next').disabled=candidateBusy||result.page>=result.pageCount;
  const list=$('#candidate-list');list.replaceChildren();if(!result.total)list.append(element('p',result.libraryTotal?'没有匹配候选。可调整筛选。':'暂无待审核的提炼候选。先在“按文档查看”中准备提炼，并在浮窗保存候选回复。',{class:'empty'}));
  for(const row of result.candidates){const entry=row.entry,card=element('article',undefined,{class:'candidate-card','data-candidate-id':entry.id}),heading=element('div',undefined,{class:'candidate-card-heading'}),check=element('label',undefined,{class:'check'}),input=element('input',undefined,{type:'checkbox','data-review-entry':entry.id,'aria-label':'审核选择：'+entry.title});input.checked=candidateSelection.has(entry.id);input.disabled=candidateBusy||row.issues.length>0;
    input.addEventListener('change',catchError(()=>{if(input.checked&&candidateSelection.size>=50){input.checked=false;throw Error('每次最多审核 50 条，请先处理已选候选。');}if(input.checked)candidateSelection.add(entry.id);else candidateSelection.delete(entry.id);candidateEpoch++;candidatePreview=null;$('#candidate-review-panel').hidden=true;renderCandidateSelection();}));check.append(input,element('strong',entry.title));heading.append(check,element('span','待审核 · v'+entry.version,{class:'badge warn'}));card.append(heading);
    const labels=element('div',undefined,{class:'badges'});labels.append(element('span',assessmentLabels[row.assessment],{class:'badge '+(row.assessment==='supported'?'':'warn')}));if(row.sensitivity==='local_only')labels.append(element('span','仅限本地',{class:'badge warn'}));if(entry.conflictState==='unresolved')labels.append(element('span','结构化冲突未解决',{class:'badge danger'}));card.append(labels,element('p',entry.content,{class:'candidate-content'}));
    for(const ref of row.references){const quote=element('blockquote',undefined,{class:'candidate-quote'});quote.append(element('p',ref.valid?ref.quote:'引用已失效，请在编辑器核对；不显示为已验证原文。'),element('footer',`${ref.name} · v${ref.sourceVersion} · 第 ${ref.start+1}—${ref.end} 字符`));card.append(quote);}
    if(row.issues.length)card.append(element('p',row.issues.join('；'),{class:'candidate-issue'}));
    const edit=element('button','核对或修改条目',{'data-candidate-edit':entry.id});edit.disabled=candidateBusy;edit.onclick=()=>runButtonAction(edit,()=>{clearCandidateSelection();openLibraryEntry(entry.id,{edit:true});});card.append(edit);list.append(card);
  }renderCandidateSelection();
}
async function previewCandidateReview(){
  requireEntryNavigation();requireThat(!candidateBusy,'审核正在保存');const libraryId=$('#entry-library').value,entryIds=[...candidateSelection],epoch=++candidateEpoch;candidatePreview=null;$('#candidate-review-panel').hidden=true;
  const shownEntries=clone(state.entries.filter(entry=>entryIds.includes(entry.id))),shownSourceIds=new Set(shownEntries.flatMap(entry=>entry.sourceRefs.map(ref=>ref.sourceId))),shownSources=clone(state.sources.filter(source=>shownSourceIds.has(source.id)));
  const snapshot=await repository.snapshot();if(epoch!==candidateEpoch||libraryId!==$('#entry-library').value||entryBrowserMode!=='candidates')return false;
  if(!equal(shownEntries,snapshot.entries.filter(entry=>entryIds.includes(entry.id)))||!equal(shownSources,snapshot.sources.filter(source=>shownSourceIds.has(source.id)))){clearCandidateSelection();await refresh();throw Error('所选候选或原文已变化，已刷新列表；请重新核对并选择。');}
  candidatePreview=prepareCandidateReview(snapshot,{libraryId,entryIds});const root=$('#candidate-review-preview');root.replaceChildren(element('strong',`将确认 ${candidatePreview.count} 条已选记忆`),element('p',`确认表示你已核对候选含义与原文。${candidatePreview.restrictedCount} 条仅限本地，审核后仍保留限制；不会加入任务核心。`));
  const list=element('ul');for(const entry of candidatePreview.entries)list.append(element('li',`${entry.title} · v${entry.version} · ${assessmentLabels[entry.assessment]}`));root.append(list);$('#candidate-review-panel').hidden=false;renderCandidateSelection();notice('请核对所选列表，再点“确认所选记忆”。AI 自评不会代替人工确认。');
}
async function commitCandidateReview(){
  const reportSoft=softReporter(['candidate-review-confirm']);
  requireEntryNavigation();requireThat(!candidateBusy&&candidatePreview,'请先预览所选候选');const preview=candidatePreview,libraryId=$('#entry-library').value,epoch=candidateEpoch;requireThat(preview.libraryId===libraryId,'资料库已切换，请重新预览');candidateBusy=true;const restore=freezeControls($('#candidate-browser-pane'));renderCandidateSelection();
  try{const result=await repository.mutate(snapshot=>applyCandidateReview(snapshot,preview));reportSoft('save_success');if(epoch===candidateEpoch&&libraryId===$('#entry-library').value)clearCandidateSelection();let warning='';try{await refresh();}catch(error){warning=' 资料已经保存，但列表刷新失败：'+error.message;}if(warning)reportSoft('partial_success','saved_refresh_pending');notice(`已确认 ${result.confirmed} 条记忆，${result.restrictedCount} 条保留仅限本地限制。来源和任务核心保持原样。`+warning,!!warning);}
  catch(error){if(['version_conflict','field_validation','invalid_input','update_rejected'].includes(error.code)){if(epoch===candidateEpoch&&libraryId===$('#entry-library').value)clearCandidateSelection();try{await refresh();}catch{} }throw error;}
  finally{candidateBusy=false;restore();if(entryBrowserMode==='candidates')renderCandidates();}
}
function openSourceDocument(sourceId,offset=0){
  requireEntryNavigation();const info=sourceDetails(state,{libraryId:$('#entry-library').value,sourceId});requireThat(info,'此文档不属于当前资料库，或来源已不存在。');
  if(!$('#entry-detail').hidden)renderEntryRead(selectedEntry);
  selectedSource=sourceId;sourceOffset=offset;sourceBackOffsets=[];sourceEntryPage=1;reviewQueue=null;entryBrowserMode='sources';clearEntryBatch();renderSourceBrowser();rememberLibraryView();showTab('entries');
}
function renderSourceDetail(){
  const root=$('#source-detail');root.replaceChildren();const info=sourceDetails(state,{libraryId:$('#entry-library').value,sourceId:selectedSource});
  if(!info){selectedSource='';sourceCoverageView=null;root.append(element('p','选择一份文档，阅读原文并查看审核进度。',{class:'empty'}));return;}
  root.append(element('p','来源文档 · 原文快照',{class:'eyebrow'}),element('h2',info.name));
  const stats=element('div',undefined,{class:'source-stat-grid'});for(const [label,value]of [['关联资料',info.entryCount],['待审核',info.pendingCount],['有效且已审核',info.confirmedCount],['已归档或替代',info.archivedCount]]){const box=element('div');box.append(element('strong',String(value)),element('span',label));stats.append(box);}root.append(stats);
  root.append(element('p','关联资料包含导入原文分段，不等于提炼记忆。审核进度表示条目已被核对，不表示模型理解了整份原文；提炼引用可在下方检查。仅限本地、冲突和适用范围限制仍生效。',{class:'hint'}));
  if(info.restrictedCount||info.conflictCount)root.append(element('p',`${info.restrictedCount} 条仅限本地 · ${info.conflictCount} 条存在冲突`,{class:'hint'}));
  if(!info.entryCount)root.append(element('p','此来源只保留历史引用，当前没有关联条目。',{class:'notice'}));
  const actions=element('div',undefined,{class:'actions'}),all=element('button','查看关联条目');all.disabled=!info.entryCount;all.onclick=()=>{setEntryBrowserMode('entries');resetBrowserFilters();$('#entry-source').value=info.id;renderList();};
  const review=element('button','开始逐条审核',{class:'primary','data-start-source-review':info.id});review.disabled=!info.pendingCount;review.onclick=()=>runViewAction(review,()=>startSourceReview(info.id));actions.append(review,all);root.append(actions);
  renderExtractionSetup(root,info);
  renderSourceCoverage(root,info);
  const reading=element('section',undefined,{class:'source-section'});reading.append(element('h3','文档原文'));
  const slice=readingSourceSlice(info.source,{offset:sourceOffset,length:6000});sourceOffset=slice.start;
  reading.append(element('p',`第 ${slice.total?slice.start+1:0}—${slice.end} 字符 / 共 ${slice.total.toLocaleString()} 字符`,{class:'hint',id:'source-reading-range'}),element('pre',slice.text,{class:'source-reading-text',id:'source-reading-text'}));
  const bar=element('div',undefined,{class:'source-reading-toolbar'}),prev=element('button','上一段原文'),next=element('button','下一段原文');prev.disabled=slice.start<=0;next.disabled=slice.end>=slice.total;
  prev.onclick=()=>{sourceOffset=sourceBackOffsets.pop()??Math.max(0,slice.start-6000);renderSourceDetail();rememberLibraryView();};next.onclick=()=>{sourceBackOffsets.push(slice.start);sourceOffset=slice.end;renderSourceDetail();rememberLibraryView();};
  const location=element('label','跳到字符位置'),offset=element('input',undefined,{type:'number',min:1,max:Math.max(1,slice.total),id:'source-reading-offset'});offset.value=String(slice.start+1);location.append(offset);const jump=element('button','跳转原文');jump.onclick=()=>runButtonAction(jump,()=>{const value=Number(offset.value);requireThat(Number.isInteger(value)&&value>=1&&value<=Math.max(1,slice.total),'请输入原文范围内的整数位置。');sourceOffset=value-1;sourceBackOffsets=[];renderSourceDetail();rememberLibraryView();});bar.append(prev,next,location,jump);reading.append(bar);root.append(reading);
  const links=element('section',undefined,{class:'source-section'});links.append(element('h3','原文对应的资料'));
  const pages=Math.max(1,Math.ceil(info.linkedEntries.length/25));sourceEntryPage=Math.min(sourceEntryPage,pages);const rows=info.linkedEntries.slice((sourceEntryPage-1)*25,sourceEntryPage*25);
  for(const row of rows){const line=element('div',undefined,{class:'source-entry-row'}),entry=row.entry;line.append(element('strong',entry.title),element('p',`${entry.reviewStatus==='confirmed'?'已审核':'待审核'} · ${entry.lifecycleStatus==='active'?'有效':'已归档或替代'} · v${entry.version}`,{class:'hint'}),element('p',entryExcerpt(entry,'',150)));
    const buttons=element('div',undefined,{class:'actions'}),read=element('button','阅读条目',{'data-source-entry':entry.id}),locate=element('button','定位引用原文');read.onclick=()=>runViewAction(read,()=>openLibraryEntry(entry.id));locate.onclick=()=>{sourceOffset=row.start;sourceBackOffsets=[];renderSourceDetail();rememberLibraryView();};buttons.append(read,locate);line.append(buttons);links.append(line);
  }
  if(!rows.length)links.append(element('p','没有当前关联条目。',{class:'hint'}));
  const page=element('div',undefined,{class:'actions'}),before=element('button','上一页条目'),after=element('button','下一页条目');before.disabled=sourceEntryPage<=1;after.disabled=sourceEntryPage>=pages;before.onclick=()=>{sourceEntryPage--;renderSourceDetail();rememberLibraryView();};after.onclick=()=>{sourceEntryPage++;renderSourceDetail();rememberLibraryView();};page.append(before,element('span',`第 ${sourceEntryPage} / ${pages} 页 · 共 ${info.linkedEntries.length} 条`),after);links.append(page);root.append(links);
}
function renderExtractionSetup(root,info){
  const box=element('section',undefined,{class:'source-section source-extraction-setup'});box.append(element('h3','让网页 AI 提炼这份文档'),element('p','按片段提炼与任务目标相关的候选记忆，并要求逐字出处。插件检查引用位置；模型的含义判断仍需复核。',{class:'hint'}));
  const available=state.tasks.filter(task=>task.libraryId===$('#entry-library').value),select=element('select',undefined,{id:'source-extract-task'}),label=element('label','用于哪个任务');
  for(const task of available)select.append(element('option',task.name,{value:task.id}));select.value=available.some(task=>task.id===activeMemoryTaskId)?activeMemoryTaskId:available[0]?.id||'';label.append(select);box.append(label);
  if(!available.length)box.append(element('p','先在任务工作台创建任务，并选择当前已有资料库。',{class:'hint'}));
  const startLabel=element('label','从第几个字符开始'),start=element('input',undefined,{type:'number',min:1,max:Math.max(1,info.characters),id:'source-extract-start'});startLabel.append(start);
  const budgetLabel=element('label','资料包字符预算'),budget=element('input',undefined,{type:'number',min:128,max:100000,value:Math.max(12000,Number($('#budget').value)||12000),id:'source-extract-budget'});budgetLabel.append(budget);const settings=element('div',undefined,{class:'grid2'});settings.append(startLabel,budgetLabel);box.append(settings);
  const progress=element('p',undefined,{class:'hint',id:'source-extract-progress'}),problem=element('p',undefined,{class:'hint'}),prepare=element('button','准备这片 AI 提炼资料',{class:'primary',id:'source-extract-prepare'});
  const fill=()=>{const offset=select.value?nextExtractionOffset(state,{taskId:select.value,sourceId:info.id}):0;start.value=String(Math.min(offset+1,Math.max(1,info.characters)));progress.textContent=offset>=info.characters?'已收到覆盖全文的片段回执；这不保证所有事实均已提取。可改起点重新提炼。':`默认接续位置：第 ${offset+1} 字符；每次最多 4000 字符。已完成回执不等于内容全部正确。`;let message='';try{createSourceExtraction(state,{libraryId:$('#entry-library').value,sourceId:info.id,start:0,length:4000});}catch(error){message=error.message;}problem.textContent=message;prepare.disabled=sourceExtractionBusy||!select.value||!!message;};select.addEventListener('change',fill);fill();
  prepare.onclick=()=>runButtonAction(prepare,()=>prepareSourceRound(info.id,select.value,Number(start.value)-1,Number(budget.value)));
  const open=element('button','打开网页浮窗',{'data-soft-action':'open-floating'});open.onclick=()=>runButtonAction(open,async()=>{const reportSoft=softReporter(['open-floating']);requireThat(!memoryDirty,'请先保存任务修改');const result=await bridge({type:'OPEN_FLOATING'});softPageResult(reportSoft,result,result.status==='opened'?'floating_opened':null);requireThat(result.status==='opened',result.message||'请回到目标 AI 网页，从侧栏打开浮窗');notice('在浮窗选择提炼任务，再点“发送提炼片段”。普通聊天输入会保留。');});
  const buttons=element('div',undefined,{class:'actions'});buttons.append(prepare,open);box.append(progress,problem,buttons);root.append(box);
}
function sourceCoverageIsCurrent(view,report=view.result){
  return sourceCoverageView===view&&view.libraryId===$('#entry-library').value&&view.sourceId===selectedSource&&view.result===report&&view.snapshot===state&&!view.changed;
}
function renderSourceCoverage(root,info){
  const libraryId=$('#entry-library').value;
  if(!sourceCoverageView||sourceCoverageView.libraryId!==libraryId||sourceCoverageView.sourceId!==info.id){
    const tasks=state.tasks.filter(task=>task.libraryId===libraryId);
    sourceCoverageView={libraryId,sourceId:info.id,taskId:tasks.some(task=>task.id===activeMemoryTaskId)?activeMemoryTaskId:tasks[0]?.id||'',query:'',filter:'gaps',maxChars:String(Math.max(12000,Number($('#budget').value)||12000)),page:1,open:false,result:null,snapshot:null,changed:false,running:false,revision:0};
  }
  const view=sourceCoverageView,box=element('details',undefined,{class:'source-section source-coverage',id:'source-coverage'});box.open=view.open;box.append(element('summary','原文覆盖检查与补读'));box.ontoggle=()=>{view.open=box.open;};
  box.append(element('p','仅检查提炼条目的逐字引用；未引用或部分引用是补读线索，不代表模型漏掉了事实。已引用也不代表语义完整或正确。导入的原文分段不计作已提炼。',{class:'hint'}));
  const settings=element('div',undefined,{class:'source-coverage-controls'}),task=element('select',undefined,{id:'source-coverage-task'}),taskLabel=element('label','参考已保存任务');
  task.append(element('option','不按任务排序',{value:''}));for(const row of state.tasks.filter(row=>row.libraryId===libraryId))task.append(element('option',row.name,{value:row.id}));
  if(view.taskId&&!state.tasks.some(row=>row.id===view.taskId&&row.libraryId===libraryId)){view.taskId='';view.changed=true;}task.value=view.taskId;taskLabel.append(task);
  const filter=element('select',undefined,{id:'source-coverage-filter'}),filterLabel=element('label','查看哪些片段');for(const [value,label]of [['gaps','未引用与部分引用'],['all','全部片段'],['pending','有待审核引用'],['confirmed','有已审核引用'],['archived','有归档或替代引用']])filter.append(element('option',label,{value}));filter.value=view.filter;filterLabel.append(filter);
  const query=element('input',undefined,{id:'source-coverage-query',type:'text',maxlength:1000,placeholder:'可选；影响提示顺序，不排除其他片段'}),queryLabel=element('label','关注内容');query.value=view.query;queryLabel.append(query);
  const budget=element('input',undefined,{id:'source-coverage-budget',type:'number',min:128,max:100000}),budgetLabel=element('label','补读资料包字符预算');budget.value=view.maxChars;budgetLabel.append(budget);budget.oninput=()=>{view.maxChars=budget.value;};settings.append(taskLabel,filterLabel,budgetLabel,queryLabel);box.append(settings);
  const actions=element('div',undefined,{class:'actions'}),check=element('button',view.running?'正在检查…':'检查原文引用',{id:'source-coverage-check',class:'primary'});check.disabled=view.running;check.onclick=()=>runButtonAction(check,()=>runSourceCoverage(view,1));actions.append(check);box.append(actions);
  const output=element('div',undefined,{id:'source-coverage-results','aria-live':'polite'});box.append(output);root.append(box);
  const changed=()=>{view.taskId=task.value;view.query=query.value;view.filter=filter.value;view.changed=true;view.page=1;view.revision++;renderSourceCoverageResults(output,view);};task.onchange=changed;filter.onchange=changed;query.oninput=changed;
  renderSourceCoverageResults(output,view);
}
async function runSourceCoverage(view,page){
  const reportSoft=softReporter(['source-coverage-check']);
  requireThat(!view.running,'正在检查原文，请稍候');requireThat(sourceCoverageView===view&&view.libraryId===$('#entry-library').value&&view.sourceId===selectedSource,'文档已切换，请在当前文档重新检查');
  view.running=true;view.open=true;const revision=view.revision;
  try{
    await refresh();requireThat(sourceCoverageView===view&&view.libraryId===$('#entry-library').value&&view.sourceId===selectedSource,'文档已切换，本次检查已停止');requireThat(view.revision===revision,'检查条件已更改，请重新检查');
    const result=inspectSourceCoverage(state,{libraryId:view.libraryId,sourceId:view.sourceId,taskId:view.taskId,query:view.query,filter:view.filter,page,pageSize:10});requireThat(result,'此来源已不属于当前资料库，请重新选择文档');
    view.result=result;view.snapshot=state;view.changed=false;view.page=result.page;reportSoft('task_success',result.total===0?'empty_result':'operation_completed');notice(`原文引用检查完成：${result.total} 个匹配片段，按措辞和任务用词排序；这不是语义完整率。`);
  }finally{view.running=false;if(sourceCoverageView===view)renderSourceDetail();}
}
function renderSourceCoverageResults(root,view){
  root.replaceChildren();const report=view.result;
  if(!report){root.append(element('p',view.changed?'条件已更改，点击“检查原文引用”。':'点击检查后生成本地提示；展开或翻阅原文不会自动扫描整份文档。',{class:'hint'}));return;}
  if(!sourceCoverageIsCurrent(view,report)){root.append(element('p',view.changed?'检查条件已更改，请重新检查。':'资料或任务已更新，请重新检查原文引用。旧结果不会用于补读。',{class:'notice',id:'source-coverage-stale'}));return;}
  const summary=report.summary,stats=element('p',`有效提炼记忆：${summary.entryCounts.pending} 条待审核 · ${summary.entryCounts.confirmed} 条已审核；另有 ${summary.entryCounts.archived} 条已归档或替代、${summary.entryCounts.disabled} 条已停用。`,{class:'hint',id:'source-coverage-summary'});root.append(stats);
  root.append(element('p',`已检查 ${summary.units.toLocaleString()} 个原文片段：${summary.unquotedUnits.toLocaleString()} 个无当前引用 · ${summary.partiallyQuotedUnits.toLocaleString()} 个部分引用 · ${summary.fullyQuotedUnits.toLocaleString()} 个完整引用。这里的“完整”仅指字符区间。`,{class:'hint'}));
  if(!report.scan.complete)root.append(element('p',`本次达到 ${report.scan.unitLimit.toLocaleString()} 个片段上限，已检查到第 ${report.scan.scannedThrough.toLocaleString()} 字符；后续原文尚未检查。`,{class:'notice'}));
  if(report.taskTermsLimited)root.append(element('p','任务用词过多，已均匀采样用于提示排序；不会排除其他未引用片段。',{class:'hint'}));
  const list=element('div',undefined,{class:'source-coverage-list',id:'source-coverage-list'});root.append(list);
  for(const row of report.rows){
    const card=element('article',undefined,{class:'source-coverage-row','data-coverage-start':row.start}),heading=element('div',undefined,{class:'source-coverage-heading'});
    heading.append(element('strong',`第 ${row.start+1}—${row.end} 字符`),element('span',{none:'无当前引用',partial:'部分引用',full:'完整引用'}[row.currentCoverage],{class:'badge '+(row.currentCoverage==='full'?'':'warn')}));card.append(heading,element('blockquote',row.text,{class:'source-coverage-text'}));
    card.append(element('p',row.reasons.length?row.reasons.map(reason=>reason.label+(reason.matches.length?'（'+reason.matches.join('、')+'）':'')).join('；'):'按原文位置排列；未命中优先提示措辞。',{class:'hint'}));
    const covered=row.coverage;card.append(element('p',`引用字符：已审核 ${covered.confirmedCharacters} · 待审核 ${covered.pendingCharacters} · 归档或替代 ${covered.archivedCharacters} · 已停用 ${covered.disabledCharacters}`,{class:'hint'}));
    const buttons=element('div',undefined,{class:'actions'}),locate=element('button','定位原文',{'data-coverage-locate':row.start}),prepare=element('button','准备补读片段',{'data-coverage-prepare':row.start});
    locate.onclick=()=>runButtonAction(locate,()=>{requireThat(sourceCoverageIsCurrent(view,report),'原文检查结果已变化，请重新检查');sourceOffset=row.start;sourceBackOffsets=[];renderSourceDetail();rememberLibraryView();$('#source-reading-text')?.scrollIntoView?.({block:'nearest'});});
    prepare.disabled=sourceExtractionBusy||!view.taskId;prepare.onclick=()=>runButtonAction(prepare,()=>prepareCoverageReread(view,report,row));buttons.append(locate,prepare);card.append(buttons,element('small',`补读将准备第 ${row.reread.start+1}—${row.reread.end} 字符，包含后续原文，最多 4000 字符；不会自动发送。`,{class:'hint'}));list.append(card);
  }
  if(!report.rows.length)list.append(element('p','没有符合此筛选的片段；这不保证所有事实已提炼，请结合原文审核。',{class:'hint'}));
  if(!view.taskId)root.append(element('p','选择当前库中的已保存任务并重新检查后，即可准备补读片段。',{class:'hint'}));
  const pages=element('div',undefined,{class:'actions source-coverage-pages'}),prev=element('button','上一页提示',{id:'source-coverage-prev'}),next=element('button','下一页提示',{id:'source-coverage-next'});prev.disabled=view.running||report.page<=1;next.disabled=view.running||report.page>=report.pageCount;
  prev.onclick=()=>runButtonAction(prev,()=>runSourceCoverage(view,report.page-1));next.onclick=()=>runButtonAction(next,()=>runSourceCoverage(view,report.page+1));pages.append(prev,element('span',`第 ${report.page} / ${report.pageCount} 页 · ${report.start}—${report.end} / ${report.total} 个片段`),next);root.append(pages);
}
async function prepareCoverageReread(view,report,row){
  requireThat(sourceCoverageIsCurrent(view,report)&&report.rows.includes(row),'原文检查结果已变化，请重新检查');requireThat(view.taskId&&report.taskId===view.taskId,'请选择当前资料库中的已保存任务并重新检查');
  const meta=row.reread,source=state.sources.find(source=>source.id===view.sourceId);requireThat(source&&source.version===meta.sourceVersion&&source.sha256===meta.sourceSha256,'原文版本已变化，请重新检查后补读');
  const text=source.text.slice(meta.start,meta.end),maxChars=Number(view.maxChars);
  return prepareSourceRound(meta.sourceId,view.taskId,meta.start,maxChars,{length:meta.length,expectedSourceVersion:meta.sourceVersion,expectedSourceSha256:meta.sourceSha256,expectedText:text,preserveWorkspace:true});
}
async function prepareSourceRound(sourceId,chosenTaskId,start,maxChars,{length=4000,expectedSourceVersion=null,expectedSourceSha256=null,expectedText=null,preserveWorkspace=false}={}){
  requireThat(!sourceExtractionBusy&&!memoryBusy,'正在准备资料，请稍候');requireEntryNavigation();requireThat(!memoryDirty,'任务有未保存修改，请先保存任务。');
  const originalTask=clone(taskById(state,chosenTaskId)),libraryId=$('#entry-library').value,generation=memoryGeneration;requireThat(originalTask?.libraryId===libraryId,'请选择使用当前资料库的已保存任务');requireThat(Number.isInteger(start)&&start>=0,'起始字符位置无效');
  sourceExtractionBusy=true;const unfreeze=freezeControls($('#tab-entries'));
  try{
    const prepared=await repository.mutate(snapshot=>{
      requireThat(equal(taskById(snapshot,chosenTaskId),originalTask),'任务在准备前已更新，请重试');
      const extraction=createSourceExtraction(snapshot,{libraryId,sourceId,start,length}),existing=activeRound(snapshot,chosenTaskId);
      requireThat(expectedSourceVersion===null||extraction.sourceVersion===expectedSourceVersion,'原文版本已变化，请重新检查后补读');
      requireThat(expectedSourceSha256===null||extraction.sourceSha256===expectedSourceSha256,'原文内容已变化，请重新检查后补读');
      requireThat(expectedText===null||extraction.text===expectedText,'原文片段已变化，请重新检查后补读');
      requireThat(!existing||existing.status==='prepared','此任务还有已交付的对话，请先在浮窗处理回复，或选择另一任务提炼。');
      const question=`提炼当前文档第 ${extraction.start+1}—${extraction.end} 字符，围绕已保存的任务目标，列出有出处的候选记忆并自查疑点。`;
      let candidate=buildPack(snapshot,{task:question,libraryIds:[libraryId],memoryTaskId:chosenTaskId,maxChars,sourceExtraction:extraction});candidate=protectQueuedPack(snapshot,chosenTaskId,existing,candidate);
      const errors=validatePack(snapshot,candidate,{...candidate.options,binding:null,memoryTaskId:chosenTaskId});requireThat(!errors.length,errors.join('；'));
      const current=existing?refreshTaskRound(snapshot,existing.id,candidate,{expectedVersion:existing.version}).pack:candidate;if(!existing)prepareRound(snapshot,current);cacheCurrentPack(snapshot,current);return current;
    });
    if(memoryGeneration!==generation||$('#entry-library').value!==libraryId||tab!=='entries'){await refresh();notice('提炼片段已保存；你已切换界面，当前选择保持不变。可在浮窗选择对应任务处理。');return;}
    if(preserveWorkspace){if(pack?.memoryTask?.id===chosenTaskId&&pack.id!==prepared.id)invalidate();await refresh();notice(`补读资料已准备：第 ${prepared.sourceExtraction.start+1}—${prepared.sourceExtraction.end} 字符。尚未发送；在目标 AI 网页浮窗选择“${originalTask.name}”，点击“发送提炼片段”。原聊天草稿保留。`);return;}
    if(!await activateMemoryTask(chosenTaskId))return;const activated=memoryGeneration;await refresh();if(memoryGeneration!==activated||activeMemoryTaskId!==chosenTaskId)return;showTab('entries');entryBrowserMode='sources';selectedSource=sourceId;renderSourceBrowser();
    notice(`提炼资料已准备：第 ${prepared.sourceExtraction.start+1}—${prepared.sourceExtraction.end} 字符。尚未发送；在目标 AI 网页的浮窗点击“发送提炼片段”。`);
  }finally{sourceExtractionBusy=false;unfreeze();if(state)renderSourceBrowser();}
}
function startSourceReview(sourceId){
  requireEntryNavigation();const info=sourceDetails(state,{libraryId:$('#entry-library').value,sourceId});requireThat(info?.pendingCount,'当前文档没有待审核条目。');
  reviewQueue={libraryId:$('#entry-library').value,sourceId,name:info.name,ids:info.linkedEntries.filter(row=>row.entry.lifecycleStatus==='active'&&row.entry.reviewStatus==='pending').map(row=>row.entry.id),position:0};
  openLibraryEntry(reviewQueue.ids[0],{edit:true,review:true});notice(`正在核对“${info.name}”，本次队列共 ${reviewQueue.ids.length} 条。只有点击确认保存的条目会变为已审核。`);
}
function advanceSourceReview(queue){
  if(reviewQueue!==queue||$('#entry-library').value!==queue.libraryId)return;
  const info=sourceDetails(state,{libraryId:queue.libraryId,sourceId:queue.sourceId}),pending=new Set((info?.linkedEntries||[]).filter(row=>row.entry.lifecycleStatus==='active'&&row.entry.reviewStatus==='pending').map(row=>row.entry.id));
  let position=queue.position+1;while(position<queue.ids.length&&!pending.has(queue.ids[position]))position++;
  if(position<queue.ids.length){queue.position=position;openLibraryEntry(queue.ids[position],{edit:true,review:true});notice(`已进入本次队列第 ${position+1} / ${queue.ids.length} 条，请核对后保存。`);}
  else{reviewQueue=null;renderEntryRead(selectedEntry);notice(`本次队列已走完；该文档仍有 ${pending.size} 条待审核。可返回文档继续核对。`);}
}
async function previewEntryBatch(operation){
  requireThat(!entryBatchBusy,'批量操作正在保存');const libraryId=$('#entry-library').value,entryIds=[...entryBatchSelection],epoch=++entryBatchEpoch,tag=$('#entry-batch-tag').value;
  requireThat(libraryId&&entryIds.length,'先在当前库勾选需要整理的资料');
  entryBatchPreview=null;$('#entry-batch-panel').hidden=true;const latest=await repository.snapshot();
  if(epoch!==entryBatchEpoch||libraryId!==$('#entry-library').value)return false;
  const preview=prepareEntryBatch(latest,{libraryId,entryIds,operation,tag:operation==='add_tag'?tag:undefined});entryBatchPreview=preview;
  const root=$('#entry-batch-preview');root.replaceChildren(element('strong',`${operation==='archive'?'归档':'添加标签“'+preview.tag+'”'} · 已选 ${preview.count} 条`),element('p',`已满足条件将跳过 ${preview.alreadyAppliedCount||0} 条。内容、来源与审核状态保持不变。`));
  if(operation==='archive'&&preview.affectedTaskNames.length)root.append(element('p','这些条目是以下任务的重要记忆：'+preview.affectedTaskNames.join('、')+'。归档后相关任务会提示核心不可用；请在任务中明确调整重要记忆。',{class:'notice error'}));
  const list=element('ul');for(const entry of preview.entries)list.append(element('li',entry.title+' · v'+entry.version));root.append(list);$('#entry-batch-panel').hidden=false;
  notice('批量操作预览已生成。请核对条目清单后确认；尚未修改资料。');return true;
}
async function commitEntryBatch(){
  const reportSoft=softReporter(['entry-batch-confirm']);
  requireThat(entryBatchPreview&&!entryBatchBusy,'先预览本次批量操作');const preview=entryBatchPreview;
  requireThat(preview.libraryId===$('#entry-library').value,'资料库已切换，请重新预览');
  const unfreeze=freezeControls($('#tab-entries'));entryBatchBusy=true;
  try{const result=await repository.mutate(snapshot=>applyEntryBatch(snapshot,preview));reportSoft('save_success');clearEntryBatch();invalidate();
    let warning='';try{await refresh();}catch(error){warning=' 资料已经保存，但列表刷新失败：'+error.message;}
    if(warning)reportSoft('partial_success','saved_refresh_pending');notice(`批量整理已保存：更新 ${result.changed} 条，跳过 ${result.skipped} 条。`+warning,!!warning);return true;
  }finally{entryBatchBusy=false;unfreeze();renderEntryBatch();}
}

function renderEntryRead(entryId){
  editorToken=editorGate.next();const root=$('#entry-read-view');root.hidden=false;$('#entry-detail').hidden=true;root.replaceChildren();
  const entry=state.entries.find(e=>e.id===entryId);if(!entry){root.append(element('p','选择一条资料查看内容。',{class:'empty'}));return;}
  root.append(element('p',`${entry.reviewStatus==='confirmed'?'已确认':'待审核'} · v${entry.version}`,{class:'eyebrow'}),element('h2',entry.title));
  const task=taskById(state,activeMemoryTaskId),eligibility=describeCoreEligibility(state,entry,task||entry.libraryId,coreOptions());
  if(eligibility.reasons.length)root.append(element('p',eligibility.reasons.map(r=>r.message).join('；'),{class:'notice error'}));
  root.append(element('div',entry.content||'此条目没有正文，请查看结构化字段。',{class:'entry-prose'}));
  if(Object.keys(entry.fields||{}).length){const fields=element('dl',undefined,{class:'read-fields'});for(const [key,value]of Object.entries(entry.fields)){fields.append(element('dt',key),element('dd',typeof value==='string'?value:JSON.stringify(value)));}root.append(fields);}
  if(entry.aliases?.length)root.append(element('p','匹配别名：'+entry.aliases.join('、'),{class:'hint'}));
  const actions=element('div',undefined,{class:'actions'}),edit=element('button',entry.reviewStatus==='pending'?'核对并编辑':'编辑资料',{class:'primary'});edit.onclick=()=>renderDetail(entry.id);actions.append(edit);
  if(task){const add=element('button',memoryCoreDraft.has(entry.id)?'已是重要记忆':'设为当前任务的重要记忆',{'data-soft-action':'core-draft-add'});add.disabled=memoryBusy||memoryCoreDraft.has(entry.id)||!eligibility.eligible;add.title=eligibility.reasons.map(r=>r.message).join('；');add.onclick=()=>runButtonAction(add,()=>{const reportSoft=softReporter(['core-draft-add']);requireThat(!memoryBusy,'任务正在保存，请稍候');const current=taskById(state,activeMemoryTaskId);requireThat(current,'请先选择任务');const check=describeCoreEligibility(state,entry.id,current,coreOptions());requireThat(check.eligible,check.reasons.map(r=>r.message).join('；'));memoryCoreDraft.add(entry.id);markMemoryDirty();renderMemoryCores();showTab('memory');reportSoft('task_success','core_draft_updated');notice('已选为重要记忆，请点击“保存任务与重要记忆”使修改生效。');});actions.append(add);}
  root.append(actions);
  const sources=element('details');sources.append(element('summary',`原文引用与适用条件 · ${entry.sourceRefs.length} 处引用`));
  sources.append(element('p',`范围：${entry.scope||'不限'} · 有效期：${entry.effectiveFrom||'不限'} 至 ${entry.effectiveTo||'不限'}`,{class:'hint'}));
  for(const ref of entry.sourceRefs){const source=state.sources.find(s=>s.id===ref.sourceId);sources.append(element('strong',source?.name||'来源不可用'),element('blockquote',ref.quote||''));if(source){const view=element('button','查看文档原文');view.onclick=()=>runViewAction(view,()=>openSourceDocument(source.id,ref.start));sources.append(view);}}root.append(sources);renderHistory(root,entry);
}
function inputField(parent,labelText,key,value,{type='text',tag='input',rows=3}={}){const label=element('label',labelText),control=element(tag,undefined,{'data-edit':key});if(tag==='input')control.type=type;if(tag==='textarea')control.rows=rows;control.value=value??'';label.append(control);parent.append(label);return control;}
function entryFormSignature(){return JSON.stringify([...$('#entry-detail').querySelectorAll('input,textarea,select')].filter(control=>control.getAttribute('data-edit')!==null||control.getAttribute('data-field-mode')!==null).map(control=>[control.getAttribute('data-edit')||control.getAttribute('data-field-mode'),control.value,!!control.checked]));}
function requireEntryNavigation(){
  const root=$('#entry-detail'),controls=[...root.querySelectorAll('input,textarea,select')];
  // A save already captures the full form and freezes its controls. Navigation
  // during that commit follows the existing editor generation guard.
  requireThat(root.hidden||!entryEditorBaseline||controls.length&&controls.every(control=>control.disabled)||entryFormSignature()===entryEditorBaseline,'当前资料有未保存的修改，请先保存，或点击“放弃编辑”后再切换。');
}
function selectField(parent,labelText,key,value,values){const label=element('label',labelText),control=element('select',undefined,{'data-edit':key});for(const [key,label]of values)control.append(element('option',label,{value:key}));control.value=value;label.append(control);parent.append(label);return control;}
function checkbox(parent,labelText,key,value){const label=element('label',undefined,{class:'check'}),control=element('input',undefined,{type:'checkbox','data-edit':key});control.checked=value;label.append(control,document.createTextNode(labelText));parent.append(label);return control;}
function renderDetail(entryId){
  const session=editorGate.next();editorToken=session;
  $('#entry-detail').hidden=false;$('#entry-read-view').hidden=true;
  const entry=entryId?state.entries.find(e=>e.id===entryId):{libraryId:$('#entry-library').value,title:'',kind:'fact',content:'',fields:{},aliases:[],tags:[],sourceRefs:[],schemaId:'',evidenceKind:'user_asserted',sensitivity:'normal',enabledForContext:true};
  if(!entry){$('#entry-detail').replaceChildren(element('p','条目已删除'));return;}
  const root=$('#entry-detail');root.replaceChildren();root.append(element('h2',entryId?'核对与编辑':'新建条目'));
  const queue=reviewQueue&&reviewQueue.libraryId===entry.libraryId&&reviewQueue.ids[reviewQueue.position]===entryId?reviewQueue:null;
  if(queue){const banner=element('div',undefined,{class:'notice',id:'source-review-status'});banner.append(element('strong',`逐条审核 · ${queue.name} · 第 ${queue.position+1} / ${queue.ids.length} 条`),element('p','确认只保存当前条目；跳过会继续保留待审核。'));
    const actions=element('div',undefined,{class:'actions'}),skip=element('button','跳过，稍后审核'),back=element('button','返回文档');skip.onclick=()=>runButtonAction(skip,()=>{requireEntryNavigation();advanceSourceReview(queue);});back.onclick=()=>runViewAction(back,()=>openSourceDocument(queue.sourceId,entry.sourceRefs.find(ref=>ref.sourceId===queue.sourceId)?.start||0));actions.append(skip,back);banner.append(actions);root.append(banner);}
  if(entryId){const back=element('button','返回阅读');back.onclick=catchError(()=>{requireEntryNavigation();renderEntryRead(entryId);});root.append(back,element('p',`${entry.id} · v${entry.version}`,{class:'hint'}));}
  const discard=element('button','放弃编辑',{class:'quiet'});discard.onclick=()=>renderEntryRead(entryId);root.append(discard);
  inputField(root,'标题','title',entry.title);const pair=element('div',undefined,{class:'grid2'});root.append(pair);
  selectField(pair,'条目类型','kind',entry.kind,[['fact','事实'],['entity','对象'],['rule','用户约束'],['event','事件'],['preference','偏好'],['note','笔记']]);
  const templates=editorTemplates(state.templates,entry);
  const schema=selectField(pair,'字段模板','schema',templateKey(templateFor(state,entry)),[['','自由 JSON 字段'],...templates.map(t=>[templateKey(t),`${t.name} v${t.version}${t.id===entry.schemaId&&t.version===entry.schemaVersion?'（当前记录）':''}`])]);
  const business=element('div',undefined,{id:'business-fields'});root.append(business);let activeTemplate=templateFor(state,entry);
  renderBusinessFields(business,entry.fields,activeTemplate);
  schema.addEventListener('change',catchError(()=>{let fields;try{fields=readBusinessFields(business,activeTemplate);}catch(error){schema.value=templateKey(activeTemplate);throw error;}activeTemplate=templates.find(t=>templateKey(t)===schema.value);renderBusinessFields(business,fields,activeTemplate);}));
  inputField(root,'正文与限制','content',entry.content,{tag:'textarea',rows:4});
  const meta=element('details');meta.append(element('summary','匹配、范围与有效期'));root.append(meta);const grid=element('div',undefined,{class:'grid2'});meta.append(grid);
  for(const [label,key]of [['实体 ID（同名对象请用不同 ID）','entityId'],['属性键（冲突比较用）','predicate'],['适用范围','scope'],['别名（逗号分隔）','aliases'],['标签（逗号分隔）','tags']])inputField(grid,label,key,Array.isArray(entry[key])?entry[key].join(', '):entry[key]);
  inputField(grid,'有效起始日（可未知）','effectiveFrom',entry.effectiveFrom,{type:'date'});inputField(grid,'有效结束日（不含）','effectiveTo',entry.effectiveTo,{type:'date'});checkbox(meta,'此实体属性在同一范围与时间内应为单值','singleValued',entry.singleValued);checkbox(meta,'允许参与上下文选择','enabledForContext',entry.enabledForContext);
  const egrid=element('div',undefined,{class:'grid2'});root.append(egrid);selectField(egrid,'证据性质','evidenceKind',entry.evidenceKind,[['direct','直接原文'],['user_asserted','用户陈述'],['inferred','推断，需复核'],['unknown','证据未知']]);selectField(egrid,'数据分类','sensitivity',entry.sensitivity,[['normal','普通资料'],['local_only','仅限本地']]);
  const source=state.sources.find(s=>s.id===entry.sourceRefs[0]?.sourceId);inputField(root,'来源名称','source-name',source?.name||'手动来源');inputField(root,'原文快照（只需在新增/更换证据时填写）','source-text',source?.text||'',{tag:'textarea',rows:4});inputField(root,'对应原文摘录（必须连续精确匹配）','source-quote',entry.sourceRefs[0]?.quote||'',{tag:'textarea',rows:2});
  if(entry.sourceRefs.length>1)root.append(element('p',`此记录有 ${entry.sourceRefs.length} 个引用。未改来源时全部保留；更换来源时以新的引用代替。`,{class:'hint'}));
  if(source?.sensitivity==='local_only')root.append(element('p','当前来源仅限本地；保留此来源时，条目不能降为普通资料。',{class:'hint'}));
  root.append(element('p','移除原文引用时，请同时清空原文快照和摘录，并调整证据性质。',{class:'hint'}));
  const errors=entryId?entryErrors(state,entry):[];if(errors.length)root.append(element('p',errors.map(x=>`${x.field}: ${x.message}`).join('；'),{class:'conflict-box'}));
  inputField(root,'本次变更原因','reason',entryId?'核对并更正':'手动建条目');checkbox(root,'已核对这次具体变更，确认受控状态转换','transitionConfirmed',false);
  const actions=element('div',undefined,{class:'actions'});root.append(actions);let saving=false;
  for(const [label,confirm,advance]of [['保存为待审核',false,false],['确认并保存',true,false],...(queue?[['确认并查看下一条',true,true]]:[])]){const button=element('button',label,{class:confirm?'primary':'','data-soft-action':'save-entry'});button.addEventListener('click',()=>runButtonAction(button,async()=>{
    const reportSoft=softReporter(['save-entry']);
    if(saving)return;const captured=captureEntryEdit(root,entry,activeTemplate,source,confirm),unfreeze=freezeControls(root);saving=true;
    try{const result=await persistEntryEdit(repository,captured),current=editorGate.current(session);
      reportSoft('save_success');if(current)selectedEntry=result.id;await refresh({detail:current&&!advance,editorSession:session});
      if(advance&&editorGate.current(session)&&reviewQueue===queue)advanceSourceReview(queue);
      else notice(`已读回保存结果：v${result.version} · ${result.reviewStatus==='confirmed'?'已确认':'待审核'}`);
    }finally{saving=false;unfreeze();}
  }));actions.append(button);}
  if(entryId){
    const archive=element('button',entry.lifecycleStatus==='active'?'归档条目':'恢复为有效',{'data-soft-action':'entry-lifecycle'});archive.addEventListener('click',()=>runButtonAction(archive,async()=>{const reportSoft=softReporter(['entry-lifecycle']);requireEntryNavigation();await repository.mutate(s=>setLifecycle(s,entry.id,entry.lifecycleStatus==='active'?'archived':'active',entry.version,'用户调整生命周期'));reportSoft('save_success');await refresh({detail:true,editorSession:session});notice('生命周期已更新，旧资料包已失效');}));actions.append(archive);
    const del=element('button','真正删除',{class:'danger','data-soft-action':'delete-entry'});del.addEventListener('click',()=>runButtonAction(del,async()=>{const reportSoft=softReporter(['delete-entry']),latest=await repository.snapshot(),preview=deletionPreview(latest,entry.id);const exclusive=preview.sources.filter(x=>!x.shared).map(x=>x.sourceId);if(!confirmDelete(preview)){reportSoft('canceled');return false;}
      await repository.mutate(s=>deleteEntry(s,preview,exclusive));reportSoft('task_success','operation_completed');if(editorGate.current(session)){selectedEntry=null;editorToken=editorGate.next();$('#entry-detail').replaceChildren(element('p','条目与选定副本已删除，共享来源按预检保留'));}invalidate();await refresh();notice('删除完成；不影响外部备份和已发出的内容');}));actions.append(del);
    renderConflicts(root,entry);renderHistory(root,entry);
  }
  entryEditorBaseline=entryFormSignature();
}
function confirmDelete(preview){return window.confirm(`将删除该条目的 ${preview.versions} 个版本、${preview.packIds.length} 个资料包、${preview.runIds.length} 个检查副本、${preview.roundIds.length} 个轮次快照，另清理专属来源关联的 ${new Set(preview.sources.filter(s=>!s.shared).flatMap(s=>s.extractionPackIds||[])).size} 个提炼资料包、${new Set(preview.sources.filter(s=>!s.shared).flatMap(s=>s.extractionRoundIds||[])).size} 个提炼轮次，并删除 ${preview.sources.filter(s=>!s.shared).length} 个专属来源。\n关联提炼队列会停止继续发送。\n保留共享来源：${preview.sources.filter(s=>s.shared).map(s=>s.name).join('、')||'无'}。\n${preview.note}\n确认删除？`);}
function renderHistory(root,entry){const details=element('details');details.append(element('summary','比较历史版本'));const versions=state.versions.filter(v=>v.entryId===entry.id).sort((a,b)=>b.version-a.version),select=element('select',undefined,{'aria-label':'选择历史版本'});for(const v of versions)select.append(element('option',`v${v.version} · ${v.changeReason}`,{value:v.version}));const comparison=element('div',undefined,{class:'history-compare'});const render=()=>{const old=versions.find(v=>v.version===Number(select.value));comparison.replaceChildren(element('pre',JSON.stringify({version:old?.version,fields:old?.fields,content:old?.content},null,2)),element('pre',JSON.stringify({version:entry.version,fields:entry.fields,content:entry.content},null,2)));};select.addEventListener('change',render);details.append(select,comparison);root.append(details);render();}
function renderConflicts(root,entry){if(!entry.conflictIds.length)return;const session=editorToken,box=element('div',undefined,{class:'conflict-box'});box.append(element('strong','同一实体属性存在未解决冲突'));
  for(const otherId of entry.conflictIds){const other=state.entries.find(e=>e.id===otherId);box.append(element('p',`${other.title} · v${other.version} · ${other.reviewStatus}`));const comparison=element('div',undefined,{class:'history-compare'});comparison.append(element('pre',JSON.stringify(entry.fields,null,2)),element('pre',JSON.stringify(other.fields,null,2)));box.append(comparison);
    const open=element('button','查看另一条来源');open.onclick=()=>runViewAction(open,()=>openLibraryEntry(otherId,{edit:true}));box.append(open);const adopt=element('button','采用当前条目并替代另一条',{'data-soft-action':'resolve-entry-conflict'});adopt.addEventListener('click',()=>runButtonAction(adopt,async()=>{const reportSoft=softReporter(['resolve-entry-conflict']);requireEntryNavigation();const reason=window.prompt('请输入已核对来源的替代理由：');if(!reason){reportSoft('canceled');return false;}await repository.mutate(s=>resolveConflict(s,entry.id,other.id,[entry.version,other.version],reason));reportSoft('conflict_resolved');await refresh({detail:true,editorSession:session});notice('已记录明确替代关系，历史仍可查');}));box.append(adopt);
  }root.append(box);
}

function showTab(name){if(name==='context'){name='memory';$('#manual-workflow').open=true;}tab=name;for(const section of document.querySelectorAll('main>section'))section.hidden=section.id!==`tab-${name}`;for(const button of document.querySelectorAll('[data-tab]'))button.setAttribute('aria-pressed',String(button.dataset.tab===name));}
function renderSelection(){const root=$('#retrieval-results');root.replaceChildren();if(!retrieved&&!selected.size){$('#excluded-results').replaceChildren();root.append(element('p','运行检索后，可逐条选择并固定关键记录。',{class:'empty'}));return;}
  const display= retrieved||{hits:[],excluded:[]},hits=new Map(display.hits.map(h=>[h.id,h]));
  const persistentCore=new Set(activeMemoryTaskId?taskById(state,activeMemoryTaskId)?.coreEntryIds||[]:[]);
  const visible=state.entries.filter(e=>enabled.includes(e.libraryId)).sort((a,b)=>Number(persistentCore.has(b.id))-Number(persistentCore.has(a.id))||(hits.get(b.id)?.score||0)-(hits.get(a.id)?.score||0));
  for(const entry of visible.slice(0,250)){const row=element('div',undefined,{class:'selection-row'}),label=element('label',undefined,{class:'check'}),input=element('input',undefined,{type:'checkbox','data-select-entry':entry.id});input.checked=selected.has(entry.id);label.append(input,document.createTextNode(entry.title));const pinLabel=element('label',undefined,{class:'check'}),pin=element('input',undefined,{type:'checkbox','data-pin-entry':entry.id});pin.checked=pinned.has(entry.id);pinLabel.append(pin,document.createTextNode('固定为关键条目'));
    input.onchange=()=>{if(input.checked)selected.add(entry.id);else{selected.delete(entry.id);pinned.delete(entry.id);pin.checked=false;}invalidate();void rebuildPack();};
    pin.onchange=()=>{if(pin.checked){pinned.add(entry.id);selected.add(entry.id);input.checked=true;}else pinned.delete(entry.id);invalidate();void rebuildPack();};
    if(persistentCore.has(entry.id)){input.checked=true;pin.checked=true;input.disabled=true;pin.disabled=true;}
    const match=hits.get(entry.id),excluded=display.excluded.find(x=>x.id===entry.id);row.append(label,element('p',persistentCore.has(entry.id)?'任务长期核心：每轮携带；在“持续记忆”中修改。':match?.reasons.join(' · ')||reasons[excluded?.reason]||'手动选择'),pinLabel);root.append(row);
  }
  const excluded=$('#excluded-results');excluded.replaceChildren();for(const result of display.excluded.filter(x=>state.entries.some(e=>e.id===x.id&&enabled.includes(e.libraryId))).slice(0,200)){const entry=state.entries.find(e=>e.id===result.id);excluded.append(element('p',`${entry.title}：${reasons[result.reason]||result.reason}`,{class:'hint'}));}
}
async function rebuildPack(){
  const reportSoft=softReporter(['build-pack','retrieve']);
  const request=packGate.next();clearPackProblems();notice('正在重新生成资料包预览…',false,'pack');
  pack=null;draftResult=null;checkRun=null;$('#pairing').checked=false;$('#pack-preview').value='';$('#pack-exclusions').replaceChildren();$('#pack-status').textContent='正在重新生成资料包预览…';
  try{
    requireThat(!activeMemoryTaskId||!memoryDirty,'任务有未保存修改，请先在“持续记忆”保存任务');
    const context=options(),args={task:$('#task').value,...context,selectedIds:[...selected],pinnedIds:[...pinned],maxChars:Number($('#budget').value),binding:binding?identity(target):null,retrieved,memoryTaskId:activeMemoryTaskId};
    const latest=await repository.snapshot();if(!packGate.current(request))return false;const existing=activeMemoryTaskId?activeRound(latest,activeMemoryTaskId):null;if(existing?.question===args.task&&existing.packSnapshot.sourceExtraction)args.sourceExtraction=existing.packSnapshot.sourceExtraction;let built=buildPack(latest,args);
    await repository.mutate(s=>{if(!packGate.current(request))return;const round=activeMemoryTaskId?activeRound(s,activeMemoryTaskId):null;built=protectQueuedPack(s,activeMemoryTaskId,round,built);const errors=validatePack(s,built,{...context,binding:built.binding});if(errors.some(e=>!e.includes('没有有效条目')&&!e.includes('超过预算')&&!(built.blocked&&e.includes('任务核心条目缺失'))))throw Error(errors.join('；'));if(round){requireThat(built.task===round.question,'当前还有待处理的本轮回复。要使用新问题，请点击“同步资料并复制”；旧记录会保留。');if(!errors.length){const stable=reuseUnchangedRoundPack(s,round.id,built);if(stable.id===round.packSnapshot.id)built=stable;else replaceRoundPack(s,round.id,built,{expectedVersion:round.version});}}return cacheCurrentPack(s,built);});
    if(!packGate.current(request))return false;
    pack=built;const hasTaskContent=pack.memoryTask&&['goal','constraints','progress','openQuestions'].some(key=>pack.memoryTask[key]?.trim()),empty=!pack.included.length&&!hasTaskContent,unavailable=pack.blocked||empty;
    const diagnostic=diagnosePack(latest,built);showPackProblems(diagnostic,built);if(unavailable)softPackIssues(reportSoft,diagnostic.issues);
    const summary=pack.blocked?packFailureMessage(diagnostic):empty?'资料包没有可输出条目，请检查选择与排除原因。':'已生成可核对预览，可以复制。';
    $('#pack-preview').value=pack.text;$('#pack-status').textContent=`${summary} ${pack.included.length} 条 · ${pack.characters}/${pack.maxChars} UTF-16 字符 · 约 ${pack.estimatedTokens} token（按 UTF-8 bytes/3 估算）`;
    $('#pack-exclusions').replaceChildren(...pack.excluded.filter(x=>selected.has(x.id)).map(x=>element('p',`${latest.entries.find(e=>e.id===x.id)?.title||x.id}：${reasons[x.reason]||x.reason}`,{class:'hint'})));
    if(noticeScope==='pack')notice(summary,unavailable,'pack');await refresh();renderMemoryRound();if(!unavailable)reportSoft('package_success');return !unavailable;
  }catch(error){if(packGate.current(request)){$('#pack-status').textContent='资料包未生成：'+(error.message||String(error));if(noticeScope==='pack')notice(error.message||String(error),true,'pack');}return false;}
}
async function currentPackForOutput(){requireThat(pack,'请先生成资料包预览');requireThat(!activeMemoryTaskId||!memoryDirty,'任务有未保存修改，请先保存并重新生成');const packId=pack.id,context=options(),memoryTaskId=activeMemoryTaskId;
  const latest=await repository.snapshot();
  requireThat(pack?.id===packId&&equal(context,options())&&memoryTaskId===activeMemoryTaskId,'资料包或范围已改变，请重新核对预览');
  try{return clipboardPack(latest,packId,{...context,memoryTaskId});}catch(error){const diagnostic=diagnosePack(latest,pack);if(diagnostic.issues.some(issue=>issue.blocking)){showPackProblems(diagnostic,pack);throw Error(packFailureMessage(diagnostic));}throw error;}
}
function renderTemplateFields(){const root=$('#template-fields');root.replaceChildren();templateDraft.forEach((f,i)=>{
  const row=element('div',undefined,{class:'field-row'});
  const name=inputField(row,'字段键',`template-name-${i}`,f.name),label=inputField(row,'显示名称',`template-label-${i}`,f.label||''),type=selectField(row,'类型',`template-type-${i}`,f.type,['string','number','boolean','enum','date','entity_ref'].map(x=>[x,x]));
  const remove=element('button','删除字段');remove.onclick=()=>{templateDraft.splice(i,1);renderTemplateFields();};row.append(remove);
  name.oninput=()=>f.name=name.value;label.oninput=()=>f.label=label.value;type.onchange=()=>{f.type=type.value;if(f.type==='enum'&&!f.values)f.values=['选项一'];renderTemplateFields();};
  if(f.type==='enum'){const values=inputField(row,'枚举值（逗号分隔）',`template-values-${i}`,f.values?.join(',')||'');values.oninput=()=>f.values=values.value.split(/[,，]/).map(v=>v.trim()).filter(Boolean);}
  const flags=element('div',undefined,{class:'field-flags'});for(const [key,title]of [['required','必填'],['nullable','允许 null'],['readonly','只读'],['match','用于匹配']]){const control=checkbox(flags,title,`template-${key}-${i}`,f[key]??(key==='match'));control.onchange=()=>f[key]=control.checked;}row.append(flags);root.append(row);
});}
function renderRules(){const root=$('#rule-list');root.replaceChildren();for(const rule of state.rules){const row=element('div',undefined,{class:'selection-row'});row.append(element('strong',`${rule.type} · ${rule.field} · v${rule.version}`),element('pre',JSON.stringify(rule,null,2)));const del=element('button','移除此规则',{'data-soft-action':'remove-rule'});del.addEventListener('click',()=>runButtonAction(del,async()=>{const reportSoft=softReporter(['remove-rule']);if(!window.confirm('确认删除此规则？后续检查将不再包含它。')){reportSoft('canceled');return false;}await repository.mutate(s=>{s.rules=s.rules.filter(r=>r.id!==rule.id);event(s,'rule_removed',rule.id);});reportSoft('save_success');await refresh();}));row.append(del);root.append(row);}}
function renderWatches(){const root=$('#watch-list');root.replaceChildren();for(const watch of state.watches){const row=element('div',undefined,{class:'selection-row'});row.append(element('p',`${state.entries.find(e=>e.id===watch.entryId)?.title||'预期记录不存在'} · ${watch.fields.join(', ')} · ${watch.taskType||'所有任务类型'}`));const button=element('button','撤销此预期项');button.addEventListener('click',catchError(async()=>{await repository.mutate(s=>{s.watches=s.watches.filter(w=>w.id!==watch.id);});await refresh();}));row.append(button);root.append(row);}}
function renderEvents(){const root=$('#audit-events');root.replaceChildren(...state.events.slice(-30).reverse().map(e=>element('p',`${e.at.slice(0,19)} · ${e.type} · ${e.result||'ok'}`,{class:'hint'})));}
function clearMemoryPreview(){memoryGeneration++;memoryPreview=null;memoryPreviewRound=null;$('#apply-memory-update').disabled=true;$('#memory-update-preview').textContent='先读取或粘贴 AI 的记忆更新，再预览。';}
function markMemoryDirty(){if(replySession)stopReplyReceiver('任务有未保存修改，接收已暂停。');memoryDirty=true;$('#memory-editor').open=true;clearMemoryPreview();invalidate();$('#memory-task-status').textContent='任务有未保存修改；保存后才会用于下一轮。';renderWorkspaceOverview();renderMemoryRound();}
function renderWorkspaceOverview(){
  const task=taskById(state,activeMemoryTaskId),library=state.libraries.find(l=>l.id===$('#memory-library').value),root=$('#task-overview');
  root.replaceChildren(element('span',task?'当前任务':'开始一个新任务',{class:'eyebrow'}),element('h2',task?.name||'把目标和资料放在一起'),element('p',task?(memoryDirty?'有未保存的修改':'已保存 · 可在不同 AI 网页继续'):'填写名称和目标，保存后即可添加资料并开始对话。',{class:'hint'}));
  const users=task?(state.tasks||[]).filter(t=>t.libraryId===task.libraryId):[];
  $('#task-library-label').textContent=library?`资料库：${library.name} · ${state.entries.filter(e=>e.libraryId===library.id).length} 条资料${users.length>1?' · 与 '+users.filter(t=>t.id!==task.id).map(t=>t.name).join('、')+' 共享':''}`:'保存时自动创建同名的独立资料库。';
  for(const selector of ['#task-browse-library','#task-import','#quick-add-memory'])$(selector).disabled=!task||memoryBusy;
  $('#workspace-onboarding').hidden=state.libraries.length>0;
  const list=$('#workspace-task-list');list.replaceChildren();
  for(const item of state.tasks||[]){const button=element('button',undefined,{class:'workspace-task'+(item.id===activeMemoryTaskId?' selected':''),'aria-pressed':item.id===activeMemoryTaskId});button.append(element('strong',item.name),element('small',`${item.coreEntryIds.length} 条重要记忆`));button.disabled=memoryBusy;button.onclick=()=>runViewAction(button,()=>activateMemoryTask(item.id));list.append(button);}
  if(!state.tasks?.length)list.append(element('p','还没有任务。创建后，目标和资料会保存在本机。',{class:'hint'}));
}
function openTaskLibrary(){const task=taskById(state,activeMemoryTaskId);requireThat(task,'请先保存任务');if(browserLibrary!==task.libraryId)requireEntryNavigation();$('#entry-library').value=task.libraryId;renderList();showTab('entries');}
function openTaskImport(){const task=taskById(state,activeMemoryTaskId);requireThat(task,'请先保存任务');if($('#import-library').value!==task.libraryId){$('#import-library').value=task.libraryId;invalidateImport();}showTab('backup');notice(`导入到任务“${task.name}”的资料库；导入后请核对待审核内容。`);}
function renderMemoryCores(){
  const root=$('#memory-core-list'),libraryId=$('#memory-library').value,query=norm($('#memory-core-search').value);root.replaceChildren();
  const cards=$('#task-core-cards');cards.replaceChildren();
  for(const key of memoryCoreDraft){const entry=state.entries.find(e=>e.id===key),check=describeCoreEligibility(state,key,libraryId,coreOptions()),card=element('article',undefined,{class:'core-card'+(!check.eligible?' blocked':'')});card.append(element('strong',entry?.title||'已删除的记忆'));if(entry?.content!==entry?.title||!entry)card.append(element('p',entry?.content?.slice(0,240)||'请检查此条目。'));
    if(check.reasons.length)card.append(element('p',check.reasons.map(r=>r.message).join('；'),{class:'core-warning'}));
    if(check.notices.length)card.append(element('p',check.notices.join('；'),{class:'hint'}));
    const actions=element('div',undefined,{class:'actions'}),remove=element('button','移出重要记忆',{'data-soft-action':'core-draft-remove'});remove.disabled=memoryBusy;remove.onclick=()=>runButtonAction(remove,()=>{const reportSoft=softReporter(['core-draft-remove']);memoryCoreDraft.delete(key);markMemoryDirty();renderMemoryCores();reportSoft('task_success','core_draft_updated');notice('已移出重要记忆草稿；保存任务后生效，原资料仍保留。');});actions.append(remove);
    if(entry){const view=element('button','查看资料');view.onclick=()=>runViewAction(view,()=>openLibraryEntry(key));actions.append(view);}card.append(actions);cards.append(card);}
  if(!memoryCoreDraft.size)cards.append(element('p','还没有重要记忆。写下一条必须记住的事实，或从资料库中选择。目标本身也会随每轮对话携带。',{class:'empty'}));
  const coreFilter=$('#memory-core-filter').value||'all',key=JSON.stringify([libraryId,query,coreFilter,activeMemoryTaskId]);if(key!==corePageKey){corePageKey=key;corePage=1;}
  const source=!libraryId?{...state,entries:[]}:coreFilter==='eligible'?{...state,entries:state.entries.filter(entry=>entry.libraryId===libraryId&&describeCoreEligibility(state,entry,libraryId,coreOptions()).eligible)}:state;
  const page=browseEntries(source,{libraryId,query,status:coreFilter==='selected'?'important':'all',importantIds:[...memoryCoreDraft],sort:'title',page:corePage,pageSize:50});corePage=page.page;
  const entries=libraryId?page.entries:[];
  for(const entry of entries){
    const check=describeCoreEligibility(state,entry,libraryId,coreOptions()),label=element('label',undefined,{class:'check'}),control=element('input',undefined,{type:'checkbox','data-memory-core':entry.id});control.checked=memoryCoreDraft.has(entry.id);control.disabled=memoryBusy||(!control.checked&&!check.eligible);
    control.onchange=()=>{if(control.checked)memoryCoreDraft.add(entry.id);else memoryCoreDraft.delete(entry.id);markMemoryDirty();renderMemoryCores();};
    label.append(control,document.createTextNode(`${entry.title} · ${check.eligible?'可选':check.reasons.map(r=>r.message).join('；')}`));root.append(label);
  }
  for(const missing of [...memoryCoreDraft].filter(key=>!state.entries.some(e=>e.id===key))){const label=element('label',undefined,{class:'check'}),control=element('input',undefined,{type:'checkbox'});control.checked=true;control.disabled=memoryBusy;control.onchange=()=>{memoryCoreDraft.delete(missing);markMemoryDirty();renderMemoryCores();};label.append(control,document.createTextNode(`核心条目已删除：${missing}（取消后保存才能解除阻塞）`));root.append(label);}
  if(!entries.length&&!memoryCoreDraft.size)root.append(element('p','先在“条目管理”建立角色、项目事实或文档条目；任务本身也可单独使用。',{class:'hint'}));
  $('#memory-core-count').textContent=`已选 ${memoryCoreDraft.size} 条重要记忆 · 匹配 ${libraryId?page.total:0} 条 · 当前 ${libraryId?page.start:0}—${libraryId?page.end:0} 条`;
  $('#memory-core-page-info').textContent=`第 ${corePage} / ${page.pageCount} 页`;
  $('#memory-core-prev').disabled=memoryBusy||corePage<=1;$('#memory-core-next').disabled=memoryBusy||corePage>=page.pageCount;
}
function rememberQuickMemoryDraft(){
  const text=$('#quick-memory-text').value;
  requireThat(typeof text==='string'&&text.length<=QUICK_MEMORY_DRAFT_LIMITS.characters,'未提交记忆最多 12000 字符；请先缩短内容，当前输入已保留。');
  if(!text){quickMemoryDrafts.delete(quickMemoryTaskId);return;}
  requireThat(quickMemoryDrafts.has(quickMemoryTaskId)||quickMemoryDrafts.size<QUICK_MEMORY_DRAFT_LIMITS.tasks,'当前页面已有 64 个任务的未提交记忆；请先保存或清空一份草稿，当前输入已保留，尚未切换任务。');
  quickMemoryDrafts.set(quickMemoryTaskId,text);
}
function fillMemoryEditor(task){
  rememberQuickMemoryDraft();quickMemoryTaskId=task?.id||'';$('#quick-memory-text').value=quickMemoryDrafts.get(quickMemoryTaskId)||'';
  memoryEditorVersion=task?.version||null;memoryDirty=false;memoryCoreDraft=new Set(task?.coreEntryIds||[]);memoryAppliedCore=new Set(task?.coreEntryIds||[]);
  for(const key of ['name','goal','constraints','progress','openQuestions'])$('#memory-'+key).value=task?.[key]||'';
  $('#memory-library').value=task?.libraryId||'';
  $('#memory-library').disabled=!!task;$('#memory-editor').open=true;clearMemoryPreview();renderMemoryCores();
}
function renderMemoryTasks(){
  selectOptions($('#memory-task-select'),(state.tasks||[]).map(t=>({id:t.id,name:`${t.name} · v${t.version}`})),{empty:true});
  $('#memory-task-select').value=activeMemoryTaskId;
  selectOptions($('#memory-library'),[{id:'',name:'自动新建独立资料库'},...state.libraries.map(l=>({...l,name:l.name+'（使用已有资料库）'}))]);
  const task=activeMemoryTaskId?taskById(state,activeMemoryTaskId):null;
  if(task&&!memoryDirty&&memoryEditorVersion!==task.version){const oldCore=[...memoryAppliedCore];fillMemoryEditor(task);for(const key of oldCore)pinned.delete(key);for(const key of task.coreEntryIds){selected.add(key);pinned.add(key);}invalidate();if(retrieved)renderSelection();}
  if(task&&!memoryDirty)$('#memory-library').value=task.libraryId;
  $('#memory-library').disabled=!!activeMemoryTaskId||memoryBusy;
  $('#memory-task-status').textContent=task?`${task.name} · v${task.version} · ${task.coreEntryIds.length} 条重要记忆${memoryDirty?' · 修改尚未保存':''}`:'新建任务或选择已有任务，目标与记忆就能在不同 AI 网页继续使用。';
  $('#active-memory-label').textContent=task?`当前任务：${task.name} · v${task.version}。长期核心每轮自动携带。`:'未启用持续任务；可在“持续记忆”中创建或载入。';
  renderMemoryCores();renderMemoryRound();renderWorkspaceOverview();renderHandoffTask();
}
function renderMemoryRound(){
  const round=activeMemoryTaskId?activeRound(state,activeMemoryTaskId):null,task=taskById(state,activeMemoryTaskId);
  const queue=task?activeExtractionQueue(state,task.id):null;$('#cancel-memory-extraction-queue').hidden=!queue;$('#cancel-memory-extraction-queue').disabled=!queue||memoryBusy;$('#memory-queue-status').hidden=!queue;
  $('#memory-queue-status').textContent=queue?`连续提炼：已处理 ${queue.currentIndex} / ${queue.ranges.length} 片。更改本轮资料前需明确取消本批；当前片段、回执和已保存候选保留。`:'';
  const label=round?`${round.question||'继续当前任务'} · ${round.status==='prepared'?'资料已准备，请交给 AI':round.deliveryKind==='draft'?'已加入草稿，等待 AI 回复':'已复制，等待 AI 回复'} · 基于任务 v${round.baseVersion}${task?.version!==round.baseVersion?' · 任务已更新，点击“同步资料并复制”即可继续':''}`:'填写本轮问题，准备资料后即可继续。';
  $('#memory-round-status').textContent=label;
  $('#resume-memory-round').disabled=!round||memoryBusy||memoryDirty;
  $('#abandon-memory-round').disabled=!round||memoryBusy;
  $('#clear-memory-rounds').disabled=!task||memoryBusy;
  $('#sync-memory-round').disabled=!task||memoryBusy||memoryDirty;$('#sync-memory-reply').disabled=!task||memoryBusy||memoryDirty;
  const recent=(state.rounds||[]).filter(r=>r.taskId===activeMemoryTaskId).slice(-8).reverse();
  $('#memory-round-history').replaceChildren(...recent.map(r=>element('p',`${r.createdAt.slice(0,16).replace('T',' ')} · ${r.question.slice(0,100)} · ${{prepared:'已保存',delivered:'已交付草稿或剪贴板',completed:'已确认记忆更新',abandoned:'已放弃'}[r.status]}`,{class:'hint'})));
  $('#workflow-status').textContent=memoryDirty?'保存修改后，目标与重要记忆会用于下一轮。':!task?'先填写任务名称和目标，再保存任务。':'任务已就绪。在 AI 网页打开对话浮窗，即可携带目标和记忆继续交流。';
  $('#open-floating').disabled=!task||memoryBusy||memoryDirty;
}
async function checkpointForOutput(current){
  if(!current.memoryTask)return null;
  return repository.mutate(s=>{
    const existing=activeRound(s,current.memoryTask.id);
    protectQueuedPack(s,current.memoryTask.id,existing,current);
    if(existing){requireThat(existing.packSnapshot.id===current.id&&existing.packSnapshot.text===current.text,'当前预览与本轮记录不一致。请点击“同步资料并复制”，保留记录后继续。');resumeRound(s,existing.id);return clone(existing);}
    return prepareRound(s,current);
  });
}
async function outputPack(kind,publish){
  const reportSoft=softReporter(kind==='clipboard'?['copy-pack','sync-memory-round','sync-memory-reply']:['insert-pack','prepare-memory-web']);
  requireThat(!memoryBusy,'任务操作进行中，请稍候');memoryBusy=true;const generation=++memoryGeneration;let outputConfirmed=false;
  const unfreezeMemory=freezeControls($('#tab-memory'));
  try{
    let current=await currentPackForOutput();const context={...options(),memoryTaskId:activeMemoryTaskId};
    const unchanged=()=>generation===memoryGeneration&&pack?.id===current.id&&equal(context,{...options(),memoryTaskId:activeMemoryTaskId})&&!memoryDirty;
    if(kind==='draft'){
      publish('正在连接当前 AI 网页…');
      const actual=await bridge({type:'TARGET'});if(actual.status!=='ready')softPageResult(reportSoft,actual);requireThat(actual.status==='ready',actual.message||'无法连接当前网页');requireThat(unchanged(),'资料选择已改变，本次写入已停止');
      const bound=await bridge({type:'BIND',identity:identity(actual),libraryIds:context.libraryIds});requireThat(bound.status==='bound',bound.message||'当前网页连接失败');requireThat(unchanged(),'资料选择已改变，本次写入已停止');
      current=await repository.mutate(s=>retargetPack(s,current.id,identity(actual),context));requireThat(unchanged(),'资料选择已改变，本次写入已停止');
      pack=current;target=actual;binding=bound.binding;$('#target-status').textContent=`${actual.adapter} · 本次加入使用当前网页`;$('#draft-preview').textContent=actual.draft;
    }
    const round=await checkpointForOutput(current);
    requireThat(unchanged(),'资料选择已改变，请重新核对预览');
    if(kind==='clipboard'){await navigator.clipboard.writeText(current.text);outputConfirmed=true;reportSoft('copy_success');}
    else{draftResult=await bridge({type:'INSERT',packId:current.id,draftHash:target.draftHash});if(!['written','already_present'].includes(draftResult.status))reportSoft('insert_error');requireThat(['written','already_present'].includes(draftResult.status),draftResult.message);outputConfirmed=true;reportSoft('insert_success',draftResult.status==='already_present'?'draft_already_present':'insert_success');}
    if(round){try{await repository.mutate(s=>markRoundDelivered(s,round.id,{expectedVersion:round.version,deliveryKind:kind}));}
      catch(error){reportSoft('partial_success',kind==='clipboard'?'copied_tracking_pending':'partial_success');publish(`资料已${kind==='clipboard'?'复制':'加入草稿'}，但轮次状态保存失败：${error.message}。请恢复该轮核对后再试；不会自动重发。`,true);return;}}
    if(replyBuffer?.processed&&replyBuffer.context?.packId!==current.id)releaseProcessedReply();
    publish(kind==='clipboard'?'资料包已复制。可在目标网页自行粘贴；此操作不代表已发送。':draftResult.status==='written'?'已加入当前草稿并读回核对，尚未发送。':'同一资料包已存在，没有重复加入。');return true;
  }catch(error){if(kind==='draft'&&lastPackFailure)publish(`${error.message||error}。请先处理第 2 步列出的条目或预算原因，再准备资料。`,true);else if(kind==='draft'&&pack)publish(`${error.message||error}。本轮资料仍保留；回到要使用的 AI 网页再点“连接当前网页并加入草稿”，也可直接复制资料包。`,true);else throw error;}
  finally{memoryBusy=false;unfreezeMemory();try{await refresh();}catch(error){if(outputConfirmed)reportSoft('partial_success');throw error;}renderMemoryRound();}
}
async function rememberActiveTask(){if(globalThis.chrome?.storage?.local){const value=activeMemoryTaskId;memoryPreferenceWrite=memoryPreferenceWrite.catch(()=>{}).then(()=>chrome.storage.local.set({activeMemoryTaskId:value}));await memoryPreferenceWrite;}}
async function activateMemoryTask(taskId,{discard=false}={}){
  requireThat(!memoryBusy,'任务正在保存，请稍候');
  requireThat(discard||!memoryDirty,'任务有未保存修改，请保存，或点击“放弃修改并重载”');
  rememberQuickMemoryDraft();
  stopReplyReceiver('任务已载入或切换，需要时重新开启自动接收。');
  const request=++memoryGeneration;invalidate();const latest=await repository.snapshot();if(request!==memoryGeneration)return false;
  const task=taskId?taskById(latest,taskId):null;requireThat(!taskId||task,'任务已不存在');
  state=latest;activeMemoryTaskId=taskId;fillMemoryEditor(task);enabled=task?[task.libraryId]:enabled;binding=null;target=null;selected.clear();pinned.clear();retrieved=null;invalidate();
  $('#reply-recovery-text').value='';
  const activation=memoryGeneration;await bridge({type:'PAUSE'}).catch(()=>{});if(activation!==memoryGeneration||activeMemoryTaskId!==taskId)return false;await rememberActiveTask();if(activation!==memoryGeneration||activeMemoryTaskId!==taskId)return false;renderLibraries();renderMemoryTasks();
  let restoreFailed=false;
  if(task&&activeRound(state,taskId)&&!memoryDirty){
    try{const restored=resumeRound(state,activeRound(state,taskId).id);showRestoredPack(restored.pack);}
    catch(error){restoreFailed=true;const candidate=activeRound(state,taskId).packSnapshot,diagnostic=diagnosePack(state,candidate);showPackProblems(diagnostic,candidate);showReplySync('任务或资料已经更新。点击“同步资料并复制”会保留旧记录，并按当前任务准备资料。');notice(`任务已载入；此前资料暂不可输出：${diagnostic.issues.some(issue=>issue.blocking)?packFailureMessage(diagnostic):error.message}。处理具体原因后点“同步资料并复制”即可继续。`,true);}
  }
  showTab('memory');await refreshReplyRecovery().catch(error=>replyDraftStatus(error.message,true));return !restoreFailed;
}
async function retrieveCurrentMemory(){
  requireThat(enabled.length,'先在左侧勾选资料库');requireThat(!activeMemoryTaskId||!memoryDirty,'请先保存任务修改');
  const request=packGate.next(),query=$('#task').value,context=options(),taskId=activeMemoryTaskId,latest=await repository.snapshot();if(!packGate.current(request))return;
  state=latest;
  if(taskId){const result=taskSelection(latest,taskId,query,context);retrieved=result.retrieved;selected=new Set(result.selectedIds);pinned=new Set(result.pinnedIds);}
  else{retrieved=retrieve(latest,query,context);selected=new Set(retrieved.hits.slice(0,8).map(h=>h.id));pinned.clear();}
  renderSelection();return await rebuildPack();
}
async function prepareTaskRound({synchronize=false}={}){
  const reportSoft=softReporter(['prepare-memory-web','prepare-memory-handoff']);
  requireThat(!memoryBusy,'任务正在保存，请稍候');
  requireThat(activeMemoryTaskId&&!memoryDirty,'请先创建或载入任务，并保存修改');
  const request=++memoryGeneration,taskId=activeMemoryTaskId,question=$('#memory-question').value.trim(),context=options(),maxChars=Number($('#budget').value);
  clearPackProblems();memoryBusy=true;const unfreeze=freezeControls($('#tab-memory'));
  try{
    const built=await repository.mutate(s=>{
      const task=taskById(s,taskId);requireThat(task,'任务已不存在');const existing=activeRound(s,taskId);
      if(existing){
        requireThat(synchronize||!question||question===existing.question,'当前还有未完成轮次。要使用输入的新问题，点击“同步资料并复制”；旧问题及回复记录会保留。');
        const old=existing.packSnapshot,scope={...context,libraryIds:[task.libraryId]};
        if((!question||question===existing.question)&&equal(scope,old.options)&&maxChars===old.maxChars){try{return cacheCurrentPack(s,resumeRound(s,existing.id).pack);}catch{/* Build and validate current data below; failed validation preserves the old round. */}}
        const newQuestion=synchronize&&question&&question!==existing.question;
        const oldCore=new Set(old.memoryTask.coreEntryIds),kept=id=>!oldCore.has(id)||task.coreEntryIds.includes(id);
        const selection=newQuestion?taskSelection(s,taskId,question,scope):{selectedIds:old.selectedIds.filter(kept),pinnedIds:old.pinnedIds.filter(kept),retrieved:old.retrieved};
        const candidate=protectQueuedPack(s,taskId,existing,checkedPreparedPack(s,buildPack(s,{...scope,...selection,task:newQuestion?question:existing.question,memoryTaskId:taskId,maxChars,binding:null,...(!newQuestion&&old.sourceExtraction?{sourceExtraction:old.sourceExtraction}:{})})));
        const result=refreshTaskRound(s,existing.id,candidate,{expectedVersion:existing.version}).pack;return cacheCurrentPack(s,result);
      }
      const scope={...context,libraryIds:[task.libraryId]},selection=taskSelection(s,taskId,question||'继续当前任务',scope);
      const result=protectQueuedPack(s,taskId,null,checkedPreparedPack(s,buildPack(s,{...scope,...selection,task:question||'继续当前任务',memoryTaskId:taskId,maxChars,binding:null})));
      rememberPack(s,result);prepareRound(s,result);return result;
    });
    if(request!==memoryGeneration||taskId!==activeMemoryTaskId)return false;await refresh();if(request!==memoryGeneration)return false;
    releaseProcessedReply();showRestoredPack(built);hideReplySync();reportSoft('package_success');notice('本轮资料已保存。核对下方预览后，连接当前网页并加入草稿，或复制到任意 AI。');return true;
  }catch(error){if(request===memoryGeneration&&error.packDiagnostics){softPackIssues(reportSoft,error.packDiagnostics.issues);showPackProblems(error.packDiagnostics,error.diagnosticPack);$('#pack-status').textContent='未生成资料包，请处理下方原因。';}throw error;}
  finally{memoryBusy=false;unfreeze();renderMemoryCores();renderMemoryRound();}
}
for(const key of ['name','goal','constraints','progress','openQuestions'])on('#memory-'+key,'input',markMemoryDirty);
on('#memory-library','change',()=>{requireThat(!activeMemoryTaskId,'已有任务不能直接移动资料库');memoryCoreDraft.clear();markMemoryDirty();renderMemoryCores();});
on('#memory-core-search','input',renderMemoryCores);
on('#memory-question','input',()=>{if(replySession&&activeRound(state,activeMemoryTaskId))stopReplyReceiver('本轮问题已编辑，接收已暂停。');memoryGeneration++;invalidate();});
on('#load-memory-task','click',async()=>{const loaded=await activateMemoryTask($('#memory-task-select').value);if(loaded)notice('已载入本地任务；目标与核心记忆可跨 AI 使用。');return loaded;});
on('#memory-task-select','change',async()=>{try{await activateMemoryTask($('#memory-task-select').value);}finally{$('#memory-task-select').value=activeMemoryTaskId;}});
async function newWorkspaceTask(){const reportSoft=softReporter(['new-memory-task','workspace-new-task']);if(!await activateMemoryTask(''))return false;reportSoft('task_success','view_updated');showTab('memory');$('#memory-name').focus();notice('填写名称和目标。默认自动创建独立资料库，也可选择已有资料库。');}
on('#new-memory-task','click',newWorkspaceTask);
on('#workspace-new-task','click',newWorkspaceTask);
on('#task-browse-library','click',openTaskLibrary);
on('#task-import','click',openTaskImport);
on('#open-core-picker','click',()=>{$('#core-picker').open=!$('#core-picker').open;});
on('#workspace-create-library','click',async()=>{const reportSoft=softReporter(['workspace-create-library']),library=await repository.mutate(s=>createLibrary(s,$('#workspace-library-name').value));reportSoft('save_success');pendingLibrarySelection=library.id;await refresh();$('#workspace-library-name').value='';notice('资料库已创建。可以导入资料，或新建任务使用它。');});
on('#quick-memory-text','input',rememberQuickMemoryDraft);
on('#reload-memory-task','click',async()=>{const loaded=await activateMemoryTask(activeMemoryTaskId,{discard:true});if(loaded)notice('已放弃未保存修改，重新载入任务。');return loaded;});
function captureTaskInput(){const draft={id:activeMemoryTaskId||undefined,libraryId:$('#memory-library').value,coreEntryIds:[...memoryCoreDraft]};
  for(const key of ['name','goal','constraints','progress','openQuestions'])draft[key]=$('#memory-'+key).value;
  return draft;
}
async function persistTaskForm({quickContent=null}={}){
  if(memoryBusy)return false;rememberQuickMemoryDraft();const draft=captureTaskInput(),coreContext=coreOptions(),reportSoft=softReporter([quickContent!==null?'quick-add-memory':'save-memory-task']);if(!draft.goal.trim())reportSoft('missing_field');requireThat(draft.goal.trim(),'请填写任务目标');
  if(quickContent!==null)requireThat(draft.id,'请先保存任务，再添加重要记忆');
  const expectedVersion=memoryEditorVersion,request=++memoryGeneration,unfreeze=freezeControls($('#tab-memory'));memoryBusy=true;
  try{const saved=await repository.mutate(s=>{
    const existing=draft.id?taskById(s,draft.id):null;
    for(const key of draft.coreEntryIds.filter(key=>!existing?.coreEntryIds.includes(key))){const check=describeCoreEligibility(s,key,draft.libraryId,coreContext);requireThat(check.eligible,check.reasons.map(r=>r.message).join('；'));}
    return quickContent!==null?addQuickMemory(s,{taskInput:draft,content:quickContent},{expectedVersion}).task:draft.id?saveTask(s,draft,{expectedVersion}):createWorkspaceTask(s,draft,coreContext).task;
  });reportSoft('save_success');if(request!==memoryGeneration)return false;activeMemoryTaskId=saved.id;memoryDirty=false;
    const priorTaskId=draft.id||'';
    if(priorTaskId!==saved.id){const text=quickMemoryDrafts.get(priorTaskId);quickMemoryDrafts.delete(priorTaskId);if(text)quickMemoryDrafts.set(saved.id,text);if(quickMemoryTaskId===priorTaskId)quickMemoryTaskId=saved.id;}
    if(quickContent!==null&&quickMemoryTaskId===saved.id&&$('#quick-memory-text').value===quickContent){$('#quick-memory-text').value='';if(quickMemoryDrafts.get(saved.id)===quickContent)quickMemoryDrafts.delete(saved.id);}
    memoryEditorVersion=saved.version;for(const key of memoryAppliedCore)pinned.delete(key);for(const key of saved.coreEntryIds){selected.add(key);pinned.add(key);}memoryCoreDraft=new Set(saved.coreEntryIds);memoryAppliedCore=new Set(saved.coreEntryIds);
    if(expectedVersion===saved.version){try{await refresh();}catch(error){reportSoft('partial_success','saved_refresh_pending');notice(`任务已保存为 v${saved.version}，但界面刷新失败：${error.message}。请重新载入查看，无需重复保存。`,true);return true;}notice(`任务内容没有变化，仍为 v${saved.version}；本轮资料和现有回复继续有效。`);return true;}
    binding=null;target=null;invalidate();await bridge({type:'PAUSE'}).catch(()=>{});
    try{await rememberActiveTask();await refresh();}catch(error){reportSoft('partial_success','saved_refresh_pending');notice(`任务与重要记忆已保存为 v${saved.version}，但界面刷新或默认任务设置失败：${error.message}。请重新载入查看，请勿重复添加记忆。`,true);return true;}
    enabled=[saved.libraryId];renderLibraries();
    if(activeRound(state,saved.id))showReplySync('任务已修改，AI 网页仍可能持有旧资料。点击“同步资料并复制”继续本轮，不需要手动放弃。');
    notice(`任务已保存 · v${saved.version} · ${saved.coreEntryIds.length} 条重要记忆。${quickContent!==null?'新记忆与任务修改已一起保存。':'现在可以添加资料或打开对话浮窗。'}`);return true;}
  finally{memoryBusy=false;unfreeze();$('#memory-library').disabled=!!activeMemoryTaskId;renderMemoryCores();renderMemoryRound();renderWorkspaceOverview();}
}
on('#save-memory-task','click',()=>persistTaskForm());
on('#quick-add-memory','click',()=>persistTaskForm({quickContent:$('#quick-memory-text').value}));
on('#remember-core-selection','click',()=>{requireThat(!memoryBusy,'任务正在保存，请稍候');requireThat(activeMemoryTaskId,'先创建并保存任务');const task=taskById(state,activeMemoryTaskId);for(const key of selected){const check=describeCoreEligibility(state,key,task,coreOptions());requireThat(check.eligible,check.reasons.map(r=>r.message).join('；'));}for(const key of selected)memoryCoreDraft.add(key);markMemoryDirty();renderMemoryCores();showTab('memory');notice('已加入重要记忆草稿，请核对并保存任务。');});
onPack('#prepare-memory-web','click',prepareTaskRound,'正在准备本轮资料…');
onPack('#prepare-memory-handoff','click',prepareTaskRound,'正在恢复或准备接力资料…');
async function synchronizeAndCopy(publish){
  const reportSoft=softReporter(['sync-memory-round','sync-memory-reply']);
  requireThat(activeMemoryTaskId&&!memoryDirty&&!memoryBusy,'请先保存任务修改，再同步资料');
  const taskId=activeMemoryTaskId,text=$('#memory-update-text').value,record=await persistReplyDraft(text);
  requireThat(taskId===activeMemoryTaskId&&text===$('#memory-update-text').value,'任务或接收内容已改变，请重新同步');
  if(await prepareTaskRound({synchronize:true})!==true)return false;
  if(await outputPack('clipboard',publish)!==true)return false;
  if(taskId!==activeMemoryTaskId)return false;
  if(text&&text===$('#memory-update-text').value){
    try{await settleReplyDraft(record,'cleared');}catch(error){reportSoft('partial_success');notice('当前资料已复制，但接收原文尚未整理：'+error.message+'。原文仍保留，请先处理接收区。',true);return false;}
    if(text===$('#memory-update-text').value&&taskId===activeMemoryTaskId){$('#memory-update-text').value='';replyBuffer=null;replyProcessingError=null;clearMemoryPreview();}
  }
  stopReplyReceiver('当前资料已复制。粘贴并发送给 AI，等它回复后点击“读取最新回复”。');hideReplySync();
  await refreshReplyRecovery().catch(error=>replyDraftStatus(error.message,true));
  notice('已按当前任务同步并复制资料。粘贴发送给 AI 后，点击“读取最新回复”；已有任务进度和旧记录保留。');return true;
}
on('#sync-memory-round','click',()=>synchronizeAndCopy((message,error)=>notice(message,error)));
on('#sync-memory-reply','click',()=>synchronizeAndCopy((message,error)=>notice(message,error)));
on('#use-recommended-budget','click',async()=>{
  const reportSoft=softReporter(['use-recommended-budget']);
  requireThat(!memoryBusy&&!memoryDirty,'请先完成当前操作并保存任务修改');const failure=lastPackFailure,generation=memoryGeneration;requireThat(failure,'请先准备资料并查看预算诊断');
  const latest=await repository.snapshot();requireThat(!memoryBusy&&generation===memoryGeneration&&lastPackFailure===failure&&failure.taskId===activeMemoryTaskId&&equal(failure.context,options())&&failure.question===$('#memory-question').value,'任务或范围已改变，请重新准备资料');
  const original=failure.pack,identityDiagnostic=diagnosePack(latest,original);
  if(identityDiagnostic.issues.some(issue=>issue.blocking&&issue.reason!=='budget'&&issue.reason!=='conflict')){state=latest;showPackProblems(identityDiagnostic,original);throw Error(packFailureMessage(identityDiagnostic));}
  const candidate=buildPack(latest,{...original.options,task:original.task,selectedIds:original.selectedIds,pinnedIds:original.pinnedIds,maxChars:Number($('#budget').value),binding:null,retrieved:original.retrieved,memoryTaskId:original.memoryTask?.id||'',...(original.sourceExtraction?{sourceExtraction:original.sourceExtraction}:{})});
  const diagnostic=diagnosePack(latest,candidate);state=latest;showPackProblems(diagnostic,candidate);
  requireThat(diagnostic.canResolveByBudget&&Number.isInteger(diagnostic.recommendedBudget),packFailureMessage(diagnostic));
  $('#budget').value=String(diagnostic.recommendedBudget);invalidate();const request=++memoryGeneration,unfreeze=freezeControls($('#tab-memory'));memoryBusy=true;
  try{
    const built=await repository.mutate(s=>{
      requireThat(request===memoryGeneration&&failure.taskId===activeMemoryTaskId,'任务或范围已改变，请重新准备资料');
      if(original.memoryTask)requireThat(equal(taskById(s,original.memoryTask.id),original.memoryTask),'任务档案已更新，请载入最新任务后重新准备资料');
      const round=original.memoryTask?activeRound(s,original.memoryTask.id):null;
      requireThat((round?.id||null)===failure.roundId&&(round?.version||null)===failure.roundVersion,'轮次已改变，请重新查看本轮资料后重试');
      let result=checkedPreparedPack(s,buildPack(s,{...original.options,task:original.task,selectedIds:original.selectedIds,pinnedIds:original.pinnedIds,maxChars:diagnostic.recommendedBudget,binding:null,retrieved:original.retrieved,memoryTaskId:original.memoryTask?.id||'',...(original.sourceExtraction?{sourceExtraction:original.sourceExtraction}:{})}));
      result=protectQueuedPack(s,original.memoryTask?.id,round,result);
      if(round)result=refreshTaskRound(s,round.id,result,{expectedVersion:round.version}).pack;else if(result.memoryTask)prepareRound(s,result);
      return cacheCurrentPack(s,result);
    });
    if(request!==memoryGeneration)return false;await refresh();if(request!==memoryGeneration)return false;
    showRestoredPack(built);reportSoft('package_success');notice(`已按 ${diagnostic.recommendedBudget} 字符预算准备资料，保留本次选择和补充内容。请核对后加入草稿或复制。`);
  }catch(error){if(request===memoryGeneration&&error.packDiagnostics)showPackProblems(error.packDiagnostics,error.diagnosticPack);throw error;}
  finally{memoryBusy=false;unfreeze();renderMemoryCores();renderMemoryRound();}
});
function showRestoredPack(saved){
  binding=null;target=null;invalidate();pack=saved;enabled=[...saved.options.libraryIds];
  $('#scope').value=saved.options.scope;$('#as-of').value=saved.options.asOf;$('#include-disputed').checked=saved.options.includeDisputed;$('#budget').value=String(saved.maxChars);
  $('#task').value=saved.task;$('#memory-question').value=saved.task;selected=new Set(saved.selectedIds);pinned=new Set(saved.pinnedIds);retrieved=saved.retrieved;
  $('#pack-preview').value=saved.text;$('#pack-status').textContent=`已载入可核对预览，可以复制。${saved.included.length} 条 · ${saved.characters}/${saved.maxChars} 字符`;
  $('#draft-preview').textContent='点击加入时读取当前网页草稿。';$('#target-status').textContent='资料已保留；点击加入时连接当前 AI 网页。';
  renderLibraries();renderSelection();renderMemoryCores();renderMemoryRound();if(!$('#entry-read-view').hidden&&selectedEntry)renderEntryRead(selectedEntry);showTab('context');
}
on('#resume-memory-round','click',async()=>{
  const reportSoft=softReporter(['resume-memory-round']);
  requireThat(activeMemoryTaskId&&!memoryDirty&&!memoryBusy,'请先载入已保存任务');const taskId=activeMemoryTaskId,request=++memoryGeneration;memoryBusy=true;
  try{
    const restored=await repository.mutate(s=>{const round=activeRound(s,taskId);requireThat(round,'此任务没有未完成轮次');const result=resumeRound(s,round.id);s.packs=s.packs.filter(p=>p.id!==result.pack.id);rememberPack(s,result.pack);return result;});
    await bridge({type:'PAUSE'}).catch(()=>{});if(request!==memoryGeneration||taskId!==activeMemoryTaskId)return;
    await refresh();if(request!==memoryGeneration)return;showRestoredPack(restored.pack);reportSoft('package_success');notice('已恢复本轮问题、范围与资料包。可以再次复制到任意 AI；原网页绑定已解除。');
  }finally{memoryBusy=false;renderMemoryCores();renderMemoryRound();}
});
on('#cancel-memory-extraction-queue','click',async()=>{
  const reportSoft=softReporter(['cancel-memory-extraction-queue']);
  requireThat(activeMemoryTaskId&&!memoryBusy,'请先载入任务');const taskId=activeMemoryTaskId,queue=activeExtractionQueue(state,taskId);requireThat(queue,'此任务没有未结束的提炼批次');
  if(!window.confirm('取消这个提炼批次的剩余片段？当前片段、待处理回执、任务进度和已保存候选均保留；取消后可单独处理本片或明确改做新问题。')){reportSoft('canceled');return false;}
  memoryBusy=true;const unfreeze=freezeControls($('#tab-memory'));
  try{await repository.mutate(snapshot=>{const current=activeExtractionQueue(snapshot,taskId);requireThat(current?.id===queue.id,'提炼批次已改变，请重新载入');cancelExtractionQueue(snapshot,queue.id,{expectedVersion:queue.version});});await refresh();reportSoft('canceled');notice('提炼批次已取消；当前片段、回执和已保存候选保留。可继续处理本片，或同步新问题。');return true;}
  finally{memoryBusy=false;unfreeze();renderMemoryRound();}
});
on('#abandon-memory-round','click',async()=>{
  const reportSoft=softReporter(['abandon-memory-round']);
  requireThat(activeMemoryTaskId&&!memoryBusy,'请先载入任务');const round=activeRound(state,activeMemoryTaskId);requireThat(round,'没有未完成轮次');
  const queued=activeExtractionQueue(state,activeMemoryTaskId)?.activeRoundId===round.id;
  if(!window.confirm('放弃这个未完成轮次？已保存的任务目标与进度保留；已复制或已发送到外部的内容不会撤回。'+(queued?' 此轮属于连续提炼，同时取消这批剩余片段；已经保存的候选保留。':''))){reportSoft('canceled');return false;}
  memoryBusy=true;try{const cancelled=await repository.mutate(s=>{const queue=activeExtractionQueue(s,round.taskId);if(queue?.activeRoundId===round.id)cancelExtractionQueue(s,queue.id);abandonRound(s,round.id,{expectedVersion:round.version});return !!queue&&queue.activeRoundId===round.id;});clearMemoryPreview();invalidate();await refresh();reportSoft('canceled');notice('已放弃此轮，可以准备新一轮资料。'+(cancelled?' 关联提炼批次已取消，已保存候选保留。':''));}finally{memoryBusy=false;renderMemoryCores();renderMemoryRound();}
});
function requireClearableRoundHistory(snapshot,preview){
  const ids=new Set(preview.rounds.map(round=>round.id));
  requireThat(!(snapshot.extractionQueues||[]).some(queue=>queue.status!=='cancelled'&&[...queue.completedRoundIds,queue.activeRoundId].some(roundId=>ids.has(roundId))),'这些轮次仍是提炼批次的历史依据，暂不能清理；请保留快照并导出备份。未结束的批次可先取消，再清理其已结束轮次。');
}
on('#clear-memory-rounds','click',async()=>{
  const reportSoft=softReporter(['clear-memory-rounds']);
  requireThat(activeMemoryTaskId&&!memoryBusy,'请先载入任务');const latest=await repository.snapshot(),preview=closedRoundsPreview(latest,activeMemoryTaskId);
  requireThat(preview.rounds.length,'此任务没有已结束轮次');
  requireClearableRoundHistory(latest,preview);
  if(!window.confirm(`清理此任务的 ${preview.rounds.length} 个已结束轮次快照？需要留存时请先导出本地备份。任务档案、事实条目和未完成轮次均保留。`)){reportSoft('canceled');return false;}
  memoryBusy=true;try{const count=await repository.mutate(s=>{requireClearableRoundHistory(s,preview);return clearClosedRounds(s,preview);});await refresh();reportSoft('save_success');notice(`已清理 ${count} 个已结束轮次快照。`);}finally{memoryBusy=false;renderMemoryCores();renderMemoryRound();}
});
async function processMemorySearch(){
  const reportSoft=softReporter(['execute-memory-search','process-memory-reply','read-and-process-memory']);
  requireThat(!replyBuffer?.processed||replyBuffer.text!==$('#memory-update-text').value,'这份回复已经处理，请准备下一轮资料');
  requireThat(activeMemoryTaskId&&!memoryDirty&&!memoryBusy,'请先载入已保存任务');clearMemoryPreview();const request=memoryGeneration,taskId=activeMemoryTaskId,text=$('#memory-update-text').value,context=options(),question=$('#memory-question').value.trim()||$('#task').value.trim(),maxChars=Number($('#budget').value);
  const unfreeze=freezeControls($('#tab-memory'));memoryBusy=true;
  try{
    const record=await persistReplyDraft(text);requireThat(request===memoryGeneration&&taskId===activeMemoryTaskId&&text===$('#memory-update-text').value,'接收内容或任务已改变，请重新处理');
    const result=await repository.mutate(s=>{
      const search=executeMemorySearch(s,taskId,text,context),round=activeRound(s,taskId);
      // Supplementing a round must keep the already delivered evidence. It is
      // mandatory for this round only, not added to the task's permanent core.
      // The explicitly requested search results must be present in this reply;
      // never report successful supplementation after dropping every new hit.
      // These requirements belong only to this round, not permanent task core.
      const carried=round?.packSnapshot.included.map(item=>item.id)||[],pinnedIds=[...new Set([...carried,...(round?.packSnapshot.pinnedIds||[]),...search.pinnedIds,...search.selectedIds])];
      const selectedIds=[...new Set([...pinnedIds,...search.selectedIds])];
      const built=protectQueuedPack(s,taskId,round,checkedPreparedPack(s,buildPack(s,{...context,libraryIds:[taskById(s,taskId).libraryId],task:round?.question||question||search.query,maxChars,binding:null,memoryTaskId:taskId,...search,selectedIds,pinnedIds})));
      if(round)replaceRoundPack(s,round.id,built,{expectedVersion:round.version});rememberPack(s,built);return{pack:built,query:search.query,hits:search.retrieved.hits.length};
    });
    const ownsReply=request===memoryGeneration&&taskId===activeMemoryTaskId&&text===$('#memory-update-text').value;
    if(ownsReply){stopReplyReceiver('补充资料已准备；交给 AI 后重新开启接收。');markReplyProcessed('补充资料已准备。');}
    const committedGeneration=memoryGeneration,stillOwnsReply=()=>ownsReply&&committedGeneration===memoryGeneration&&taskId===activeMemoryTaskId;
    const warnings=[];try{await settleReplyDraft(record,'processed');}catch(error){warnings.push('原文已保存，但接收记录状态未更新：'+error.message);}
    if(!stillOwnsReply())return true;
    await bridge({type:'PAUSE'}).catch(()=>{});
    if(!stillOwnsReply())return true;
    try{await refresh();if(!stillOwnsReply())return true;showRestoredPack(result.pack);}catch(error){warnings.push('补充资料已准备，但界面刷新失败，请重新载入任务；不要重复处理：'+error.message);}
    await refreshReplyRecovery().catch(error=>replyDraftStatus(error.message,true));
    reportSoft(warnings.length?'partial_success':'package_success');
    notice(`已检索“${result.query}”，命中 ${result.hits} 条可输出资料；预览包含 ${result.pack.included.length} 条（含长期核心）。请核对后复制给 AI。`+(warnings.length?' '+warnings.join('；'):''));return true;
  }catch(error){if(request===memoryGeneration&&error.packDiagnostics)showPackProblems(error.packDiagnostics,error.diagnosticPack);throw error;}
  finally{memoryBusy=false;unfreeze();renderMemoryCores();renderMemoryRound();}
}
on('#execute-memory-search','click',processMemorySearch);
on('#memory-update-text','input',async()=>{const text=$('#memory-update-text').value,context=currentReplyContext();replyBuffer={source:'manual_edit',text,taskId:activeMemoryTaskId,context};replyProcessingError=null;clearMemoryPreview();showPendingReply();await persistReplyDraft(text,{context}).catch(()=>{});});
function replyStatus(message,kind='idle'){
  const root=$('#auto-memory-status');if(root.textContent!==message)root.textContent=message;if(root.getAttribute('data-state')!==kind)root.setAttribute('data-state',kind);
}
function replyDraftStatus(message,error=false){const root=$('#reply-draft-status');root.textContent=message;root.setAttribute('data-state',error?'blocked':'idle');}
function currentReplyContext(snapshot=state){
  const task=taskById(snapshot,activeMemoryTaskId);if(!task)return null;const round=activeRound(snapshot,task.id);
  return{taskId:task.id,libraryId:task.libraryId,baseVersion:task.version,roundId:round?.id||null,packId:round?.packSnapshot.id||null};
}
async function persistReplyDraft(text=$('#memory-update-text').value,{context=replyBuffer?.text===text&&replyBuffer.context?replyBuffer.context:currentReplyContext(),method=replyBuffer?.text===text&&['latest_reply_read','selection_read'].includes(replyBuffer.source)?replyBuffer.source:'manual_edit'}={}){
  if(!text||!context){if(!context&&text)replyDraftStatus('尚未载入任务，文字暂存在当前侧栏。',true);return null;}
  const key=JSON.stringify(context),generation=memoryGeneration;
  const pending=replyDraftQueue.catch(()=>{}).then(async()=>{
    const known=replyDraftRecords.get(key),previous=known?.status==='pending'?known:null,payload={writerId:replyWriterId,context:clone(context),text,method,expectedRevision:previous?.revision||0};if(previous)payload.recordId=previous.id;
    const result=await bridge({type:'SAVE_REPLY_DRAFT',payload});requireThat(result.status==='saved',result.message||'接收草稿保存失败，原文仍保留在当前侧栏');
    replyDraftRecords.set(key,result.record);
    if(generation===memoryGeneration&&activeMemoryTaskId===context.taskId&&$('#memory-update-text').value===text)replyDraftStatus('接收原文已保存在本地草稿；尚未写入任务记忆。');
    return result.record;
  });replyDraftQueue=pending.catch(()=>{});
  try{return await pending;}catch(error){if(generation===memoryGeneration&&$('#memory-update-text').value===text)replyDraftStatus('本地草稿尚未保存：'+error.message+'。请保留当前文字。',true);throw error;}
}
async function settleReplyDraft(record,status){
  if(!record)return;
  const pending=replyDraftQueue.catch(()=>{}).then(async()=>{
    const result=await bridge({type:'SETTLE_REPLY_DRAFT',payload:{recordId:record.id,expectedRevision:record.revision,writerId:replyWriterId,status}});
    requireThat(result.status==='settled',result.message||'接收记录状态尚未更新');
    replyDraftRecords.set(JSON.stringify(result.record.context),result.record);return result.record;
  });replyDraftQueue=pending.catch(()=>{});return pending;
}
async function refreshReplyRecovery(){
  const reportSoft=softReporter(['read-reply-drafts']);
  const taskId=activeMemoryTaskId;if(!taskId){replyRecoveryRows=[];selectOptions($('#reply-recovery-select'),[]);$('#restore-reply-draft').disabled=true;$('#discard-reply-draft').disabled=true;$('#reply-recovery-status').textContent='载入任务后可查看本地接收记录。';return;}
  const result=await bridge({type:'LIST_REPLY_DRAFTS',payload:{taskId}});if(taskId!==activeMemoryTaskId)return;
  requireThat(result.status==='listed',result.message||'无法读取本地接收草稿');replyRecoveryRows=result.records;
  selectOptions($('#reply-recovery-select'),replyRecoveryRows.map(row=>({id:row.record.id,name:`${row.record.updatedAt.slice(0,19).replace('T',' ')} · ${row.record.status==='pending'?'未确认':row.record.status==='processed'?'已处理':'已清空'} · ${row.eligibility==='current'?'当前轮次':row.eligibility==='invalid'?'待解析原文':'只读记录'}`})));
  $('#restore-reply-draft').disabled=!replyRecoveryRows.length;$('#discard-reply-draft').disabled=!replyRecoveryRows.length;
  reportSoft('task_success','saved_report_read');
  $('#reply-recovery-status').textContent=replyRecoveryRows.length?`本任务有 ${replyRecoveryRows.length} 份接收记录。恢复只读取本地内容，不访问 AI 网页。`:'本任务暂未保存接收草稿。';
  if(!$('#memory-update-text').value.trim()&&replyRecoveryRows.some(row=>row.record.status==='pending')){$('#reply-recovery').open=true;replyDraftStatus('发现未确认的本地接收记录，可在下方选择并恢复。');}
}
function markReplyProcessed(message){if(replyBuffer)replyBuffer.processed=true;else replyBuffer={source:'manual_edit',text:$('#memory-update-text').value,taskId:activeMemoryTaskId,context:currentReplyContext(),processed:true};replyProcessingError=null;clearMemoryPreview();replyDraftStatus('本轮处理已完成；原回复保存在本地接收记录中。');replyStatus(message+' 原回复保留在接收框和本地接收记录中。','received');}
function releaseProcessedReply(){if(replyBuffer?.processed&&replyBuffer.text===$('#memory-update-text').value){$('#memory-update-text').value='';replyBuffer=null;replyProcessingError=null;clearMemoryPreview();replyDraftStatus('已开始新一轮；上一轮原文仍可在接收记录中查看。');}}
function showPendingReply(){
  const text=$('#memory-update-text').value,source=replyBuffer?.text===text?replyBuffer:null;
  let message,kind='pending';
  if(source?.processed){message='这份回复已经处理。准备下一轮资料后可继续接收；原文保留在本地接收记录中。';kind='received';}
  else if(replyProcessingError?.text===text&&replyProcessingError.taskId===activeMemoryTaskId){message=replyProcessingError.message;kind='blocked';}
  else if(source?.taskId&&source.taskId!==activeMemoryTaskId){message='接收框保留了另一任务的回复，不能直接用于当前任务。请保留需要的文字，清空接收区后读取当前回复。';kind='blocked';}
  else if(memoryPreview){message=(source?.trigger==='automatic'?`已从 ${source.adapter} 自动接收。`:'记忆更新预览已就绪。')+'请核对下方预览，点击“确认更新进度并保存候选”；尚未写入任务记忆。';kind='received';}
  else{
    const inspected=inspectMemoryReply(text);
    if(inspected.status==='empty'){message=replyAuto?'接收区为空，等待当前网页的完整记忆回复。':'接收区为空。点击“读取最新回复”或开启自动接收。';kind='idle';}
    else if(inspected.status==='ready'){
      message=(source?.trigger==='automatic'?`已从 ${source.adapter} 自动接收`:'接收框已有')+(inspected.kind==='search'?'检索请求。点击“处理收到的回复”生成补充资料。':'记忆更新区段。点击“处理收到的回复”生成确认预览。');
    }else{message=inspected.message+' 框内文字已保留，自动读取正等待处理；需改读网页时，先清空接收区，再点“读取最新回复”。';kind='blocked';}
  }
  replyStatus(message,kind);return message;
}
function stopReplyReceiver(message='自动接收已关闭。'){
  replyEpoch++;if(replyTimer!==null)globalThis.clearTimeout?.(replyTimer);replyTimer=null;replyAuto=false;replySession=null;
  replyInbox.reset('stopped:'+replyEpoch);$('#auto-memory-toggle').checked=false;replyStatus(message);
}
function replyContext(latest,session){
  const task=taskById(latest,session.taskId),round=activeRound(latest,session.taskId);
  requireThat(task&&task.libraryId===session.libraryId,'任务或资料库已改变，请重新开启接收');
  requireThat(enabled.includes(task.libraryId),'任务资料库未启用，请重新载入任务');
  if(!round)return null;
  requireThat(equal(round.packSnapshot.memoryTask,task),'任务已更新，请准备新的本轮资料');
  requireThat(equal({...options(),libraryIds:[task.libraryId]},round.packSnapshot.options),'适用范围已改变，请重新准备资料后开启接收');
  const expected={taskId:task.id,baseVersion:task.version,packId:round.packSnapshot.id};
  const context=JSON.stringify({identity:session.identity,expected,roundId:round.id,roundVersion:round.version,options:options()});
  return{expected,context};
}
async function pollLatestReply(ticket){
  const session=replySession;if(ticket!==replyEpoch||!session)return;
  if(session.taskId!==activeMemoryTaskId||memoryDirty){stopReplyReceiver('任务已切换或有未保存修改，接收已暂停。');return;}
  if(memoryBusy)return;
  if($('#memory-update-text').value.trim()||memoryPreview){showPendingReply();return;}
  const generation=memoryGeneration,stillCurrent=()=>ticket===replyEpoch&&session===replySession&&generation===memoryGeneration&&!memoryBusy&&!memoryDirty&&session.taskId===activeMemoryTaskId;
  const latest=await repository.snapshot();if(!stillCurrent())return;
  const scope=replyContext(latest,session);if(!scope){replyStatus('等待准备下一轮资料；当前任务的自动接收仍开启。','waiting');return;}
  replyInbox.reset(scope.context);
  const result=await bridge({type:'READ_LATEST_REPLY',identity:session.identity,expected:scope.expected});if(!stillCurrent())return;
  if(result.status!=='reply_ready'){
    if(result.status==='stale_reply'){showReplySync((result.message||'网页回复与当前任务资料不一致')+'。点击下方“同步资料并复制”，把同步后的资料发给 AI 再读取回复。');replyStatus(result.message||'网页回复与当前资料不一致，请同步资料。','blocked');return 'stale_reply';}
    if(['stale_target','permission_required','unsupported','ambiguous_target'].includes(result.status)){stopReplyReceiver(result.message||'网页访问已变化，请回到目标网页重新开启接收。');return;}
    replyStatus(result.message||'等待本轮完整记忆区段；生成中的内容不会接收。',result.status==='waiting'?'waiting':'blocked');return result.status;
  }
  requireThat(equal(identity(result),session.identity),'回复页面已改变，请重新开启接收');
  const fresh=await repository.snapshot();if(!stillCurrent())return;
  requireThat(replyContext(fresh,session)?.context===scope.context,'读取期间轮次或范围已改变，已丢弃旧回复');
  const reply=validateInboxReply(fresh,session.taskId,result.text,options());
  const offered=await replyInbox.offer(reply,{context:scope.context,currentText:()=>$('#memory-update-text').value});if(!stillCurrent())return;
  if(!offered.accepted){replyStatus(offered.reason==='duplicate'?'这条回复已接收，等待 AI 的下一条回执。':'已有待处理内容，本次未覆盖。','pending');return;}
  hideReplySync();
  $('#memory-update-text').value=reply.text;replyBuffer={source:'latest_reply_read',trigger:replyAuto?'automatic':'button',text:reply.text,kind:reply.kind,taskId:reply.taskId,context:currentReplyContext(fresh),adapter:result.source?.adapter||session.identity.adapter};replyProcessingError=null;clearMemoryPreview();
  const acceptedGeneration=memoryGeneration;await persistReplyDraft(reply.text,{context:replyBuffer.context,method:'latest_reply_read'});
  if(ticket!==replyEpoch||session!==replySession||acceptedGeneration!==memoryGeneration||$('#memory-update-text').value!==reply.text)return;
  if(reply.kind==='update'){
    const prepared=await previewMemoryUpdate({receiverTicket:ticket});if(prepared!==true||ticket!==replyEpoch||session!==replySession)return;
    replyStatus(`已从 ${result.source?.adapter||session.identity.adapter} 接收记忆更新。核对后点击“确认更新进度并保存候选”。`,'received');
  }else{
    $('#memory-update-preview').textContent=`AI 请求补充资料：${reply.preview.query}\n点击“处理收到的回复”生成补充资料包，再由你发送给 AI。`;
    replyStatus('已接收检索请求，等待你确认处理。','received');notice('已接收 AI 的检索请求；点击“处理收到的回复”补充资料。');
  }
  return 'received';
}
function scheduleReplyPoll(ticket){
  if(!replyAuto||ticket!==replyEpoch||!replySession)return;
  replyTimer=globalThis.setTimeout?.(async()=>{
    replyTimer=null;
    try{await pollLatestReply(ticket);}catch(error){if(ticket===replyEpoch){if(/任务已更新|轮次|资料包|范围已改变/.test(error.message))showReplySync(error.message+'。点击“同步资料并复制”后，把当前资料发送给 AI 再读取回复。');stopReplyReceiver(error.message||'回复接收失败，请重新开启。');}}
    finally{scheduleReplyPoll(ticket);}
  },2000)??null;replyTimer?.unref?.();
}
async function startReplyReceiver(automatic=false){
  const reportSoft=softReporter(['read-latest-memory']);
  if(!automatic&&($('#memory-update-text').value.trim()||memoryPreview)){notice('接收框已有待处理内容，本次没有再次读取网页。'+showPendingReply(),true);return false;}
  stopReplyReceiver('正在连接当前 AI 回复页…');const ticket=replyEpoch,generation=memoryGeneration,taskId=activeMemoryTaskId;
  try{
  requireThat(taskId&&!memoryDirty&&!memoryBusy,'请先载入已保存任务并准备本轮资料');
  const latest=await repository.snapshot();if(ticket!==replyEpoch||generation!==memoryGeneration)return false;
  const task=taskById(latest,taskId);requireThat(task&&activeRound(latest,taskId),'请先准备本轮资料并交给 AI');
  const actual=await bridge({type:'TARGET'});if(ticket!==replyEpoch||generation!==memoryGeneration)return false;requireThat(actual.status==='ready',actual.message||'无法连接当前网页');
  const bound=await bridge({type:'BIND',identity:identity(actual),libraryIds:[task.libraryId]});if(ticket!==replyEpoch||generation!==memoryGeneration)return false;requireThat(bound.status==='bound',bound.message||'无法绑定当前网页');
  target=actual;binding=bound.binding;enabled=[task.libraryId];renderLibraries();$('#target-status').textContent=`${actual.adapter} · 已连接回复接收`;
  replySession={taskId,libraryId:task.libraryId,identity:identity(actual)};replyAuto=automatic;$('#auto-memory-toggle').checked=automatic;
    let status=await pollLatestReply(ticket);
    if(!automatic&&status==='waiting'&&ticket===replyEpoch&&globalThis.setTimeout){await new Promise(resolve=>globalThis.setTimeout(resolve,1200));if(ticket===replyEpoch)status=await pollLatestReply(ticket);}
    if(ticket===replyEpoch)scheduleReplyPoll(ticket);
    if(status==='received')reportSoft('task_success','reply_received');else if(status==='waiting')reportSoft('awaiting_result');
    if(status==='stale_reply'){reportSoft('page_not_ready');if(!automatic)notice($('#reply-sync-reason').textContent,true);return false;}
  }catch(error){if(ticket!==replyEpoch)return false;if(/任务已更新|轮次|资料包|范围已改变/.test(error.message))showReplySync(error.message+'。点击“同步资料并复制”后，把当前资料发送给 AI 再读取回复。');stopReplyReceiver(error.message||'读取失败');throw error;}
}
on('#read-latest-memory','click',()=>startReplyReceiver(false));
on('#auto-memory-toggle','change',async()=>{if(!$('#auto-memory-toggle').checked){stopReplyReceiver();return;}await startReplyReceiver(true);});
on('#clear-memory-reply','click',async()=>{
  const text=$('#memory-update-text').value,taskId=activeMemoryTaskId,generation=memoryGeneration;
  const record=await persistReplyDraft(text);if(generation!==memoryGeneration||taskId!==activeMemoryTaskId||text!==$('#memory-update-text').value)return false;
  requireThat(record||!text,'尚未载入任务，无法保存这段原文；请先载入任务后再清空');
  await settleReplyDraft(record,'cleared');if(generation!==memoryGeneration||taskId!==activeMemoryTaskId||text!==$('#memory-update-text').value)return false;
  replyBuffer=null;replyProcessingError=null;clearMemoryPreview();$('#memory-update-text').value='';replyStatus('已清空接收区；原文留在接收记录中，任务与事实保留。');
  await refreshReplyRecovery().catch(error=>replyDraftStatus(error.message,true));return true;
});
on('#read-reply-drafts','click',refreshReplyRecovery);
on('#restore-reply-draft','click',async()=>{
  requireThat(!memoryBusy&&!$('#memory-update-text').value,'接收框已有内容，请先处理或清空，恢复不会覆盖当前文字');
  const taskId=activeMemoryTaskId,generation=memoryGeneration,recordId=$('#reply-recovery-select').value;
  await refreshReplyRecovery();if(generation!==memoryGeneration||taskId!==activeMemoryTaskId||$('#memory-update-text').value)return false;
  const row=replyRecoveryRows.find(item=>item.record.id===recordId);requireThat(row,'请选择仍存在的接收记录');
  $('#reply-recovery-text').value=row.record.text;
  if(row.eligibility==='stale'){replyDraftStatus(row.message,true);notice('已在下方只读区显示原文。'+row.message);return true;}
  const claimed=await bridge({type:'CLAIM_REPLY_DRAFT',payload:{recordId,expectedRevision:row.record.revision,writerId:replyWriterId}});requireThat(claimed.status==='claimed',claimed.message||'接收记录已改变，请重新读取');
  if(generation!==memoryGeneration||taskId!==activeMemoryTaskId||$('#memory-update-text').value)return false;
  const latest=await repository.snapshot();if(generation!==memoryGeneration||taskId!==activeMemoryTaskId||$('#memory-update-text').value)return false;
  if(!equal(currentReplyContext(latest),claimed.record.context)){replyDraftStatus('任务或轮次已变化，原文仅在下方供查看。',true);return false;}
  stopReplyReceiver('已恢复本地原文，网页接收保持关闭。');replyDraftRecords.set(JSON.stringify(claimed.record.context),claimed.record);
  $('#memory-update-text').value=claimed.record.text;replyBuffer={source:'restored',text:claimed.record.text,taskId,context:claimed.record.context};replyProcessingError=null;clearMemoryPreview();
  replyDraftStatus('已恢复本地接收原文；尚未写入任务记忆。');showPendingReply();
  try{const reply=validateInboxReply(latest,taskId,claimed.record.text,options());if(reply.kind==='update')await previewMemoryUpdate();}
  catch(error){replyProcessingError={text:claimed.record.text,taskId,message:error.message};showPendingReply();notice('原文已恢复，暂不能确认：'+error.message,true);return false;}
  notice('已恢复原文并重新校验。确认更新前，请核对当前任务和预览。');return true;
});
on('#discard-reply-draft','click',async()=>{
  const taskId=activeMemoryTaskId,recordId=$('#reply-recovery-select').value;await refreshReplyRecovery();if(taskId!==activeMemoryTaskId)return false;
  const row=replyRecoveryRows.find(item=>item.record.id===recordId);requireThat(row,'请选择仍存在的接收记录');
  const claimed=await bridge({type:'CLAIM_REPLY_DRAFT',payload:{recordId,expectedRevision:row.record.revision,writerId:replyWriterId}});requireThat(claimed.status==='claimed',claimed.message);
  await settleReplyDraft(claimed.record,'cleared');await refreshReplyRecovery();notice('所选记录已标记为清空；原文仍可只读查看，容量不足时可被回收。');return true;
});
globalThis.addEventListener?.('pagehide',()=>{memoryGeneration++;stopReplyReceiver();});
async function readMemoryReply(){
  requireThat(!$('#memory-update-text').value,'接收框已有内容，请先处理或清空；读取不会覆盖当前文字');
  stopReplyReceiver('已切换为手动读取选区。');
  requireThat(activeMemoryTaskId&&!memoryDirty&&!memoryBusy,'请先载入已保存任务，再选中网页回复');const request=++memoryGeneration,taskId=activeMemoryTaskId,task=taskById(state,taskId);requireThat(task,'任务已不存在');
  // A first send may change / into a conversation URL. Explicitly reread and
  // bind the current page for this user action, without editing its draft.
  const actual=await bridge({type:'TARGET'});requireThat(actual.status==='ready',actual.message||'无法读取当前网页');if(request!==memoryGeneration)return false;
  const bound=await bridge({type:'BIND',identity:identity(actual),libraryIds:[task.libraryId]});requireThat(bound.status==='bound',bound.message);if(request!==memoryGeneration)return false;
  const result=await bridge({type:'READ_SELECTION',identity:identity(actual)});requireThat(result.status==='selected',result.message||'没有读到选中内容');if(request!==memoryGeneration)return false;
  target=actual;binding=bound.binding;enabled=[task.libraryId];renderLibraries();$('#target-status').textContent=`${actual.adapter} · 已连接当前回复页`;$('#draft-preview').textContent=actual.draft;
  $('#memory-update-text').value=result.text;replyBuffer={source:'selection_read',text:result.text,taskId,context:currentReplyContext(),adapter:actual.adapter};replyProcessingError=null;clearMemoryPreview();
  const receivedGeneration=memoryGeneration;await persistReplyDraft(result.text,{method:'selection_read'});if(receivedGeneration!==memoryGeneration||$('#memory-update-text').value!==result.text)return false;
  showPendingReply();notice('已读取网页选中的文本并保存本地草稿，尚未写入任务记忆。');return true;
}
on('#read-memory-reply','click',readMemoryReply);
async function previewMemoryUpdate({receiverTicket=null}={}){
  const reportSoft=softReporter(['preview-memory-update','process-memory-reply','read-and-process-memory']);
  requireThat(activeMemoryTaskId&&!memoryDirty,'请先载入已保存任务');clearMemoryPreview();const request=memoryGeneration,taskId=activeMemoryTaskId,text=$('#memory-update-text').value,latest=await repository.snapshot();if(request!==memoryGeneration||receiverTicket!==null&&receiverTicket!==replyEpoch)return false;
  const preview=prepareMemoryUpdate(latest,taskId,text),round=activeRound(latest,taskId);
  if(round)validateRoundUpdate(latest,round.id,{expectedVersion:round.version,taskId,baseVersion:preview.baseVersion,packId:preview.packId});
  memoryPreview=preview;memoryPreviewRound=round?{id:round.id,version:round.version}:null;
  $('#memory-update-preview').textContent=JSON.stringify({taskId:preview.taskId,baseVersion:preview.baseVersion,currentProgress:taskById(latest,taskId).progress,newProgress:preview.progress,openQuestions:preview.openQuestions,receivedFacts:preview.facts,newFactCount:preview.deduplication.newFacts,skippedDuplicateCount:preview.deduplication.deduplicated,excludedFactCount:preview.evidenceReview?.excludedCount||0,evidenceReview:preview.evidenceReview||null,note:preview.notice},null,2);
  $('#apply-memory-update').disabled=false;renderMemoryRound();reportSoft('task_success','view_updated');notice('更新预览已生成；请核对任务、进度及新增事实。');
  return true;
}
on('#preview-memory-update','click',previewMemoryUpdate);
async function processMemoryReply(){
  const text=$('#memory-update-text').value,taskId=activeMemoryTaskId;
  try{
    requireThat(!replyBuffer?.processed||replyBuffer.text!==text,'这份回复已经处理，请准备下一轮资料');
    await persistReplyDraft(text);if(text!==$('#memory-update-text').value||taskId!==activeMemoryTaskId)return false;
    const inspected=inspectMemoryReply(text);requireThat(inspected.status==='ready',inspected.message);
    const result=inspected.kind==='search'?await processMemorySearch():await previewMemoryUpdate();
    if(text===$('#memory-update-text').value&&taskId===activeMemoryTaskId&&result!==false){replyProcessingError=null;showPendingReply();}return result;
  }catch(error){if(text===$('#memory-update-text').value&&taskId===activeMemoryTaskId){replyProcessingError={text,taskId,message:error.message||String(error)};if(['version_conflict','round_stale','round_closed','round_not_delivered'].includes(error.code))showReplySync(error.message+'。可点击“同步资料并复制”按当前任务继续。');showPendingReply();}throw error;}
}
on('#process-memory-reply','click',processMemoryReply);
on('#read-and-process-memory','click',async()=>{if(!await readMemoryReply())return false;return await processMemoryReply();});
on('#apply-memory-update','click',async()=>{
  const reportSoft=softReporter(['apply-memory-update']);
  requireThat(memoryPreview&&!memoryDirty,'请先预览当前任务的记忆更新');if(memoryBusy)return;const preview=memoryPreview;requireThat(preview.taskId===activeMemoryTaskId,'任务已切换，请重新预览');
  const unfreeze=freezeControls($('#tab-memory'));memoryBusy=true;
  try{const record=await persistReplyDraft();requireThat(preview===memoryPreview&&preview.taskId===activeMemoryTaskId,'接收内容已改变，请重新预览');const result=await repository.mutate(s=>{
    const round=activeRound(s,preview.taskId);requireThat((round?.id||null)===(memoryPreviewRound?.id||null),'轮次在预览后改变，请重新预览');
    const roundOptions=round?{expectedVersion:memoryPreviewRound.version,taskId:preview.taskId,baseVersion:preview.baseVersion,packId:preview.packId}:null;
    if(round)validateRoundUpdate(s,round.id,roundOptions);const applied=applyMemoryUpdate(s,preview);if(round){completeRound(s,round.id,roundOptions);const queue=activeExtractionQueue(s,preview.taskId);if(queue?.activeRoundId===round.id){pauseExtractionQueue(s,queue.id);applied.queue=completeQueuedSlice(s,queue.id,round.id);}}return applied;
  });reportSoft('save_success');markReplyProcessed('记忆已确认并保存。');memoryEditorVersion=null;invalidate();
  const warnings=[];try{await settleReplyDraft(record,'processed');}catch(error){warnings.push('原文已保存，但接收记录状态未更新：'+error.message);}
  try{await refresh();}catch(error){warnings.push('记忆已保存，但界面刷新失败，请重新载入任务；不要重复确认：'+error.message);}
  await refreshReplyRecovery().catch(error=>replyDraftStatus(error.message,true));
  if(warnings.length)reportSoft('partial_success');
  notice(`进度已更新为 v${result.task.version}；${result.entries.length} 条新增事实保存为待审核。${result.deduplicated?`已跳过 ${result.deduplicated} 条重复候选。`:''}${result.excludedCount?` ${result.excludedCount} 条引用异常候选未收录，请查看接收记录。`:''}原回复已保留。${result.queue?result.queue.status==='completed'?' 本批提炼已完成，请到资料库集中审核候选。':' 本片已完成，批次已暂停；需要继续时在浮窗点击“继续本批”。':''}`+(warnings.length?' '+warnings.join('；'):''));return true;}
  finally{memoryBusy=false;unfreeze();$('#apply-memory-update').disabled=!memoryPreview;$('#memory-library').disabled=!!activeMemoryTaskId;renderMemoryCores();renderMemoryRound();}
});
function table(parent,headers,rows){const t=element('table',undefined,{class:'results-table'}),head=element('thead'),tr=element('tr');headers.forEach(h=>tr.append(element('th',h)));head.append(tr);t.append(head);const body=element('tbody');for(const row of rows){const r=element('tr');row.forEach(cell=>r.append(element('td',String(cell??''))));body.append(r);}t.append(body);parent.append(t);}
function download(name,value){const blob=new Blob([JSON.stringify(value,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=element('a',undefined,{href:url,download:name});document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}

for(const button of document.querySelectorAll('[data-tab]')){button.dataset.softAction='view-action';button.onclick=()=>runButtonAction(button,()=>showTab(button.dataset.tab));}
for(const selector of browserControls)on(selector,'input',()=>{if(entryBatchBusy)return;entryPage=1;$('#entry-list').scrollTop=0;clearEntryBatch();renderList();});
on('#show-entry-view','click',()=>setEntryBrowserMode('entries'));
on('#show-source-view','click',()=>setEntryBrowserMode('sources'));
on('#show-candidate-view','click',()=>setEntryBrowserMode('candidates'));
for(const selector of ['#candidate-source','#candidate-assessment','#candidate-search'])on(selector,'input',()=>{requireThat(!candidateBusy,'审核正在保存');clearCandidateSelection();candidatePage=1;renderCandidates();});
on('#candidate-prev','click',()=>{candidatePage--;renderCandidates();});on('#candidate-next','click',()=>{candidatePage++;renderCandidates();});
on('#candidate-clear-selection','click',()=>{clearCandidateSelection();renderCandidates();});
on('#candidate-review-preview-button','click',previewCandidateReview);on('#candidate-review-confirm','click',commitCandidateReview);
on('#candidate-review-cancel','click',()=>{candidateEpoch++;candidatePreview=null;$('#candidate-review-panel').hidden=true;renderCandidateSelection();});
for(const selector of ['#source-search','#source-filter'])on(selector,'input',()=>{sourcePage=1;renderSourceBrowser();rememberLibraryView();});
on('#source-prev','click',()=>{sourcePage--;renderSourceBrowser();rememberLibraryView();});
on('#source-next','click',()=>{sourcePage++;renderSourceBrowser();rememberLibraryView();});
on('#entry-library','input',()=>{if(entryBatchBusy)return;try{requireEntryNavigation();}catch(error){$('#entry-library').value=browserLibrary||'';throw error;}renderList();});
on('#entry-reset-filters','click',()=>{requireThat(!entryBatchBusy,'批量操作正在保存');renderList({resetFilters:true});});
function goEntryPage(page){requireThat(!entryBatchBusy,'批量操作正在保存');requireThat(Number.isSafeInteger(page)&&page>=1,'页码须为正整数');entryPage=page;$('#entry-list').scrollTop=0;renderList();}
on('#entry-prev','click',()=>goEntryPage(Math.max(1,entryPage-1)));on('#entry-next','click',()=>goEntryPage(entryPage+1));
on('#entry-page-go','click',()=>goEntryPage(Number($('#entry-page-number').value)));
on('#entry-page-number','keydown',event=>{if(event.key==='Enter'){event.preventDefault();goEntryPage(Number($('#entry-page-number').value));}});
on('#entry-select-page','change',()=>{
  requireThat(!entryBatchBusy,'批量操作正在保存');const ids=entryResult?.entries.map(entry=>entry.id)||[];
  if($('#entry-select-page').checked){const added=ids.filter(key=>!entryBatchSelection.has(key));if(entryBatchSelection.size+added.length>100){renderEntryBatch();throw Error('跨页合计最多选择 100 条，请先处理已选资料。');}for(const key of ids)entryBatchSelection.add(key);}else for(const key of ids)entryBatchSelection.delete(key);
  entryBatchEpoch++;entryBatchPreview=null;$('#entry-batch-panel').hidden=true;renderList();
});
on('#entry-clear-selection','click',()=>{clearEntryBatch();renderList();});
on('#entry-batch-add-tag','click',()=>previewEntryBatch('add_tag'));on('#entry-batch-archive','click',()=>previewEntryBatch('archive'));
on('#entry-batch-confirm','click',commitEntryBatch);on('#entry-batch-cancel','click',()=>{entryBatchEpoch++;entryBatchPreview=null;$('#entry-batch-panel').hidden=true;});
on('#entry-batch-tag','input',()=>{entryBatchEpoch++;entryBatchPreview=null;$('#entry-batch-panel').hidden=true;});
on('#memory-core-filter','input',()=>{corePage=1;renderMemoryCores();});
on('#memory-core-prev','click',()=>{corePage=Math.max(1,corePage-1);renderMemoryCores();});
on('#memory-core-next','click',()=>{corePage++;renderMemoryCores();});
for(const selector of ['#task','#scope','#as-of','#budget','#include-disputed'])on(selector,'input',()=>{if(replySession)stopReplyReceiver('本轮范围或资料设置已改变，接收已暂停。');memoryGeneration++;invalidate();if(['#scope','#as-of'].includes(selector)){renderMemoryCores();if(!$('#entry-read-view').hidden&&selectedEntry)renderEntryRead(selectedEntry);}});
let creatingLibrary=false;
on('#new-library','submit',async e=>{
  e.preventDefault();if(creatingLibrary)return;const reportSoft=softReporter(['new-library']),name=$('#library-name').value,unfreeze=freezeControls($('#new-library'));creatingLibrary=true;
  try{const library=await repository.mutate(s=>createLibrary(s,name));reportSoft('save_success');$('#library-name').value='';pendingLibrarySelection=library.id;invalidateImport();try{await refresh();}catch(error){reportSoft('partial_success','saved_refresh_pending');throw error;}notice(`资料库“${library.name}”已创建，已选为导入目标；对外使用前请勾选启用`);}
  finally{creatingLibrary=false;unfreeze();}
});
on('#new-entry','click',()=>{requireEntryNavigation();requireThat(state.libraries.length,'请先创建资料库');reviewQueue=null;entryBrowserMode='entries';selectedEntry=null;renderDetail(null);renderList();});
on('#seed-demo','click',async()=>{const reportSoft=softReporter(['seed-demo']),sha=await hash(demoText);await repository.mutate(s=>populateDemo(s,sha));reportSoft('save_success');try{await refresh();}catch(error){reportSoft('partial_success','saved_refresh_pending');throw error;}notice('已载入原创样例。请在左侧启用所需库，再检查参数冲突。');});
on('#open-manager','click',async()=>{const reportSoft=softReporter(['open-manager']),result=await bridge({type:'OPEN_MANAGER'});softPageResult(reportSoft,result,result.status==='opened'?'view_updated':null);requireThat(result.status==='opened',result.message);});
on('#open-floating','click',async()=>{
  const reportSoft=softReporter(['open-floating']);
  requireThat(activeMemoryTaskId&&!memoryDirty&&!memoryBusy,'请先保存当前任务');await rememberActiveTask();
  notice('正在当前 AI 网页打开浮窗…');const opened=await bridge({type:'OPEN_FLOATING'});softPageResult(reportSoft,opened,opened.status==='opened'?'floating_opened':null);requireThat(opened.status==='opened',opened.message||'无法打开浮窗，请先切回 AI 网页');
  notice('网页浮窗已打开。可拖动顶栏、调整大小，选择任务后直接输入并发送；记忆更新按浮窗中的保存设置处理。');return true;
});
async function connectWorkbenchSite(value){
  requireThat(!siteConnectionBusy,'正在连接网站，请稍候');
  const site=connectionSite(value);requireThat(site,'请选择支持的 AI 网站');siteConnectionBusy=true;
  const softAttempt=softAction('connect-site','begin','','','',normalizeSite(site.origin)),reportSoft=softReporter(['connect-site']);sitePicker?.setState({busy:true,message:`正在打开 ${site.name}…`});
  try{
    const result=await connectSite(site.origin,{api:globalThis.chrome,beforeNavigate:async()=>{
      stopReplyReceiver('已切换 AI 网站，待处理回复保留。');
      await rememberActiveTask();await bridge({type:'PAUSE'});target=null;binding=null;
    }});
    if(result.connected){$('#connect-site-origin').value=site.origin;sitePicker?.setState({site:site.origin,connected:true,message:result.message});}
    else sitePicker?.setState({message:result.message});
    reportSoft(result.connected?'task_success':'permission_error',result.connected?'site_connected':'permission_error');notice(result.message,!result.connected);return result;
  }catch(error){reportSoft('insert_error','operation_failed');sitePicker?.setState({message:error.message});throw error;}
  finally{siteConnectionBusy=false;sitePicker?.setState({busy:false});softAction('connect-site','end','','',softAttempt);}
}
function handoffHasPendingReply(snapshot=state){
  const task=taskById(snapshot,activeMemoryTaskId);
  return!!memoryPreview||!!(replyBuffer&&!replyBuffer.processed&&replyBuffer.text?.trim())||!!(!replyBuffer?.processed&&$('#memory-update-text').value.trim())||replyRecoveryRows.some(row=>row.record.status==='pending'&&row.record.context.taskId===task?.id&&row.record.context.baseVersion===task.version);
}
function invalidateHandoff(message='任务包尚未准备，点击预览查看本次交接内容。'){
  handoffEpoch++;handoffPreview=null;$('#handoff-copy').disabled=true;$('#handoff-preview').value='';$('#handoff-problems').replaceChildren();$('#handoff-problems').hidden=true;$('#handoff-summary').textContent=message;
}
function renderHandoffTask(){
  const task=taskById(state,activeMemoryTaskId),key=task?task.id+':'+task.version:'';
  if(key!==handoffTaskKey){const previous=handoffTaskKey.split(':')[0];handoffTaskKey=key;invalidateHandoff(task?`${task.name} · v${task.version}。选择目标 AI，预览后复制。`:'先创建或选择一个已保存任务。');
    if(task&&previous!==task.id){const round=activeRound(state,task.id);$('#handoff-question').value=round?.question||'';$('#handoff-budget').value=String(round?.packSnapshot.maxChars||12000);}
  }
  $('#handoff-preview-button').disabled=!task||memoryBusy||memoryDirty;
  if(memoryDirty)$('#handoff-copy').disabled=true;
}
function handoffInput(){
  return{taskId:activeMemoryTaskId,sourceSite:$('#handoff-source').value||'local',targetSite:$('#handoff-target').value,nextQuestion:$('#handoff-question').value,maxChars:Number($('#handoff-budget').value),pendingReply:handoffHasPendingReply()};
}
function paintHandoff(preview){
  $('#handoff-problems').replaceChildren();
  for(const problem of preview.blockers)$('#handoff-problems').append(element('p',problem.message,{class:'handoff-blocker'}));
  if(preview.blockers.some(problem=>problem.code==='pending_reply')){const button=element('button','查看待处理回复');button.addEventListener('click',()=>{showTab('memory');$('#manual-workflow').open=true;$('#reply-recovery').open=true;$('#reply-recovery').scrollIntoView?.({block:'center',behavior:'smooth'});});$('#handoff-problems').append(button);}
  for(const warning of preview.warnings)$('#handoff-problems').append(element('p',typeof warning==='string'?warning:warning.message,{class:'hint'}));
  $('#handoff-problems').hidden=preview.blockers.length===0&&preview.warnings.length===0;
  $('#handoff-preview').value=preview.ready?preview.pack.text:'';$('#handoff-copy').disabled=!preview.ready;
  const task=preview.task;
  $('#handoff-summary').textContent=preview.ready?`${task.name} · v${task.version} → ${preview.targetSite.name}。${preview.included.length} 条资料（${preview.included.filter(row=>row.core).length} 条核心），${preview.pack.characters} 字符。${preview.mode==='resume'?'继续同一问题，保留现有轮次。':'准备新的接续问题。'}尚未复制或发送。`:'任务包暂不可输出，请处理下面的原因。';
}
async function previewHandoff(){
  const reportSoft=softReporter(['handoff-preview-button']);
  requireThat(activeMemoryTaskId&&!memoryDirty&&!memoryBusy,'请先选择并保存任务');await refreshReplyRecovery();const input=handoffInput(),request=++handoffEpoch;
  const latest=await repository.snapshot();if(request!==handoffEpoch||!equal(input,handoffInput()))return false;
  handoffPreview=previewTaskHandoff(latest,{...input,pendingReply:handoffHasPendingReply(latest)});paintHandoff(handoffPreview);if(handoffPreview.ready)reportSoft('package_success');else softPackIssues(reportSoft,handoffPreview.blockers.map(issue=>({reason:issue.code,blocking:true})));return handoffPreview.ready;
}
async function copyHandoff(){
  const reportSoft=softReporter(['handoff-copy']);
  requireThat(handoffPreview?.ready&&!memoryDirty&&!memoryBusy,'先预览可用的接力任务包');await refreshReplyRecovery();requireThat(!handoffHasPendingReply(),'请先核对或保留当前待处理回复，再准备接力');
  const preview=handoffPreview,input=handoffInput(),request=handoffEpoch;memoryBusy=true;
  const unfreeze=freezeControls($('#handoff-panel'));
  try{
    const prepared=await repository.mutate(snapshot=>prepareTaskHandoff(snapshot,preview,{pendingReply:handoffHasPendingReply(snapshot)}));
    requireThat(request===handoffEpoch&&equal(input,handoffInput())&&!memoryDirty,'接力设置已改变，请重新预览');
    await refreshReplyRecovery();const latest=await repository.snapshot(),current=clipboardPack(latest,prepared.pack.id,prepared.context);
    requireThat(!handoffHasPendingReply(latest),'收到新的待处理回复，复制已暂停，请先核对');
    requireThat(request===handoffEpoch&&equal(input,handoffInput())&&!memoryDirty,'接力设置已改变，请重新预览');
    await navigator.clipboard.writeText(current.text);reportSoft('copy_success');
    try{await repository.mutate(snapshot=>markRoundDelivered(snapshot,prepared.round.id,{expectedVersion:prepared.round.version,deliveryKind:'clipboard'}));}
    catch(error){reportSoft('partial_success','copied_tracking_pending');invalidateHandoff('内容已复制，但交付记录保存失败；请核对本轮记录，勿重复发送。');notice(`接力包已复制，轮次记录未保存：${error.message}`,true);return false;}
    try{await refresh();handoffPreview=previewTaskHandoff(state,handoffInput());paintHandoff(handoffPreview);}
    catch(error){
      reportSoft('partial_success');
      invalidateHandoff('接力包已复制，轮次已记录；界面刷新失败，请重新打开工作台，不要重复发送。');
      notice(`接力包已复制，轮次已记录；界面刷新失败：${error.message}。请重新打开工作台，不要重复发送。`);return true;
    }
    $('#handoff-summary').textContent=`接力包已复制。打开 ${preview.targetSite.name} 后粘贴发送；同一个本地任务会继续使用。这一步没有向 AI 发送消息。`;
    notice('跨 AI 接力包已复制，目标、进度、核心记忆及回复格式已包含。');return true;
  }finally{memoryBusy=false;unfreeze();renderHandoffTask();renderWorkspaceOverview();renderMemoryRound();$('#handoff-copy').disabled=memoryDirty||!handoffPreview?.ready;}
}
on('#handoff-toggle','click',()=>{const panel=$('#handoff-panel');panel.hidden=!panel.hidden;$('#handoff-toggle').setAttribute('aria-expanded',String(!panel.hidden));renderHandoffTask();});
for(const site of supportedSites){$('#handoff-source').append(element('option',site.name,{value:site.origin}));$('#handoff-target').append(element('option',site.label||site.name,{value:site.origin}));}
$('#handoff-target').value='https://claude.ai';
for(const selector of ['#handoff-source','#handoff-target','#handoff-question','#handoff-budget'])on(selector,'input',()=>invalidateHandoff('接力设置已修改，请重新预览。'));
on('#handoff-preview-button','click',previewHandoff);
on('#handoff-copy','click',copyHandoff);
on('#handoff-open-target','click',()=>connectWorkbenchSite($('#handoff-target').value));
sitePicker=mountSitePicker({root:document,onConnect:async value=>{
  try{return await connectWorkbenchSite(value);}catch(error){notice(error.message,true);return false;}
}});
async function restoreSitePreference(){
  if(!globalThis.chrome?.storage?.local)return;
  const saved=await chrome.storage.local.get(SITE_PREFERENCE_KEY),site=connectionSite(saved[SITE_PREFERENCE_KEY]?.origin);if(!site)return;
  const granted=!!(await chrome.permissions?.contains?.({origins:[site.origin+'/*']}));
  $('#connect-site-origin').value=site.origin;applySiteTheme(site.origin,{root:document,connected:granted});sitePicker?.setState({site:site.origin,connected:granted,message:granted?`${site.name} 已授权；点击站点按钮打开网页。`:`上次选择 ${site.name}，点击连接后开始。`});
}
void restoreSitePreference().catch(()=>{});
// The floating action explicitly opens manager.html. An already-open sidepanel
// must not consume that request before the manager has had a chance to load.
function isHandoffManager(){return globalThis.location?.pathname?.endsWith('/manager.html')===true;}
globalThis.chrome?.storage?.onChanged?.addListener((changes,area)=>{if(!isHandoffManager()||area!=='local'||!changes.textMemoryOpenHandoff?.newValue)return;
  void(async()=>{if(memoryDirty||memoryBusy){notice('请先保存工作台中的修改，再展开“跨 AI 接力”。');return;}const saved=await chrome.storage.local.get('activeMemoryTaskId');if(saved.activeMemoryTaskId&&saved.activeMemoryTaskId!==activeMemoryTaskId)await activateMemoryTask(saved.activeMemoryTaskId);showTab('memory');$('#handoff-panel').hidden=false;$('#handoff-toggle').setAttribute('aria-expanded','true');await chrome.storage.local.set({textMemoryOpenHandoff:false});})().catch(error=>notice(error.message,true));
});
function showLiveCheck(report){const output=$('#site-self-test-result');output.textContent=JSON.stringify(report,null,2);output.closest('details').open=true;notice(describeLiveCheck(report),report.status!=='pass');return report.status==='pass';}
function showFunctionalCheck(report){const output=$('#functional-test-result');output.textContent=JSON.stringify(report,null,2);output.closest('details').open=true;
  notice(report.status==='pass'?`功能验收通过：${report.passed}/${report.total}。使用独立测试库，未修改正式资料。`:
    '功能验收未通过：'+((report.steps||[]).filter(s=>!s.ok).map(s=>`${s.name} → ${s.message}`).join('；')||report.message||report.status),report.status!=='pass');return report.status==='pass';}
for(const site of supportedSites)$('#connect-site-origin').append(element('option',site.label||site.name,{value:site.origin}));
on('#connect-site','click',()=>connectWorkbenchSite($('#connect-site-origin').value));
on('#site-self-test','click',async()=>{const reportSoft=softReporter(['site-self-test']),button=$('#site-self-test');button.disabled=true;notice('正在用独立测试库检查当前网页；请暂时不要编辑草稿或切换页面。');try{const report=await bridge({type:'SELF_TEST'});if(report.status==='pass')reportSoft('task_success','web_check_passed');else softPageResult(reportSoft,{status:report.steps?.find(step=>!step.ok)?.result||report.status});return showLiveCheck(report);}finally{button.disabled=false;}});
on('#read-site-self-test','click',async()=>{const reportSoft=softReporter(['read-site-self-test']);showLiveCheck(await bridge({type:'LAST_SELF_TEST'}));reportSoft('task_success','saved_report_read');});
on('#functional-test','click',async()=>{const reportSoft=softReporter(['functional-test']),button=$('#functional-test');button.disabled=true;notice('正在验收独立测试库的导入、审核、检索、检查、版本、事务和备份恢复。');try{const report=await bridge({type:'FUNCTIONAL_TEST'});reportSoft(report.status==='pass'?'task_success':'insert_error',report.status==='pass'?'functional_check_passed':'operation_failed');return showFunctionalCheck(report);}finally{button.disabled=false;}});
on('#read-functional-test','click',async()=>{const reportSoft=softReporter(['read-functional-test']);showFunctionalCheck(await bridge({type:'LAST_FUNCTIONAL_TEST'}));reportSoft('task_success','saved_report_read');});
let restartCheckBusy=false;
for(const [selector,type]of [['#prepare-restart-check','PREPARE_RESTART_CHECK'],['#verify-restart-check','VERIFY_RESTART_CHECK'],['#read-restart-check','LAST_RESTART_CHECK']])on(selector,'click',async()=>{
  const reportSoft=softReporter([selector.slice(1)]);if(restartCheckBusy)return false;restartCheckBusy=true;const buttons=['#prepare-restart-check','#verify-restart-check','#read-restart-check'].map($);for(const button of buttons)button.disabled=true;
  try{const report=await bridge({type}),output=$('#restart-check-result');output.textContent=JSON.stringify(report,null,2);output.closest('details').open=true;
    const message=report.status==='prepared'?'重启检查点已保存。请完全退出并重新打开浏览器，再点击验证。':report.status==='pass'?'重启持久化检查通过；独立测试库已读回核验。':report.status==='restart_not_observed'?'尚未观察到浏览器重启，本次不能判为通过。请完全退出并重新打开浏览器后验证。':'重启检查未通过：'+(report.message||(report.steps||[]).filter(step=>!step.ok).map(step=>step.message||step.result).join('；')||report.status||'请查看步骤结果');
    notice(message,!['prepared','pass'].includes(report.status));
    if(type==='LAST_RESTART_CHECK')reportSoft('task_success','saved_report_read');else if(report.status==='prepared')reportSoft('save_success');else reportSoft(report.status==='pass'?'task_success':'unverified',report.status==='pass'?'restart_check_passed':'unverified');
    return ['prepared','pass'].includes(report.status);
  }finally{restartCheckBusy=false;for(const button of buttons)button.disabled=false;}
});
on('#read-target','click',async()=>{const reportSoft=softReporter(['read-target']);target=await bridge({type:'TARGET'});binding=null;$('#target-status').textContent=target.status==='ready'?`${target.adapter} · 输入框已读取`:target.message;$('#draft-preview').textContent=target.draft??'未读取';softPageResult(reportSoft,target,target.status==='ready'?'draft_read':null);requireThat(target.status==='ready',target.message);notice('已读取可见输入框。本轮资料保留，可在第 2 步直接加入。');});
on('#bind-target','click',async()=>{const reportSoft=softReporter(['bind-target']);requireThat(target?.status==='ready','请先读取目标草稿');requireThat(enabled.length,'请先勾选本轮资料库');const result=await bridge({type:'BIND',identity:identity(target),libraryIds:enabled});softPageResult(reportSoft,result,result.status==='bound'?'page_bound':null);requireThat(result.status==='bound',result.message);binding=result.binding;notice('已连接当前页面。本轮资料保留；加入时还会核对当前网页。');});
on('#pause-target','click',async()=>{const reportSoft=softReporter(['pause-target']);stopReplyReceiver('网页访问与回复接收均已暂停。');memoryGeneration++;const result=await bridge({type:'PAUSE'});requireThat(result.status==='paused',result.message||'暂停尚未确认');reportSoft('task_success','access_paused');target=null;binding=null;$('#target-status').textContent='页面访问已暂停。本轮资料保留，可继续复制。';notice('已暂停页面访问，本轮资料仍保留。');});
onPack('#retrieve','click',retrieveCurrentMemory,'正在检索条目…');
on('#build-pack','click',rebuildPack);
onPack('#copy-pack','click',publish=>outputPack('clipboard',publish),'正在校验并复制资料包…');
onPack('#insert-pack','click',publish=>outputPack('draft',publish));
on('#undo-pack','click',async()=>{const reportSoft=softReporter(['undo-pack']),result=await bridge({type:'UNDO'});softPageResult(reportSoft,result,result.status==='undone'?'draft_restored':null);requireThat(result.status==='undone',result.message);target=null;binding=null;draftResult=null;notice('已恢复写入前草稿。本轮资料保留，可再次加入或复制。');});
on('#check-answer','click',async()=>{const reportSoft=softReporter(['check-answer']);state=await repository.snapshot();let input;try{input=JSON.parse($('#answer-json').value);}catch{input=$('#answer-json').value;}checkRun=checkStructured(state,input,{...options(),packId:pack?.id||'',pairingConfirmed:$('#pairing').checked});await repository.mutate(s=>s.runs.push(checkRun));const root=$('#check-results');root.replaceChildren();table(root,['结果','条目 / 字段','依据'],checkRun.results.map(r=>[r.result,`${r.entryId||''} / ${r.field||''}`,r.message]));for(const r of checkRun.results.filter(r=>r.entryId)){const button=element('button','定位 '+r.field);button.onclick=()=>runViewAction(button,()=>openLibraryEntry(r.entryId,{edit:true}));root.append(button);}const failed=checkRun.results.some(r=>r.result==='fail'),passed=checkRun.results.length>0&&checkRun.results.every(r=>r.result==='pass');reportSoft(failed?'insert_error':passed?'task_success':'unverified',failed?'operation_failed':passed?'operation_completed':'');notice('已检查手动提供的结构化映射；未推断任意自由文本。');});
on('#diagnose','click',async()=>{const reportSoft=softReporter(['diagnose']);state=await repository.snapshot();const report=diagnose(state,{watchIds:state.watches.filter(w=>enabled.includes(w.libraryId)).map(w=>w.id),options:{...options(),taskType:$('#watch-task').value},retrievedIds:retrieved?.hits.map(h=>h.id)||null,pack,draftResult,checkRun});const root=$('#diagnostic-results');root.replaceChildren(element('p',report.note,{class:'hint'}));table(root,['预期项','可观察状态','原因'],report.rows.map(r=>[r.watchId,r.codes.join(' · '),r.reason||r.exclusion||'服务器上下文未观察']));reportSoft('task_success',report.rows.length===0?'empty_result':'operation_completed');});
on('#run-probes','click',async()=>{const reportSoft=softReporter(['run-probes']),{runProbes}=await import('./core/probes.js');const result=await runProbes();$('#diagnostic-results').replaceChildren(element('h2','隔离规则与诊断回归'),element('pre',JSON.stringify(result,null,2)));const passed=result.total>0&&result.passed===result.total;reportSoft(passed?'task_success':'insert_error',passed?'operation_completed':'operation_failed');notice(`隔离案例：${result.passed}/${result.total} 符合预期。未调用真实模型，未写入正式资料库。`,!passed);return passed;});
on('#watch-form','submit',async e=>{e.preventDefault();const reportSoft=softReporter(['watch-form']),entryId=$('#watch-entry').value,fields=$('#watch-fields').value.split(/[,，]/).map(x=>x.trim()).filter(Boolean),taskType=$('#watch-task').value;await repository.mutate(s=>{const entry=s.entries.find(e=>e.id===entryId);requireThat(entry,'请选择仍存在的条目');requireThat(fields.length>0&&fields.every(f=>Object.hasOwn(entry.fields,f)),'预期字段必须存在于当前条目');s.watches.push({id:id('watch'),entryId:entry.id,libraryId:entry.libraryId,fields,taskType,confirmed:true,createdAt:now()});});reportSoft('save_success');try{await refresh();}catch(error){reportSoft('partial_success','saved_refresh_pending');throw error;}notice('已创建独立于检索结果的关键检查项');});
on('#template-select','change',()=>{const t=latestTemplates().find(t=>t.id===$('#template-select').value);templateId=t?.id||null;templateVersion=t?.version||null;templateDraft=clone(t?.fields||[]);$('#template-name').value=t?.name||'';renderTemplateFields();});
on('#add-field','click',()=>{templateDraft.push({name:'field'+(templateDraft.length+1),type:'string',required:false,label:''});renderTemplateFields();});
let templateSaving=false;
on('#save-template','click',async()=>{if(templateSaving)return;const reportSoft=softReporter(['save-template']),draft={id:templateId,name:$('#template-name').value,fields:clone(templateDraft)},expectedVersion=templateVersion,unfreeze=freezeControls($('#tab-schemas'));templateSaving=true;
  try{const t=await repository.mutate(s=>saveTemplate(s,draft,{expectedVersion}));reportSoft('save_success');templateId=t.id;templateVersion=t.version;try{await refresh();}catch(error){reportSoft('partial_success','saved_refresh_pending');throw error;}$('#template-select').value=t.id;notice(`模板 v${t.version} 已保存；既有条目仍使用其已审核版本`);}finally{templateSaving=false;unfreeze();}});
on('#load-schema-draft','click',()=>{const reportSoft=softReporter(['load-schema-draft']),value=JSON.parse($('#schema-draft').value);const draft=value.template||value;requireThat(Array.isArray(draft.fields),'草案缺少 fields');templateId=null;templateVersion=null;templateDraft=clone(draft.fields);$('#template-name').value=draft.name||'';renderTemplateFields();reportSoft('task_success','operation_completed');notice('已载入草案，尚未保存。请核对字段后确认模板。');});
on('#migrate-template','click',async()=>{const reportSoft=softReporter(['migrate-template']),session=editorToken,libraryId=$('#entry-library').value,t=latestTemplates().find(t=>t.id===$('#template-select').value);requireThat(t,'先选择目标模板');const current=await repository.snapshot(),entries=current.entries.filter(e=>e.libraryId===libraryId&&e.schemaId===t.id&&e.schemaVersion!==t.version);const preview=migrationPreview(current,entries.map(e=>e.id),t);requireThat(!preview.some(p=>p.errors.length),JSON.stringify(preview.filter(p=>p.errors.length)));requireThat(preview.length,'当前库没有需要迁移的同模板条目');if(!window.confirm(`将 ${preview.length} 条记录迁移至 v${t.version} 并改为待确认，旧版本保留。继续？`)){reportSoft('canceled');return false;}await repository.mutate(s=>migrateEntries(s,preview,t.id,t.version));reportSoft('save_success');try{await refresh({detail:true,editorSession:session});}catch(error){reportSoft('partial_success','saved_refresh_pending');throw error;}notice('迁移完成，请重新核对条目');});
on('#rule-form','submit',async e=>{e.preventDefault();const reportSoft=softReporter(['rule-form']),type=$('#rule-type').value,raw=$('#rule-value').value,value=raw?JSON.parse(raw):null;const rule={id:id('rule'),version:1,libraryId:$('#rule-library').value,entryId:$('#rule-entry').value,field:$('#rule-field').value,type,scope:$('#rule-scope').value,confirmed:true,createdAt:now()};if(type==='enum')rule.values=value;else if(type==='transition'){rule.allowed=value;rule.confirmationRequired=$('#rule-confirmation').value||null;}else rule.value=value;if($('#rule-exception').value)rule.exception=JSON.parse($('#rule-exception').value);validateRule(rule);await repository.mutate(s=>{requireThat(s.libraries.some(l=>l.id===rule.libraryId),'库不存在');requireThat(!rule.entryId||s.entries.some(e=>e.id===rule.entryId&&e.libraryId===rule.libraryId),'条目必须属于仍存在的所选库');s.rules.push(rule);event(s,'rule_confirmed',rule.id);});reportSoft('save_success');try{await refresh();}catch(error){reportSoft('partial_success','saved_refresh_pending');throw error;}notice('规则已由用户确认，后续检查使用此版本');});
function syncImportControls(){$('#commit-import').disabled=!imports.ready||imports.busy;$('#preview-import').disabled=imports.busy;}
function invalidateImport(){const token=imports.invalidate();syncImportControls();$('#import-preview').textContent='输入已改变，请重新预检。';return token;}
for(const selector of ['#import-text','#import-name','#import-library','#import-sensitivity','#map-title','#map-content','#map-fields'])on(selector,'input',invalidateImport);
on('#import-file','change',async()=>{const token=invalidateImport(),file=$('#import-file').files[0];if(!file)return;requireThat(file.size<=20*1024*1024,'文件超过 20 MB');const text=await file.text();if(!imports.current(token))return;$('#import-text').value=text;$('#import-name').value=file.name;});
on('#preview-import','click',async()=>{
  const reportSoft=softReporter(['preview-import']),form={text:$('#import-text').value,name:$('#import-name').value,libraryId:$('#import-library').value,sensitivity:$('#import-sensitivity').value,mapping:{title:$('#map-title').value,content:$('#map-content').value,fields:$('#map-fields').value}};
  const pending=imports.prepare(form,async frozen=>{requireThat(frozen.text.length<=20*1024*1024,'输入过大');const current=await repository.snapshot();let json;if(/^[\s]*[\[{]/.test(frozen.text))json=JSON.parse(frozen.text);
    if(json?.format==='text-memory-backup')return{kind:'backup',data:await preflightBackup(json,current)};
    if(json?.format==='text-memory-exchange')return{kind:'exchange',data:await preflightExchange(json)};
    const library=requireImportLibrary(current,frozen.libraryId);
    if(json)return{kind:'rows',libraryName:library.name,data:prepareRows(json,frozen.mapping)};
    return{kind:'text',libraryName:library.name,data:await prepareText(frozen.name,frozen.text,frozen.sensitivity)};
  });syncImportControls();const prepared=await pending;if(!prepared)return;
  const count=prepared.data.count??prepared.data.length??prepared.data.counts;
  $('#import-preview').textContent=[`目标：${prepared.libraryName||(prepared.kind==='exchange'?'创建独立新库':'按备份中的资料库恢复')}`,`数量：${typeof count==='object'?JSON.stringify(count):count??'见来源'}`,`分类：${prepared.kind==='backup'?'保留备份原有分类':prepared.form.sensitivity==='local_only'?'仅限本地，不会输出到 AI':'普通资料；文件原有的本地限制保留'}`,prepared.data.notice||'导入后为待审核资料。核对确认后，才能用于 AI 对话。'].join('\n\n');syncImportControls();reportSoft('task_success','operation_completed');
  notice('预检通过，尚未导入。请核对下方预览，再点击“确认导入”。');
});
on('#commit-import','click',async()=>{const reportSoft=softReporter(['commit-import']),libraryId=$('#import-library').value,committing=imports.commit(prepared=>repository.mutate(s=>commitPreparedImport(s,prepared)));syncImportControls();try{await committing;reportSoft('save_success');try{await refresh();}catch(error){reportSoft('partial_success','saved_refresh_pending');throw error;}$('#view-imported-entries').hidden=false;$('#view-imported-entries').dataset.libraryId=libraryId;notice('导入完成。点击“查看导入资料”核对待审核内容。');}finally{syncImportControls();}});
on('#view-imported-entries','click',()=>{requireEntryNavigation();const libraryId=$('#view-imported-entries').dataset.libraryId;if(state.libraries.some(l=>l.id===libraryId))$('#entry-library').value=libraryId;renderList({resetFilters:true});reviewQueue=null;entryBrowserMode='entries';$('#entry-filter').value='pending';selectedEntry=null;renderEntryRead(null);renderList();showTab('entries');});
on('#export-backup','click',async()=>{const reportSoft=softReporter(['export-backup']),latest=await repository.snapshot(),restricted=latest.entries.filter(e=>e.sensitivity==='local_only').length;if(!window.confirm(`导出 ${latest.entries.length} 条记录、${latest.versions.length} 个版本和 ${latest.sources.length} 个来源，包含 ${restricted} 条仅限本地记录。此文件是本地备份，请勿直接发给 AI。继续？`)){reportSoft('canceled');return false;}download('text-memory-backup-'+new Date().toISOString().slice(0,10)+'.json',exportBackup(latest));reportSoft('awaiting_result','download_requested');notice('备份下载已请求，请确认浏览器保存完成');});

try{await refresh();showTab('memory');if(globalThis.chrome?.storage?.local){const generation=memoryGeneration,saved=await chrome.storage.local.get(['activeMemoryTaskId','textMemoryOpenHandoff']);if(generation===memoryGeneration&&!memoryDirty&&saved.activeMemoryTaskId&&taskById(state,saved.activeMemoryTaskId)){await activateMemoryTask(saved.activeMemoryTaskId);}if(saved.textMemoryOpenHandoff&&isHandoffManager()){$('#handoff-panel').hidden=false;$('#handoff-toggle').setAttribute('aria-expanded','true');await chrome.storage.local.set({textMemoryOpenHandoff:false});}}
  const channel=new BroadcastChannel('text-memory-changed');channel.onmessage=()=>{void refresh().catch(e=>notice(e.message,true));};
  if(!globalThis.chrome?.runtime?.id)notice('这是独立开发页面，数据属于当前网页源，与真实扩展不自动共享。',true);
}catch(error){notice('数据库无法打开：'+error.message+'。请保留现有扩展数据，重新打开后重试。',true);}
