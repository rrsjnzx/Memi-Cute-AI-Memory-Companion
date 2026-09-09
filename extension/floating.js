import {Repository} from './storage.js';
import {clone,equal,id,requireThat} from './core/base.js';
import {taskById,taskSelection} from './core/tasks.js';
import {buildPack,validatePack,diagnosePack,rememberPack} from './core/pack.js';
import {activeRound,prepareRound,resumeRound,replaceRoundPack,markRoundDelivered,validateRoundUpdate,completeRound,abandonRound} from './core/rounds.js';
import {refreshTaskRound} from './core/round-workflow.js';
import {retargetPack} from './core/delivery.js';
import {validateInboxReply} from './core/reply-inbox.js';
import {rejectedReplyBlock} from './core/rejected-reply.js';
import {applyMemoryUpdate} from './core/memory-updates.js';
import {describeMemoryUpdate} from './core/memory-review.js';
import {executeMemorySearch} from './core/memory-requests.js';
import {appendChatRow,upsertAssistantDisplay,emptyChatView} from './core/chat-view.js';
import {createSourceExtraction,nextExtractionOffset} from './core/source-extraction.js';
import {createExtractionQueue,activeExtractionQueue,extractionQueueById,prepareQueuedSlice,completeQueuedSlice,pauseExtractionQueue,resumeExtractionQueue,cancelExtractionQueue} from './core/extraction-queue.js';
import {connectSite} from './site-connection.js';
import {mountSitePicker,applySiteTheme} from './site-theme.js';

const $=selector=>document.querySelector(selector);
const floatingToken=new URLSearchParams(location.search).get('token')||'';
const writerId=id('floating_reply');
let repository=null,state=null,taskId='',busy=false,authorized=false,closed=false,epoch=0,pollTimer=null,pending=null,recoveryRows=[],collapsed=false,closeUnsavedWarning=false;
let chatView=null,chatQueue=Promise.resolve(),chatTimer=null,chatGeneration=0,chatSavedGeneration=0,lastDeliveryIdentity=null,currentOrigin=null,liveDisplay=null;
let renderedReview=null,undoableNotice=null;
let changeChannel=null,starting=true,changeRequested=false,changeReading=false,changeGeneration=0,changeFailureMessage=null;
// Permission to run a batch belongs to this open window only. Persisted queue
// state is a checkpoint, never permission to send after a reload.
let runningQueueId=null,queueTimer=null,queueWaitUntil=0;
function stopQueueRunner(){runningQueueId=null;queueWaitUntil=0;clearTimeout(queueTimer);queueTimer=null;}
async function pauseQueueRun(){
  const queueId=runningQueueId;stopQueueRunner();
  if(queueId)await repository.mutate(snapshot=>{const queue=extractionQueueById(snapshot,queueId);if(queue&&['ready','paused'].includes(queue.status))pauseExtractionQueue(snapshot,queue.id);});
}
const chatRevisions=new Map();
const identity=value=>Object.fromEntries(['tabId','documentId','url','pageKey','conversation','temporary','adapter','adapterVersion'].map(key=>[key,value[key]]));
const bridge=message=>chrome.runtime.sendMessage({...message,floatingToken});
function status(message,error=false,undoable=null){$('#status').textContent=message;$('#status').dataset.state=error?'error':'success';if(error){undoableNotice=undoable?{...undoable,message}:null;$('#exception').hidden=false;$('#exception-message').textContent=message;}}
function clearException(){undoableNotice=null;$('#exception').hidden=true;$('#exception-message').textContent='';}
function stopAuto(){clearTimeout(pollTimer);pollTimer=null;$('#auto-read').checked=false;}
async function authorize(){
  requireThat(!closed&&floatingToken,'此浮窗未连接到 AI 网页，请从扩展重新打开');
  let result;
  for(let attempt=0;attempt<10;attempt++){
    try{result=await bridge({type:'FLOATING_HELLO'});}catch(error){showVerifiedDestination(null);throw error;}
    if(result.status!=='waiting'||result.reason!=='floating_transition_pending')break;
    status(result.message||'等待网站建立本次会话…');await new Promise(resolve=>setTimeout(resolve,1000));requireThat(!closed,'聊天窗口已关闭');
  }
  if(result.status!=='authorized'){authorized=false;showVerifiedDestination(null);stopAuto();throw Error(result.message||'浮窗连接已过期，请从此网页重新打开扩展。当前文字仍保留。');}
  authorized=true;
}
function layout(action,extra={}){if(!closed&&(authorized||action==='move'||action==='resize'))parent.postMessage({type:'TEXT_MEMORY_FLOATING_LAYOUT',action,...extra},'*');}
function setCollapsed(value){collapsed=value;document.body.classList.toggle('collapsed',value);$('#collapse').textContent=value?'展开':'收起';$('#collapse').setAttribute('aria-label',value?'展开窗口':'收起窗口');layout(value?'collapse':'expand');}
function contextFor(snapshot=state){const task=taskById(snapshot,taskId),round=activeRound(snapshot,taskId);requireThat(task,'请先选择已保存任务');return{taskId:task.id,libraryId:task.libraryId,baseVersion:task.version,roundId:round?.id||null,packId:round?.packSnapshot.id||null};}
function scopeFor(task){return{libraryIds:[task.libraryId],scope:$('#scope').value,asOf:$('#as-of').value,includeDisputed:$('#disputed').checked};}
function resetPending(){pending=null;$('#protocol').value='';$('#memory-preview').textContent='';$('#memory-actions').hidden=true;$('#confirm-update').disabled=true;$('#supplement').hidden=true;$('#reply-state').textContent='尚未接收';renderReview();}
function renderReview(){
  const receipt=pending,review=receipt?.review,visible=!!(review&&receipt.reply?.kind==='update'&&!receipt.processed);
  $('#review-card').hidden=!visible;$('#review-confirm').disabled=busy||!visible;$('#review-skip').disabled=busy||!visible;
  if(!visible){renderedReview=null;return;}if(renderedReview===review)return;renderedReview=review;
  $('#review-heading').textContent='核对这次任务记忆';
  $('#review-summary').textContent=`${review.changedFields.length} 项文字变化 · ${review.factCount} 条新事实候选${review.duplicateCount?` · ${review.duplicateCount} 条重复候选跳过`:''}${review.excludedCount?` · ${review.excludedCount} 条引用异常不收录`:''} · 尚未保存`;
  $('#review-notices').replaceChildren();
  for(const notice of review.notices){const item=document.createElement('p');item.textContent=notice;$('#review-notices').append(item);}
  $('#review-evidence').replaceChildren();
  if(review.extraction){
    for(const check of receipt.reply.preview.evidenceReview?.factChecks||[]){
      const fact=receipt.reply.preview.facts[check.factIndex],item=document.createElement('article'),title=document.createElement('strong'),text=document.createElement('p'),statusText=document.createElement('p');
      item.className='evidence-candidate';title.textContent=fact.title;text.textContent=fact.content;statusText.textContent=check.status==='excluded'?'不收录：'+check.issues.map(issue=>issue.message).join('；'):'逐字引用匹配；含义仍待核对。AI 自评：'+({supported:'有支持',uncertain:'证据不足',conflict:'可能冲突'}[check.assessment]||'未说明');
      statusText.className=check.status==='excluded'||check.assessment!=='supported'?'evidence-warning':'hint';item.append(title);item.append(text);item.append(statusText);
      for(const ref of check.sourceRefs||[]){const quote=document.createElement('blockquote');quote.textContent=ref.quote;item.append(quote);}$('#review-evidence').append(item);
    }
  }
  $('#review-fields').replaceChildren();
  for(const field of review.fields){
    const section=document.createElement('section'),heading=document.createElement('strong');heading.textContent=field.label+(field.changed?' · 有变化':' · 未改变');section.append(heading);
    for(const[label,text]of [['原内容',field.before],['本次建议',field.after]]){const name=document.createElement('p'),body=document.createElement('pre');name.textContent=label;body.textContent=text||'（空）';section.append(name);section.append(body);}
    $('#review-fields').append(section);
  }
}
function chatChanged(){chatGeneration++;}
async function saveChat(){
  if(!chatView||!taskId)return null;clearTimeout(chatTimer);chatTimer=null;chatView.question=$('#question').value;
  const selected=taskId,generation=chatGeneration,snapshot=clone(chatView);
  const next=chatQueue.catch(()=>{}).then(async()=>{
    await authorize();const result=await bridge({type:'SAVE_CHAT_VIEW',payload:{taskId:selected,expectedRevision:chatRevisions.get(selected)??snapshot.revision,question:snapshot.question,rows:snapshot.rows,flow:snapshot.flow,automaticMemory:snapshot.automaticMemory}});
    requireThat(result.status==='saved',result.message||'聊天输入尚未保存，请保留当前窗口');chatRevisions.set(selected,result.view.revision);
    if(taskId===selected&&chatView?.taskId===selected){chatView.revision=result.view.revision;chatView.updatedAt=result.view.updatedAt;chatSavedGeneration=Math.max(chatSavedGeneration,generation);}return result.view;
  });chatQueue=next.catch(()=>{});return next;
}
async function loadChat(){
  clearTimeout(chatTimer);chatTimer=null;liveDisplay=null;
  if(!taskId){chatView=null;$('#question').value='';renderTranscript();return;}
  const result=await bridge({type:'LOAD_CHAT_VIEW',payload:{taskId}});requireThat(result.status==='loaded',result.message||'无法读取本地聊天显示记录');chatView=result.view;chatRevisions.set(taskId,chatView.revision);chatGeneration=0;chatSavedGeneration=0;
  $('#question').value=chatView.question;$('#automatic-memory').checked=chatView.automaticMemory;
  const oldRound=activeRound(state,taskId);if(chatView.revision===0&&!chatView.question&&!chatView.flow&&oldRound&&!oldRound.packSnapshot.sourceExtraction){$('#question').value=oldRound.question;chatView.question=oldRound.question;chatChanged();}
  if(chatView.flow?.status==='sending'){chatView.flow.status='uncertain';chatChanged();await saveChat();}
  const completed=chatView.flow&&state.rounds.find(round=>round.id===chatView.flow.roundId&&round.status==='completed'&&round.packSnapshot.id===chatView.flow.packId);
  if(completed&&chatView.flow.status!=='complete'){if(!completed.packSnapshot.sourceExtraction&&$('#question').value.trim()===chatView.flow.question)$('#question').value='';chatView.flow.status='complete';chatChanged();await saveChat();}
  if(chatView.flow?.status==='uncertain')status('上次发送结果尚未确认，请先核对原网页或检查最新回复；不会重复发送。',true);
  renderTranscript({forceScroll:true});
}
function renderTranscript({forceScroll=false}={}){
  const viewport=$('#transcript'),oldTop=Number(viewport.scrollTop)||0,nearBottom=(Number(viewport.scrollHeight)||0)-(Number(viewport.clientHeight)||0)-oldTop<64;
  let rows=chatView?.rows||[];
  if(liveDisplay&&liveDisplay.taskId===taskId&&liveDisplay.packId===chatView?.flow?.packId){rows=rows.filter(row=>row.role!=='assistant'||row.packId!==liveDisplay.packId);rows=[...rows,{role:'assistant',text:liveDisplay.text}];}
  const last=rows.at(-1),latest=last?.role==='assistant'?last:null;$('#history').replaceChildren();
  for(const row of latest?rows.slice(0,-1):rows){const item=document.createElement('article');item.className='chat-row '+row.role;item.textContent=row.text;$('#history').append(item);}
  $('#answer').hidden=!latest;$('#answer').textContent=latest?.text||'';$('#answer-label').hidden=!latest;
  $('#answer-label').textContent=liveDisplay&&liveDisplay.taskId===taskId&&liveDisplay.packId===chatView?.flow?.packId?'当前轮次正在接收的网页回答':'本地记录中的最近回答';$('#empty-chat').hidden=rows.length>0;
  viewport.scrollTop=forceScroll||nearBottom?Number(viewport.scrollHeight)||0:oldTop;
}
function appendRow(packId,role,text){
  if(!chatView||typeof text!=='string'||!text.trim()&&(role!=='assistant'||chatView.flow?.packId!==packId||chatView.flow.status==='complete'))return;const row={packId,role,text,at:new Date().toISOString()};
  chatView=role==='assistant'&&chatView.flow?.packId===packId&&chatView.flow.status!=='complete'?upsertAssistantDisplay(chatView,row):appendChatRow(chatView,row);
  if(role==='assistant')liveDisplay=null;chatChanged();renderTranscript({forceScroll:role==='user'});
}
async function receiveDisplay(display,context,round){
  if(!display||!chatView||typeof display.text!=='string'||!display.text.trim()||display.text.length>100000||!['streaming','settling','stable'].includes(display.phase)||!['protocol','user_pack'].includes(display.pairing)||typeof display.messageKey!=='string'||!display.messageKey||display.messageKey.length>500)return false;
  if(chatView.flow&&(chatView.flow.packId!==context.packId||chatView.flow.status==='complete'))return false;
  if(!chatView.flow){chatView.flow={packId:context.packId,roundId:round.id,baseVersion:round.baseVersion,question:round.question,rootPackId:context.packId,searches:0,status:'waiting',attemptId:null,destinationOrigin:currentOrigin};chatChanged();}
  liveDisplay={taskId,packId:context.packId,text:display.text,phase:display.phase,messageKey:display.messageKey};renderTranscript();
  if(display.phase==='stable'){
    const row={packId:context.packId,role:'assistant',text:display.text,at:new Date().toISOString()},next=upsertAssistantDisplay(chatView,row);
    const changed=!equal(chatView.rows,next.rows)||chatView.flow.status!=='reply_visible';chatView=next;chatView.flow.status='reply_visible';
    if(changed){chatChanged();await saveChat();}
    liveDisplay=null;renderTranscript();clearException();status('回答已显示，记忆尚未更新。可以继续提问。');
  }else status(display.phase==='streaming'?'正在生成回答…':'回答已显示，正在等待记忆更新…');
  return true;
}
function showHandoff(){
  const flow=chatView?.flow,available=!!(flow&&['waiting','reply_visible','uncertain'].includes(flow.status)&&flow.destinationOrigin&&currentOrigin&&flow.destinationOrigin!==currentOrigin);$('#handoff').hidden=!available;
  if(available){$('#exception').hidden=false;$('#exception-message').textContent='这次问题此前交给了另一个 AI。点击“在当前 AI 继续”可将同一问题和记忆交给当前网站；不会自动发送。';}
  return available;
}
// Presentation only: local chat rows are scoped to taskId, not a website chat.
// Never infer their source from the currently selected theme or destination.
function showVerifiedDestination(actual){
  const label=$('#chat-destination');let url=null;
  try{if(actual?.status==='ready'&&Number.isSafeInteger(actual.tabId)&&typeof actual.documentId==='string'&&actual.documentId&&typeof actual.pageKey==='string'&&actual.pageKey&&typeof actual.conversation==='string'&&actual.conversation)url=new URL(actual.url);}catch{/* A malformed target cannot be presented as verified. */}
  const name=url?.protocol==='https:'&&!url.username&&!url.password&&!url.port?({'chatgpt.com':'ChatGPT','chat.deepseek.com':'DeepSeek','www.kimi.com':'Kimi','grok.com':'Grok','claude.ai':'Claude','www.qianwen.com':'千问','gemini.google.com':'Gemini'}[url.hostname]):null;
  if(!name){label.dataset.state='unconnected';label.textContent='尚未连接已核验的 AI 网页；下方本地记录仍保留';label.title='';return;}
  label.dataset.state='verified';label.title=url.origin+url.pathname;
  const session=actual.temporary?'临时会话（无稳定会话 ID）':url.pathname;
  label.textContent=`最近核验网页：${name} · ${session}`;
}
async function readTarget(){
  try{const actual=await bridge({type:'TARGET'});showVerifiedDestination(actual);return actual;}catch(error){showVerifiedDestination(null);throw error;}
}
async function detectDestination(){const actual=await readTarget();if(actual.status==='ready'){currentOrigin=new URL(actual.url).origin;applySiteTheme(currentOrigin,{root:document,connected:true});floatingSitePicker?.setState({site:currentOrigin,connected:true,applyTheme:false,message:'当前 AI 已连接，任务记忆保存在本地。'});}showHandoff();return actual;}
function setTaskContextOpen(open){
  $('#task-context').hidden=!open;$('#task-context-toggle').setAttribute('aria-expanded',String(open));
  if(open){$('#settings').hidden=true;$('#settings-toggle').setAttribute('aria-expanded','false');renderTaskContext();}
}
function renderTaskContext(){
  if($('#task-context').hidden)return;
  const task=state?taskById(state,taskId):null,cores=$('#task-context-cores'),drawer=$('#task-context');
  const scrollTop=drawer.dataset.taskId===task?.id?drawer.scrollTop:0;drawer.dataset.taskId=task?.id||'';cores.replaceChildren();
  $('#task-context-empty').hidden=!!task;$('#task-context-content').hidden=!task;
  $('#task-context-meta').textContent='';$('#task-context-manager-hint').textContent='';
  for(const field of ['goal','constraints','progress','questions'])$('#task-context-'+field).textContent='';
  if(!task){drawer.scrollTop=0;return;}
  const library=state.libraries.find(value=>value.id===task.libraryId);
  $('#task-context-meta').textContent=`${task.name} · v${task.version}${library?' · '+library.name:''}`;
  for(const [field,value,empty]of [['goal',task.goal,'尚未设置任务目标'],['constraints',task.constraints,'尚未设置长期约束'],['progress',task.progress,'尚未保存进度'],['questions',task.openQuestions,'暂无已保存事项']])$('#task-context-'+field).textContent=value||empty;
  $('#task-context-core-heading').textContent=`核心记忆 · ${task.coreEntryIds.length} 条`;
  $('#task-context-manager-hint').textContent=`打开管理页后，选择“${task.name}”查看或修改。`;
  if(!task.coreEntryIds.length){const empty=document.createElement('p');empty.className='hint';empty.textContent='还没有固定核心记忆。可在管理页为此任务选择重要条目。';cores.append(empty);}
  for(const entryId of task.coreEntryIds){
    // A malformed or stale core reference must not expose another library's
    // title/content. This drawer is a read-only view of the selected task.
    const entry=state.entries.find(value=>value.id===entryId&&value.libraryId===task.libraryId);
    const card=document.createElement('article'),title=document.createElement('h4'),body=document.createElement('p'),limits=document.createElement('p');card.className='task-context-core';limits.className='task-context-limits';
    if(!entry){title.textContent='核心条目不可用';body.textContent='条目已删除或不属于此任务资料库，请在管理页核对。';limits.textContent='需要处理';card.dataset.restricted='true';}
    else{
      title.textContent=entry.title;
      const content=entry.content||'';body.textContent=content.length>360?content.slice(0,360).replace(/[\uD800-\uDBFF]$/,'')+'…':content||'暂无正文摘要';
      const flags=[];
      if(entry.sensitivity==='local_only'||entry.sourceRefs?.some(ref=>state.sources.find(source=>source.id===ref.sourceId)?.sensitivity==='local_only'))flags.push('仅限本地');
      if(entry.reviewStatus!=='confirmed')flags.push('待审核');
      if(entry.enabledForContext===false)flags.push('未启用到对话');
      if(entry.lifecycleStatus!=='active')flags.push(entry.lifecycleStatus==='superseded'?'已被替代':'已归档');
      if(entry.conflictState==='unresolved')flags.push('存在未解决争议');
      card.dataset.restricted=String(flags.length>0);
      const details=[`v${entry.version}`,flags.length?flags.join(' · '):'已审核'];
      if(entry.scope)details.push('范围：'+entry.scope);
      if(entry.effectiveFrom||entry.effectiveTo)details.push(`生效：${entry.effectiveFrom||'不限'} 至 ${entry.effectiveTo||'不限'}${entry.effectiveTo?'（结束日不含）':''}`);
      limits.textContent=details.join(' · ');
    }
    card.append(title,body,limits);cores.append(card);
  }
  drawer.scrollTop=scrollTop;
}
async function openTaskContext(){await refresh();setTaskContextOpen(true);return true;}
function render(){
  const selected=taskId;$('#task-select').replaceChildren();const empty=document.createElement('option');empty.value='';empty.textContent='请选择已保存任务';$('#task-select').append(empty);
  for(const task of state.tasks){const option=document.createElement('option');option.value=task.id;option.textContent=task.name;$('#task-select').append(option);}$('#task-select').value=selected;
  const task=taskById(state,taskId),round=task?activeRound(state,taskId):null;
  $('#task-summary').textContent=task?`v${task.version} · ${task.coreEntryIds.length} 个核心记忆点 · ${task.goal||'尚未填写目标'}`:'还没有任务时，点“管理”创建资料库与持续任务。';
  $('#round-status').textContent=round?`${round.status==='delivered'?'资料已填入或复制，等待回复':'本轮资料已准备'} · ${round.question}`:'没有待处理轮次，可直接输入本轮问题。';
  if(round){$('#pack-preview').value=round.packSnapshot.text;$('#pack-summary').textContent=`${round.packSnapshot.included.length} 条资料 · ${round.packSnapshot.characters}/${round.packSnapshot.maxChars} 字符`;}
  else{$('#pack-preview').value='';$('#pack-summary').textContent='';}
  $('#prepare').disabled=busy||!task;$('#read').disabled=busy||!round;$('#auto-read').disabled=busy||!task;
  $('#confirm-update').disabled=busy||!pending?.reply||pending.reply.kind!=='update'||pending.processed;
  $('#supplement').disabled=busy||!pending?.reply||pending.reply.kind!=='search'||pending.processed;
  $('#recheck-reply').disabled=busy||!pending||pending.processed;
  const waiting=chatView?.flow&&(['sending','waiting','uncertain','review'].includes(chatView.flow.status)||liveDisplay&&liveDisplay.phase!=='stable'||chatView.flow.status==='blocked'&&$('#question').value.trim()===chatView.flow.question);
  $('#send').disabled=busy||!task||!!waiting||!!pending&&!pending.processed;$('#send').textContent=chatView?.flow?.status==='waiting'?'等待回复':chatView?.flow?.status==='uncertain'?'待核对':'发送';
  $('#memory-mode').textContent=$('#automatic-memory').checked?'自动记忆已开启':'记忆需手动确认';
  $('#start-new-question').hidden=!chatView?.flow||!['waiting','reply_visible','uncertain','review','blocked'].includes(chatView.flow.status);$('#start-new-question').textContent=chatView?.flow?.status==='blocked'?'开始新问题':'停止等待';
  renderExtractionBanner();renderQueue();showHandoff();renderReview();renderTaskContext();
}
function followingExtraction(snapshot){
  const task=taskById(snapshot,taskId);if(!task||activeRound(snapshot,taskId))return null;
  const completed=(snapshot.rounds||[]).filter(round=>round.taskId===taskId&&round.status==='completed'&&round.packSnapshot.sourceExtraction).sort((a,b)=>b.completedAt.localeCompare(a.completedAt));
  const last=completed[0]?.packSnapshot.sourceExtraction;if(!last)return null;
  const source=snapshot.sources.find(item=>item.id===last.sourceId);if(!source||source.version!==last.sourceVersion||source.sha256!==last.sourceSha256)return null;
  const start=nextExtractionOffset(snapshot,{taskId,sourceId:source.id});if(start>=source.text.length)return null;
  return createSourceExtraction(snapshot,{libraryId:task.libraryId,sourceId:source.id,start,length:4000});
}
function renderExtractionBanner(){
  const round=taskId?activeRound(state,taskId):null,prepared=round?.packSnapshot.sourceExtraction;let next=null;
  try{next=followingExtraction(state);}catch{/* A restricted source has no next-send action. */}
  const awaitingReply=prepared&&round.status==='delivered'&&['sending','waiting','uncertain','reply_visible','review'].includes(chatView?.flow?.status);
  $('#prepared-extraction').hidden=!!activeExtractionQueue(state,taskId)||!!awaitingReply||!prepared&&!next;
  const source=prepared||next;$('#extraction-summary').textContent=source?`${source.name} · 第 ${source.start+1}—${source.end} 字符${prepared?' · 当前片段':' · 下一片段'}`:'';
  $('#send-extraction').hidden=!prepared;$('#next-extraction').hidden=!!prepared||!next;
  const blockedFlow=chatView?.flow&&['sending','waiting','uncertain','review'].includes(chatView.flow.status);
  $('#send-extraction').disabled=busy||!prepared||!!blockedFlow||!!pending&&!pending.processed;
  $('#next-extraction').disabled=busy||!next||!!blockedFlow||!!pending&&!pending.processed;
}
function renderQueue(){
  const queue=taskId?activeExtractionQueue(state,taskId):null,last=queue||[...(state.extractionQueues||[])].reverse().find(item=>item.taskId===taskId),round=taskId?activeRound(state,taskId):null;
  let source=round?.status==='prepared'?round.packSnapshot.sourceExtraction:null;
  try{source||=followingExtraction(state);}catch{}
  $('#extraction-queue').hidden=!queue&&!source&&!last;
  $('#queue-summary').textContent=last?`${last.currentIndex}/${last.ranges.length} 片已处理 · ${last.status==='completed'?'本批完成':last.status==='cancelled'?'已取消':runningQueueId===last.id?'正在提炼':last.status==='paused'?'已暂停':'待继续'} · ${last.sourceName}`:'连续提炼文档';
  $('#queue-summary').setAttribute('title',$('#queue-summary').textContent);
  $('#queue-config').hidden=!!queue||!source;$('#queue-start').disabled=busy||!source||!!queue;
  $('#queue-source').textContent=source?`${source.name} · 从第 ${source.start+1} 字符开始，每片最多 4000 字符`:'';
  $('#queue-continue').hidden=!queue||!!runningQueueId;$('#queue-continue').disabled=busy||!!pending&&!pending.processed;
  $('#queue-pause').hidden=!runningQueueId;$('#queue-pause').disabled=false;
  $('#queue-cancel').hidden=!queue;$('#queue-cancel').disabled=busy;
  if(queue){$('#send').disabled=true;$('#prepare').disabled=true;$('#send-extraction').disabled=true;$('#next-extraction').disabled=true;}
}
function scheduleQueuedSlice(){
  clearTimeout(queueTimer);queueTimer=null;const ticket=runningQueueId;if(!ticket||closed)return;
  queueTimer=setTimeout(async()=>{queueTimer=null;if(ticket!==runningQueueId||closed)return;if(busy){scheduleQueuedSlice();return;}await run($('#queue-continue'),sendQueuedSlice);},450);
}
async function sendQueuedSlice(){
  const queueId=runningQueueId;requireThat(queueId,'请先开始或继续提炼队列');requireThat(!pending||pending.processed,'请先处理本片回执');
  const pack=await repository.mutate(snapshot=>{const queue=extractionQueueById(snapshot,queueId);requireThat(queue?.taskId===taskId,'队列任务已经改变');const result=prepareQueuedSlice(snapshot,queueId,{expectedVersion:queue.version});return cachePack(snapshot,result.pack);});
  if(runningQueueId!==queueId||closed)return false;
  queueWaitUntil=Date.now()+180000;const sent=await transmit(pack,{preserveDraft:true});
  if(!sent)await pauseQueueRun();await refresh();return sent;
}
async function startExtractionQueue(){
  requireThat(!pending||pending.processed,'请先处理当前回执');await saveChat();stopAuto();
  const queue=await repository.mutate(snapshot=>{const round=activeRound(snapshot,taskId),source=round?.status==='prepared'?round.packSnapshot.sourceExtraction:followingExtraction(snapshot);requireThat(source,'请先在资料库选择文档并准备提炼');return createExtractionQueue(snapshot,{taskId,sourceId:source.sourceId,start:source.start,sliceCount:Number($('#queue-count').value),maxChars:round?.packSnapshot.maxChars||Number($('#budget').value)});});
  runningQueueId=queue.id;$('#queue-options').open=false;return sendQueuedSlice();
}
async function continueExtractionQueue(){
  requireThat(!pending||pending.processed,'请先处理当前回执');await saveChat();
  const queue=await repository.mutate(snapshot=>{const current=activeExtractionQueue(snapshot,taskId);requireThat(current,'没有可继续的提炼队列');return resumeExtractionQueue(snapshot,current.id,{expectedVersion:current.version});});
  const snapshot=await repository.snapshot(),round=queue.activeRoundId&&snapshot.rounds.find(item=>item.id===queue.activeRoundId);
  runningQueueId=queue.id;
  if(round?.status==='delivered'){
    // A restart never resends a delivered slice. Even an uncertain send first
    // checks the actual reply; an explicit cancellation keeps manual recovery.
    queueWaitUntil=Date.now()+180000;$('#auto-read').checked=true;schedule();await refresh();status('继续检查当前片段的回复；已交付片段不会重复发送。');return true;
  }
  return sendQueuedSlice();
}
async function cancelCurrentQueue(){
  stopQueueRunner();stopAuto();await repository.mutate(snapshot=>{const queue=activeExtractionQueue(snapshot,taskId);requireThat(queue,'没有可取消的队列');cancelExtractionQueue(snapshot,queue.id,{expectedVersion:queue.version});});await refresh();status('本批提炼已取消；已有资料、回执与当前片段保留，可单独处理。');return true;
}
async function refresh(){state=await repository.snapshot();render();}
// A committed change may come from the manager while this iframe remains open.
// Refresh database presentation only: never reload chat, replace typed inputs,
// apply a reply, or grant permission to start/resume an extraction queue.
function requestCommittedRefresh(){
  if(closed||!authorized||!repository)return;
  changeRequested=true;changeGeneration++;void refreshCommittedState();
}
async function refreshCommittedState(){
  if(closed||starting||busy||changeReading||!authorized||!state||!changeRequested)return;
  changeReading=true;
  try{
    while(changeRequested&&!closed&&!busy&&authorized){
      changeRequested=false;
      const generation=changeGeneration,selected=taskId,ticket=epoch,previous=state;
      let snapshot;
      try{snapshot=await repository.snapshot();}
      catch(error){
        if(!closed&&!busy&&generation===changeGeneration&&selected===taskId&&ticket===epoch&&previous===state){changeFailureMessage='本地资料已改变，但刷新失败：'+(error.message||String(error))+'。输入和接收原文仍保留，可重新读取本地任务。';status(changeFailureMessage,true);}
        continue;
      }
      if(closed)break;
      if(busy||generation!==changeGeneration||selected!==taskId||ticket!==epoch||previous!==state){changeRequested=true;continue;}
      state=snapshot;
      if(pending?.reply&&!pending.processed){
        try{
          requireThat(equal(pending.context,contextFor(snapshot)),'任务或资料包已改变');
          validateInboxReply(snapshot,taskId,pending.text,activeRound(snapshot,taskId)?.packSnapshot.options);
        }catch(error){
          pending.reply=null;pending.review=null;pending.error='本地任务或资料已改变，旧记忆建议已失效；接收原文和记录仍保留。请重新校验或保留记录后开始新问题。'+(error.message||String(error));
          stopAuto();showReceipt(pending);status(pending.error,true);
        }
      }
      render();
      if(changeFailureMessage){if($('#status').textContent===changeFailureMessage){if($('#exception-message').textContent===changeFailureMessage)clearException();status('本地资料已重新读取，输入和接收原文仍保留。');}changeFailureMessage=null;}
    }
  }finally{changeReading=false;if(changeRequested&&!closed&&!starting&&!busy&&authorized)void refreshCommittedState();}
}
function watchCommittedChanges(){
  try{changeChannel=new BroadcastChannel('text-memory-changed');changeChannel.onmessage=event=>{if(event.data?.changed===true)requestCommittedRefresh();};}catch{/* Focus/manual refresh remains available when channels are unavailable. */}
}
function stopCommittedChanges(){changeGeneration++;changeRequested=false;changeChannel?.close();changeChannel=null;}
async function run(button,action){
  if(busy)return false;busy=true;changeGeneration++;button.dataset.feedback='busy';const original=button.textContent;button.textContent='处理中…';
  // A reply read does not consume the next question. Keep that input editable
  // during periodic polling so the floating composer remains usable.
  const controls=[...document.querySelectorAll('button,input,select,textarea')].filter(node=>node!==$('#queue-pause')&&(![receive,readLatest].includes(action)||node!==$('#question'))),disabled=controls.map(node=>node.disabled);controls.forEach(node=>node.disabled=true);
  try{await authorize();const result=await action();button.dataset.feedback=result===false?'error':'success';if(result===false&&undoableNotice)undoableNotice.button=button;return result;}
  catch(error){let message=error.message||String(error);if(runningQueueId){stopAuto();try{await pauseQueueRun();state=await repository.snapshot();}catch(pauseError){message+='；队列已停止，本地暂停状态未保存：'+pauseError.message;}}if(pending&&!pending.processed&&[receive,readLatest,recheckReply,confirmUpdate,supplement].includes(action))pending.error=message;if([receive,readLatest,sendCurrent,supplement,confirmUpdate].includes(action))stopAuto();status(message,true);button.dataset.feedback='error';return false;}
  finally{busy=false;controls.forEach((node,index)=>node.disabled=disabled[index]);if(button.textContent==='处理中…')button.textContent=original;if(state)render();void refreshCommittedState();}
}
function click(selector,action){$(selector).addEventListener('click',()=>run($(selector),action));}
function checkedPack(snapshot,pack){const diagnostic=diagnosePack(snapshot,pack),errors=validatePack(snapshot,pack,{...pack.options,binding:pack.binding,memoryTaskId:taskId});requireThat(!errors.length,diagnostic.issues.filter(item=>item.blocking).map(item=>`${item.title}：${item.action}`).join('；')||errors.join('；'));return pack;}
function cachePack(snapshot,pack){const index=snapshot.packs.findIndex(item=>item.id===pack.id);if(index<0)rememberPack(snapshot,pack);else snapshot.packs[index]=clone(pack);return pack;}
async function savePending(){
  if(!pending?.text)return null;const receipt=pending;
  if(receipt.processed)return receipt.record;
  const result=await bridge({type:'SAVE_REPLY_DRAFT',payload:{writerId,context:receipt.context,text:receipt.text,method:receipt.method||'latest_reply_read',recordId:receipt.record?.id,expectedRevision:receipt.record?.revision||0}});
  if(['rejected','unauthorized'].includes(result.status)){authorized=false;stopAuto();}
  requireThat(result.status==='saved',`原文尚未保存：${result.message||'本地存储失败'}。接收框已保留，请重试，不要关闭浮窗。`);receipt.record=result.record;return result.record;
}
async function settle(receipt,kind){if(!receipt?.record)return;const result=await bridge({type:'SETTLE_REPLY_DRAFT',payload:{recordId:receipt.record.id,expectedRevision:receipt.record.revision,writerId,status:kind}});requireThat(result.status==='settled',result.message||'接收记录状态未保存');receipt.record=result.record;}
async function afterCommit(receipt,message,{completed=false}={}){
  receipt.processed=true;receipt.reply=null;$('#confirm-update').disabled=true;$('#supplement').disabled=true;$('#reply-state').textContent='已处理，原文保留';
  const warnings=[];try{await settle(receipt,'processed');}catch(error){warnings.push('原文已保留，记录状态未更新：'+error.message);}
  try{await refresh();}catch(error){warnings.push('内容已保存，但界面刷新失败，请勿重复确认：'+error.message);}
  if(completed&&chatView?.flow?.packId===receipt.context.packId){const extraction=state.rounds.find(round=>round.packSnapshot.id===receipt.context.packId)?.packSnapshot.sourceExtraction;if(!extraction&&$('#question').value.trim()===chatView.flow.question)$('#question').value='';chatView.flow.status='complete';chatChanged();try{await saveChat();}catch(error){warnings.push('记忆已保存，但显示状态尚未保存：'+error.message);}}
  if(completed)stopAuto();
  status(message+(warnings.length?' '+warnings.join('；'):''));
  if(warnings.length)status(message+' '+warnings.join('；'),true);else if(completed)clearException();
  return warnings.length===0;
}
async function deliver(pack){
  const currentTask=taskId;let actual=await readTarget();requireThat(actual.status==='ready',actual.message||'未找到当前 AI 输入框');
  const foreignPack=value=>typeof value==='string'&&[...value.matchAll(/(?:^|\r?\n)[ \t]*TEXT-MEMORY-PACK[ \t]+([^\s]+)/g)].some(match=>match[1]!==pack.id);
  if(foreignPack(actual.draft)){
    // Only the adapter may undo its own still-intact insertion. It rejects
    // edited drafts and cannot erase arbitrary user text or manually pasted packs.
    const previousIdentity=identity(actual),undone=await bridge({type:'UNDO'});
    requireThat(undone.status==='undone','新资料已在本地准备，但原网页仍有尚未发送的旧资料；'+(undone.message||'无法安全撤销上次填入')+'。原草稿未覆盖，请先处理原网页草稿再重试。');
    actual=await readTarget();requireThat(actual.status==='ready'&&equal(identity(actual),previousIdentity),'上次填入已撤销，但网页连接已变化；新资料仍保留，请回原网页重试。');
    requireThat(!foreignPack(actual.draft),'上次填入已撤销，但草稿仍有其他资料包；新资料保留，未继续追加，请先核对原草稿。');
  }
  const bound=await bridge({type:'BIND',identity:identity(actual),libraryIds:pack.options.libraryIds});requireThat(bound.status==='bound',bound.message||'网页连接失败');
  requireThat(currentTask===taskId,'任务选择已改变');
  const context={...pack.options,memoryTaskId:currentTask};await repository.mutate(snapshot=>retargetPack(snapshot,pack.id,identity(actual),context));
  const checkpoint=activeRound(await repository.snapshot(),currentTask);requireThat(checkpoint?.packSnapshot.id===pack.id,'资料包已变化，请重新准备');
  const inserted=await bridge({type:'INSERT',packId:pack.id,draftHash:actual.draftHash});requireThat(['written','already_present'].includes(inserted.status),inserted.message||'写入草稿失败，本轮资料仍保留');
  try{await repository.mutate(snapshot=>markRoundDelivered(snapshot,checkpoint.id,{expectedVersion:checkpoint.version,deliveryKind:'draft'}));}
  catch(error){throw Error('资料已填入草稿，但轮次状态保存失败。请核对后重试，不会自动发送：'+error.message);}
  lastDeliveryIdentity=identity(actual);
  return inserted.status;
}
async function prepare({prepareOnly=false}={}){
  requireThat(!activeExtractionQueue(await repository.snapshot(),taskId),'文档队列尚未结束，请先取消本批提炼，再发送普通问题');
  requireThat(taskId,'请先选择任务');requireThat(!pending||pending.processed,'已有未确认回复，请先确认记忆或保留记录后清空接收区');
  const question=$('#question').value.trim()||'继续当前任务',maxChars=Number($('#budget').value);
  const pack=await repository.mutate(snapshot=>{
    const task=taskById(snapshot,taskId);requireThat(task,'任务已不存在');const existing=activeRound(snapshot,taskId),scope=scopeFor(task);
    if(existing&&existing.question===question&&equal(existing.packSnapshot.options,scope)&&existing.packSnapshot.maxChars===maxChars){try{return cachePack(snapshot,resumeRound(snapshot,existing.id).pack);}catch{/* Changed source data is checked below. */}}
    // Rebuilding this same question must keep evidence obtained by an earlier
    // SEARCH, even if budget or source versions change. Explicitly removed
    // task cores may leave; other already included evidence remains required.
    const previous=existing?.packSnapshot,oldCore=new Set(previous?.memoryTask.coreEntryIds||[]),kept=key=>!oldCore.has(key)||task.coreEntryIds.includes(key);
    const selection=existing?.question===question?{selectedIds:[...new Set([...previous.selectedIds,...previous.included.map(item=>item.id)])].filter(kept),pinnedIds:[...new Set([...previous.pinnedIds,...previous.included.map(item=>item.id)])].filter(kept),retrieved:previous.retrieved}:taskSelection(snapshot,taskId,question,scope);
    const sourceExtraction=existing?.question===question?existing.packSnapshot.sourceExtraction:undefined;
    const candidate=checkedPack(snapshot,buildPack(snapshot,{...scope,...selection,task:question,memoryTaskId:taskId,maxChars,binding:null,...(sourceExtraction?{sourceExtraction}:{})}));
    const current=existing?refreshTaskRound(snapshot,existing.id,candidate,{expectedVersion:existing.version}).pack:candidate;
    if(!existing)prepareRound(snapshot,current);return cachePack(snapshot,current);
  });
  if(prepareOnly)return pack;
  const result=await deliver(pack);if(pending?.processed&&pending.context.packId!==pack.id)resetPending();
  try{await refresh();}catch(error){status('资料已填入，但浮窗刷新失败：'+error.message+'。请在原网页核对并发送。',true);setCollapsed(true);return true;}
  status(result==='already_present'?'这份资料已在草稿中，没有重复加入。请在原网页点发送。':'资料已填入原网页草稿，请在原网页点发送。生成完成后展开浮窗读取回复。');setCollapsed(true);return true;
}
async function transmit(pack,{followup=false,preserveDraft=false}={}){
  const snapshot=await repository.snapshot(),round=activeRound(snapshot,taskId);requireThat(round?.packSnapshot.id===pack.id,'当前资料已经改变，请重新准备');
  liveDisplay=null;
  if(!followup){chatView.flow={packId:pack.id,roundId:round.id,baseVersion:round.baseVersion,question:pack.task,rootPackId:pack.id,searches:0,status:'prepared',attemptId:null,destinationOrigin:null};appendRow(pack.id,'user',pack.task);}
  else{requireThat(chatView.flow&&chatView.flow.searches<=2,'补充资料次数无效');chatView.flow={...chatView.flow,packId:pack.id,roundId:round.id,baseVersion:round.baseVersion,status:'prepared',attemptId:null};}
  chatChanged();await saveChat();await deliver(pack);await refresh();
  chatView.flow.status='sending';chatView.flow.destinationOrigin=new URL(lastDeliveryIdentity.url).origin;currentOrigin=chatView.flow.destinationOrigin;chatChanged();await saveChat();
  let result;try{result=await bridge({type:'SEND_PACK',packId:pack.id,identity:lastDeliveryIdentity});}
  catch(error){result={status:'send_uncertain',message:'网站发送结果未确认：'+error.message};}
  const flow=chatView.flow;flow.attemptId=typeof result.attemptId==='string'?result.attemptId:null;
  if(result.status==='send_invoked'){
    flow.status='waiting';if(!followup&&!preserveDraft&&$('#question').value.trim()===flow.question){$('#question').value='';chatView.question='';}chatChanged();
    try{await saveChat();}catch(error){stopAuto();status('已点击网站发送，但本地显示状态尚未保存。不要再次发送；请检查最新回复。'+error.message,true);return false;}
    if(pending?.processed&&pending.context.packId!==pack.id)resetPending();clearException();status('已点击发送，等待回复…');$('#auto-read').checked=true;schedule();render();return true;
  }
  flow.status=result.status==='send_uncertain'?'uncertain':'not_sent';chatChanged();stopAuto();let warning='';
  try{await saveChat();}catch(error){warning=' 本地状态保存失败：'+error.message;}
  status((flow.status==='uncertain'?'发送结果尚未确认，不会自动重试。请先核对原网页或检查最新回复。':result.message||'尚未发送，请核对原网页后重试。')+warning,true,flow.status==='not_sent'&&!warning?{taskId,packId:flow.packId}:null);render();return false;
}
async function sendPreparedExtraction(){
  requireThat(!activeExtractionQueue(await repository.snapshot(),taskId),'请通过连续提炼队列继续，或先取消本批');
  requireThat(chatView&&taskId,'请选择提炼任务');requireThat(!pending||pending.processed,'请先处理当前回执');
  requireThat(!chatView.flow||['prepared','not_sent','complete','reply_visible','blocked'].includes(chatView.flow.status),'当前回复或发送状态尚未处理，不能重复发送');
  await saveChat();stopAuto();
  const pack=await repository.mutate(snapshot=>{const round=activeRound(snapshot,taskId);requireThat(round?.packSnapshot.sourceExtraction,'没有已准备的提炼片段');requireThat(round.status==='prepared'||round.status==='delivered'&&chatView.flow?.packId===round.packSnapshot.id&&['prepared','not_sent'].includes(chatView.flow.status),'此片段已经交付，请先检查回复，避免重复发送');return cachePack(snapshot,resumeRound(snapshot,round.id).pack);});
  return transmit(pack,{preserveDraft:true});
}
async function sendNextExtraction(){
  requireThat(!activeExtractionQueue(await repository.snapshot(),taskId),'请通过连续提炼队列继续，或先取消本批');
  requireThat(chatView&&taskId,'请选择提炼任务');requireThat(!pending||pending.processed,'请先处理当前回执');requireThat(!chatView.flow||['complete','not_sent','prepared','reply_visible','blocked'].includes(chatView.flow.status),'还有待处理对话');
  await saveChat();stopAuto();
  const pack=await repository.mutate(snapshot=>{const extraction=followingExtraction(snapshot);requireThat(extraction,'没有可以继续的原文片段，请在资料库检查来源。');const candidate=checkedPack(snapshot,buildPack(snapshot,{...scopeFor(taskById(snapshot,taskId)),task:`提炼当前文档第 ${extraction.start+1}—${extraction.end} 字符，围绕已保存的任务目标，列出有出处的候选记忆并自查疑点。`,memoryTaskId:taskId,maxChars:Number($('#budget').value),sourceExtraction:extraction}));prepareRound(snapshot,candidate);return cachePack(snapshot,candidate);});
  return transmit(pack,{preserveDraft:true});
}
async function sendCurrent(){
  requireThat(chatView&&taskId,'请选择任务');requireThat($('#question').value.trim(),'请输入要发送的问题');
  requireThat(!chatView.flow||['prepared','not_sent','complete','reply_visible'].includes(chatView.flow.status)||chatView.flow.status==='blocked'&&$('#question').value.trim()!==chatView.flow.question,'上一次对话仍在处理或发送结果尚未确认，请先检查最新回复，避免重复发送');
  requireThat(chatView.flow?.status!=='reply_visible'||$('#question').value.trim()!==chatView.flow.question,'这份问题已得到回答。请输入下一问，避免重复发送同一份资料。');
  requireThat(!pending||pending.processed,'有未处理的记忆回复，请先在诊断中处理');
  await saveChat();stopAuto();const pack=await prepare({prepareOnly:true});clearException();return transmit(pack);
}
async function handoffCurrent(){
  requireThat(chatView?.flow&&['waiting','reply_visible','uncertain'].includes(chatView.flow.status),'没有可继续的未完成问题');const actual=await detectDestination();requireThat(actual.status==='ready'&&showHandoff(),'当前网站与上次发送相同；请先检查回复，避免重复发送');
  if(pending&&!pending.processed)await savePending();const original=clone(chatView.flow),pack=await repository.mutate(snapshot=>{const round=activeRound(snapshot,taskId);requireThat(round?.packSnapshot.id===original.packId&&round.baseVersion===original.baseVersion,'任务已被另一回复更新，请输入新问题继续');return cachePack(snapshot,resumeRound(snapshot,round.id).pack);});
  resetPending();stopAuto();clearException();return transmit(pack,{preserveDraft:!!pack.sourceExtraction});
}
function showReceipt(receipt){
  $('#protocol').value=receipt.text;$('#memory-actions').hidden=false;$('#supplement').hidden=receipt.reply?.kind!=='search';
  if(receipt.reply?.kind==='update'){
    const preview=receipt.reply.preview;receipt.review=describeMemoryUpdate(taskById(state,taskId),preview);$('#memory-summary').textContent=`待确认：更新任务进度，新增 ${receipt.review.factCount} 条待审核记忆。${receipt.review.duplicateCount?` ${receipt.review.duplicateCount} 条重复候选将跳过。`:''}`;
    $('#memory-preview').textContent=`进度：${preview.progress}\n待解决：${preview.openQuestions||'无'}\n候选记忆：\n${preview.facts.map(fact=>`${fact.title}：${fact.content}`).join('\n')||'无'}\n${preview.notice}`;
  }else if(receipt.reply?.kind==='search'){
    $('#memory-summary').textContent=`AI 需要补充资料：${receipt.reply.preview.query}`;$('#memory-preview').textContent='点击“补充资料并填入网页”后，在原网页发送补充内容，等待下一次回复。';
  }else{$('#memory-summary').textContent=receipt.error?'收到格式异常回执，未更新记忆。':'原文已保留，尚未通过当前任务校验。';$('#memory-preview').textContent=receipt.error||'';}
  $('#reply-state').textContent=receipt.processed?'已处理，原文保留':receipt.error?'已接收，格式异常':'待确认';render();
}
async function receive(){
  const receivingQueueId=runningQueueId;
  if(runningQueueId&&queueWaitUntil&&Date.now()>queueWaitUntil){await pauseQueueRun();stopAuto();await refresh();status('当前片段等待回复超过 3 分钟，本批已暂停。可检查网页后继续，不会自动重发。',true);return false;}
  requireThat(taskId,'请先选择任务');if(pending&&!pending.processed){status(pending.error||'已有待处理回复，原文已保留；请先确认记忆或保留记录后清空接收区。',!!pending.error);return!pending.error;}
  const ticket=epoch,snapshot=await repository.snapshot(),task=taskById(snapshot,taskId),round=activeRound(snapshot,taskId);
  if(!round){status('等待准备下一轮资料。输入问题并填入网页后，可继续接收。');return true;}resumeRound(snapshot,round.id);
  const dispositions=await bridge({type:'LIST_REPLY_DRAFTS',payload:{taskId}});requireThat(dispositions.status==='listed',dispositions.message||'无法复核本地回复处理记录，请稍后再试');
  if(dispositions.records.some(row=>row.record.status==='cleared'&&row.record.context.packId===round.packSnapshot.id)){
    stopAuto();let warning='';if(chatView?.flow?.packId===round.packSnapshot.id&&chatView.flow.status!=='blocked'){chatView.flow.status='blocked';chatChanged();try{await saveChat();}catch(error){warning=' 本地显示状态尚未保存：'+error.message;}}
    status('这轮候选已由你选择保留原记忆，不会重新自动应用。可以输入下一问；原回执在接收记录中仅供查看。'+warning);return true;
  }
  const expected={taskId,baseVersion:round.baseVersion,packId:round.packSnapshot.id},before=contextFor(snapshot);
  const actual=await readTarget();requireThat(actual.status==='ready',actual.message||'无法连接当前网页');
  const bound=await bridge({type:'BIND',identity:identity(actual),libraryIds:[task.libraryId]});requireThat(bound.status==='bound',bound.message||'无法连接回复页');
  const result=await bridge({type:'READ_LATEST_REPLY',identity:identity(actual),expected,includeDisplay:true});if(ticket!==epoch||closed)return false;
  if(['stale_target','unauthorized'].includes(result.status))showVerifiedDestination(null);
  let latest=null,displayed=false;
  if(result.status==='reply_ready'||(result.display||result.diagnostic)&&['waiting','invalid_reply','ambiguous'].includes(result.status)){
    const samePage=equal(identity(result),identity(actual));if(!samePage)showVerifiedDestination(null);
    requireThat(samePage,'回复网页已变化，请重新读取');latest=await repository.snapshot();requireThat(equal(before,contextFor(latest)),'读取期间任务或轮次已改变，请重新读取');
    state=latest;
    if(result.status!=='reply_ready')displayed=await receiveDisplay(result.display,before,round);
  }
  if(result.status!=='reply_ready'){
    const diagnostic=result.diagnostic;
    if(result.status==='invalid_reply'&&result.reason==='invalid_json'&&diagnostic?.phase==='stable'&&diagnostic.pairing==='user_pack'&&typeof diagnostic.messageKey==='string'&&diagnostic.messageKey&&diagnostic.messageKey.length<=500&&round.status==='delivered'){
      const rejected=rejectedReplyBlock(diagnostic.text,expected);
      requireThat(rejected&&rejected.text===diagnostic.text,'错误回执与当前任务或资料包不匹配，未保存为当前回执');
      stopAuto();if(runningQueueId)await pauseQueueRun();
      const message='记忆回执的 JSON 格式有误（例如尾随逗号、重复字段或未闭合字符串），未更新任务记忆。错误原文已保留在接收区；可查看接收记录，或保留记录后清空，再让 AI 按严格 JSON 重新输出。';
      pending={text:rejected.text,context:before,record:null,reply:null,method:'latest_reply_read',processed:false,error:message,answerText:result.display?.text||''};showReceipt(pending);
      await savePending();
      if(chatView?.flow?.packId===before.packId){chatView.flow.status='blocked';chatChanged();await saveChat();}
      $('#settings').hidden=false;$('#diagnostics').open=true;status(message+' 原文已保存到本地，可在重开浮窗后恢复。',true);return false;
    }
    if(runningQueueId&&(['invalid_reply','ambiguous'].includes(result.status)||displayed&&result.display.phase==='stable')){await pauseQueueRun();stopAuto();await refresh();status('本片没有可校验的完整记忆回执，本批已暂停。回答已保留，请检查网页或接收记录。',true);return false;}
    if(displayed)return result.display.phase==='stable'?true:'waiting';
    if(result.status==='waiting'){status(result.message||'正在检查网页上是否出现可读取的回复…');return'waiting';}
    stopAuto();let warning='';if(chatView?.flow&&chatView.flow.status!=='complete'){chatView.flow.status='blocked';chatChanged();try{await saveChat();}catch(error){warning=' 本地显示状态尚未保存：'+error.message;}}
    status((result.message||'这次回复暂时无法处理。')+warning+' 可以开始一个不同的新问题；旧记录保留。',true);return false;
  }
  const raw=result.text;requireThat(typeof raw==='string'&&raw.length<=100000,'网页回执长度无效');
  if(pending?.processed&&pending.text===raw){status('这份回复已处理，原文保留；输入下一轮问题即可继续。');return true;}
  // includeDisplay replies use the cleaned body for both progressive display
  // and final persistence. An explicitly empty cleaned result must not fall
  // back to the older strict reader's less aggressively stripped answer.
  const answerText=typeof result.display?.text==='string'?result.display.text:typeof result.answerText==='string'?result.answerText:'';
  pending={text:raw,context:before,record:null,reply:null,method:'latest_reply_read',processed:false,answerText};$('#protocol').value=raw;
  state=latest;showReceipt(pending);await savePending();
  pending.reply=validateInboxReply(latest,taskId,raw,round.packSnapshot.options);showReceipt(pending);if(result.display)await receiveDisplay(result.display,before,round);
  if(pending.reply.kind==='update'){
    appendRow(before.packId,'assistant',pending.answerText);await saveChat();
    const clearsExisting=pending.review.fields.some(field=>field.cleared);
    const queue=activeExtractionQueue(latest,taskId),queued=queue?.activeRoundId===round.id,queueAllowed=queued&&queue.status==='ready'&&runningQueueId===queue.id;
    if(receivingQueueId&&!queueAllowed){stopQueueRunner();stopAuto();}
    if((queued?queueAllowed:!receivingQueueId&&$('#automatic-memory').checked)&&!clearsExisting&&!pending.review.hasEvidenceIssues)return confirmUpdate({automatic:true,queueId:queued?queue.id:null});
    if(queued&&runningQueueId){await pauseQueueRun();await refresh();}
    if(chatView?.flow?.packId===before.packId){chatView.flow.status='review';chatChanged();await saveChat();}stopAuto();
    clearException();status(clearsExisting?'这次更新会清空已有内容，请在回答下方核对后保存。':'回答已显示，请在下方保存这次更新，或保留原记忆继续聊天。');return true;
  }
  // Review controls task writes, not retrieval. A user-started chat may still
  if(activeExtractionQueue(latest,taskId)?.activeRoundId===round.id){await pauseQueueRun();stopAuto();await refresh();status('提炼片段返回了检索请求，本批已暂停。请取消本批后单独处理请求；不会替换正在提炼的原文。',true);return false;}
  // obtain the missing evidence while every UPDATE waits for review.
  if(chatView?.flow?.packId===before.packId)return supplement({autoSend:true});
  stopAuto();status('AI 需要更多资料；请在设置中处理补充请求。');$('#exception').hidden=false;$('#exception-message').textContent='这次对话需要补充资料。点击“查看处理方式”可核对检索请求。';return true;
}
async function readLatest(){
  const ticket=epoch,selected=taskId,first=await receive();if(first!=='waiting')return first;
  // The reader needs two stable observations separated by at least a second.
  // A button click includes one bounded retry; automatic polling stays single.
  await new Promise(resolve=>setTimeout(resolve,1200));if(closed||ticket!==epoch||selected!==taskId)return false;
  await authorize();if(closed||ticket!==epoch||selected!==taskId)return false;return await receive();
}
async function confirmUpdate({automatic=false,queueId=null}={}){
  const receipt=pending;requireThat(receipt?.reply?.kind==='update'&&!receipt.processed,'请先读取当前轮次的记忆更新');await savePending();
  const preview=receipt.reply.preview,result=await repository.mutate(snapshot=>{
    const round=activeRound(snapshot,taskId),options={expectedVersion:receipt.reply.roundVersion,taskId:preview.taskId,baseVersion:preview.baseVersion,packId:preview.packId};
    requireThat(round?.id===receipt.reply.roundId,'轮次已改变，请重新读取');validateRoundUpdate(snapshot,round.id,options);
    if(automatic&&queueId){const queue=extractionQueueById(snapshot,queueId);requireThat(runningQueueId===queueId&&queue?.status==='ready'&&queue.activeRoundId===round.id,'队列已暂停或取消，请手动核对本片回执');}
    const applied=applyMemoryUpdate(snapshot,preview,{automatic});completeRound(snapshot,round.id,options);
    const queue=activeExtractionQueue(snapshot,taskId);if(queue?.activeRoundId===round.id)applied.queue=completeQueuedSlice(snapshot,queue.id,round.id);return applied;
  });const displaySaved=await afterCommit(receipt,`${automatic?'回复已收到，任务记忆已更新。':`已保存为任务 v${result.task.version}；`}${result.entries.length} 条新增记忆待审核。${result.deduplicated?`已跳过 ${result.deduplicated} 条重复候选。`:''}${result.excludedCount?` ${result.excludedCount} 条引用异常候选未收录，原回复已保留。`:''}${result.queue?'本片已处理；候选可在资料库集中审核。':'可以输入下一轮问题。'}`,{completed:true});
  if(runningQueueId&&!displaySaved)await pauseQueueRun();
  if(result.queue?.status==='completed'){stopQueueRunner();if(displaySaved)status(`本批 ${result.queue.ranges.length} 片已处理完成。请在管理页“资料库 → 提炼候选”集中核对；候选尚未审核。`);}
  else if(result.queue?.id===runningQueueId&&result.queue.status==='ready')scheduleQueuedSlice();
  return true;
}
async function keepOriginalMemory(){
  const receipt=pending;requireThat(receipt?.reply?.kind==='update'&&!receipt.processed,'没有待审核的记忆更新');stopAuto();await savePending();
  // Close this round atomically without changing the task. Another window
  // cannot commit its old preview after this decision, even if the local
  // display or reply-record status subsequently fails to save.
  stopQueueRunner();await repository.mutate(snapshot=>{const round=activeRound(snapshot,taskId);requireThat(round?.id===receipt.reply.roundId&&round.packSnapshot.id===receipt.context.packId,'这轮已被其他窗口处理，请重新载入任务');const queue=activeExtractionQueue(snapshot,taskId);if(queue?.activeRoundId===round.id)cancelExtractionQueue(snapshot,queue.id);abandonRound(snapshot,round.id,{expectedVersion:receipt.reply.roundVersion});});
  receipt.processed=true;receipt.reply=null;receipt.disposition='kept_original';let warning='';
  try{await settle(receipt,'cleared');}catch(error){warning+=' 回执状态尚未保存，原文仍保留：'+error.message;}
  if(chatView?.flow?.packId===receipt.context.packId){chatView.flow.status='blocked';chatChanged();try{await saveChat();}catch(error){warning+=' 已保留原记忆，但显示状态尚未保存：'+error.message;}}
  try{await refresh();}catch(error){warning+=' 本轮已关闭，但界面刷新失败：'+error.message;}
  $('#reply-state').textContent='保留原记忆，回执已归档';liveDisplay=null;clearException();render();
  status('已保留原记忆，这次候选没有写入。直接输入下一问即可；原回复记录仍可查看。'+warning,!!warning);return true;
}
async function recheckReply(){
  requireThat(pending&&!pending.processed,'没有待重新校验的回复');await savePending();const latest=await repository.snapshot();pending.reply=null;
  requireThat(equal(pending.context,contextFor(latest)),'这份原文属于旧任务或旧资料包，仍保留在本地；请先保留记录后清空，再准备当前资料。');
  const round=activeRound(latest,taskId);pending.reply=validateInboxReply(latest,taskId,pending.text,round?.packSnapshot.options);pending.error=null;state=latest;showReceipt(pending);status('本地原文已保存并重新校验，核对记忆预览后可继续。');return true;
}
async function supplement({autoSend=false}={}){
  requireThat(!activeExtractionQueue(await repository.snapshot(),taskId),'请先取消本批提炼，再单独处理检索请求；当前片段保留');
  const receipt=pending;requireThat(receipt?.reply?.kind==='search'&&!receipt.processed,'请先读取本轮检索请求');await savePending();
  if(autoSend)requireThat(chatView?.flow?.packId===receipt.context.packId&&chatView.flow.searches<2,'AI 连续补充资料已达到两次，请核对问题或在高级诊断中处理；已停止继续发送。');
  const pack=await repository.mutate(snapshot=>{
    const round=activeRound(snapshot,taskId);requireThat(round?.id===receipt.reply.roundId&&round.version===receipt.reply.roundVersion,'轮次已改变，请重新读取');
    const previous=round.packSnapshot,search=executeMemorySearch(snapshot,taskId,receipt.text,previous.options);
    const pinnedIds=[...new Set([...previous.included.map(item=>item.id),...previous.pinnedIds,...search.pinnedIds,...search.selectedIds])];
    const candidate=checkedPack(snapshot,buildPack(snapshot,{...previous.options,task:round.question,maxChars:Number($('#budget').value),binding:null,memoryTaskId:taskId,...search,selectedIds:[...pinnedIds],pinnedIds}));
    replaceRoundPack(snapshot,round.id,candidate,{expectedVersion:round.version});return cachePack(snapshot,candidate);
  });await afterCommit(receipt,autoSend?'正在补充所需信息…':'补充资料已保存。');
  if(autoSend){chatView.flow.searches++;chatChanged();status('正在补充任务需要的信息…');return transmit(pack,{followup:true});}
  try{await deliver(pack);}catch(error){status('补充资料已保存，填入未完成：'+error.message+'。点“准备记忆并填入网页”可重试现有资料。',true);return false;}
  try{await refresh();}catch(error){status('补充资料已填入原网页，但浮窗刷新失败：'+error.message+'。请在原网页核对后发送。',true);setCollapsed(true);return true;}
  status('补充资料已填入原网页，请点发送，等待 AI 基于补充资料回复。');setCollapsed(true);return true;
}
async function listRecovery(){
  requireThat(taskId,'请先选择任务');const result=await bridge({type:'LIST_REPLY_DRAFTS',payload:{taskId}});requireThat(result.status==='listed',result.message||'读取本地记录失败');recoveryRows=result.records;
  $('#recovery-select').replaceChildren();for(const row of recoveryRows){const option=document.createElement('option');option.value=row.record.id;option.textContent=`${row.record.updatedAt.slice(0,16).replace('T',' ')} · ${{pending:'未确认',processed:'已处理',cleared:'已清空'}[row.record.status]} · ${row.eligibility==='stale'?'只读记录':'当前任务回执'}`;$('#recovery-select').append(option);}
  $('#recovery-status').textContent=`本地 ${recoveryRows.length} 条接收记录。恢复不会自动访问 AI 网页。`;
  if(recoveryRows.some(row=>row.record.status==='pending'))$('#recovery').open=true;
}
async function restore({preserveAnswer=false}={}){
  requireThat(!pending||pending.processed,'先处理或保留当前回复，恢复不会覆盖未确认原文');const selected=$('#recovery-select').value;await listRecovery();
  const row=recoveryRows.find(item=>item.record.id===selected);requireThat(row,'请选择仍存在的记录');$('#recovery-text').value=row.record.text;
  if(row.eligibility==='stale'){status('原文已显示在只读区。'+row.message);return true;}
  const result=await bridge({type:'CLAIM_REPLY_DRAFT',payload:{recordId:selected,expectedRevision:row.record.revision,writerId}});requireThat(result.status==='claimed',result.message||'记录已改变');
  const latest=await repository.snapshot();requireThat(equal(contextFor(latest),result.record.context),'任务已改变，原文保留在只读区');
  stopAuto();state=latest;pending={text:result.record.text,context:result.record.context,record:result.record,reply:null,method:'unknown',processed:false};showReceipt(pending);await savePending();
  const round=activeRound(latest,taskId);
  try{pending.reply=validateInboxReply(latest,taskId,pending.text,round?.packSnapshot.options);}catch(error){pending.error='已恢复格式异常的原始回执，未更新记忆：'+error.message;showReceipt(pending);$('#settings').hidden=false;$('#diagnostics').open=true;status(pending.error,true);return false;}
  showReceipt(pending);if(!preserveAnswer)$('#answer').textContent='已恢复本地记忆区段；普通回复请查看原 AI 网页。';status('已恢复待审核更新；任务记忆尚未改变，请在回答下方核对。');return true;
}
async function recoverVisibleReview(){
  if(!['review','waiting','reply_visible','uncertain','blocked'].includes(chatView?.flow?.status)||pending)return false;
  const matches=recoveryRows.filter(row=>['current','invalid'].includes(row.eligibility)&&row.record.status==='pending'&&row.record.context.packId===chatView.flow.packId);
  if(chatView.flow.status==='blocked'&&!matches.some(row=>row.eligibility==='invalid'))return false;
  if(matches.length===1){$('#recovery-select').value=matches[0].record.id;await restore({preserveAnswer:true});stopAuto();chatView.flow.status=pending?.reply?.kind==='update'?'review':'blocked';chatChanged();await saveChat();if(pending?.reply?.kind==='search'){status('已恢复未完成的检索请求，请在设置中核对补充操作；不会自动重发。',true);$('#settings').hidden=false;$('#diagnostics').open=true;}return true;}
  if(!matches.length&&chatView.flow.status!=='review'&&activeRound(state,taskId)?.packSnapshot.id===chatView.flow.packId)return false;
  chatView.flow.status='blocked';chatChanged();await saveChat();
  status('原候选已过期、已处理或存在多份记录，未自动应用。可在设置中核对记录，也可输入新问题继续。',true);return true;
}
function schedule(){
  clearTimeout(pollTimer);pollTimer=null;if(!$('#auto-read').checked||closed)return;
  pollTimer=setTimeout(async()=>{pollTimer=null;if(!busy){await run($('#read'),receive);}schedule();},2000);
}
click('#prepare',prepare);click('#read',readLatest);click('#confirm-update',confirmUpdate);click('#supplement',supplement);click('#recheck-reply',recheckReply);
click('#send-extraction',sendPreparedExtraction);click('#next-extraction',sendNextExtraction);
click('#queue-start',startExtractionQueue);click('#queue-continue',continueExtractionQueue);click('#queue-cancel',cancelCurrentQueue);
$('#queue-pause').addEventListener('click',async()=>{try{await pauseQueueRun();stopAuto();await refresh();status('本批已暂停，不再开始下一片。当前已开始的发送可能仍会完成，收到回复后可手动保存。');}catch(error){status('连续运行已停止；暂停状态未保存：'+error.message,true);}});
click('#review-confirm',confirmUpdate);click('#review-skip',keepOriginalMemory);
click('#handoff',handoffCurrent);
click('#start-new-question',async()=>{
  if(activeExtractionQueue(await repository.snapshot(),taskId))await cancelCurrentQueue();
  requireThat(chatView?.flow,'没有正在等待的问题');stopAuto();if(pending&&!pending.processed)await savePending();chatView.flow.status='blocked';chatChanged();await saveChat();liveDisplay=null;renderTranscript();resetPending();clearException();status('旧问题记录已保留，请输入不同的新问题继续。');
});
$('#send').addEventListener('click',event=>{event.preventDefault();return run($('#send'),sendCurrent);});
$('#composer').addEventListener('submit',event=>{event.preventDefault();return run($('#send'),sendCurrent);});
$('#task-context-toggle').addEventListener('click',()=>$('#task-context').hidden?run($('#task-context-toggle'),openTaskContext):setTaskContextOpen(false));
$('#task-context-close').addEventListener('click',()=>setTaskContextOpen(false));
$('#settings-toggle').addEventListener('click',()=>{const open=$('#settings').hidden;setTaskContextOpen(false);$('#settings').hidden=!open;$('#settings-toggle').setAttribute('aria-expanded',String(open));});
$('#exception-details').addEventListener('click',()=>{setTaskContextOpen(false);$('#settings').hidden=false;$('#settings-toggle').setAttribute('aria-expanded','true');$('#diagnostics').open=true;});
$('#question').addEventListener('input',()=>{
  if(!chatView)return;chatView.question=$('#question').value;chatChanged();const leading=chatTimer===null;clearTimeout(chatTimer);if(!busy&&state)render();
  const persist=async()=>{try{await saveChat();}catch(error){if(!closed){stopAuto();status('输入暂未保存到本地：'+error.message,true);}}};
  // Queue the first edit immediately; a lone paste/fill no longer waits for
  // the trailing debounce that pagehide cancels. Continued typing is coalesced.
  // saveChat still serializes writes and checks revisions; no unload write
  // bypasses that protection, and unfinished writes are not called durable.
  const first=leading?persist():null;
  chatTimer=setTimeout(async()=>{chatTimer=null;if(chatGeneration!==chatSavedGeneration)await persist();},200);
  return first;
});
$('#automatic-memory').addEventListener('change',()=>run($('#settings-toggle'),async()=>{requireThat(chatView,'请先选择任务');const previous=chatView.automaticMemory;chatView.automaticMemory=$('#automatic-memory').checked;chatChanged();try{await saveChat();}catch(error){chatView.automaticMemory=previous;$('#automatic-memory').checked=previous;throw error;}status(chatView.automaticMemory?'之后自动保存任务进度；清空已有内容时仍会先请你核对。当前待审核更新不会自动提交。':'之后收到的更新先在回答下方核对；检索补充仍可自动进行。');}));
click('#clear-chat-history',async()=>{requireThat(chatView,'请先选择任务');chatView.rows=[];chatChanged();await saveChat();renderTranscript();status('本地显示历史已清理，任务记忆与未发送输入保留。');});
click('#undo',async()=>{
  const notice=undoableNotice,result=await bridge({type:'UNDO'});requireThat(result.status==='undone',result.message||'无法安全撤销；请核对原网页草稿');
  // Undo resolves this unsent attempt only. A newer failure, pending receipt or
  // uncertain send still needs attention; neither its warning nor state changes.
  if(notice&&notice===undoableNotice&&notice.taskId===taskId&&notice.packId===chatView?.flow?.packId&&chatView.flow.status==='not_sent'&&(!pending||pending.processed)&&$('#exception-message').textContent===notice.message){
    if(notice.button?.dataset.feedback==='error')delete notice.button.dataset.feedback;clearException();
  }
  status('已撤销上次填入并恢复原草稿。本地轮次资料保留，可调整问题后重新填入。');
});
click('#manager',async()=>{const result=await bridge({type:'OPEN_MANAGER'});requireThat(result.status==='opened',result.message||'管理页打开失败');});
click('#task-context-manager',async()=>{requireThat(taskById(state,taskId),'请先选择已保存任务');const result=await bridge({type:'OPEN_MANAGER'});requireThat(result.status==='opened',result.message||'管理页打开失败');});
click('#refresh-tasks',async()=>{await refresh();await listRecovery();status('已重新读取本地任务。');});
click('#refresh-recovery',listRecovery);click('#restore-reply',restore);
click('#archive-reply',async()=>{requireThat(pending,'没有接收原文');await savePending();await settle(pending,pending.disposition==='kept_original'?'cleared':pending.processed?'processed':'cleared');if(chatView?.flow&&chatView.flow.status!=='complete'){chatView.flow.status='blocked';chatChanged();await saveChat();}resetPending();stopAuto();clearException();status('原回复记录已保留，可以输入新的问题继续。');await listRecovery();});
$('#task-select').addEventListener('change',()=>run($('#refresh-tasks'),async()=>{
  const next=$('#task-select').value;if(pending&&!pending.processed)await savePending();
  if(chatView)await saveChat();
  try{await chrome.storage.local.set({activeMemoryTaskId:next});}catch(error){throw Error('任务选择尚未保存，当前任务保持不变：'+error.message);}
  stopQueueRunner();stopAuto();epoch++;taskId=next;resetPending();$('#answer').textContent='正常回复将在这里显示。';$('#recovery-text').value='';
  state=await repository.snapshot();const round=activeRound(state,taskId);$('#scope').value=round?.packSnapshot.options.scope||'';$('#as-of').value=round?.packSnapshot.options.asOf||'';$('#disputed').checked=round?.packSnapshot.options.includeDisputed||false;$('#budget').value=String(round?.packSnapshot.maxChars||12000);await loadChat();render();let recovered=false;if(taskId){await listRecovery();await detectDestination();recovered=await recoverVisibleReview();}if(!recovered&&chatView?.flow?.status!=='uncertain')status(taskId?'任务已载入，可以继续聊天。':'请选择任务。');
}));
$('#auto-read').addEventListener('change',async()=>{if(!$('#auto-read').checked){stopAuto();status('自动接收已停止，已收到的原文保留。');return;}await run($('#read'),receive);schedule();});
$('#question').addEventListener('keydown',event=>{if(event.ctrlKey&&event.key==='Enter'&&!event.isComposing){event.preventDefault();return run($('#send'),sendCurrent);}});
// Closing only removes this iframe. It needs no database snapshot, active-tab
// query or renewed authorization. The parent verifies the sender frame/origin.
$('#close').addEventListener('click',async()=>{
  if(busy||closed)return;const button=$('#close');button.disabled=true;
  try{
    if(pending?.text&&pending.record?.text!==pending.text){
      if(authorized){try{await savePending();}catch(error){pending.error=error.message;status(error.message,true);button.dataset.feedback='error';return false;}}
      else if(!closeUnsavedWarning){closeUnsavedWarning=true;status('连接已过期，这份原文尚未保存。请先复制记忆区段留存；再次点击关闭会关闭此浮窗。',true);document.body.classList.toggle('collapsed',false);parent.postMessage({type:'TEXT_MEMORY_FLOATING_LAYOUT',action:'expand'},'*');return false;}
    }
    if(chatView&&chatGeneration>chatSavedGeneration){
      if(authorized){try{await saveChat();}catch(error){status('输入或显示状态尚未保存：'+error.message,true);button.dataset.feedback='error';return false;}}
      else if(!closeUnsavedWarning){closeUnsavedWarning=true;status('连接已过期，当前输入尚未保存。请先复制留存；再次点击关闭会关闭此窗口。',true);document.body.classList.toggle('collapsed',false);parent.postMessage({type:'TEXT_MEMORY_FLOATING_LAYOUT',action:'expand'},'*');return false;}
    }
    if(authorized){try{const result=await bridge({type:'CLOSE_FLOATING'});if(result.status==='closed'){closed=true;stopCommittedChanges();stopQueueRunner();stopAuto();repository?.close();return true;}}catch{/* A closed/expired service worker must not trap this window. */}}
    parent.postMessage({type:'TEXT_MEMORY_FLOATING_LAYOUT',action:'close'},'*');closed=true;epoch++;stopCommittedChanges();stopQueueRunner();stopAuto();repository?.close();return true;
  }finally{button.disabled=false;}
});
$('#collapse').addEventListener('click',()=>run($('#collapse'),async()=>setCollapsed(!collapsed)));
// Screen coordinates remain stable while the parent moves this iframe. Local
// client coordinates shift underneath the pointer and would cause drag jitter.
const pointerPosition=event=>({x:Number.isFinite(event.screenX)?event.screenX:event.clientX,y:Number.isFinite(event.screenY)?event.screenY:event.clientY});
function bindLayoutPointer(handle,action,{ignoreControls=false}={}){
  let gesture=null;
  const finish=event=>{if(gesture&&(!event||event.pointerId===gesture.id)){gesture=null;handle.classList.toggle('moving',false);}};
  handle.addEventListener('pointerdown',event=>{
    if(closed||gesture||event.button!==0||event.isPrimary===false)return;
    if(ignoreControls&&event.target.closest('button,a,input,textarea,select,summary,[contenteditable],[role="button"]'))return;
    const position=pointerPosition(event);if(!Number.isFinite(position.x)||!Number.isFinite(position.y))return;
    gesture={id:event.pointerId,...position};handle.classList.toggle('moving',true);
    // Capture may be unavailable during frame focus changes. Document listeners
    // still continue a drag outside the title; no business authorization is used.
    try{handle.setPointerCapture(event.pointerId);}catch{}
    event.preventDefault();
  });
  document.addEventListener('pointermove',event=>{
    if(!gesture||gesture.id!==event.pointerId)return;
    if(closed||event.buttons===0){finish(event);return;}
    const next=pointerPosition(event);if(!Number.isFinite(next.x)||!Number.isFinite(next.y))return;
    const dx=next.x-gesture.x,dy=next.y-gesture.y;gesture={id:gesture.id,...next};if(dx||dy)layout(action,{dx,dy});
  });
  for(const event of ['pointerup','pointercancel'])document.addEventListener(event,finish);
  handle.addEventListener('lostpointercapture',finish);
  globalThis.addEventListener('blur',()=>finish());
}
bindLayoutPointer($('#floating-header'),'move',{ignoreControls:true});
bindLayoutPointer($('#resize-handle'),'resize');
for(const[selector,action]of [['#drag-handle','move'],['#resize-handle','resize']])$(selector).addEventListener('keydown',event=>{
  const deltas={ArrowLeft:[-12,0],ArrowRight:[12,0],ArrowUp:[0,-12],ArrowDown:[0,12]};
  if(!closed&&deltas[event.key]){event.preventDefault();const[dx,dy]=deltas[event.key];layout(action,{dx,dy});}
});
globalThis.addEventListener('pagehide',()=>{closed=true;epoch++;clearTimeout(chatTimer);stopCommittedChanges();stopQueueRunner();stopAuto();repository?.close();});
globalThis.addEventListener('focus',requestCommittedRefresh);
async function start(){
  try{await authorize();repository=new Repository();watchCommittedChanges();state=await repository.snapshot();const preferences=await chrome.storage.local.get('activeMemoryTaskId');taskId=taskById(state,preferences.activeMemoryTaskId)?.id||'';
    await detectDestination();
    const round=activeRound(state,taskId);$('#scope').value=round?.packSnapshot.options.scope||'';$('#as-of').value=round?.packSnapshot.options.asOf||'';$('#disputed').checked=round?.packSnapshot.options.includeDisputed||false;$('#budget').value=String(round?.packSnapshot.maxChars||12000);await loadChat();render();let recovered=false;if(taskId){await listRecovery();recovered=await recoverVisibleReview();}if(!recovered&&chatView?.flow?.status!=='uncertain')status(chatView?.flow?.status==='reply_visible'?'回答已显示，记忆尚未更新。可以继续提问。':'已连接当前 AI，可以直接发送问题。');if(!activeExtractionQueue(state,taskId)&&['waiting','reply_visible'].includes(chatView?.flow?.status)&&!showHandoff()){$('#auto-read').checked=true;schedule();}
  }catch(error){status(error.message||String(error),true);}
  finally{starting=false;if(state&&authorized){render();$('#content').hidden=false;layout('ready');}void refreshCommittedState();}
}
const floatingSitePicker=mountSitePicker({root:document,applyTheme:false,onConnect:async value=>{
  try{
    requireThat(authorized&&!busy,'请等待当前操作完成再切换 AI');
    return await connectSite(value,{api:chrome,beforeNavigate:async()=>{await pauseQueueRun();if(taskId)await saveChat();stopAuto();}});
  }catch(error){status(error.message,true);return false;}
}});
click('#open-handoff',async()=>{
  requireThat(taskById(state,taskId),'请先选择已保存任务');await pauseQueueRun();if(pending&&!pending.processed)await savePending();await saveChat();stopAuto();
  await chrome.storage.local.set({activeMemoryTaskId:taskId,textMemoryOpenHandoff:true});
  const result=await bridge({type:'OPEN_MANAGER'});requireThat(result.status==='opened',result.message||'无法打开接力工作台');
  status('已打开任务工作台，在“跨 AI 接力”中选择目标网站。');
});
await start();
