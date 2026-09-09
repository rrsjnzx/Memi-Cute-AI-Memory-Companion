import {clone,id,now,norm,equal,overlap,within,requireThat,string,isoDate,LIMITS} from './base.js';
import {validateTemplate,validateFields,checkUpdate} from './schema.js';

export function event(state,type,objectId,result='ok') {
  state.events.push({id:id('event'),type,objectId,result,at:now()});
  if(state.events.length>2000)state.events.splice(0,state.events.length-2000);
}
export function createLibrary(state,name) {
  string(name,'资料库名称',200);
  const library={id:id('lib'),name:name.trim(),createdAt:now()};state.libraries.push(library);event(state,'library_created',library.id);return library;
}
export function templateFor(state,entry) { return state.templates.find(t=>t.id===entry.schemaId&&t.version===entry.schemaVersion); }
export function saveTemplate(state,draft,{expectedVersion=null}={}) {
  validateTemplate(draft);
  const siblings=state.templates.filter(t=>t.id===(draft.id||''));
  const previous=siblings.sort((a,b)=>b.version-a.version)[0];
  requireThat(!previous||previous.version===expectedVersion,'模板已被其他面板修改，请重新载入','version_conflict');
  const value={id:previous?.id||id('schema'),version:(previous?.version||0)+1,name:draft.name,fields:clone(draft.fields),createdAt:now()};
  // Versioned templates leave existing records pinned to their reviewed schema.
  state.templates.push(value);event(state,'template_saved',value.id);return value;
}
export function migrationPreview(state,entryIds,template) {
  validateTemplate(template);
  return entryIds.map(entryId=>{const entry=state.entries.find(e=>e.id===entryId);requireThat(entry,'条目不存在');return {entryId,version:entry.version,errors:validateFields(entry.fields,template,state.entries,entry.libraryId)};});
}
export function migrateEntries(state,preview,templateId,templateVersion) {
  const template=state.templates.find(t=>t.id===templateId&&t.version===templateVersion);requireThat(template,'目标模板不存在');
  for(const item of preview){const entry=state.entries.find(e=>e.id===item.entryId);requireThat(entry?.version===item.version,'迁移预览已过期','version_conflict');requireThat(validateFields(entry.fields,template,state.entries,entry.libraryId).length===0,'迁移字段校验失败');}
  return preview.map(item=>{const entry=state.entries.find(e=>e.id===item.entryId);return saveEntry(state,{...entry,schemaId:template.id,schemaVersion:template.version},{expectedVersion:item.version,confirm:false,reason:'模板迁移，需要重新确认'});});
}
export function addSource(state,{name,text,sha256,sensitivity='normal',url='',kind='text'}) {
  string(name,'来源名称',500);string(text,'来源正文',LIMITS.bytes);string(sha256,'内容哈希',64);
  requireThat(/^[a-f0-9]{64}$/.test(sha256),'来源哈希格式无效');requireThat(['normal','local_only'].includes(sensitivity),'分类无效');
  requireThat(state.sources.length<LIMITS.sources,'来源数量达到上限');
  const source={id:id('src'),name,text,sha256,sensitivity,url,kind,version:1,coordinates:'utf16',createdAt:now()};state.sources.push(source);return source;
}
export function evidenceErrors(state,entry) {
  const errors=[];
  if(entry.evidenceKind==='direct'&&!entry.sourceRefs.length)errors.push({field:'sourceRefs',message:'直接证据需要原文引用'});
  for(const ref of entry.sourceRefs){
    const source=state.sources.find(s=>s.id===ref.sourceId&&s.version===ref.sourceVersion);
    if(!source){errors.push({field:ref.field||'sourceRefs',message:'来源版本不存在'});continue;}
    if(!Number.isInteger(ref.start)||!Number.isInteger(ref.end)||ref.start<0||ref.end<=ref.start||ref.end>source.text.length||typeof ref.quote!=='string'||source.text.slice(ref.start,ref.end)!==ref.quote)
      errors.push({field:ref.field||'sourceRefs',message:'引用不能在来源中精确定位（UTF-16）'});
  }return errors;
}
export function effectiveSensitivity(state,entry) {
  return entry.sensitivity==='local_only'||entry.sourceRefs.some(r=>state.sources.find(s=>s.id===r.sourceId)?.sensitivity==='local_only')?'local_only':'normal';
}
export function entryErrors(state,entry) {
  return [...validateFields(entry.fields,templateFor(state,entry),state.entries,entry.libraryId),...evidenceErrors(state,entry)];
}
export function saveEntry(state,draft,{expectedVersion=null,confirm=false,reason='编辑',transitionConfirmed=false}={}) {
  requireThat(state.libraries.some(l=>l.id===draft.libraryId),'资料库不存在');
  const previous=draft.id?state.entries.find(e=>e.id===draft.id):null;
  requireThat(!draft.id||previous,'条目不存在');
  requireThat(!previous||previous.libraryId===draft.libraryId,'不能通过编辑移动资料库');
  requireThat(!previous||previous.version===expectedVersion,'条目已被其他面板修改，请比较最新版本','version_conflict');
  requireThat(previous||state.entries.length<LIMITS.entries,'条目数量达到上限');
  for(const [k,max] of [['title',300],['content',LIMITS.content]])string(draft[k]??'',k,max,k==='title');
  for(const key of ['entityId','predicate','scope'])string(draft[key]??'',key,1000,false);
  requireThat(draft.fields&&typeof draft.fields==='object'&&!Array.isArray(draft.fields)&&JSON.stringify(draft.fields).length<LIMITS.content,'业务字段必须是有界的 JSON 对象');
  requireThat(validateFields(draft.fields,null).length===0,'字段过多或使用保留键');
  requireThat(['fact','entity','rule','preference','event','note'].includes(draft.kind||'fact'),'条目类型无效');
  requireThat(['normal','local_only'].includes(draft.sensitivity||'normal'),'分类无效');
  requireThat(['direct','inferred','user_asserted','unknown'].includes(draft.evidenceKind||'unknown'),'证据类型无效');
  for(const key of ['aliases','tags'])requireThat(Array.isArray(draft[key]||[])&&(draft[key]||[]).length<=100&&(draft[key]||[]).every(v=>typeof v==='string'&&v.length<=200),'别名和标签须为文本数组');
  const value={id:previous?.id||id('entry'),libraryId:draft.libraryId,kind:draft.kind||'fact',title:draft.title,content:draft.content||'',fields:clone(draft.fields),
    schemaId:draft.schemaId||'',schemaVersion:draft.schemaVersion||null,entityId:draft.entityId||'',predicate:draft.predicate||'',singleValued:!!draft.singleValued,
    aliases:clone(draft.aliases||[]),tags:clone(draft.tags||[]),sourceRefs:clone(draft.sourceRefs||[]),scope:draft.scope||'',
    effectiveFrom:isoDate(draft.effectiveFrom),effectiveTo:isoDate(draft.effectiveTo),sensitivity:draft.sensitivity||'normal',evidenceKind:draft.evidenceKind||'unknown',
    enabledForContext:draft.enabledForContext!==false,reviewStatus:confirm?'confirmed':'pending',lifecycleStatus:previous?.lifecycleStatus||'active',
    conflictState:'none',version:(previous?.version||0)+1,previousVersionId:previous?`${previous.id}@${previous.version}`:null,
    createdAt:previous?.createdAt||now(),updatedAt:now(),changeReason:string(reason,'变更原因',1000)};
  requireThat(!value.effectiveFrom||!value.effectiveTo||value.effectiveFrom<value.effectiveTo,'有效时间应使用左闭右开区间');
  requireThat(!value.schemaId||templateFor(state,value),'模板版本不存在');
  requireThat(Array.isArray(value.sourceRefs)&&value.sourceRefs.length<=100,'引用数量超限');
  requireThat(evidenceErrors(state,value).length===0,evidenceErrors(state,value).map(x=>x.message).join('；'));
  if(effectiveSensitivity(state,value)==='local_only')value.sensitivity='local_only';
  if(previous){const issues=checkUpdate(previous,value,templateFor(state,previous),state.rules,{confirmed:transitionConfirmed});requireThat(!issues.length,issues.map(x=>x.message).join('；'),'update_rejected');}
  if(confirm)requireThat(entryErrors(state,value).length===0,entryErrors(state,value).map(e=>`${e.field}: ${e.message}`).join('；'),'field_validation');
  if(previous)state.entries[state.entries.indexOf(previous)]=value;else state.entries.push(value);
  state.versions.push({...clone(value),id:`${value.id}@${value.version}`,entryId:value.id});
  refreshConflicts(state);invalidatePacks(state,[value.id]);event(state,previous?'entry_updated':'entry_created',value.id);return value;
}
export function refreshConflicts(state) {
  for(const entry of state.entries){entry.conflictState='none';entry.conflictIds=[];}
  const groups=new Map();
  for(const e of state.entries.filter(e=>e.lifecycleStatus==='active'&&e.entityId&&e.predicate&&e.singleValued)) {
    const key=JSON.stringify([e.libraryId,e.entityId,norm(e.predicate),norm(e.scope)]);const group=groups.get(key)||[];group.push(e);groups.set(key,group);
  }
  for(const group of groups.values())for(let i=0;i<group.length;i++)for(let j=i+1;j<group.length;j++) {
    const a=group[i],b=group[j];
    if(overlap(a,b)&&!equal(a.fields.value,b.fields.value)){a.conflictState=b.conflictState='unresolved';a.conflictIds.push(b.id);b.conflictIds.push(a.id);}
  }
}
export function conflictIdsAt(state,entry,asOf='') {
  // The management view records every overlapping interval. A dated query
  // needs only peers that are also effective at that particular instant.
  if(asOf&&!within(entry,asOf))return [];
  return (entry.conflictIds||[]).filter(otherId=>{
    const other=state.entries.find(e=>e.id===otherId);
    // A broken projection must remain blocked until it is recomputed.
    return !other||other.lifecycleStatus==='active'&&(!asOf||within(other,asOf));
  });
}
export function invalidatePacks(state,entryIds) {
  for(const pack of state.packs)if(pack.included.some(x=>entryIds.includes(x.id)))pack.stale=true;
}
export function setLifecycle(state,entryId,status,expectedVersion,reason) {
  requireThat(['active','archived','superseded'].includes(status),'生命周期无效');
  const e=state.entries.find(e=>e.id===entryId);requireThat(e&&e.version===expectedVersion,'生命周期操作版本已过期','version_conflict');
  e.lifecycleStatus=status;e.version++;e.updatedAt=now();e.changeReason=string(reason,'原因');
  e.previousVersionId=`${e.id}@${e.version-1}`;
  state.versions.push({...clone(e),id:`${e.id}@${e.version}`,entryId:e.id});refreshConflicts(state);invalidatePacks(state,[e.id]);event(state,'lifecycle_changed',e.id);return e;
}
export function resolveConflict(state,winnerId,loserId,versions,reason) {
  const a=state.entries.find(e=>e.id===winnerId),b=state.entries.find(e=>e.id===loserId);
  requireThat(a&&b&&a.conflictIds.includes(b.id),'两个条目不属于当前冲突');
  requireThat(a.version===versions[0]&&b.version===versions[1],'冲突预览已过期','version_conflict');
  requireThat(a.reviewStatus==='confirmed','请先核对并确认采用的条目');
  setLifecycle(state,b.id,'superseded',b.version,reason);a.replacesEntryId=b.id;a.resolutionReason=reason;
  a.version++;a.updatedAt=now();a.previousVersionId=`${a.id}@${a.version-1}`;
  state.versions.push({...clone(a),id:`${a.id}@${a.version}`,entryId:a.id});refreshConflicts(state);invalidatePacks(state,[a.id,b.id]);event(state,'conflict_resolved',a.id);return a;
}
export function deletionPreview(state,entryId) {
  const entry=state.entries.find(e=>e.id===entryId);requireThat(entry,'条目不存在');
  const sourceIds=[...new Set(state.versions.filter(v=>v.entryId===entryId).flatMap(v=>v.sourceRefs.map(r=>r.sourceId)))];
  return {entryId,version:entry.version,versions:state.versions.filter(v=>v.entryId===entryId).length,
    taskIds:(state.tasks||[]).filter(task=>task.coreEntryIds.includes(entryId)).map(task=>task.id),
    packIds:state.packs.filter(p=>p.included.some(x=>x.id===entryId)).map(p=>p.id),
    roundIds:(state.rounds||[]).filter(round=>round.packSnapshot?.included?.some(item=>item.id===entryId)).map(round=>round.id),
    extractionQueueIds:(state.extractionQueues||[]).filter(queue=>queue.status!=='cancelled'&&(queue.taskDefinition.coreEntryIds.includes(entryId)||sourceIds.includes(queue.sourceId))).map(queue=>queue.id),
    runIds:state.runs.filter(r=>r.entryIds?.includes(entryId)||r.packId&&state.packs.some(p=>p.id===r.packId&&p.included.some(x=>x.id===entryId))).map(r=>r.id),
    sources:sourceIds.map(sourceId=>({sourceId,name:state.sources.find(s=>s.id===sourceId)?.name||'',shared:state.versions.some(v=>v.entryId!==entryId&&v.sourceRefs.some(r=>r.sourceId===sourceId)),
      extractionPackIds:state.packs.filter(pack=>pack.sourceExtraction?.sourceId===sourceId).map(pack=>pack.id),
      extractionRoundIds:(state.rounds||[]).filter(round=>round.packSnapshot?.sourceExtraction?.sourceId===sourceId).map(round=>round.id),
      extractionQueueIds:(state.extractionQueues||[]).filter(queue=>queue.status!=='cancelled'&&queue.sourceId===sourceId).map(queue=>queue.id)})),
    note:'将清理条目及可定位的版本、包、轮次快照和检查副本。若同时删除专属来源，还会清理该来源的提炼资料包与轮次快照。失去来源、核心或轮次的提炼队列会停止并保留为不可恢复的取消记录。持续任务若固定了此条目，删除后会阻止该任务输出；请在任务中明确调整核心选择。来源快照是独立对象；外部备份和已发送内容不能撤回。'};
}
export function deleteEntry(state,preview,deleteSourceIds=[]) {
  const current=deletionPreview(state,preview.entryId);requireThat(equal(current,preview),'删除依赖已变，请重新预检','version_conflict');
  for(const sourceId of deleteSourceIds)requireThat(current.sources.some(s=>s.sourceId===sourceId&&!s.shared),'共享来源不能随单条记录删除');
  const deletingSources=current.sources.filter(source=>deleteSourceIds.includes(source.sourceId)),packIds=new Set([...current.packIds,...deletingSources.flatMap(source=>source.extractionPackIds)]),roundIds=new Set([...current.roundIds,...deletingSources.flatMap(source=>source.extractionRoundIds)]);
  state.entries=state.entries.filter(e=>e.id!==preview.entryId);
  state.versions=state.versions.filter(e=>e.entryId!==preview.entryId);
  state.packs=state.packs.filter(p=>!packIds.has(p.id));
  if(state.rounds)state.rounds=state.rounds.filter(round=>!roundIds.has(round.id));
  state.runs=state.runs.filter(r=>!current.runIds.includes(r.id)&&!packIds.has(r.packId));
  state.sources=state.sources.filter(s=>!deleteSourceIds.includes(s.id));
  // Keep audit metadata without leaving an orphan queue that can send. A
  // shared source remains usable by other libraries when their current entry
  // still owns it; deleting a bound round or core always cancels that queue.
  for(const queue of state.extractionQueues||[]){
    if(queue.status==='cancelled')continue;
    const ownsSource=state.entries.some(entry=>entry.libraryId===queue.libraryId&&entry.sourceRefs.some(ref=>ref.sourceId===queue.sourceId&&ref.sourceVersion===queue.sourceVersion));
    if(deleteSourceIds.includes(queue.sourceId)||!ownsSource||queue.taskDefinition.coreEntryIds.includes(preview.entryId)||roundIds.has(queue.activeRoundId)||queue.completedRoundIds.some(roundId=>roundIds.has(roundId))){
      queue.status='cancelled';queue.activeRoundId=null;queue.cancelReason='关联来源、核心条目或轮次已删除；保留历史记录，不能恢复发送';queue.version++;queue.updatedAt=now();event(state,'extraction_queue_dependency_deleted',queue.id);
    }
  }
  state.rules=state.rules.filter(r=>r.entryId!==preview.entryId);
  state.watches=state.watches.filter(w=>w.entryId!==preview.entryId);
  state.events=state.events.filter(e=>e.objectId!==preview.entryId);event(state,'entry_deleted',preview.entryId);
  refreshConflicts(state);return current;
}
