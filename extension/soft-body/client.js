import {getExpression} from './catalog.js';
import {getSemanticExpression,getPresentationExpression,INTERACTION_TO_V2} from './mapping.js';
import {createSoftFace,expressionForSnapshot} from './face.js';
import {createSoftBody} from './physics.js';
import {createBodyInteraction} from './interaction.js';
import {createPresentationController,canUseRubEmotion,STATUS_TEXT,SEMANTIC_STATES} from './presentation.js';

const actions=new Set(["open-manager", "connect-site", "workspace-new-task", "new-library", "read-target", "bind-target", "pause-target", "site-self-test", "read-site-self-test", "functional-test", "read-functional-test", "prepare-restart-check", "verify-restart-check", "read-restart-check", "seed-demo", "open-floating", "workspace-create-library", "load-memory-task", "new-memory-task", "handoff-toggle", "handoff-preview-button", "handoff-copy", "handoff-open-target", "task-browse-library", "task-import", "save-memory-task", "reload-memory-task", "open-core-picker", "quick-add-memory", "memory-core-prev", "memory-core-next", "prepare-memory-web", "cancel-memory-extraction-queue", "resume-memory-round", "abandon-memory-round", "prepare-memory-handoff", "clear-memory-rounds", "insert-pack", "copy-pack", "undo-pack", "use-recommended-budget", "sync-memory-round", "retrieve", "build-pack", "remember-core-selection", "read-latest-memory", "sync-memory-reply", "process-memory-reply", "apply-memory-update", "clear-memory-reply", "restore-reply-draft", "read-reply-drafts", "discard-reply-draft", "read-and-process-memory", "read-memory-reply", "execute-memory-search", "preview-memory-update", "new-entry", "show-entry-view", "show-source-view", "show-candidate-view", "entry-reset-filters", "entry-clear-selection", "entry-batch-add-tag", "entry-batch-archive", "entry-batch-confirm", "entry-batch-cancel", "entry-prev", "entry-next", "entry-page-go", "source-prev", "source-next", "candidate-clear-selection", "candidate-review-preview-button", "candidate-review-confirm", "candidate-review-cancel", "candidate-prev", "candidate-next", "check-answer", "diagnose", "run-probes", "watch-form", "add-field", "save-template", "migrate-template", "load-schema-draft", "rule-form", "preview-import", "commit-import", "view-imported-entries", "export-backup", "dynamic-action", "view-action", "source-coverage-check","save-entry","entry-lifecycle","delete-entry","resolve-entry-conflict"]);
for(const actionId of ['core-draft-add','core-draft-remove','remove-rule'])actions.add(actionId);
const allowedSites=new Set(['chatgpt','deepseek','gemini','claude','grok','kimi','qianwen']);
const failures=new Set(['missing_field','target_unselected','permission_required','conflict_detected','unverified','partial_success','network_error','write_error','insert_error','parse_error','permission_error','timeout','page_not_ready']);
const processing=new Set(['loading','thinking','validating','awaiting_result']);
const feedbackOperation='feedback-transport';
const instances=new WeakMap();
export const SOFT_ACTION_EVENT='text-memory-soft-action';
// Explicit callbacks only. Event details never contain task names or user text.
export function softAction(actionId,phase,semanticState='',statusCode='',attemptId='',destinationSiteId=''){
  try{const attempt=phase==='begin'&&!attemptId?crypto.randomUUID():attemptId;globalThis.document?.dispatchEvent(new CustomEvent(SOFT_ACTION_EVENT,{detail:{actionId,phase,semanticState,statusCode,attemptId:attempt,...(actionId==='connect-site'&&phase==='begin'&&allowedSites.has(destinationSiteId)?{destinationSiteId}:{})}}));return attempt;}catch{return '';}
}
export function installSoftBody({document:doc=globalThis.document,transport=null,preview=false}={}){
  const card=doc.getElementById('soft-body-card');if(!card)return null;
  instances.get(card)?.dispose();
  const stage=doc.getElementById('soft-body-stage'),cap=doc.getElementById('soft-capability'),localFeedback=doc.getElementById('soft-feedback-fallback'),text=doc.getElementById('soft-local-state'),issues=doc.getElementById('soft-unresolved');
  const view=createSoftFace({document:doc}),feedback=createSoftFace({document:doc,feedback:true});stage.append(view.element);localFeedback.querySelector('.soft-feedback-face').append(feedback.element);
  view.element.setAttribute('role','img');view.element.setAttribute('aria-label','可揉颜表情');view.element.removeAttribute('aria-hidden');
  let presenter=null,snapshot=null,port=null,phaseTimer=null,closed=false,reduced=false,hidden=false,external=false,externalCapable=false,context=null,detached=false,generation=0,connectionGeneration=0,connectionAttempt=null,replayTime=null;
  const tickets=new Map(),unresolved=new Map(),failedGenerations=new Map(),listeners=[],portListeners=[];let timings=[];
  let ambientTimer=null,ambientState=null,tapCount=0,feedbackAttempt=null,lastContext=null,frozenBusiness=false,bodyInteractionState='none';
  const media=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
  const body=createSoftBody({cx:150,cy:174,width:222,height:64});
  const interaction=createBodyInteraction({svg:view.element,stage,body,onFrame:frame=>{
    stage.dataset.active=String(frame.active);
    if(!frame.held)view.setInteractionReaction(null);
    view.setFrame(frame);if(!frame.active&&snapshot)paintMain();
  },onInteraction:value=>{
    const kind=typeof value==='string'?value:value?.interaction||value?.state;
    bodyInteractionState=kind;
    if(!snapshot)return;
    updateBodyReaction();
    if(['none','cancelled_reset'].includes(kind)){if(kind==='cancelled_reset'||!['wake','peek'].includes(ambientState))ambientState=null;paintMain();armIdle();return;}
    if(canUseRubEmotion(snapshot)&&!unresolved.size){
      const wasSleepy=ambientState==='sleepy';clearTimeout(ambientTimer);ambientTimer=null;
      if(kind==='poke')tapCount++;
      ambientState=kind==='release_bounce'&&['wake','peek'].includes(ambientState)?ambientState:kind==='poke'&&wasSleepy?'wake':kind==='poke'&&tapCount%3===0?'peek':INTERACTION_TO_V2[kind];
      paintMain();
    }
  }});
  const output={getSnapshot:()=>snapshot&&structuredClone(snapshot),getTimings:()=>timings.slice(),getBodyFrame:()=>body.getFrame(),dispose};
  function listen(target,type,callback,options){target?.addEventListener?.(type,callback,options);listeners.push(()=>target?.removeEventListener?.(type,callback,options));}
  function updateFallback(){
    // Feedback bubbles belong only outside the right panel. The retained node
    // is an inert compatibility mirror, never a visible pending-ACK fallback.
    localFeedback.hidden=true;
    cap.dataset.externalConfirmed=String(external);
  }
  function canIdle(){return !closed&&!hidden&&doc.visibilityState!=='hidden'&&snapshot&&canUseRubEmotion(snapshot)&&!unresolved.size&&!body.getFrame().active;}
  function setMainExpression(entry,phase){
    view.setExpression(entry,phase);
    // Link the face actually on the body, including ambient/rub-only changes.
    // blocked_rub is a force layer, so its original business recipe stays here.
    const atlas=doc.getElementById('soft-open-atlas');if(!atlas)return;
    const persona=allowedSites.has(snapshot?.personaId)?snapshot.personaId:null;
    const canonical=persona&&entry?.personaId===persona?getExpression(persona,entry.stateId):null;
    atlas.href='soft-body/atlas.html'+(persona?'?persona='+persona:'')+(canonical&&canonical.id===entry.id?'&expression='+encodeURIComponent(canonical.id)+'&phase='+encodeURIComponent(phase):'');
  }
  function paintMain(){const entry=ambientState&&canUseRubEmotion(snapshot)&&!unresolved.size?getExpression(snapshot.personaId,ambientState):null;setMainExpression(entry||expressionForSnapshot(snapshot),entry?'main':snapshot.phase);}
  function updateBodyReaction(){
    const blocked=failures.has(snapshot?.semanticState);
    const heldKind=['press_hold','rub_soft','rub_fast','rub_overload','drag_pull'].includes(bodyInteractionState);
    view.setInteractionReaction(blocked&&heldKind?getExpression(snapshot.personaId,'blocked_rub'):null);
  }
  function armIdle(){
    clearTimeout(ambientTimer);ambientTimer=null;if(!canIdle())return;
    // Interactions are cosmetic only: no timer starts an action or invents a
    // result. Unresolved failures and in-flight operations prevent idle faces.
    const finishInteraction=ambientState&&ambientState!=='sleepy';
    ambientTimer=setTimeout(()=>{ambientTimer=null;if(!canIdle())return;ambientState=finishInteraction?null:'sleepy';paintMain();if(finishInteraction)armIdle();},finishInteraction?1600:30000);
  }
  function selectedPersona(){const selected=doc.documentElement.dataset.site;return allowedSites.has(selected)?selected:'neutral';}
  function updateIssues(){while(unresolved.size>8)unresolved.delete(unresolved.keys().next().value);issues.textContent=unresolved.size?`${unresolved.size} 项操作仍需核对：${[...unresolved.values()].join('；')}`:'';}
  function keepBusinessResult(){return snapshot?.operationId!==feedbackOperation&&(failures.has(snapshot?.semanticState)||processing.has(snapshot?.semanticState)||[...unresolved.keys()].some(key=>key!==feedbackOperation));}
  function feedbackResult(semanticState,statusCode,attempt){
    if(!attempt||attempt.preserve)return;
    let ticket;
    if(snapshot.operationId===feedbackOperation&&snapshot.attemptId===attempt.attemptId)ticket={contextKey:snapshot.contextKey,operationId:feedbackOperation,attemptId:attempt.attemptId};
    else if(snapshot.operationId==='idle')ticket=presenter.begin({operationId:feedbackOperation,attemptId:attempt.attemptId});
    else return; // A transport outcome cannot take over another operation.
    presenter.result(ticket,{semanticState,statusCode,evidence:'uncertain'});
  }
  function lostFeedback(message,{closePort=true}={}){
    const attempt=feedbackAttempt,known=!!context||!!lastContext||!!attempt;
    if(closePort)disconnect();detachContext();feedbackAttempt=null;
    cap.textContent=message;
    // Only an explicit broken endpoint is a loss. A delayed render receipt,
    // narrow viewport or first-time unavailable context is not a network error.
    if(known){
      unresolved.set(feedbackOperation,STATUS_TEXT.feedback_connection_lost||STATUS_TEXT.network_error);
      // V3 section 05: background loss updates status, never starts a button
      // bubble. Only the already-started user recheck may receive this result,
      // using that same attempt rather than inventing a new operation chain.
      if(attempt&&!keepBusinessResult())feedbackResult('network_error','feedback_connection_lost',attempt);
      updateIssues();
    }
    updateFallback();
  }
  function beginFeedbackReconnect(){
    const preserve=keepBusinessResult();
    const attempt={attemptId:crypto.randomUUID(),ticket:null,contextKey:null,preserve};feedbackAttempt=attempt;
    if(!preserve){
      const ticket=presenter.begin({operationId:feedbackOperation,attemptId:attempt.attemptId,semanticState:'loading',statusCode:'feedback_reconnecting'});
      if(feedbackAttempt!==attempt)return; // Synchronous send failure ended it.
      attempt.ticket=ticket;
    }
    cap.textContent='正在重新核对当前网页的外侧反馈通道…';
    if(port)send({type:'hello'});else connect();
  }
  function detachContext(){
    // A display transport failure does not erase a real business failure.
    // Keep the old local presentation explicitly detached, discard its tickets,
    // and create a fresh local context before accepting any subsequent action.
    if(context)lastContext=context;
    context=null;detached=true;generation++;tickets.clear();connectionAttempt=null;external=false;externalCapable=false;interaction.cancel();updateFallback();
  }
  function send(value){
    if(!port||closed)return false;
    try{port.postMessage(value);return true;}catch{lostFeedback('外侧反馈不可用：连接已中断，上次结果保留在本体和文字状态中；可点击“重新连接外侧反馈”。');return false;}
  }
  function schedule(){
    clearTimeout(phaseTimer);phaseTimer=null;
    if(closed||hidden||doc.visibilityState==='hidden'||!snapshot)return;
    const elapsed=Math.max(0,Date.now()-snapshot.startedAt);let deadline=null;
    if(processing.has(snapshot.semanticState)){
      // A dismissed processing bubble stays closed until a real result arrives.
      if(snapshot.phase==='enter')deadline=180;
      else if(snapshot.semanticState!=='awaiting_result'&&elapsed<6000)deadline=6000;
    }else if(snapshot.feedbackVisible){
      if(elapsed<100)deadline=100;else if(elapsed<320)deadline=320;
      else if(snapshot.duration&&elapsed<2400)deadline=2400;
      else if(snapshot.duration)deadline=snapshot.duration;
    }
    if(deadline!==null)phaseTimer=setTimeout(()=>{phaseTimer=null;presenter?.advance();schedule();},Math.max(1,deadline-elapsed));
  }
  function paint(next){
    if(closed)return;
    // Both documents consume one immutable value, never a wire-only override.
    if(hidden&&next.feedbackVisible){presenter?.dismiss(next.revision);return;}
    snapshot=next;external=false;card.dataset.semanticState=next.semanticState;card.dataset.recipeId=next.recipeId;card.dataset.revision=String(next.revision);card.dataset.phase=next.phase;
    ambientState=null;clearTimeout(ambientTimer);ambientTimer=null;
    const entry=expressionForSnapshot(next);setMainExpression(entry,next.phase);updateBodyReaction();feedback.setExpression(entry,next.phase);feedback.element.dataset.revision=String(next.revision);localFeedback.dataset.revision=String(next.revision);localFeedback.dataset.recipeId=next.recipeId;localFeedback.dataset.phase=next.phase;
    updateFallback();localFeedback.querySelector('.soft-feedback-text').textContent=STATUS_TEXT[next.statusCode]||STATUS_TEXT.unverified;text.textContent=STATUS_TEXT[next.statusCode]||STATUS_TEXT.unverified;
    doc.getElementById('soft-close-feedback').disabled=!next.feedbackVisible;
    timings.push({contextKey:next.contextKey,revision:next.revision,at:Date.now(),phase:next.phase,recipeId:next.recipeId});timings=timings.slice(-60);
    if(context&&port&&!preview&&!frozenBusiness&&next.contextKey===context.key){
      if(externalCapable)cap.textContent='正在等待当前表情的外侧显示确认；结果保留在本体和文字状态中。';
      send({type:'presentation',snapshot:next});
    }schedule();armIdle();
  }
  function resetContext(next=null,{preserveConnection=false}={}){
    // A site-opening operation is intentionally allowed to change the target.
    // Preserve only its explicitly named destination and genuine open receipt;
    // page reads/writes and their tickets still end at every context boundary.
    const current=connectionAttempt,visibleSuccess=current?.lastResult&&snapshot?.attemptId===current.ticket.attemptId&&snapshot?.statusCode==='site_connected'&&snapshot.feedbackVisible;
    const pendingSuccess=current?.lastResult&&current.waitingForTarget;
    const carry=preserveConnection&&current&&(current.lastResult?(visibleSuccess||pendingSuccess)&&Date.now()-current.lastResult.at<2560:current.active)?current:null;
    generation++;interaction.cancel();presenter?.dispose();clearTimeout(phaseTimer);phaseTimer=null;tickets.clear();localFeedback.hidden=true;
    context=next;detached=false;external=false;externalCapable=false;frozenBusiness=false;lastContext=next;const persona=allowedSites.has(next?.siteId)?next.siteId:selectedPersona();
    connectionAttempt=carry;
    presenter=createPresentationController({contextKey:next?.key||'local-'+crypto.randomUUID(),personaId:persona,resolveRecipe:(site,semantic,details={})=>getPresentationExpression(site,semantic,{...details,retry:failedGenerations.get(details.operationId)===generation})?.id||'neutral.'+semantic,now:()=>replayTime??Date.now(),onChange:paint});paint(presenter.getSnapshot());
    if(carry&&connectionAttempt===carry&&!detached){
      carry.waitingForTarget=persona!==carry.destinationSiteId;
      if(!carry.waitingForTarget){
        carry.ticket=presenter.begin({operationId:'connect-site',attemptId:carry.ticket.attemptId});carry.generation=generation;carry.migrated=true;tickets.set('connect-site',carry);
        if(carry.lastResult){
          replayTime=carry.lastResult.at;try{presenter.result(carry.ticket,{semanticState:'task_success',statusCode:'site_connected',evidence:'confirmed',resolved:true});}finally{replayTime=null;}
          presenter.advance();schedule();
        }
      }
    }
  }
  function validContext(value){return value===null||!!value&&typeof value.key==='string'&&value.key.length>0&&value.key.length<=160&&Number.isSafeInteger(value.windowId)&&Number.isSafeInteger(value.tabId)&&typeof value.documentId==='string'&&typeof value.pageSession==='string'&&allowedSites.has(value.siteId);}
  function sameContext(left,right){return left===null&&right===null||!!left&&!!right&&['key','windowId','tabId','documentId','pageSession','siteId'].every(key=>left[key]===right[key]);}
  function message(event){
    const data=event?.data||event;if(closed||doc.visibilityState==='hidden'||!data)return;
    if(data.type==='context'&&validContext(data.context)){
      const same=sameContext(context,data.context),capable=data.context!==null&&data.capability?.mode==='external';
      const confirmLayout=doc.getElementById('soft-confirm-right-layout');if(confirmLayout)confirmLayout.hidden=!data.context||!['layout_unknown','layout_query_failed'].includes(data.capability?.reason);
      const reconnect=feedbackAttempt;
      if((reconnect?.preserve||frozenBusiness&&same)&&(!data.context||data.context.siteId===snapshot.personaId)){
        // Retain the old business snapshot locally. Do not re-label it with a
        // new session key or publish an old operation into that session.
        if(!same||detached){generation++;tickets.clear();connectionAttempt=null;interaction.cancel();}
        context=data.context;detached=true;frozenBusiness=true;external=false;externalCapable=false;feedbackAttempt=null;lastContext=context;
        if(context)unresolved.delete(feedbackOperation);updateIssues();
        cap.textContent=data.context?'连接已重新核对；上次业务问题保留在本体和文字状态中，请继续处理原问题。':'外侧通道仍不可用；上次业务问题保留在本体和文字状态中，连接原因：'+(data.capability?.reason||'能力未确认');
        updateFallback();return;
      }
      if(!same||detached)resetContext(data.context,{preserveConnection:!detached});
      if(!sameContext(context,data.context))return; // A publish during reset lost the port; deserialized equal values remain valid.
      externalCapable=capable;
      if(reconnect){
        if(reconnect.preserve){feedbackAttempt=null;}
        else if(capable){
          reconnect.contextKey=data.context.key;
          const ticket=presenter.begin({operationId:feedbackOperation,attemptId:reconnect.attemptId,semanticState:'loading',statusCode:'feedback_reconnecting'});
          if(feedbackAttempt!==reconnect||!sameContext(context,data.context))return;
          reconnect.ticket=ticket;
        }else{
          feedbackAttempt=null;
          const semantic=data.capability?.reason==='permission_required'?'permission_required':'page_not_ready';
          feedbackResult(semantic,semantic,reconnect);
        }
      }
      if(!capable)external=false;
      cap.textContent=capable?external?'网页已确认当前表情的外侧显示。':'外侧通道可用，正在等待当前表情的显示确认；结果保留在本体和文字状态中。':'外侧反馈不可用（'+(data.capability?.reason||'能力未确认')+'）；结果保留在本体和文字状态中，可重新连接或检查侧栏位置。';updateFallback();
    }else if(data.type==='context_invalidated'&&context&&data.contextKey===context.key){
      const confirmLayout=doc.getElementById('soft-confirm-right-layout');if(confirmLayout)confirmLayout.hidden=true;
      if(data.reason==='overlay_disconnected'){lostFeedback('外侧反馈连接已中断，上次结果保留在本体和文字状态中；可点击“重新连接外侧反馈”。',{closePort:false});return;}
      feedbackAttempt=null;lastContext=null;frozenBusiness=false;
      external=false;cap.textContent='网页上下文已变化，旧反馈已清理。';resetContext(null,{preserveConnection:true});send({type:'hello'});
    }else if(data.type==='dismiss_requested'&&context&&!frozenBusiness&&snapshot?.contextKey===context.key&&data.contextKey===context.key&&data.revision===snapshot.revision)presenter.dismiss(data.revision);
    else if(data.type==='rejected'&&context&&data.contextKey===context.key){
      external=false;cap.textContent='外侧显示请求未获确认；当前结果保留在本体和文字状态中，可重新连接外侧反馈。';updateFallback();
    }else if(data.type==='presented'&&context&&!frozenBusiness&&snapshot?.contextKey===context.key&&data.contextKey===context.key&&data.revision===snapshot.revision){
      if(data.mode==='internal'&&data.reason==='overlay_disconnected'){lostFeedback('外侧反馈连接已中断，上次结果保留在本体和文字状态中；可点击“重新连接外侧反馈”。',{closePort:false});return;}
      external=data.mode==='external';
      cap.textContent=external?'网页已确认当前表情的外侧显示。':'外侧反馈不可用（'+(data.reason||'网页未确认显示')+'）；结果保留在本体和文字状态中，可重新连接或检查侧栏位置。';updateFallback();
      if(external&&Number.isFinite(data.renderedAt)){const own=timings.findLast(row=>row.contextKey===snapshot.contextKey&&row.revision===data.revision);if(own)own.remoteDeltaMs=data.renderedAt-own.at;}
      if(external&&feedbackAttempt&&!feedbackAttempt.preserve&&feedbackAttempt.contextKey===context.key&&snapshot.operationId===feedbackOperation&&snapshot.attemptId===feedbackAttempt.attemptId){
        const ticket=feedbackAttempt.ticket;feedbackAttempt=null;unresolved.delete(feedbackOperation);updateIssues();
        presenter.result(ticket,{semanticState:'task_success',statusCode:'feedback_reconnected',evidence:'confirmed',resolved:true});
      }
    }
  }
  function action(event){
    const{actionId,phase,semanticState,statusCode,attemptId,destinationSiteId}=event.detail||{};if(!actions.has(actionId)||closed||doc.visibilityState==='hidden'||!presenter||typeof attemptId!=='string'||!attemptId.length||attemptId.length>160||/[\u0000-\u001f\u007f]/u.test(attemptId))return;
    if(phase==='begin'){
      feedbackAttempt=null;
      if(detached)resetContext(context);
      const old=tickets.get(actionId);
      if(old?.ticket.attemptId===attemptId){
        // The generic button wrapper begins before its site-aware handler.
        // Supplement that same active attempt once; never reassign its target.
        if(actionId==='connect-site'&&old.active&&old.generation===generation&&snapshot.operationId===actionId&&snapshot.attemptId===attemptId&&!old.destinationSiteId&&allowedSites.has(destinationSiteId)){old.destinationSiteId=destinationSiteId;old.waitingForTarget=false;connectionAttempt=old;}
        return;
      }
      const ticket=presenter.begin({operationId:actionId,attemptId,semanticState:semanticState||'loading'}),accepted=presenter.getSnapshot();
      if(accepted.operationId!==actionId||accepted.attemptId!==attemptId)return;
      connectionAttempt=null;const record={ticket,active:true,reported:false,generation,migrated:false};tickets.set(actionId,record);
      if(actionId==='connect-site'&&allowedSites.has(destinationSiteId)){record.destinationSiteId=destinationSiteId;record.waitingForTarget=false;connectionAttempt=record;}
    }else{
      const connection=actionId==='connect-site'&&connectionAttempt?.ticket.attemptId===attemptId?connectionAttempt:null;
      const connectionFailure=actionId==='connect-site'&&(semanticState==='permission_error'&&(!statusCode||statusCode==='permission_error')||semanticState==='insert_error'&&statusCode==='operation_failed');
      // Theme data changes synchronously, while its MutationObserver runs later.
      // Bind the actual receipt to the intended persona before that observer.
      if(connection?.active&&!context&&selectedPersona()===connection.destinationSiteId&&snapshot?.personaId!==connection.destinationSiteId)resetContext(null,{preserveConnection:true});
      if(connection?.active&&phase==='result'&&snapshot?.personaId!==connection.destinationSiteId)connection.waitingForTarget=true;
      if(connection?.active&&connection.waitingForTarget){
        if(phase==='result'&&semanticState==='task_success'&&statusCode==='site_connected'){connection.lastResult={at:Date.now()};connection.reported=true;}
        else if(phase==='result'&&connectionFailure){
          // Refusing permission (or failing to open the site) is a known result
          // of this connect attempt even though its destination never connects.
          // Present the failure in the current context; never migrate a page
          // write result or pretend the requested site's identity was verified.
          if(snapshot.operationId!=='connect-site'||snapshot.attemptId!==attemptId){
            const ticket=presenter.begin({operationId:'connect-site',attemptId}),accepted=presenter.getSnapshot();
            if(accepted.operationId!=='connect-site'||accepted.attemptId!==attemptId)return;
            connection.ticket=ticket;
          }else connection.ticket={contextKey:snapshot.contextKey,operationId:'connect-site',attemptId};
          connection.generation=generation;connection.migrated=true;connection.waitingForTarget=false;connection.lastResult=null;tickets.set('connect-site',connection);connectionAttempt=null;
        }
        else if(phase==='result'){connectionAttempt=null;}
        else if(phase==='end'){connection.active=false;if(!connection.lastResult)connectionAttempt=null;}
        if(!connectionFailure||phase!=='result')return;
      }
      const record=tickets.get(actionId);if(!record?.active||record.generation!==generation||record.ticket.attemptId!==attemptId)return;
      if(phase==='repeat'){presenter.repeat(record.ticket,{evidence:'confirmed'});return;}
      if(phase==='result'){
        const allowedMigration=!record.migrated||actionId==='connect-site'&&semanticState==='task_success'&&statusCode==='site_connected'||connectionFailure;
        const semantic=allowedMigration&&SEMANTIC_STATES.includes(semanticState)?semanticState:'unverified';
        const resolved=presenter.result(record.ticket,{semanticState:semantic,evidence:['save_success','copy_success','insert_success','package_success','conflict_resolved','task_success','canceled'].includes(semantic)?'confirmed':'uncertain',statusCode:statusCode||semantic,resolved:true});record.reported=true;
        if(connection===record){if(semantic==='task_success'&&statusCode==='site_connected')record.lastResult={at:Date.now()};else connectionAttempt=null;}
        const effectiveCode=resolved?.operationId===record.ticket.operationId&&resolved?.attemptId===record.ticket.attemptId?resolved.statusCode:semantic;
        if(failures.has(semantic)){unresolved.delete(actionId);unresolved.set(actionId,STATUS_TEXT[effectiveCode]||STATUS_TEXT.unverified);failedGenerations.set(actionId,generation);}else{unresolved.delete(actionId);failedGenerations.delete(actionId);}
      }else if(phase==='end'){
        if(!record.reported){presenter.result(record.ticket,{semanticState:'unverified',evidence:'uncertain'});unresolved.set(actionId,STATUS_TEXT.unverified);}record.active=false;
      }
      updateIssues();updateBodyReaction();
    }
  }
  function disconnect(){
    const previous=port;port=null;connectionGeneration++;for(const remove of portListeners.splice(0))remove();try{previous?.disconnect();}catch{}external=false;externalCapable=false;updateFallback();
  }
  function connect(){
    if(closed||preview||doc.visibilityState==='hidden'||port)return;
    try{
      const endpoint=typeof transport==='function'?transport():transport||globalThis.chrome.runtime.connect({name:'text-memory-soft-body-v1'});
      if(!endpoint?.onMessage?.addListener)throw Error('unavailable');
      port=endpoint;const connection=++connectionGeneration;
      const receive=event=>{if(!closed&&port===endpoint&&connection===connectionGeneration)message(event);};
      const lost=()=>{if(closed||port!==endpoint||connection!==connectionGeneration)return;lostFeedback('外侧反馈不可用：原生连接已关闭，上次结果保留在本体和文字状态中；可点击“重新连接外侧反馈”。');};
      endpoint.onMessage.addListener(receive);endpoint.onDisconnect?.addListener(lost);
      portListeners.push(()=>endpoint.onMessage.removeListener?.(receive),()=>endpoint.onDisconnect?.removeListener?.(lost));send({type:'hello'});
    }catch{port=null;external=false;externalCapable=false;const retry=feedbackAttempt;feedbackAttempt=null;cap.textContent='外侧反馈不可用：当前页面不是已连接的原生右侧栏；结果保留在本体和文字状态中。';if(retry&&!retry.preserve)feedbackResult('page_not_ready','page_not_ready',retry);updateFallback();}
  }
  function savePreferences(){try{void globalThis.chrome?.storage?.local?.set({softBodyPreferences:{reduced,hidden}}).catch(()=>{});}catch{}}
  function preferences(){
    interaction.setReducedMotion(reduced||media?.matches===true);doc.documentElement.dataset.softReduced=String(reduced);card.hidden=hidden;doc.getElementById('soft-visibility').textContent=hidden?'显示颜表情':'隐藏颜表情';
    if(hidden){interaction.cancel();presenter?.dismiss(snapshot?.revision);clearTimeout(phaseTimer);phaseTimer=null;}else schedule();updateFallback();
  }
  const visibility=()=>{
    doc.documentElement.dataset.softPageHidden=String(doc.visibilityState==='hidden');
    if(doc.visibilityState==='hidden'){interaction.cancel();clearTimeout(phaseTimer);phaseTimer=null;feedbackAttempt=null;lastContext=null;frozenBusiness=false;disconnect();resetContext();}
    else{connect();schedule();}
  };
  const dismiss=()=>presenter?.dismiss(snapshot?.revision),hide=()=>{hidden=!hidden;preferences();savePreferences();},reduce=()=>{reduced=doc.getElementById('soft-reduced').checked;preferences();savePreferences();},poke=()=>{if(!hidden)interaction.poke({x:150,y:174});};
  listen(doc.getElementById('soft-close-feedback'),'click',dismiss);listen(localFeedback.querySelector('button'),'click',dismiss);listen(doc.getElementById('soft-visibility'),'click',hide);listen(doc.getElementById('soft-reduced'),'change',reduce);listen(doc.getElementById('soft-poke'),'click',poke);
  listen(doc.getElementById('soft-confirm-right-layout'),'click',()=>{const button=doc.getElementById('soft-confirm-right-layout');if(button?.hidden||!context)return;cap.textContent='已提交侧栏在右侧的布局确认，正在等待网页实际显示回执。';send({type:'confirm_right_layout'});});
  listen(doc.getElementById('soft-reconnect-feedback'),'click',beginFeedbackReconnect);
  listen(stage,'pointerenter',()=>{if(canIdle()&&ambientState!=='sleepy'){ambientState='notice';paintMain();armIdle();}});
  listen(stage,'pointerleave',()=>{if(canIdle()&&ambientState==='notice'){ambientState=null;paintMain();armIdle();}});
  listen(doc,SOFT_ACTION_EVENT,action);listen(doc,'visibilitychange',visibility);listen(media,'change',preferences);listen(globalThis,'resize',()=>{if(doc.visibilityState!=='hidden')send({type:'check_layout'});});listen(globalThis,'pagehide',dispose,{once:true});
  const observer=new MutationObserver(()=>{if(!context&&!closed&&doc.visibilityState!=='hidden'&&selectedPersona()!==snapshot?.personaId)resetContext(null,{preserveConnection:true});});observer.observe(doc.documentElement,{attributes:true,attributeFilter:['data-site']});
  doc.documentElement.dataset.softPageHidden=String(doc.visibilityState==='hidden');resetContext();cap.textContent=preview?'开发预览：同文档布局；不代表原生侧栏外绘已验收。':'正在核对原生侧栏和当前网页的外侧显示能力…';connect();
  try{void globalThis.chrome?.storage?.local?.get('softBodyPreferences').then(saved=>{if(closed)return;reduced=saved.softBodyPreferences?.reduced===true;hidden=saved.softBodyPreferences?.hidden===true;doc.getElementById('soft-reduced').checked=reduced;preferences();}).catch(()=>{});}catch{}
  function dispose(){
    if(closed)return;closed=true;clearTimeout(ambientTimer);disconnect();interaction.dispose();presenter?.dispose();clearTimeout(phaseTimer);observer.disconnect();for(const remove of listeners)remove();listeners.length=0;view.element.remove();feedback.element.remove();localFeedback.hidden=true;if(instances.get(card)===output)instances.delete(card);
  }
  instances.set(card,output);return output;
}
