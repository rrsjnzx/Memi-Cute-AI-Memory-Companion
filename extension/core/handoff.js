import {clone,equal,isoDate,requireThat,string,LIMITS} from './base.js';
import {supportedSites} from './sites.js';
import {taskById,taskSelection} from './tasks.js';
import {buildPack,validatePack,diagnosePack,rememberPack} from './pack.js';
import {activeRound,prepareRound,resumeRound,validateRounds} from './rounds.js';
import {activeExtractionQueue} from './extraction-queue.js';
import {clipboardPack} from './delivery.js';

const prepared=new WeakMap();
const localSite={name:'本地任务库',origin:null};
const roundIdentity=round=>round?{id:round.id,version:round.version,status:round.status,packId:round.packSnapshot.id}:null;
const contextFor=pack=>({...clone(pack.options),memoryTaskId:pack.memoryTask.id});

function siteFor(value,{source=false}={}){
  if(source&&['','local','本地任务库',null,undefined].includes(value))return clone(localSite);
  string(value,source?'来源站点':'目标站点',200);
  const site=supportedSites.find(site=>[site.name.toLocaleLowerCase(),site.origin].includes(value.toLocaleLowerCase()));
  requireThat(site,'请选择支持的 AI 站点');
  return{name:site.name,origin:site.origin};
}

function requestFor(state,input){
  requireThat(input&&typeof input==='object'&&!Array.isArray(input),'请提供接力任务选项');
  string(input.taskId,'接力任务 ID',199);const task=taskById(state,input.taskId);
  requireThat(task,'请先选择并保存接力任务');
  const current=activeRound(state,task.id),old=current?.packSnapshot;
  const nextQuestion=input.nextQuestion??'';
  string(nextQuestion,'接力后的问题',4000,false);
  const request={taskId:task.id,sourceSite:siteFor(input.sourceSite,{source:true}),targetSite:siteFor(input.targetSite),
    nextQuestion:nextQuestion.trim()?nextQuestion:old?.task||'继续当前任务',
    scope:input.scope??old?.options.scope??'',asOf:input.asOf??old?.options.asOf??'',
    maxChars:input.maxChars??old?.maxChars??12000,includeDisputed:input.includeDisputed??old?.options.includeDisputed??false,
    pendingReply:input.pendingReply??false};
  string(request.scope,'接力适用范围',1000,false);string(request.asOf,'接力适用日期',10,false);isoDate(request.asOf);
  requireThat(Number.isInteger(request.maxChars)&&request.maxChars>=128&&request.maxChars<=LIMITS.packChars,'字符预算须为 128—100000');
  requireThat(typeof request.includeDisputed==='boolean'&&typeof request.pendingReply==='boolean','争议资料和待处理回复状态须为布尔值');
  return{request,task,current};
}

function prerequisiteIssues(state,taskId,pendingReply){
  const issues=[];
  if(pendingReply)issues.push({code:'pending_reply',message:'还有待处理的 AI 回复。请先核对并保存更新，或明确保留/清空该回复，再准备接力。'});
  const queue=activeExtractionQueue(state,taskId);
  if(queue)issues.push({code:'extraction_queue_active',message:'此任务还有未结束的长文提炼批次。请先完成批次，或在本轮记录中取消批次并保留当前片段；接力不会替你取消。',queueId:queue.id});
  return issues;
}

function summaryFor(state,pack){
  const entries=new Map(state.entries.map(entry=>[entry.id,entry]));
  const selected=new Set(pack?.selectedIds||[]),cores=new Set(pack?.memoryTask.coreEntryIds||[]);
  const excludedCounts={};
  for(const entry of pack?.excluded||[])excludedCounts[entry.reason]=(excludedCounts[entry.reason]||0)+1;
  return{
    included:(pack?.included||[]).map(item=>({id:item.id,title:entries.get(item.id)?.title||item.id,version:item.version,core:cores.has(item.id),sourceCount:item.sourceRefs.length})),
    excluded:(pack?.excluded||[]).filter(item=>selected.has(item.id)).map(item=>({...clone(item),title:entries.get(item.id)?.title||item.id,core:cores.has(item.id)})),
    excludedCounts,
  };
}

/** A handoff is a view over the existing task-pack protocol. Site labels are
 * local routing choices, never inferred delivery evidence or new instructions
 * appended to a signed-off pack. Previewing does not save, abandon, or send. */
export function previewTaskHandoff(state,input){
  const {request,task,current}=requestFor(state,input),blockers=prerequisiteIssues(state,task.id,request.pendingReply),warnings=[];
  const context={libraryIds:[task.libraryId],scope:request.scope,asOf:request.asOf,includeDisputed:request.includeDisputed,memoryTaskId:task.id};
  let pack=null;
  if(current){
    if(current.packSnapshot.sourceExtraction)blockers.push({code:'extraction_round_active',message:'当前轮次正在提炼原文，请先处理当前片段。接力任务包只携带已审核记忆，不会把未审核原文改成普通任务资料。'});
    if(current.question!==request.nextQuestion)blockers.push({code:'active_question_changed',message:'此任务还有未结束轮次。接力时请保留原问题，或先处理当前回复、在本轮记录中明确结束旧轮次后再换问题。'});
    if(!equal(current.packSnapshot.options,{libraryIds:[task.libraryId],scope:request.scope,asOf:request.asOf,includeDisputed:request.includeDisputed})||request.maxChars!==current.packSnapshot.maxChars)
      blockers.push({code:'active_context_changed',message:'接力当前轮次需要保留原资料库、范围、日期和预算；请恢复原选项，或先在任务页明确同步资料。'});
    if(!current.packSnapshot.sourceExtraction){
      try{
        const resumed=resumeRound(state,current.id,context);
        // This read-only gateway also rejects a damaged cache instead of
        // quietly overwriting it with an otherwise valid round snapshot.
        pack=clipboardPack(state,resumed.pack.id,context);
      }catch(error){blockers.push({code:error.code||'round_stale',message:error.message});}
    }
    warnings.push('将保留当前轮次的原问题和资料包 ID。来源 AI 的待审核回复不会自动写入，也不会声明目标 AI 已收到。');
  }else{
    const selection=taskSelection(state,task.id,request.nextQuestion,context);
    pack=buildPack(state,{...context,...selection,task:request.nextQuestion,maxChars:request.maxChars,binding:null});
  }
  if(pack){
    const errors=validatePack(state,pack,{...context,binding:null});
    const diagnostic=diagnosePack(state,pack);
    for(const issue of diagnostic.issues.filter(issue=>issue.blocking))blockers.push({code:issue.reason,message:`${issue.title}：${issue.action}`,entryId:issue.id});
    if(errors.length&&!diagnostic.issues.some(issue=>issue.blocking))blockers.push(...errors.map(message=>({code:'invalid_pack',message})));
  }
  const pendingEntries=state.entries.filter(entry=>entry.libraryId===task.libraryId&&entry.reviewStatus!=='confirmed').length;
  if(pendingEntries)warnings.push(`资料库还有 ${pendingEntries} 条未审核记忆，未作为已确认资料交给目标 AI。`);
  const preview={kind:'task_handoff',version:1,mode:current?'resume':'new',task:clone(task),sourceSite:request.sourceSite,targetSite:request.targetSite,
    nextQuestion:request.nextQuestion,context,round:roundIdentity(current),pack,ready:blockers.length===0,blockers,warnings,...summaryFor(state,pack),
    notice:'接力包包含当前任务目标、约束、进度、未解决事项和可对外使用的记忆。预览不改变轮次；复制成功也不代表已发送。'};
  prepared.set(preview,{value:clone(preview),task:clone(task),round:roundIdentity(current)});
  return preview;
}

/** Explicit local preparation, suitable for Repository.mutate. Call the
 * clipboard/browser gateway next, and markRoundDelivered only after its
 * successful result. No automatic round replacement or delivery happens here. */
export function prepareTaskHandoff(state,preview,{pendingReply=false}={}){
  const baseline=prepared.get(preview);
  requireThat(baseline&&equal(baseline.value,preview),'接力预览已改变或不属于此页面，请重新预览','version_conflict');
  requireThat(preview.ready&&preview.pack,preview.blockers.map(issue=>issue.message).join('；')||'接力资料尚未就绪','handoff_blocked');
  requireThat(typeof pendingReply==='boolean','待处理回复状态须为布尔值');
  const blockers=prerequisiteIssues(state,preview.task.id,pendingReply);
  requireThat(!blockers.length,blockers.map(issue=>issue.message).join('；'),'handoff_blocked');
  requireThat(equal(taskById(state,preview.task.id),baseline.task),'任务在预览后已经改变，请重新预览接力包','version_conflict');
  const current=activeRound(state,preview.task.id);
  // A Repository transaction may fail after its callback returns. Accept the
  // original baseline again in that case, and the exact newly prepared round
  // after a successful commit. Never rewrite the original preview baseline.
  requireThat(equal(roundIdentity(current),baseline.round)||baseline.round===null&&baseline.preparedRound&&equal(roundIdentity(current),baseline.preparedRound),'轮次在预览后已经改变，请重新预览接力包','version_conflict');
  const errors=validatePack(state,preview.pack,{...preview.context,binding:null});
  requireThat(!errors.length,errors.join('；'),'stale_pack');
  const staged=clone(state);let round;
  if(current){
    const checked=clipboardPack(staged,preview.pack.id,preview.context);
    requireThat(equal(checked,preview.pack),'接力资料在预览后已经改变，请重新预览','version_conflict');
    // Keep a cache usable by the normal output UI after an old cache eviction.
    if(!staged.packs.some(pack=>pack.id===checked.id))rememberPack(staged,checked);
    round=clone(current);
  }else{
    requireThat(!staged.rounds.some(round=>round.packSnapshot.id===preview.pack.id),'接力资料包已有轮次记录，请重新预览','version_conflict');
    requireThat(!staged.packs.some(pack=>pack.id===preview.pack.id),'资料包 ID 已存在，请重新预览','version_conflict');
    round=prepareRound(staged,preview.pack);rememberPack(staged,preview.pack);
  }
  validateRounds(staged);
  Object.assign(state,staged);
  if(baseline.round===null)baseline.preparedRound=roundIdentity(round);
  return{pack:clone(preview.pack),round:clone(round),context:clone(preview.context),sourceSite:clone(preview.sourceSite),targetSite:clone(preview.targetSite),reused:!!current};
}
