import {clone,equal,requireThat,string} from './base.js';
import {saveEntry,setLifecycle} from './library.js';

const prepared=new WeakMap();
export const ENTRY_BATCH_LIMIT=100;

function selectedEntries(state,libraryId,entryIds){
  string(libraryId,'资料库 ID',199);
  requireThat(state.libraries.some(library=>library.id===libraryId),'资料库不存在');
  requireThat(Array.isArray(entryIds)&&entryIds.length>0&&entryIds.length<=ENTRY_BATCH_LIMIT&&new Set(entryIds).size===entryIds.length,
    `请明确选择同一资料库的 1—${ENTRY_BATCH_LIMIT} 条不同条目`);
  const byId=new Map(state.entries.map(entry=>[entry.id,entry]));
  return entryIds.map(entryId=>{
    string(entryId,'条目 ID',199);const entry=byId.get(entryId);
    requireThat(entry,'选中条目不存在，请重新选择','version_conflict');
    requireThat(entry.libraryId===libraryId,'批量操作只能包含同一资料库的条目');
    requireThat(['pending','confirmed'].includes(entry.reviewStatus),'条目审核状态无效，请先修复资料');
    requireThat(Array.isArray(entry.tags)&&entry.tags.every(tag=>typeof tag==='string'),'条目标签无效，请先修复资料');
    return entry;
  });
}

function affectedTasks(state,entryIds){
  const ids=new Set(entryIds);
  return (state.tasks||[]).filter(task=>task.coreEntryIds.some(entryId=>ids.has(entryId)))
    .map(task=>({id:task.id,name:task.name,coreEntryIds:task.coreEntryIds.filter(entryId=>ids.has(entryId)).sort()}))
    .sort((a,b)=>a.id.localeCompare(b.id));
}
function alreadyApplied(entry,operation,tag){return operation==='archive'?entry.lifecycleStatus==='archived':entry.tags.includes(tag);}

/** Preview only. Selection must be explicit; there is no implicit whole-library operation. */
export function prepareEntryBatch(state,{libraryId,entryIds,operation,tag}={}){
  requireThat(['add_tag','archive'].includes(operation),'批量操作只支持添加标签或归档');
  if(operation==='add_tag')tag=string(tag,'新增标签',200).trim();
  else {requireThat(tag===undefined||tag===null||tag==='','归档操作不能同时修改标签');tag=null;}
  const entries=selectedEntries(state,libraryId,entryIds),tasks=affectedTasks(state,entryIds);
  const preview={libraryId,operation,tag,entries:entries.map(entry=>({id:entry.id,title:entry.title,version:entry.version})),
    count:entries.length,affectedTaskNames:tasks.map(task=>task.name),alreadyAppliedCount:entries.filter(entry=>alreadyApplied(entry,operation,tag)).length};
  prepared.set(preview,{value:clone(preview),entries:clone(entries),tasks});return preview;
}

/**
 * Commit only an authentic unchanged preview against the same live records.
 * Stage all history, conflict and pack changes so even direct in-memory callers
 * get all-or-nothing behavior. Repository adds its normal database transaction.
 */
export function applyEntryBatch(state,preview){
  const original=prepared.get(preview);
  requireThat(original&&equal(original.value,preview),'批量预览已改变或无法确认，请重新预览','version_conflict');
  const ids=preview.entries.map(entry=>entry.id),entries=selectedEntries(state,preview.libraryId,ids);
  requireThat(equal(entries,original.entries),'选中条目在预览后已改变，请重新预览','version_conflict');
  requireThat(equal(affectedTasks(state,ids),original.tasks),'关联的重要记忆任务在预览后已改变，请重新预览','version_conflict');
  const pending=entries.filter(entry=>!alreadyApplied(entry,preview.operation,preview.tag));
  const result={changed:pending.length,skipped:entries.length-pending.length,count:entries.length,operation:preview.operation,tag:preview.tag};
  if(!pending.length)return result;
  const staged=clone(state);
  for(const previous of pending){
    if(preview.operation==='archive'){
      setLifecycle(staged,previous.id,'archived',previous.version,'用户确认批量归档；任务重要记忆关联保持不变');
    }else{
      const updated=saveEntry(staged,{...previous,tags:[...previous.tags,preview.tag]},
        {expectedVersion:previous.version,confirm:previous.reviewStatus==='confirmed',reason:'用户确认批量添加标签'});
      // saveEntry reconstructs the editable record. Tag-only edits must also
      // retain resolution metadata from prior explicit conflict resolution.
      const version=staged.versions.find(item=>item.entryId===updated.id&&item.version===updated.version);
      for(const key of ['replacesEntryId','resolutionReason'])if(Object.hasOwn(previous,key)){
        updated[key]=clone(previous[key]);version[key]=clone(previous[key]);
      }
    }
  }
  for(const key of Object.keys(staged))state[key]=staged[key];
  return result;
}
