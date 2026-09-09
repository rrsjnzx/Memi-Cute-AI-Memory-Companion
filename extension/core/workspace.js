import {clone,requireThat,string,isoDate,scopeMatches,within,LIMITS} from './base.js';
import {createLibrary,saveEntry,effectiveSensitivity,entryErrors} from './library.js';
import {taskById,saveTask,TASK_LIMITS} from './tasks.js';

/** Read current records, never a caller's stale or edited entry projection.
 * All messages and titles are plain text; UI callers must use textContent.
 * Existing core IDs are never removed by this diagnostic.
 */
export function describeCoreEligibility(state,entryOrId,taskOrLibraryId,{asOf='',scope=''}={}){
  isoDate(asOf);string(scope,'适用范围',1000,false);
  const entryId=typeof entryOrId==='string'?entryOrId:entryOrId?.id;
  const entry=state.entries.find(value=>value.id===entryId),reasons=[],notices=[];
  const libraryId=typeof taskOrLibraryId==='string'?taskOrLibraryId:taskOrLibraryId?.libraryId;
  const reason=(code,message)=>reasons.push({code,message});
  if(!state.libraries.some(library=>library.id===libraryId))reason('library_missing','请先选择存在的任务资料库。');
  if(typeof taskOrLibraryId==='object'&&taskOrLibraryId?.id){
    const task=taskById(state,taskOrLibraryId.id);
    if(!task||task.libraryId!==libraryId)reason('task_missing','任务已不存在或所属资料库已改变，请重新载入。');
  }
  if(!entry)reason('missing','条目已不存在；若仍被固定为核心，请明确调整核心选择。');
  else{
    if(entry.libraryId!==libraryId)reason('library','条目属于其他资料库，不能作为此任务的核心。');
    if(entry.reviewStatus!=='confirmed')reason('pending','条目尚未确认，请先核对内容。');
    if(entry.lifecycleStatus!=='active')reason('inactive','条目已归档或被替代，不能用于当前任务。');
    if(entry.enabledForContext!==true)reason('disabled','条目已停用，请先明确恢复使用。');
    if(entry.sensitivity!=='normal'||effectiveSensitivity(state,entry)!=='normal')reason('local_only','条目或引用来源仅限本地，不能输出到 AI；请保留限制并调整核心选择。');
    if(entry.conflictState==='unresolved'||entry.conflictIds?.length)reason('conflict','条目存在未解决冲突，核对并解决后才能固定为长期核心。');
    const errors=entryErrors(state,entry);
    if(errors.length)reason('invalid','字段或原文引用校验失败：'+errors.map(error=>`${error.field}：${error.message}`).join('；'));
    if(entry.scope){
      notices.push(`此条目仅适用于“${entry.scope}”；换用其他范围时会阻止资料包输出。`);
      if(!scopeMatches(entry.scope,scope))reason('scope','当前任务范围与条目限制不符，请设置对应范围后使用。');
    }
    if(entry.effectiveFrom||entry.effectiveTo){
      notices.push(`有效日期：${entry.effectiveFrom||'不限起日'} 至 ${entry.effectiveTo?entry.effectiveTo+'（不含当日）':'不限止日'}；每轮均须满足日期限制。`);
      if(!asOf)reason('needs_time','条目有有效期，请指定本轮适用日期。');
      else if(!within(entry,asOf))reason('date','本轮适用日期不在条目有效期内。');
    }
  }
  return{eligible:reasons.length===0,entryId:entryId??null,libraryId:libraryId??null,reasons,notices};
}

// Stage both changes even for direct in-memory callers. Repository.mutate
// additionally supplies the durable IndexedDB transaction around this service.
function commit(state,staged,result){for(const key of Object.keys(staged))state[key]=staged[key];return result;}

export function addQuickMemory(state,{taskInput,content,title},{expectedVersion=null}={}){
  const taskId=typeof taskInput==='string'?taskInput:taskInput?.id;
  string(taskId,'任务 ID',199);string(content,'要记住的内容',LIMITS.content);
  if(title!==undefined)string(title,'记忆标题',300);
  const current=taskById(state,taskId);requireThat(current,'任务已不存在，请重新选择');
  requireThat(current.version===expectedVersion,'任务已被其他面板修改，请重新载入','version_conflict');
  const staged=clone(state),task=taskById(staged,taskId);
  // A supplied form snapshot is an explicit user edit, protected by the same
  // task CAS. Compact {id}/string callers retain the currently saved fields.
  const draft=typeof taskInput==='object'?{...task,...clone(taskInput)}:task;
  requireThat(Array.isArray(draft.coreEntryIds),'任务核心条目须为 ID 数组');
  const entry=saveEntry(staged,{libraryId:task.libraryId,kind:'fact',title:title??content.trim().split(/\r\n|\r|\n/u)[0].slice(0,60),content,
    fields:{},aliases:[],tags:['手动记忆'],sourceRefs:[],evidenceKind:'user_asserted',sensitivity:'normal',enabledForContext:true},
    {confirm:true,reason:'用户明确添加到任务核心的记忆'});
  // Save the captured form and new core together, producing only one task
  // version and never discarding unsaved user changes in the workspace.
  const saved=saveTask(staged,{...draft,coreEntryIds:[...draft.coreEntryIds,entry.id]},{expectedVersion});
  return commit(state,staged,{task:saved,entry});
}

export function createWorkspaceTask(state,draft,context={}){
  requireThat(draft&&typeof draft==='object'&&!Array.isArray(draft)&&!draft.id,'请提供新任务信息');
  string(draft.name,'任务名称',200);string(draft.goal,'任务目标',TASK_LIMITS.text);
  const staged=clone(state),createdLibrary=draft.libraryId===undefined||draft.libraryId===null||draft.libraryId==='';
  let library;
  if(createdLibrary)library=createLibrary(staged,draft.name);
  else{string(draft.libraryId,'资料库 ID',199);library=staged.libraries.find(value=>value.id===draft.libraryId);requireThat(library,'资料库已不存在，请重新选择');}
  requireThat(Array.isArray(draft.coreEntryIds??[]),'任务核心条目须为 ID 数组');
  for(const entryId of draft.coreEntryIds??[]){
    const eligibility=describeCoreEligibility(staged,entryId,library.id,context);
    requireThat(eligibility.eligible,eligibility.reasons.map(reason=>reason.message).join('；'),'core_ineligible');
  }
  const task=saveTask(staged,{name:draft.name,goal:draft.goal,libraryId:library.id,constraints:draft.constraints??'',progress:draft.progress??'',
    openQuestions:draft.openQuestions??'',coreEntryIds:clone(draft.coreEntryIds??[])},{expectedVersion:null});
  return commit(state,staged,{task,library,createdLibrary});
}
