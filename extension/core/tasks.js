import {clone,id,now,string,requireThat,equal} from './base.js';
import {event} from './library.js';
import {retrieve,exclusion} from './retrieval.js';

export const TASK_LIMITS={count:1000,versions:20000,text:12000,coreEntries:100,contextCandidates:100};
export function taskById(state,taskId){return state.tasks?.find(task=>task.id===taskId)||null;}

// Deleted core IDs remain explicit requirements. They are never silently
// removed by retrieval or backup restore; a later pack must fail closed.
export function validateTask(state,task,{allowMissingCore=false}={}){
  requireThat(task&&typeof task==='object'&&!Array.isArray(task),'任务档案必须是对象');
  string(task.libraryId,'任务资料库 ID',199);
  requireThat(state.libraries.some(l=>l.id===task.libraryId),'任务资料库不存在');
  string(task.name,'任务名称',200);
  for(const field of ['goal','constraints','progress','openQuestions'])string(task[field],`任务 ${field}`,TASK_LIMITS.text,false);
  requireThat(Array.isArray(task.coreEntryIds)&&task.coreEntryIds.length<=TASK_LIMITS.coreEntries&&new Set(task.coreEntryIds).size===task.coreEntryIds.length,'任务核心条目须为去重的 ID 数组，最多 100 条');
  for(const entryId of task.coreEntryIds){
    string(entryId,'任务核心条目 ID',199);
    const entry=state.entries.find(e=>e.id===entryId);
    requireThat(entry?entry.libraryId===task.libraryId:allowMissingCore,'任务核心条目必须存在于同一资料库');
  }
  return task;
}

export function saveTask(state,draft,{expectedVersion=null,forceRevision=false}={}){
  const previous=draft.id?taskById(state,draft.id):null;
  requireThat(!draft.id||previous,'任务档案不存在');
  requireThat(!previous||previous.libraryId===draft.libraryId,'不能通过编辑移动任务资料库');
  requireThat(previous?previous.version===expectedVersion:expectedVersion===null,'任务已被其他面板修改，请重新载入','version_conflict');
  requireThat(previous||(state.tasks?.length||0)<TASK_LIMITS.count,'任务档案数量达到上限');
  requireThat(typeof forceRevision==='boolean','任务版本提交选项必须为布尔值');
  requireThat(Array.isArray(draft.coreEntryIds??[]),'任务核心条目须为 ID 数组');
  const value={id:previous?.id||id('task'),libraryId:draft.libraryId,name:draft.name,
    goal:draft.goal??'',constraints:draft.constraints??'',progress:draft.progress??'',openQuestions:draft.openQuestions??'',
    coreEntryIds:[...new Set(draft.coreEntryIds??[])],version:(previous?.version||0)+1,createdAt:previous?.createdAt||now(),updatedAt:now()};
  validateTask(state,value,{allowMissingCore:true});
  for(const entryId of value.coreEntryIds)requireThat(state.entries.some(e=>e.id===entryId)||previous?.coreEntryIds.includes(entryId),'新加入的任务核心条目不存在');
  // Saving an unchanged form must not obsolete a pack already handed to an AI.
  // Validate the caller's version and all fields first; core order remains
  // meaningful because it controls priority in a constrained pack budget.
  const fields=['libraryId','name','goal','constraints','progress','openQuestions','coreEntryIds'];
  if(previous&&!forceRevision&&fields.every(field=>equal(previous[field],value[field])))return previous;
  // A confirmed model reply may deliberately advance an unchanged task so its
  // delivered round can complete and the same reply cannot be applied again.
  requireThat((state.taskVersions?.length||0)<TASK_LIMITS.versions,'任务历史数量达到上限，请导出备份后整理');
  state.tasks??=[];state.taskVersions??=[];
  if(previous)state.tasks[state.tasks.indexOf(previous)]=value;else state.tasks.push(value);
  state.taskVersions.push({...clone(value),id:`${value.id}@${value.version}`,taskId:value.id});
  for(const pack of state.packs)if(pack.memoryTask?.id===value.id)pack.stale=true;
  event(state,previous?'task_updated':'task_created',value.id);
  return value;
}

export function taskSelection(state,taskId,query,options){
  const task=taskById(state,taskId);requireThat(task,'请先保存任务档案');
  requireThat(options.libraryIds?.includes(task.libraryId),'请明确启用任务所属资料库');
  validateTask(state,task,{allowMissingCore:true});
  const retrieved=retrieve(state,query,options),pinnedIds=clone(task.coreEntryIds),entryById=new Map(state.entries.map(entry=>[entry.id,entry]));
  // This pool is outbound context, not a short list of UI search suggestions.
  // Let the pack builder spend its exact character budget across a bounded
  // ranked pool. Cores have their own mandatory slots, so matching cores and
  // local-only hits cannot crowd out ordinary evidence for multi-part tasks.
  // Unavailable cores remain selected so pack validation still blocks them.
  retrieved.hits=retrieved.hits.filter(hit=>{
    const entry=entryById.get(hit.id),reason=exclusion(state,entry,options,{outbound:true});
    if(reason)retrieved.excluded.push({id:entry.id,reason});
    return !reason;
  });
  const coreIds=new Set(pinnedIds),candidates=retrieved.hits.filter(hit=>!coreIds.has(hit.id)).slice(0,TASK_LIMITS.contextCandidates);
  return {retrieved,selectedIds:[...pinnedIds,...candidates.map(hit=>hit.id)],pinnedIds};
}

export function validateTaskHistory(state){
  requireThat(state.tasks.length<=TASK_LIMITS.count&&state.taskVersions.length<=TASK_LIMITS.versions,'任务或任务历史数量超限');
  for(const [task,historical] of [...state.tasks.map(t=>[t,false]),...state.taskVersions.map(t=>[t,true])]){
    validateTask(state,task,{allowMissingCore:true});
    requireThat(Number.isInteger(task.version)&&task.version>=1,'任务版本无效');
    for(const field of ['createdAt','updatedAt'])requireThat(typeof task[field]==='string'&&!Number.isNaN(Date.parse(task[field])),'任务时间无效');
    requireThat(Date.parse(task.createdAt)<=Date.parse(task.updatedAt),'任务创建时间晚于更新时间');
    if(historical){
      const current=taskById(state,task.taskId);
      requireThat(current&&current.libraryId===task.libraryId&&task.version<=current.version&&task.id===`${task.taskId}@${task.version}`,'任务历史版本链无效');
    }
  }
  const persisted=task=>Object.fromEntries(Object.entries(task).filter(([key])=>!['id','taskId'].includes(key)));
  for(const task of state.tasks){
    const history=state.taskVersions.filter(v=>v.taskId===task.id).sort((a,b)=>a.version-b.version);
    requireThat(history.length===task.version&&history.every((v,index)=>v.version===index+1),'任务历史版本不连续');
    requireThat(equal(persisted(task),persisted(history.at(-1))),'当前任务与同版本历史快照不一致');
  }
}
