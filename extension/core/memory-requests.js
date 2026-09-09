import {clone,equal,requireThat,string,isoDate} from './base.js';
import {parseMemoryProtocol,strictObjectKeys} from './protocol.js';
import {taskById,taskSelection} from './tasks.js';
import {exclusion} from './retrieval.js';
import {validatePack} from './pack.js';

// A model may propose search words. Only the caller's explicitly selected
// task and user scope grant access; the reply cannot expand that scope.
export function executeMemorySearch(state,taskId,text,options){
  const task=taskById(state,taskId);requireThat(task,'任务不存在');
  const payload=parseMemoryProtocol(text,'TEXT-MEMORY-SEARCH','记忆检索请求');
  strictObjectKeys(payload,['taskId','baseVersion','packId','query'],'记忆检索请求');
  string(payload.taskId,'任务 ID',200);
  string(payload.packId,'资料包 ID',199);
  requireThat(Number.isSafeInteger(payload.baseVersion)&&payload.baseVersion>=1,'任务基础版本必须是正整数');
  string(payload.query,'检索问题',2000);
  requireThat(payload.taskId===task.id,'检索请求属于另一任务，请勿混用','version_conflict');
  requireThat(payload.baseVersion===task.version,'检索请求基于旧任务版本，请重新生成','version_conflict');
  const active=(state.rounds||[]).find(round=>round.taskId===task.id&&['prepared','delivered'].includes(round.status));
  requireThat(!active||active.packSnapshot.id===payload.packId,'检索请求不属于当前轮次资料包，请使用最新资料包的请求','version_conflict');
  const sourcePack=active?active.packSnapshot:state.packs.find(pack=>pack.id===payload.packId);
  requireThat(sourcePack,'检索请求关联的资料包不存在，请先生成任务资料包','version_conflict');
  requireThat(equal(sourcePack.memoryTask,task),'检索请求资料包的任务版本或配置已改变，请重新生成','version_conflict');
  const errors=validatePack(state,sourcePack,{...sourcePack.options,binding:sourcePack.binding,memoryTaskId:task.id});
  requireThat(!errors.length,'检索请求关联的资料包已失效：'+errors.join('；'),'version_conflict');
  requireThat(!sourcePack.sourceExtraction,'本轮仅提炼已指定的原文片段，不接收额外检索请求；请返回带原文引文的记忆候选','extraction_search_unsupported');
  requireThat(options&&Array.isArray(options.libraryIds)&&options.libraryIds.includes(task.libraryId),'请明确启用任务所属资料库');
  const context={libraryIds:[task.libraryId],scope:options.scope??'',asOf:options.asOf??'',includeDisputed:options.includeDisputed??false};
  string(context.scope,'适用范围',1000,false);string(context.asOf,'适用日期',10,false);isoDate(context.asOf);
  requireThat(typeof context.includeDisputed==='boolean','争议资料选项必须是布尔值');
  const result=taskSelection(state,task.id,payload.query,context),retrieved=result.retrieved,entryById=new Map(state.entries.map(entry=>[entry.id,entry]));
  // Local retrieval normally permits local-only records. An AI's request is
  // for outbound context: move these hits into metadata-only exclusions.
  // Keep mandatory core IDs, so later pack validation blocks a restricted
  // core instead of silently dropping a task requirement.
  retrieved.hits=retrieved.hits.filter(hit=>{
    const entry=entryById.get(hit.id),reason=exclusion(state,entry,context,{outbound:true});
    if(reason)retrieved.excluded.push({id:entry.id,reason});
    return !reason;
  });
  const pinnedIds=clone(result.pinnedIds),selectedIds=[...new Set([...pinnedIds,...retrieved.hits.slice(0,8).map(hit=>hit.id)])];
  return{taskId:task.id,baseVersion:task.version,packId:payload.packId,query:payload.query,retrieved,selectedIds,pinnedIds};
}
