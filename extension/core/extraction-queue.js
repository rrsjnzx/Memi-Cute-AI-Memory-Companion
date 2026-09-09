import {clone,id,now,equal,requireThat,string,LIMITS} from './base.js';
import {event} from './library.js';
import {taskById} from './tasks.js';
import {buildPack,validatePack} from './pack.js';
import {activeRound,prepareRound,resumeRound,roundById,roundPackChecksum} from './rounds.js';
import {createSourceExtraction} from './source-extraction.js';
import {readingSourceSlice} from './source-browser.js';

export const EXTRACTION_QUEUE_LIMITS={count:200,slices:10,sliceLength:4000};
const openStatuses=new Set(['ready','paused']);
const keys=['id','taskId','libraryId','sourceId','sourceVersion','sourceSha256','sourceName','sourceLength','sourceChecksum','taskBaseVersion','taskDefinition','ranges','sliceLength','maxChars','status','currentIndex','activeRoundId','completedRoundIds','version','createdAt','updatedAt','cancelReason'];
const definition=task=>({goal:task.goal,constraints:task.constraints,coreEntryIds:clone(task.coreEntryIds)});
const shape=(value,fields,label)=>requireThat(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===fields.length&&fields.every(key=>Object.hasOwn(value,key)),`${label} 字段不完整或包含额外字段`);
const integer=(value,min,max,label)=>requireThat(Number.isSafeInteger(value)&&value>=min&&value<=max,`${label} 无效`);
function timestamp(value){requireThat(typeof value==='string'&&value.length<=40&&!Number.isNaN(Date.parse(value))&&new Date(value).toISOString()===value,'提炼队列时间无效');}
export function extractionQueueById(state,queueId){return state.extractionQueues?.find(queue=>queue.id===queueId)||null;}
export function activeExtractionQueue(state,taskId){return state.extractionQueues?.find(queue=>queue.taskId===taskId&&openStatuses.has(queue.status))||null;}

function matchesRound(queue,round,index){
  const meta=round?.packSnapshot?.sourceExtraction,range=queue.ranges[index];
  return !!(meta&&range&&round.taskId===queue.taskId&&round.libraryId===queue.libraryId&&meta.libraryId===queue.libraryId&&meta.sourceId===queue.sourceId&&meta.sourceVersion===queue.sourceVersion&&meta.sourceSha256===queue.sourceSha256&&meta.name===queue.sourceName&&meta.start===range.start&&meta.end===range.end&&round.packSnapshot.maxChars===queue.maxChars&&equal(definition(round.packSnapshot.memoryTask),queue.taskDefinition));
}
function validateShape(queue){
  shape(queue,keys,'提炼队列');
  for(const field of ['id','taskId','libraryId','sourceId'])string(queue[field],`提炼队列 ${field}`,199);
  string(queue.sourceName,'提炼来源名称',500);string(queue.cancelReason,'队列取消原因',1000,false);
  integer(queue.sourceVersion,1,Number.MAX_SAFE_INTEGER,'队列来源版本');integer(queue.sourceLength,1,LIMITS.bytes,'队列来源长度');
  requireThat(typeof queue.sourceSha256==='string'&&/^[a-f0-9]{64}$/.test(queue.sourceSha256)&&typeof queue.sourceChecksum==='string'&&/^[a-f0-9]{8}$/.test(queue.sourceChecksum),'队列来源哈希无效');
  integer(queue.taskBaseVersion,1,Number.MAX_SAFE_INTEGER,'队列任务基础版本');integer(queue.version,1,Number.MAX_SAFE_INTEGER,'队列版本');
  shape(queue.taskDefinition,['goal','constraints','coreEntryIds'],'队列任务基线');
  for(const field of ['goal','constraints'])string(queue.taskDefinition[field],`队列任务 ${field}`,12000,false);
  const cores=queue.taskDefinition.coreEntryIds;requireThat(Array.isArray(cores)&&cores.length<=100&&new Set(cores).size===cores.length,'队列核心选择无效');for(const core of cores)string(core,'队列核心 ID',199);
  integer(queue.sliceLength,1,6000,'队列片段长度');integer(queue.maxChars,128,LIMITS.packChars,'队列字符预算');
  requireThat(Array.isArray(queue.ranges)&&queue.ranges.length>=1&&queue.ranges.length<=EXTRACTION_QUEUE_LIMITS.slices,'队列片段数量无效');
  queue.ranges.forEach((range,index)=>{shape(range,['start','end'],'队列片段');integer(range.start,0,queue.sourceLength-1,'队列片段起点');integer(range.end,range.start+1,Math.min(range.start+queue.sliceLength+1,queue.sourceLength),'队列片段终点');requireThat(index===0||range.start===queue.ranges[index-1].end,'队列片段必须连续');});
  requireThat(['ready','paused','completed','cancelled'].includes(queue.status),'提炼队列状态无效');integer(queue.currentIndex,0,queue.ranges.length,'队列当前位置');
  requireThat(queue.activeRoundId===null||typeof queue.activeRoundId==='string'&&queue.activeRoundId.length>0&&queue.activeRoundId.length<200,'队列绑定轮次无效');
  requireThat(Array.isArray(queue.completedRoundIds)&&queue.completedRoundIds.length===queue.currentIndex&&new Set(queue.completedRoundIds).size===queue.completedRoundIds.length,'队列完成记录与位置不一致');for(const roundId of queue.completedRoundIds)string(roundId,'队列已完成轮次',199);
  requireThat(!queue.activeRoundId||!queue.completedRoundIds.includes(queue.activeRoundId),'队列重复使用已完成轮次');
  requireThat(queue.status==='completed'?queue.currentIndex===queue.ranges.length&&queue.activeRoundId===null:queue.status==='cancelled'||queue.currentIndex<queue.ranges.length,'队列状态与进度不一致');
  requireThat(queue.status!=='cancelled'||queue.activeRoundId===null,'已取消队列不能仍绑定可运行轮次');
  requireThat(queue.status==='cancelled'||queue.cancelReason==='','未取消队列不能携带取消原因');
  timestamp(queue.createdAt);timestamp(queue.updatedAt);requireThat(queue.createdAt<=queue.updatedAt,'队列时间顺序无效');
}

/** Historical validation does not authorize transmission. A changed task or a
 * newly restricted source remains exportable and will fail the live check. */
export function validateExtractionQueues(state){
  requireThat(Array.isArray(state.extractionQueues)&&state.extractionQueues.length<=EXTRACTION_QUEUE_LIMITS.count,'缺少 extractionQueues 表或队列数量超过 200');
  const open=new Set(),bindings=new Set();
  for(const queue of state.extractionQueues){
    validateShape(queue);const task=taskById(state,queue.taskId),base=state.taskVersions.find(item=>item.taskId===queue.taskId&&item.version===queue.taskBaseVersion);
    requireThat(task&&task.libraryId===queue.libraryId&&base&&equal(definition(base),queue.taskDefinition),'提炼队列任务基线或资料库不一致');
    if(openStatuses.has(queue.status)){requireThat(!open.has(queue.taskId),'同一任务存在多个未结束提炼队列');open.add(queue.taskId);}
    const source=state.sources.find(item=>item.id===queue.sourceId);
    requireThat(source||queue.status==='cancelled','提炼队列来源缺失，必须保留为已取消状态');
    if(source&&source.version===queue.sourceVersion){
      requireThat(source.sha256===queue.sourceSha256&&source.name===queue.sourceName&&source.text.length===queue.sourceLength&&roundPackChecksum(source.text)===queue.sourceChecksum,'提炼队列来源基线与同版本原文不一致');
      for(const range of queue.ranges){const slice=readingSourceSlice(source,{offset:range.start,length:queue.sliceLength});requireThat(slice.start===range.start&&slice.end===range.end,'提炼队列片段不符合原文 UTF-16 边界');}
    }
    queue.completedRoundIds.forEach((roundId,index)=>{const round=roundById(state,roundId);requireThat(!round&&queue.status==='cancelled'||round?.status==='completed'&&matchesRound(queue,round,index),'提炼队列完成轮次与片段不一致');});
    if(queue.activeRoundId){
      const round=roundById(state,queue.activeRoundId);requireThat(round&&matchesRound(queue,round,queue.currentIndex)&&['prepared','delivered','completed'].includes(round.status),'提炼队列绑定轮次与当前片段不一致');
      requireThat(!bindings.has(round.id),'多个提炼队列绑定同一轮次');bindings.add(round.id);
    }
  }
}

function live(state,queue){
  validateShape(queue);const task=taskById(state,queue.taskId);requireThat(task?.libraryId===queue.libraryId,'队列任务或资料库已不存在','queue_stale');
  requireThat(equal(definition(task),queue.taskDefinition),'任务目标、约束或重要记忆选择已改变，请取消旧队列后重新准备','queue_stale');
  const source=state.sources.find(item=>item.id===queue.sourceId);
  requireThat(source&&source.version===queue.sourceVersion&&source.sha256===queue.sourceSha256&&source.name===queue.sourceName&&source.text.length===queue.sourceLength&&roundPackChecksum(source.text)===queue.sourceChecksum,'提炼来源已改变或删除，请取消旧队列后重新准备','queue_stale');
  const range=queue.ranges[Math.min(queue.currentIndex,queue.ranges.length-1)],meta=createSourceExtraction(state,{libraryId:queue.libraryId,sourceId:queue.sourceId,start:range.start,length:queue.sliceLength});
  requireThat(meta.start===range.start&&meta.end===range.end,'提炼队列片段已改变','queue_stale');return{task,source,meta};
}
function expected(state,queueId,expectedVersion,{required=false}={}){
  const queue=extractionQueueById(state,queueId);requireThat(queue,'提炼队列不存在');
  if(required||expectedVersion!==undefined)requireThat(Number.isSafeInteger(expectedVersion)&&queue.version===expectedVersion,'提炼队列已改变，请重新载入','version_conflict');return queue;
}
function change(state,previous,patch,type){const queue={...clone(previous),...patch,version:previous.version+1,updatedAt:now()};validateShape(queue);state.extractionQueues[state.extractionQueues.indexOf(previous)]=queue;event(state,type,queue.id);return queue;}

export function createExtractionQueue(state,{taskId,sourceId,start=0,sliceCount=3,sliceLength=4000,maxChars=12000}={}){
  const task=taskById(state,taskId);requireThat(task,'请先保存持续任务');requireThat(!activeExtractionQueue(state,taskId),'该任务已有未结束提炼队列，请继续、暂停或取消原队列','active_queue_exists');
  requireThat((state.extractionQueues?.length||0)<EXTRACTION_QUEUE_LIMITS.count,'提炼队列达到 200 条上限，请先导出备份并整理');
  integer(sliceCount,1,EXTRACTION_QUEUE_LIMITS.slices,'提炼片数（1—10）');integer(sliceLength,1,6000,'提炼片段长度');integer(maxChars,128,LIMITS.packChars,'队列字符预算');
  const first=createSourceExtraction(state,{libraryId:task.libraryId,sourceId,start,length:sliceLength}),source=state.sources.find(item=>item.id===sourceId),ranges=[{start:first.start,end:first.end}];
  while(ranges.length<sliceCount&&ranges.at(-1).end<source.text.length){const meta=createSourceExtraction(state,{libraryId:task.libraryId,sourceId,start:ranges.at(-1).end,length:sliceLength});ranges.push({start:meta.start,end:meta.end});}
  const at=now(),queue={id:id('extraction_queue'),taskId,libraryId:task.libraryId,sourceId,sourceVersion:source.version,sourceSha256:source.sha256,sourceName:source.name,sourceLength:source.text.length,sourceChecksum:roundPackChecksum(source.text),taskBaseVersion:task.version,taskDefinition:definition(task),ranges,sliceLength,maxChars,status:'ready',currentIndex:0,activeRoundId:null,completedRoundIds:[],version:1,createdAt:at,updatedAt:at,cancelReason:''};
  const existing=activeRound(state,taskId);
  if(existing){requireThat(existing.status==='prepared'&&existing.baseVersion===task.version&&matchesRound(queue,existing,0),'该任务已有不匹配或已交付轮次，请先处理该轮；队列仅能接续相同的待发送提炼片段','active_round_exists');resumeRound(state,existing.id);queue.activeRoundId=existing.id;}
  validateShape(queue);state.extractionQueues??=[];state.extractionQueues.push(queue);event(state,'extraction_queue_created',queue.id);return queue;
}

export function prepareQueuedSlice(state,queueId,{expectedVersion}={}){
  const queue=expected(state,queueId,expectedVersion,{required:true});requireThat(queue.status==='ready','提炼队列尚未恢复或已经结束','queue_not_ready');const {task,meta}=live(state,queue);
  if(queue.activeRoundId){const existing=roundById(state,queue.activeRoundId);requireThat(existing?.status==='prepared'&&matchesRound(queue,existing,queue.currentIndex),'当前片段已交付或轮次已改变，请先处理回执','queue_round_pending');const {round,pack}=resumeRound(state,existing.id);return{queue,pack,round};}
  requireThat(!activeRound(state,queue.taskId),'该任务已有其他未结束轮次，请先处理','active_round_exists');
  const pack=buildPack(state,{task:`提炼当前文档第 ${meta.start+1}—${meta.end} 字符，围绕已保存的任务目标，列出有出处的候选记忆并自查疑点。`,libraryIds:[queue.libraryId],memoryTaskId:task.id,maxChars:queue.maxChars,sourceExtraction:meta});
  const errors=validatePack(state,pack,{...pack.options,binding:null,memoryTaskId:task.id});requireThat(!errors.length,errors.join('；'),'queue_pack_blocked');
  const round=prepareRound(state,pack),next=change(state,queue,{activeRoundId:round.id},'extraction_queue_slice_prepared');return{queue:next,pack,round};
}

/** Call immediately after applyMemoryUpdate and completeRound in the same
 * repository transaction. Completion means receipt handling, not truth. */
export function completeQueuedSlice(state,queueId,roundId){
  const queue=expected(state,queueId);requireThat(openStatuses.has(queue.status),'提炼队列已经结束','queue_closed');live(state,queue);
  const round=roundById(state,roundId);requireThat(queue.activeRoundId===roundId&&round?.status==='completed'&&matchesRound(queue,round,queue.currentIndex),'只能推进当前片段已经处理完成的绑定轮次','queue_round_mismatch');
  const currentIndex=queue.currentIndex+1;return change(state,queue,{currentIndex,activeRoundId:null,completedRoundIds:[...queue.completedRoundIds,roundId],status:currentIndex===queue.ranges.length?'completed':queue.status},'extraction_queue_slice_completed');
}
export function pauseExtractionQueue(state,queueId,{expectedVersion}={}){const queue=expected(state,queueId,expectedVersion);requireThat(openStatuses.has(queue.status),'提炼队列已经结束','queue_closed');if(queue.status==='paused')return queue;return change(state,queue,{status:'paused'},'extraction_queue_paused');}
export function resumeExtractionQueue(state,queueId,{expectedVersion}={}){const queue=expected(state,queueId,expectedVersion);requireThat(openStatuses.has(queue.status),'提炼队列已经结束，不能恢复','queue_closed');live(state,queue);if(queue.status==='ready')return queue;return change(state,queue,{status:'ready'},'extraction_queue_resumed');}
export function cancelExtractionQueue(state,queueId,{expectedVersion}={}){const queue=expected(state,queueId,expectedVersion);requireThat(openStatuses.has(queue.status),'提炼队列已经结束','queue_closed');return change(state,queue,{status:'cancelled',activeRoundId:null,cancelReason:'用户取消队列；已保存资料和已有轮次保留'},'extraction_queue_cancelled');}
