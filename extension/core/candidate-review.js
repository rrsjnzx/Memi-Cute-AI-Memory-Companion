import {clone,equal,norm,requireThat,string} from './base.js';
import {effectiveSensitivity,entryErrors,saveEntry,templateFor} from './library.js';

export const CANDIDATE_REVIEW_LIMIT=50;
const prepared=new WeakMap();
const isCandidate=entry=>entry.lifecycleStatus==='active'&&entry.reviewStatus==='pending'&&entry.evidenceKind==='inferred'&&entry.tags?.includes('原文提炼');
function assessment(entry){const labels=['supported','uncertain','conflict'].filter(value=>entry.tags.includes('提炼自评：'+value));return labels.length===1?labels[0]:'unknown';}
function describe(state,entry){
  const issues=entryErrors(state,entry).map(issue=>issue.message);
  if(!entry.sourceRefs.length)issues.push('提炼候选缺少原文引用，请先在编辑器核对。');
  const references=entry.sourceRefs.map(ref=>{
    const source=state.sources.find(row=>row.id===ref.sourceId&&row.version===ref.sourceVersion);
    const valid=Boolean(source&&Number.isInteger(ref.start)&&Number.isInteger(ref.end)&&ref.start>=0&&ref.end>ref.start&&ref.end<=source.text.length&&source.text.slice(ref.start,ref.end)===ref.quote);
    return {...clone(ref),name:source?.name||'来源不可用',valid,quote:valid?source.text.slice(ref.start,ref.end):''};
  });
  return {entry,assessment:assessment(entry),references,issues,sensitivity:effectiveSensitivity(state,entry)};
}

/** Library-scoped reading view; no implicit review or selection. */
export function browseExtractionCandidates(state,{libraryId,sourceId='',assessment:filter='',query='',page=1}={}){
  const exists=state.libraries.some(row=>row.id===libraryId),all=exists?state.entries.filter(entry=>entry.libraryId===libraryId&&isCandidate(entry)):[];
  const sourceIds=new Set(all.flatMap(entry=>entry.sourceRefs.map(ref=>ref.sourceId))),sources=state.sources.filter(source=>sourceIds.has(source.id)).map(source=>({id:source.id,name:source.name})).sort((a,b)=>a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
  const words=norm(String(query).slice(0,2000)).split(' ').filter(Boolean);
  const matches=all.filter(entry=>(!sourceId||entry.sourceRefs.some(ref=>ref.sourceId===sourceId))&&(!filter||assessment(entry)===filter)&&words.every(word=>norm([entry.title,entry.content,...entry.aliases,...entry.sourceRefs.map(ref=>ref.quote)].join(' ')).includes(word)))
    .sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||a.id.localeCompare(b.id));
  const total=matches.length,pageCount=Math.max(1,Math.ceil(total/25));page=Number.isSafeInteger(page)&&page>0?Math.min(page,pageCount):1;
  return {libraryTotal:all.length,total,page,pageCount,pageSize:25,start:total?(page-1)*25+1:0,end:Math.min(page*25,total),sources,candidates:matches.slice((page-1)*25,page*25).map(entry=>describe(state,entry))};
}
function selected(state,libraryId,entryIds){
  string(libraryId,'资料库 ID',199);requireThat(state.libraries.some(row=>row.id===libraryId),'资料库不存在');
  requireThat(Array.isArray(entryIds)&&entryIds.length>0&&entryIds.length<=CANDIDATE_REVIEW_LIMIT&&new Set(entryIds).size===entryIds.length,`请明确选择同一资料库的 1—${CANDIDATE_REVIEW_LIMIT} 条不同候选`);
  return entryIds.map(entryId=>{string(entryId,'候选 ID',199);const entry=state.entries.find(row=>row.id===entryId);requireThat(entry?.libraryId===libraryId&&isCandidate(entry),'候选已变化、已审核或不属于当前资料库，请重新选择','version_conflict');return entry;});
}
function dependencies(state,entries){
  const sourceIds=new Set(entries.flatMap(entry=>entry.sourceRefs.map(ref=>ref.sourceId)));
  return {sources:state.sources.filter(source=>sourceIds.has(source.id)),templates:entries.map(entry=>templateFor(state,entry)||null),rules:state.rules};
}
export function prepareCandidateReview(state,{libraryId,entryIds}={}){
  const entries=selected(state,libraryId,entryIds),rows=entries.map(entry=>describe(state,entry));
  for(const row of rows)requireThat(!row.issues.length,`${row.entry.title}：${row.issues.join('；')}`,'field_validation');
  const preview={kind:'candidate_review_preview',libraryId,count:entries.length,entries:rows.map(row=>({id:row.entry.id,title:row.entry.title,version:row.entry.version,assessment:row.assessment,sensitivity:row.sensitivity})),restrictedCount:rows.filter(row=>row.sensitivity==='local_only').length};
  prepared.set(preview,{value:clone(preview),entries:clone(entries),dependencies:clone(dependencies(state,entries))});return preview;
}
/** Preserve model provenance and restrictions; user confirmation is review only. */
export function applyCandidateReview(state,preview){
  const original=prepared.get(preview);requireThat(original&&equal(original.value,preview),'审核预览已改变或无法确认，请重新预览','version_conflict');
  const entries=selected(state,preview.libraryId,preview.entries.map(row=>row.id));
  requireThat(equal(entries,original.entries)&&equal(dependencies(state,entries),original.dependencies),'候选、原文或审核规则在预览后已改变，请重新预览','version_conflict');
  const staged=clone(state);
  for(const entry of entries){
    requireThat(entry.sourceRefs.length>0,'提炼候选缺少原文引用，请先核对');
    const saved=saveEntry(staged,entry,{expectedVersion:entry.version,confirm:true,reason:'用户在提炼候选中心核对原文并确认'}),version=staged.versions.find(row=>row.entryId===saved.id&&row.version===saved.version);
    for(const key of ['replacesEntryId','resolutionReason'])if(Object.hasOwn(entry,key)){saved[key]=clone(entry[key]);version[key]=clone(entry[key]);}
  }
  for(const key of Object.keys(staged))state[key]=staged[key];
  return {confirmed:entries.length,entryIds:entries.map(entry=>entry.id),restrictedCount:preview.restrictedCount};
}
