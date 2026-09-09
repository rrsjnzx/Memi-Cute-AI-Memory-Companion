import {norm} from './base.js';

const PAGE_SIZES=new Set([6,12,24]),FILTERS=new Set(['all','pending','unlinked']);
const collator=new Intl.Collator('zh-CN',{numeric:true});
const compareText=(a,b)=>collator.compare(String(a??''),String(b??''))||(String(a??'')<String(b??'')?-1:String(a??'')>String(b??'')?1:0);
const active=entry=>entry.lifecycleStatus==='active';
const timestamp=source=>{const value=Date.parse(source.createdAt||'');return Number.isFinite(value)?value:0;};
const referenceKey=ref=>JSON.stringify([ref.sourceId,ref.sourceVersion,ref.start,ref.end,ref.quote,ref.field??null]);
const firstOffset=refs=>Math.min(...refs.map(ref=>Number.isInteger(ref.start)&&ref.start>=0?ref.start:Infinity));
const compareLinks=(a,b)=>a.start-b.start||compareText(a.entry.title,b.entry.title)||compareText(a.entry.id,b.entry.id);

function catalog(state,libraryId){
  // A source has no library owner in the persisted schema. Only an extant
  // library's extant entries (or their real earlier versions) establish scope.
  // Never infer ownership for orphan sources from their names or timestamps.
  if(!libraryId||!state.libraries.some(library=>library.id===libraryId))return [];
  const allEntries=new Map(state.entries.map(entry=>[entry.id,entry])),entries=new Map(state.entries.filter(entry=>entry.libraryId===libraryId).map(entry=>[entry.id,entry]));
  const sources=new Map(state.sources.map(source=>[source.id,source])),links=new Map(),histories=new Map();
  for(const entry of entries.values()){
    const groups=new Map();
    for(const ref of entry.sourceRefs||[]){
      if(sources.get(ref.sourceId)?.version!==ref.sourceVersion)continue;
      let refs=groups.get(ref.sourceId);if(!refs)groups.set(ref.sourceId,refs=new Map());
      refs.set(referenceKey(ref),ref);
    }
    for(const [sourceId,unique]of groups){
      const refs=[...unique.values()].sort((a,b)=>a.start-b.start||a.end-b.end||compareText(a.field,b.field));
      const rows=links.get(sourceId)||[];rows.push({entry,refs,start:firstOffset(refs),end:Math.max(...refs.map(ref=>ref.end))});links.set(sourceId,rows);
    }
  }
  for(const version of state.versions||[]){
    const entry=entries.get(version.entryId);
    if(!entry||version.libraryId!==libraryId||!Number.isInteger(version.version)||version.version<1||version.version>=entry.version)continue;
    for(const ref of version.sourceRefs||[]){
      if(sources.get(ref.sourceId)?.version!==ref.sourceVersion)continue;
      let ids=histories.get(ref.sourceId);if(!ids)histories.set(ref.sourceId,ids=new Set());ids.add(entry.id);
    }
  }
  return [...new Set([...links.keys(),...histories.keys()])].map(id=>{
    const source=sources.get(id),linkedEntries=(links.get(id)||[]).sort(compareLinks),current=linkedEntries.map(link=>link.entry);
    const isRestricted=entry=>entry.sensitivity==='local_only'||(entry.sourceRefs||[]).some(ref=>sources.get(ref.sourceId)?.sensitivity==='local_only');
    const isConflicted=entry=>entry.conflictState==='unresolved'||(entry.conflictIds||[]).some(peerId=>!allEntries.has(peerId)||active(allEntries.get(peerId)));
    return {source,id,name:source.name,characters:source.text.length,entryCount:current.length,
      pendingCount:current.filter(entry=>active(entry)&&entry.reviewStatus==='pending').length,
      confirmedCount:current.filter(entry=>active(entry)&&entry.reviewStatus==='confirmed').length,
      archivedCount:current.filter(entry=>entry.lifecycleStatus==='archived'||entry.lifecycleStatus==='superseded').length,
      restrictedCount:current.filter(isRestricted).length,conflictCount:current.filter(entry=>active(entry)&&isConflicted(entry)).length,
      historyEntryCount:histories.get(id)?.size||0,firstPendingId:current.find(entry=>active(entry)&&entry.reviewStatus==='pending')?.id||'',linkedEntries};
  });
}

/** Read-only source browsing, scoped to one existing library. Counts deduplicate
 * entries even when they cite multiple spans. pending/confirmed count current
 * active entries by review status; they do not establish context eligibility.
 * archived includes superseded. restricted counts all current linked entries
 * whose effective classification is local_only; these counts may overlap.
 * unlinked means only earlier versions of surviving entries reference a source,
 * not a globally orphaned source of unknown ownership. Search is normalized AND
 * matching across the source name, body, kind and URL; no external request runs.
 */
export function browseSources(state,{libraryId='',query='',page=1,pageSize=12,filter='all'}={}){
  const rows=catalog(state,String(libraryId||'')),libraryTotal=rows.length,terms=norm(query).split(' ').filter(Boolean),mode=FILTERS.has(filter)?filter:'all';
  const filtered=rows.filter(row=>{
    if(mode==='pending'&&!row.pendingCount||mode==='unlinked'&&row.entryCount)return false;
    if(!terms.length||String(query).trim()===row.id)return true;
    const searchable=norm([row.name,row.source.text,row.source.kind,row.source.url].join('\n'));return terms.every(term=>searchable.includes(term));
  });
  filtered.sort((a,b)=>timestamp(b.source)-timestamp(a.source)||compareText(a.name,b.name)||compareText(a.id,b.id));
  const size=PAGE_SIZES.has(Number(pageSize))?Number(pageSize):12,total=filtered.length,pageCount=Math.max(1,Math.ceil(total/size)),requested=Number(page),currentPage=Math.min(pageCount,Math.max(1,Number.isFinite(requested)?Math.floor(requested):1)),offset=(currentPage-1)*size;
  const result=filtered.slice(offset,offset+size).map(({linkedEntries,...row})=>row);
  return {sources:result,total,page:currentPage,pageSize:size,pageCount,start:total?offset+1:0,end:offset+result.length,libraryTotal};
}

/** Current linked entries retain original objects and source references. Only
 * refs for this source are returned, sorted by UTF-16 offset, with exact duplicate
 * references removed. No historical entry content is promoted to a current row.
 * An inaccessible or missing source returns null, including blank library IDs.
 */
export function sourceDetails(state,{libraryId='',sourceId=''}={}){
  return catalog(state,String(libraryId||'')).find(row=>row.id===sourceId)||null;
}

function codePointBoundary(text,offset){
  return offset>0&&offset<text.length&&/[\uDC00-\uDFFF]/.test(text[offset])&&/[\uD800-\uDBFF]/.test(text[offset-1]);
}

/** A bounded exact slice in the persisted UTF-16 coordinate system. Call again
 * with offset=result.end for lossless forward reading. Offset inside an emoji
 * expands backwards; an end inside an emoji expands forwards by one code unit.
 * Length accepts 1..12000, defaults to 6000. Output is plain text, not HTML.
 */
export function readingSourceSlice(source,{offset=0,length=6000}={}){
  const text=typeof source?.text==='string'?source.text:'',total=text.length,requested=Number(offset),requestedLength=Number(length);
  let start=Number.isFinite(requested)?Math.max(0,Math.min(total,Math.floor(requested))):requested===Infinity?total:0;
  const size=Number.isFinite(requestedLength)?Math.max(1,Math.min(12000,Math.floor(requestedLength))):6000;
  if(codePointBoundary(text,start))start--;
  let end=Math.min(total,start+size);if(codePointBoundary(text,end))end++;
  return {text:text.slice(start,end),start,end,total};
}
