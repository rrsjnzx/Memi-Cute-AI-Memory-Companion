import {FORMAT,VERSION,TABLES,LIMITS,clone,id,now,requireThat,hash,freshState,equal} from './base.js';
import {validateTemplate,validateFields} from './schema.js';
import {addSource,saveEntry,evidenceErrors,refreshConflicts,createLibrary,event} from './library.js';
import {validateRule} from './checks.js';
import {validateTaskHistory} from './tasks.js';
import {validateRounds} from './rounds.js';
import {validateExtractionQueues} from './extraction-queue.js';

export function exportBackup(state){return{format:FORMAT,version:VERSION,exportedAt:now(),tables:clone(state)};}
export async function preflightBackup(value,current){
  requireThat(JSON.stringify(value).length<=LIMITS.bytes,'备份超过 20 MB 上限');
  requireThat(value?.format===FORMAT&&[2,3,4,VERSION].includes(value.version),'不支持的备份格式或版本');
  const tables=clone(value.tables);
  if(value.version===2){
    requireThat(tables&&typeof tables==='object'&&!Array.isArray(tables),'备份表格式无效');
    requireThat((tables.tasks===undefined||Array.isArray(tables.tasks)&&tables.tasks.length===0)&&(tables.taskVersions===undefined||Array.isArray(tables.taskVersions)&&tables.taskVersions.length===0),'旧版备份不能携带持续任务数据');
    tables.tasks=[];tables.taskVersions=[];
  }
  if(value.version<4){
    requireThat(tables&&typeof tables==='object'&&!Array.isArray(tables),'备份表格式无效');
    requireThat(tables.rounds===undefined||Array.isArray(tables.rounds)&&tables.rounds.length===0,'旧版备份不能携带轮次数据');tables.rounds=[];
  }
  if(value.version<5){
    requireThat(tables&&typeof tables==='object'&&!Array.isArray(tables),'备份表格式无效');
    requireThat(tables.extractionQueues===undefined||Array.isArray(tables.extractionQueues)&&tables.extractionQueues.length===0,'旧版备份不能携带提炼队列数据');tables.extractionQueues=[];
  }
  for(const key of TABLES)requireThat(Array.isArray(tables?.[key]),`缺少 ${key} 表`);
  requireThat(tables.entries.length<=LIMITS.entries&&tables.sources.length<=LIMITS.sources&&tables.versions.length<=50000,'备份对象数量超限');
  for(const table of TABLES){
    const keys=tables[table].map(r=>table==='templates'?`${r.id}@${r.version}`:r.id);
    requireThat(keys.every(k=>typeof k==='string'&&k.length>0&&k.length<200)&&new Set(keys).size===keys.length,`${table} 存在无效或重复 ID`);
    const existing=new Set((current[table]||[]).map(r=>table==='templates'?`${r.id}@${r.version}`:r.id));
    requireThat(!keys.some(k=>existing.has(k)),`${table} 与现有 ID 冲突；请导入空库或使用文件交换导入新库`);
  }
  for(const template of tables.templates)validateTemplate(template);
  for(const source of tables.sources){requireThat(typeof source.text==='string'&&source.text.length<=LIMITS.bytes&&['normal','local_only'].includes(source.sensitivity),'来源格式无效');requireThat(await hash(source.text)===source.sha256,'来源哈希不匹配');requireThat(source.coordinates==='utf16','来源位置格式不是 UTF-16');}
  for(const [entry,isVersion] of [...tables.entries.map(e=>[e,false]),...tables.versions.map(e=>[e,true])]){
    requireThat(tables.libraries.some(l=>l.id===entry.libraryId),'条目关联的资料库缺失');
    requireThat(Number.isInteger(entry.version)&&entry.version>=1&&Array.isArray(entry.sourceRefs)&&typeof entry.content==='string'&&entry.content.length<=LIMITS.content,'条目形状无效');
    requireThat(['draft','pending','confirmed'].includes(entry.reviewStatus)&&['active','archived','superseded'].includes(entry.lifecycleStatus)&&['normal','local_only'].includes(entry.sensitivity),'条目状态无效');
    requireThat(typeof entry.title==='string'&&entry.title.length<=300&&typeof entry.scope==='string'&&typeof entry.updatedAt==='string'&&['fact','entity','rule','preference','event','note'].includes(entry.kind),'条目元数据无效');
    for(const field of ['aliases','tags'])requireThat(Array.isArray(entry[field])&&entry[field].length<=100&&entry[field].every(x=>typeof x==='string'),'检索字段无效');
    requireThat(typeof entry.enabledForContext==='boolean'&&typeof entry.singleValued==='boolean','布尔字段无效');
    const template=tables.templates.find(t=>t.id===entry.schemaId&&t.version===entry.schemaVersion);
    requireThat(validateFields(entry.fields,null).length===0,'业务字段对象无效');
    const currentEntry=isVersion?tables.entries.find(e=>e.id===entry.entryId):entry;
    if(isVersion)requireThat(currentEntry&&currentEntry.libraryId===entry.libraryId&&entry.version<=currentEntry.version&&entry.id===`${entry.entryId}@${entry.version}`,'历史版本链无效');
    // Older snapshots remain auditable after a referenced object is archived.
    // Current entries and their matching snapshots still require active targets.
    const historicalReferences=isVersion&&entry.version<currentEntry.version;
    if(entry.reviewStatus==='confirmed')requireThat(validateFields(entry.fields,template,tables.entries,entry.libraryId,{historicalReferences}).length===0,'已确认记录不符合模板');
    requireThat(evidenceErrors(tables,entry).length===0,'条目引用无效');
    requireThat(!entry.schemaId||tables.templates.some(t=>t.id===entry.schemaId&&t.version===entry.schemaVersion),'模板版本缺失');
  }
  // Conflict projections are recomputed after import. Every other persisted
  // value in a version must describe the same state as the current entry.
  const persisted=row=>Object.fromEntries(Object.entries(row).filter(([key])=>!['id','entryId','conflictState','conflictIds'].includes(key)));
  for(const entry of tables.entries){
    const version=tables.versions.find(v=>v.entryId===entry.id&&v.version===entry.version);
    requireThat(version,'缺少当前版本快照');
    requireThat(equal(persisted(entry),persisted(version)),'当前条目与同版本历史快照不一致');
  }
  validateTaskHistory(tables);
  validateRounds(tables);
  validateExtractionQueues(tables);
  // Historical rounds remain viewable after permissions change or the source
  // is removed. When the same source version is still in this backup, however,
  // it must corroborate the embedded original text. A recomputed round checksum
  // alone cannot detect a forged metadata object and matching forged pack body.
  // Keep this import check out of live round operations so an obsolete round
  // can still be abandoned and rebuilt after its source changes.
  for(const round of tables.rounds){
    const meta=round.packSnapshot.sourceExtraction;if(!meta)continue;
    const source=tables.sources.find(item=>item.id===meta.sourceId&&item.version===meta.sourceVersion);if(!source)continue;
    requireThat(source.sha256===meta.sourceSha256&&source.name===meta.name&&meta.end<=source.text.length&&source.text.slice(meta.start,meta.end)===meta.text,'提炼轮次的原文快照与备份中同版本来源不一致');
  }
  const localReference=(row,entryRequired=false)=>{
    requireThat(tables.libraries.some(l=>l.id===row.libraryId),'规则或预期项关联的资料库不在备份内');
    requireThat(typeof (row.entryId??'')==='string','规则或预期项条目 ID 无效');
    requireThat(!entryRequired&&!row.entryId||tables.entries.some(e=>e.id===row.entryId&&e.libraryId===row.libraryId),'规则或预期项条目必须属于备份内的同一资料库');
    requireThat(typeof row.confirmed==='boolean','规则或预期项确认状态必须是布尔值');
  };
  for(const rule of tables.rules){
    validateRule(rule);localReference(rule);
    requireThat(Number.isInteger(rule.version)&&rule.version>=1,'规则版本无效');
  }
  for(const watch of tables.watches){
    localReference(watch,true);
    requireThat(Array.isArray(watch.fields)&&watch.fields.length>0&&watch.fields.length<=LIMITS.fields&&watch.fields.every(f=>typeof f==='string'&&f.length>0),'预期字段列表无效');
  }
  for(const pack of tables.packs)pack.stale=true;
  return {tables,counts:Object.fromEntries(TABLES.map(t=>[t,tables[t].length])),localOnly:tables.entries.filter(e=>e.sensitivity==='local_only').length,
    digest:await hash(JSON.stringify(tables)),baseCounts:Object.fromEntries(TABLES.map(t=>[t,(current[t]||[]).length])),notice:'导入会保留条目、任务档案、轮次、提炼队列和历史；缓存资料包标为过期，轮次与队列继续时重新校验。恢复或刷新不会自动发送，需要在浮窗明确启动。'};
}
export function commitBackup(state,preview){
  for(const table of TABLES){const existing=new Set(state[table].map(r=>table==='templates'?`${r.id}@${r.version}`:r.id));requireThat(preview.tables[table].every(r=>!existing.has(table==='templates'?`${r.id}@${r.version}`:r.id)),'预检后发生 ID 冲突，原库保持不变');}
  for(const table of TABLES)state[table].push(...clone(preview.tables[table]));refreshConflicts(state);event(state,'backup_imported','backup');
  return preview.counts;
}
export async function prepareText(name,text,sensitivity='normal'){
  requireThat(typeof text==='string'&&text.trim()&&text.length<=LIMITS.bytes,'文本为空或超过 20 MB');
  const source={name,text,sha256:await hash(text),sensitivity};const chunks=[];let start=0;
  while(start<text.length){let end=Math.min(start+4000,text.length);if(end<text.length){const boundary=text.lastIndexOf('\n\n',end);if(boundary>start+2000)end=boundary+2;}
    const content=text.slice(start,end);if(content.trim())chunks.push({title:`${name} · ${chunks.length+1}`,content,start,end});start=end;}
  return{source,chunks,count:chunks.length,notice:'原文分段作为待审核条目导入，不自动抽取字段或确认事实。'};
}
export function importText(state,preview,libraryId){
  requireThat(state.entries.length+preview.chunks.length<=LIMITS.entries,'条目数超限');
  const source=addSource(state,preview.source);
  return preview.chunks.map(c=>saveEntry(state,{libraryId,title:c.title,content:c.content,fields:{},kind:'note',evidenceKind:'direct',sensitivity:source.sensitivity,
    sourceRefs:[{sourceId:source.id,sourceVersion:1,start:c.start,end:c.end,quote:c.content}]},{reason:'文本导入，待核对'}));
}
export function prepareRows(value,{title='title',content='content',fields='fields',aliases='aliases',tags='tags'}={}){
  requireThat(Array.isArray(value)&&value.length>0&&value.length<=1000,'映射导入需要 1—1000 条 JSON 对象');
  return value.map(row=>{requireThat(row&&typeof row==='object'&&!Array.isArray(row),'导入行不是对象');return{title:row[title],content:row[content]||'',fields:row[fields]||{},aliases:row[aliases]||[],tags:row[tags]||[]};});
}
export function importRows(state,rows,libraryId,schemaId='',schemaVersion=null,sensitivity='normal'){
  requireThat(state.entries.length+rows.length<=LIMITS.entries,'条目数超限');
  return rows.map(row=>saveEntry(state,{...row,libraryId,schemaId,schemaVersion,sensitivity,evidenceKind:'unknown'},{reason:'JSON 字段映射导入，待确认'}));
}
export async function preflightExchange(value){
  requireThat(value?.format==='text-memory-exchange'&&value.version===1,'不支持的文件交换版本');
  requireThat(Array.isArray(value.entries)&&value.entries.length<=LIMITS.entries&&Array.isArray(value.sources)&&value.sources.length<=LIMITS.sources,'交换对象数量无效');
  requireThat(JSON.stringify(value).length<=LIMITS.bytes,'交换文件过大');
  requireThat(new Set(value.sources.map(s=>s.id)).size===value.sources.length,'交换来源 ID 重复');
  for(const s of value.sources){requireThat(s.coordinates==='utf16'&&typeof s.text==='string','来源坐标格式无效');requireThat(await hash(s.text)===s.sha256,'来源哈希不匹配');}
  importExchange(freshState(),{value}); // Validate all mappings before touching IndexedDB.
  return{value:clone(value),count:value.entries.length,notice:'创建独立新库。来自 Python 的记忆仍需在扩展内核对确认；不自动同步。'};
}
export function importExchange(state,preview){
  const value=preview.value;const library=createLibrary(state,value.library.name);const map=new Map();
  for(const s of value.sources){const source=addSource(state,s);map.set(s.id,source.id);}
  const entries=value.entries.map(row=>saveEntry(state,{...row,id:undefined,libraryId:library.id,sourceRefs:row.sourceRefs.map(r=>({...r,sourceId:map.get(r.sourceId),sourceVersion:1}))},{reason:'Python 文件交换导入，待复核'}));
  return{library,entries};
}
