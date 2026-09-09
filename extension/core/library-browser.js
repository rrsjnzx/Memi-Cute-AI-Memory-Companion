import {fieldTerms,norm} from './base.js';
import {effectiveSensitivity,conflictIdsAt} from './library.js';
import {prepareKeywordIndex} from './keyword-index.js';

const PAGE_SIZES=new Set([25,50,100]),SORTS=new Set(['updated','title','relevance']);
const textCollator=new Intl.Collator('zh-CN',{numeric:true});
const compareText=(a,b)=>{const left=String(a??''),right=String(b??'');return textCollator.compare(left,right)||(left<right?-1:left>right?1:0);};
const compareIdentity=(a,b)=>compareText(a.entry.id,b.entry.id)||a.position-b.position;
const updated=entry=>{const value=Date.parse(entry.updatedAt||entry.createdAt||'');return Number.isFinite(value)?value:0;};
const compareUpdated=(a,b)=>b.updatedTime-a.updatedTime||compareText(a.entry.title,b.entry.title)||compareIdentity(a,b);
const inLibrary=(entry,libraryId)=>!libraryId||entry.libraryId===libraryId;
const sourceIds=entry=>new Set((entry.sourceRefs||[]).map(ref=>ref.sourceId).filter(Boolean));

function statusMatches(state,entry,status,important){
  if(status==='confirmed'||status==='pending')return entry.reviewStatus===status;
  if(status==='conflict')return entry.conflictState==='unresolved'||conflictIdsAt(state,entry).length>0;
  if(status==='archived')return entry.lifecycleStatus==='archived'||entry.lifecycleStatus==='superseded';
  if(status==='important')return important.has(entry.id);
  if(status==='local_only')return effectiveSensitivity(state,entry)==='local_only';
  return true;
}
function queryScore(row,terms,query,entry){
  let score=query.trim()===entry.id?100:0;
  for(let i=0;i<row.texts.length;i++)score+=terms.filter(term=>row.texts[i].includes(term)).length*[6,8,4,3,1][i];
  score+=terms.filter(term=>/^[a-z0-9_]+(?:-[a-z0-9_]+)*$/.test(term)&&row.identifiers.has(term)).length*20;
  return score;
}

/** Read-only management browsing: pending, archived, disabled and local-only
 * entries remain visible. These filters never confer outbound eligibility.
 * Returned entries are the original objects; callers must use repository
 * transactions, not modify them, when saving changes.
 */
export function browseEntries(state,options={}){
  const libraryId=String(options.libraryId||''),query=String(options.query||''),sourceId=String(options.sourceId||''),kind=String(options.kind||''),tag=String(options.tag||''),status=String(options.status||'all');
  const important=new Set(options.importantIds||[]),pageSize=PAGE_SIZES.has(Number(options.pageSize))?Number(options.pageSize):50,sort=SORTS.has(options.sort)?options.sort:'updated';
  const libraryRows=state.entries.map((entry,position)=>({entry,position})).filter(({entry})=>inLibrary(entry,libraryId)).map(row=>({...row,updatedTime:updated(row.entry)}));
  let rows=libraryRows.filter(({entry})=>(!sourceId||(sourceId==='__none__'?sourceIds(entry).size===0:sourceIds(entry).has(sourceId)))&&(!kind||entry.kind===kind)&&(!tag||(entry.tags||[]).includes(tag))&&statusMatches(state,entry,status,important));
  const normalizedQuery=norm(query);
  if(normalizedQuery){
    const terms=fieldTerms(query);if(!terms.length)terms.push(normalizedQuery);
    // Template match:false controls outbound retrieval, not management search.
    // Only the index view omits schemas; original entries and state stay intact.
    const index=prepareKeywordIndex(state,rows.map(({entry,position})=>({position,entry:{...entry,schemaId:'',schemaVersion:null}}))),candidates=index.candidates(terms);
    rows=rows.flatMap(row=>{
      if(query.trim()!==row.entry.id&&candidates&&!candidates.has(row.position))return [];
      const score=queryScore(index.rowAt(row.position),terms,query,row.entry);
      return score?[{...row,score}]:[];
    });
  }
  rows.sort(sort==='title'?(a,b)=>compareText(a.entry.title,b.entry.title)||compareIdentity(a,b):sort==='relevance'&&normalizedQuery?(a,b)=>b.score-a.score||compareUpdated(a,b):compareUpdated);
  const total=rows.length,pageCount=Math.max(1,Math.ceil(total/pageSize)),requested=Number(options.page),focusId=String(options.focusId||''),focusPosition=focusId?rows.findIndex(({entry})=>entry.id===focusId):-1;
  const page=focusPosition>=0?Math.floor(focusPosition/pageSize)+1:Math.min(pageCount,Math.max(1,Number.isFinite(requested)?Math.floor(requested):1)),offset=(page-1)*pageSize;
  const entries=rows.slice(offset,offset+pageSize).map(row=>row.entry);
  return {entries,total,libraryTotal:libraryRows.length,pendingCount:libraryRows.filter(({entry})=>entry.reviewStatus==='pending').length,page,pageSize,pageCount,start:total?offset+1:0,end:offset+entries.length,selectedVisible:!!focusId&&entries.some(entry=>entry.id===focusId)};
}

/** Facet counts use the complete chosen library, before the current filters.
 * Names are plain text, never HTML. Repeated source references count once per
 * entry; two sources with the same display name remain distinct IDs.
 */
export function browserFacets(state,libraryId=''){
  const sources=new Map(),kinds=new Map(),tags=new Map();let withoutSource=0;
  for(const entry of state.entries){
    if(!inLibrary(entry,libraryId))continue;
    const ids=sourceIds(entry);if(!ids.size)withoutSource++;
    for(const id of ids)sources.set(id,(sources.get(id)||0)+1);
    kinds.set(entry.kind,(kinds.get(entry.kind)||0)+1);
    for(const name of new Set(entry.tags||[]))tags.set(name,(tags.get(name)||0)+1);
  }
  return {sources:[...sources].map(([id,count])=>({id,name:state.sources.find(source=>source.id===id)?.name||'来源已不存在',count})).sort((a,b)=>compareText(a.name,b.name)||compareText(a.id,b.id)),
    kinds:[...kinds].map(([id,count])=>({id,count})).sort((a,b)=>compareText(a.id,b.id)),tags:[...tags].map(([name,count])=>({name,count})).sort((a,b)=>compareText(a.name,b.name)),withoutSource};
}

function readable(value){return String(value??'').replace(/\s+/gu,' ').trim();}
function originalOffset(text,normalizedOffset){
  const lower=text.toLocaleLowerCase();
  if(lower.length===text.length&&lower.normalize('NFKC')===lower)return normalizedOffset;
  let offset=0;
  // Grapheme boundaries keep combining sequences intact when NFKC expands or
  // contracts text before a distant hit. This path is only needed for excerpts.
  for(const {segment,index} of new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(text)){
    const length=segment.normalize('NFKC').toLocaleLowerCase().length;
    if(offset+length>normalizedOffset)return index;offset+=length;
  }
  return text.length;
}
function sliceExcerpt(text,hit,limit){
  if(text.length<=limit)return text;
  if(limit<=1)return /^[\uD800-\uDBFF][\uDC00-\uDFFF]/.test(text)?'…':text.slice(0,limit);
  let start=Math.max(0,hit-Math.floor(limit/3));
  if(start>text.length-limit)start=Math.max(0,text.length-limit);
  let room=limit-(start>0?1:0),end=Math.min(text.length,start+room);
  if(end<text.length)end--;
  // Do not emit a lone UTF-16 surrogate when truncating an emoji.
  if(start>0&&/[\uDC00-\uDFFF]/.test(text[start])&&/[\uD800-\uDBFF]/.test(text[start-1]))start++;
  if(end>start&&/[\uD800-\uDBFF]/.test(text[end-1]))end--;
  return (start>0?'…':'')+text.slice(start,end)+(end<text.length?'…':'');
}

/** A plain-text excerpt, not markup. Render with textContent. */
export function entryExcerpt(entry,query='',maxLength=140){
  const requested=Number(maxLength),limit=Number.isFinite(requested)?Math.max(0,Math.min(2000,Math.floor(requested))):140;if(!limit)return '';
  const content=readable(entry.content),fields=readable(Object.entries(entry.fields||{}).map(([key,value])=>`${key}: ${typeof value==='string'?value:JSON.stringify(value)}`).join(' · '));
  const choices=[content,fields,readable((entry.aliases||[]).join(' · ')),readable((entry.tags||[]).join(' · '))].filter(Boolean),fallback=choices[0]||readable(entry.title);
  const normalizedQuery=norm(query),terms=normalizedQuery?[normalizedQuery,...fieldTerms(query)]:[];
  for(const text of choices){
    const normalized=norm(text);let hit=-1;
    for(const term of terms){const position=normalized.indexOf(term);if(position>=0){hit=position;break;}}
    if(hit>=0)return sliceExcerpt(text,originalOffset(text,hit),limit);
  }
  return sliceExcerpt(fallback,0,limit);
}
