import {clone,equal,requireThat,string,LIMITS} from './base.js';
import {saveEntry,event} from './library.js';
import {taskById,saveTask,TASK_LIMITS} from './tasks.js';
import {parseMemoryProtocol,strictObjectKeys} from './protocol.js';
import {validatePack} from './pack.js';
import {planCandidateFacts} from './candidate-dedup.js';
import {planCandidateEvidence} from './candidate-evidence.js';

const prepared=new WeakMap();

function validateUpdatePack(state,task,packId){
  const rounds=(state.rounds||[]).filter(round=>round.taskId===task.id),active=rounds.find(round=>['prepared','delivered'].includes(round.status));
  if(active){
    requireThat(packId&&active.packSnapshot.id===packId,'记忆更新不属于当前轮次资料包，请使用本轮最新资料包的回复','version_conflict');
    requireThat(active.status==='delivered','请先成功复制或加入草稿，再确认该轮更新','round_not_delivered');
  }
  if(!packId)return {gateway:null,pack:null}; // Legacy manual v0.3.0 updates without an active round.
  requireThat(!rounds.some(round=>round.packSnapshot.id===packId&&['completed','abandoned'].includes(round.status)),'该资料包的轮次已结束，不能继续确认旧回复','round_closed');
  const pack=active?active.packSnapshot:state.packs.find(item=>item.id===packId);
  requireThat(pack,'记忆更新关联的资料包不存在，请重新生成','version_conflict');
  if(pack.taskProtocolVersion===3)requireThat(active?.status==='delivered','原文提炼回执必须对应当前已交付轮次，请先交付本轮资料','round_not_delivered');
  requireThat(equal(pack.memoryTask,task),'记忆更新资料包的任务版本或配置已改变，请重新生成','version_conflict');
  const errors=validatePack(state,pack,{...pack.options,binding:pack.binding,memoryTaskId:task.id});
  requireThat(!errors.length,'记忆更新关联的资料包已失效：'+errors.join('；'),'version_conflict');
  return {gateway:active?{roundId:active.id,roundVersion:active.version}:null,pack};
}

function payloadFrom(text){
  const payload=parseMemoryProtocol(text,'TEXT-MEMORY-UPDATE','记忆候选');
  strictObjectKeys(payload,['taskId','baseVersion','packId','progress','openQuestions','facts'],'记忆候选',{optional:['packId']});
  string(payload.taskId,'任务 ID',200);requireThat(Number.isSafeInteger(payload.baseVersion)&&payload.baseVersion>=1,'任务基础版本必须是正整数');
  if(Object.hasOwn(payload,'packId'))string(payload.packId,'资料包 ID',199);
  string(payload.progress,'当前进度',TASK_LIMITS.text,false);string(payload.openQuestions,'未解决事项',TASK_LIMITS.text,false);
  requireThat(Array.isArray(payload.facts)&&payload.facts.length<=20,'新增候选最多 20 条');
  return payload;
}
function validateFacts(facts,extraction){
  for(const fact of facts){
    strictObjectKeys(fact,extraction?['title','content','aliases','assessment','evidence']:['title','content','aliases'],'新增候选',extraction?{optional:['evidence']}:{});
    string(fact.title,'候选标题',300);string(fact.content,'候选正文',10000);
    requireThat(Array.isArray(fact.aliases)&&fact.aliases.length<=20,'候选别名最多 20 个');
    fact.aliases.forEach(alias=>string(alias,'候选别名',200));
    if(extraction){
      requireThat(['supported','uncertain','conflict'].includes(fact.assessment),'提炼自评必须是 supported、uncertain 或 conflict');
      if(Object.hasOwn(fact,'evidence')){
        requireThat(Array.isArray(fact.evidence)&&fact.evidence.length<=3,'每条候选最多 3 处原文引用');
        for(const evidence of fact.evidence){
          strictObjectKeys(evidence,['sourceId','version','quote'],'候选引用');
          string(evidence.sourceId,'引用来源 ID',200);requireThat(Number.isSafeInteger(evidence.version)&&evidence.version>=1,'引用来源版本必须是正整数');
          string(evidence.quote,'原文引用',4000,false);
        }
      }
    }
  }
}
function evidenceDependency(state,pack){return pack?.sourceExtraction?clone(state.sources.find(source=>source.id===pack.sourceExtraction.sourceId)||null):null;}

export function prepareMemoryUpdate(state,taskId,text){
  const task=taskById(state,taskId);requireThat(task,'任务不存在');
  const payload=payloadFrom(text);
  requireThat(payload.taskId===task.id,'候选属于另一任务，请勿混用','version_conflict');
  requireThat(payload.baseVersion===task.version,'候选基于旧任务版本，请重新生成','version_conflict');
  const {gateway,pack}=validateUpdatePack(state,task,payload.packId??null),extraction=pack?.taskProtocolVersion===3;
  validateFacts(payload.facts,extraction);
  const evidenceReview=extraction?planCandidateEvidence(state,task,pack,payload.facts):null;
  const deduplication=planCandidateFacts(state,task.libraryId,payload.facts,{evidenceReview});
  requireThat(state.entries.length+deduplication.newFacts<=LIMITS.entries,'新增候选会超过条目数量上限');
  const preview={kind:'memory_update_preview',taskId:task.id,baseVersion:task.version,packId:payload.packId??null,libraryId:task.libraryId,
    progress:payload.progress,openQuestions:payload.openQuestions,facts:clone(payload.facts),deduplication,
    ...(extraction?{extraction:true,evidenceReview}:{}),
    notice:'确认后只更新当前进度与未解决事项；精确重复候选不重复入库，其余事实保存为待审核的模型推断，不自动修改角色核心、目标或约束。'+(extraction?' 原文引用仅核对连续摘录与位置，不判断它是否支持陈述；被排除的候选不写入。':'')};
  prepared.set(preview,{value:clone(preview),task:clone(task),gateway,evidenceDependency:evidenceDependency(state,pack)});return preview;
}

export function applyMemoryUpdate(state,preview,{automatic=false}={}){
  requireThat(typeof automatic==='boolean','记忆更新模式无效');
  const original=prepared.get(preview);
  requireThat(original&&equal(original.value,preview),'候选预览已改变或无法确认，请重新预览','version_conflict');
  const current=taskById(state,preview.taskId);
  requireThat(current&&equal(current,original.task),'任务在预览后已改变，请重新生成候选','version_conflict');
  const {gateway,pack}=validateUpdatePack(state,current,preview.packId);
  requireThat(equal(gateway,original.gateway),'轮次在预览后已改变，请重新预览','version_conflict');
  const evidenceReview=preview.extraction?planCandidateEvidence(state,current,pack,preview.facts):null;
  requireThat(equal(evidenceDependency(state,pack),original.evidenceDependency)&&equal(evidenceReview,preview.evidenceReview??null),'引用依据或限制在预览后已改变，请重新预览','version_conflict');
  requireThat(!automatic||!evidenceReview?.attentionCount,'提炼候选有引用异常或不确定/冲突自评，请手动核对后确认','evidence_review_required');
  const deduplication=planCandidateFacts(state,current.libraryId,preview.facts,{evidenceReview});
  requireThat(state.entries.length+deduplication.newFacts<=LIMITS.entries,'新增候选会超过条目数量上限');
  // Stage the entire operation even for direct in-memory callers. Repository
  // additionally commits these table changes in one IndexedDB transaction.
  const staged=clone(state);
  const task=saveTask(staged,{...current,progress:preview.progress,openQuestions:preview.openQuestions},{expectedVersion:preview.baseVersion,forceRevision:true});
  const entries=deduplication.newFactIndexes.map(factIndex=>{const fact=preview.facts[factIndex],check=evidenceReview?.factChecks[factIndex];return saveEntry(staged,{libraryId:current.libraryId,kind:'fact',title:fact.title,content:fact.content,
    fields:{},aliases:clone(fact.aliases),tags:['模型候选',...(check?['原文提炼',`提炼自评：${check.assessment}`]:[])],sourceRefs:clone(check?.sourceRefs||[]),evidenceKind:'inferred',sensitivity:'normal'},
    {confirm:false,reason:automatic?'自动流程保存的模型记忆候选；尚未核验为事实':'用户确认保存的模型记忆候选；尚未核验为事实'});});
  const createdIds=new Map(deduplication.newFactIndexes.map((factIndex,index)=>[factIndex,entries[index].id]));
  deduplication.duplicates=deduplication.duplicates.map(duplicate=>({...duplicate,entryId:duplicate.entryId??createdIds.get(duplicate.duplicateOfFactIndex)}));
  const duplicateEntryIds=[...new Set(deduplication.duplicates.map(duplicate=>duplicate.entryId))];
  event(staged,'memory_update_applied',current.id);
  for(const key of Object.keys(staged))state[key]=staged[key];
  const exclusions=evidenceReview?.factChecks.filter(check=>check.status==='excluded').map(check=>({...clone(check),title:preview.facts[check.factIndex].title}))||[];
  return{task,entries,deduplicated:deduplication.deduplicated,duplicateEntryIds,deduplication,excludedCount:exclusions.length,exclusions};
}
