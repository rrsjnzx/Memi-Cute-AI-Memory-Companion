import {fieldTerms,norm} from './base.js';
import {readingSourceSlice} from './source-browser.js';
import {SOURCE_EXTRACTION_LIMITS} from './source-extraction.js';

export const SOURCE_COVERAGE_LIMITS=Object.freeze({pageSize:10,maxPageSize:50,unitCharacters:1000,maxUnits:100000,taskTerms:64,rowReferences:8,gapRanges:8,maxRepetitionPenalty:32});
export const SOURCE_COVERAGE_NOTE='仅检查当前版本原文是否被提炼条目逐字引用。未引用或部分引用只提示可能需要补读；引用覆盖不代表事实完整、语义正确或已审核。重复文字按已扫描单元统计，降权仅调整阅读顺序，不代表真实性。';
const FILTERS=new Set(['gaps','all','pending','confirmed','archived']);
const signalRules=[
  {code:'pending',label:'包含待办或未完成措辞',weight:40,pattern:/尚未|仍未|未提交|未完成|未确定|未收到|待(?:办|确认|提交|核对|审核|处理|补充)|\bpending\b|\bnot yet\b|\bunresolved\b|\bto[ -]?do\b/giu},
  {code:'revision',label:'包含修订或替换措辞',weight:20,pattern:/修订|改为|改成|更正|撤销|取代|替换|旧值|现值|版本|\brevision\b|\brevised\b|\bsupersed\w*\b|\breplac\w*\b/giu},
  {code:'status',label:'包含状态或条件措辞',weight:12,pattern:/状态|完成|提交|确定|成功|失败|停止|失效|生效|必须|不得|仅限|\bstatus\b|\bcomplet\w*\b|\bsubmit\w*\b|\bfail\w*\b|\brequired\b/giu},
  {code:'number',label:'包含数字、时间或数量',weight:8,pattern:/\d+(?:[.:/-]\d+)*|[一二三四五六七八九十百千万]+(?=次|分钟|小时|天|条|份|节|个|米)/gu}
];
const boundary=(text,offset)=>offset>0&&offset<text.length&&/[\uDC00-\uDFFF]/.test(text[offset])&&/[\uD800-\uDBFF]/.test(text[offset-1]);
const extracted=entry=>entry.evidenceKind==='inferred'&&entry.tags?.includes('原文提炼');
function validReference(source,ref){
  return ref?.sourceId===source.id&&ref.sourceVersion===source.version&&Number.isSafeInteger(ref.start)&&Number.isSafeInteger(ref.end)&&ref.start>=0&&ref.end>ref.start&&ref.end<=source.text.length&&typeof ref.quote==='string'&&ref.quote.trim().length>0&&!boundary(source.text,ref.start)&&!boundary(source.text,ref.end)&&source.text.slice(ref.start,ref.end)===ref.quote;
}
function accessibleSource(state,libraryId,sourceId){
  if(!libraryId||!state.libraries.some(library=>library.id===libraryId))return null;
  const source=state.sources.find(row=>row.id===sourceId);
  if(!source||source.coordinates!=='utf16'||typeof source.text!=='string')return null;
  const entries=state.entries.filter(entry=>entry.libraryId===libraryId);
  if(entries.some(entry=>(entry.sourceRefs||[]).some(ref=>validReference(source,ref))))return source;
  const current=new Map(entries.map(entry=>[entry.id,entry]));
  // Surviving entries' real earlier versions may establish local read access,
  // but never contribute current extraction coverage. Orphans are inaccessible.
  return (state.versions||[]).some(version=>{
    const entry=current.get(version.entryId);
    return entry&&version.libraryId===libraryId&&Number.isSafeInteger(version.version)&&version.version>0&&version.version<entry.version&&(version.sourceRefs||[]).some(ref=>validReference(source,ref));
  })?source:null;
}
function mergeRanges(refs){
  const sorted=refs.map(ref=>({start:ref.start,end:ref.end})).sort((a,b)=>a.start-b.start||a.end-b.end),merged=[];
  for(const range of sorted){const last=merged.at(-1);if(last&&range.start<=last.end)last.end=Math.max(last.end,range.end);else merged.push({...range});}return merged;
}
function firstOverlap(ranges,start){
  let low=0,high=ranges.length;while(low<high){const middle=(low+high)>>>1;if(ranges[middle].end<=start)low=middle+1;else high=middle;}return low;
}
function overlapCharacters(ranges,start,end){
  let count=0;for(let index=firstOverlap(ranges,start);index<ranges.length&&ranges[index].start<end;index++)count+=Math.min(end,ranges[index].end)-Math.max(start,ranges[index].start);return count;
}
function gapsWithin(ranges,start,end){
  const gaps=[];let offset=start,total=0;
  const append=(from,to)=>{if(from<to){total++;if(gaps.length<SOURCE_COVERAGE_LIMITS.gapRanges)gaps.push({start:from,end:to});}};
  for(let index=firstOverlap(ranges,start);index<ranges.length&&ranges[index].start<end;index++){append(offset,Math.min(end,ranges[index].start));offset=Math.max(offset,Math.min(end,ranges[index].end));}
  append(offset,end);return {ranges:gaps,total,truncated:total>gaps.length};
}
function collectReferences(state,libraryId,source){
  const refs=[],ignored={nonExtractionEntries:0,oldVersionReferences:0,invalidReferences:0,unknownStatusReferences:0},entryCounts={pending:0,confirmed:0,archived:0,disabled:0};
  for(const entry of state.entries){
    if(entry.libraryId!==libraryId)continue;
    const linked=(entry.sourceRefs||[]).filter(ref=>ref.sourceId===source.id);if(!linked.length)continue;
    if(!extracted(entry)){ignored.nonExtractionEntries++;continue;}
    const category=['archived','superseded'].includes(entry.lifecycleStatus)?'archived':entry.lifecycleStatus==='active'&&entry.enabledForContext===false?'disabled':entry.lifecycleStatus==='active'&&['pending','confirmed'].includes(entry.reviewStatus)?entry.reviewStatus:null;
    let counted=false;const seen=new Set();
    for(const ref of linked){
      if(ref.sourceVersion!==source.version){ignored.oldVersionReferences++;continue;}
      if(!validReference(source,ref)){ignored.invalidReferences++;continue;}
      if(!category){ignored.unknownStatusReferences++;continue;}
      const key=JSON.stringify([ref.start,ref.end]);if(seen.has(key))continue;seen.add(key);
      refs.push({entryId:entry.id,category,start:ref.start,end:ref.end});counted=true;
    }
    if(counted)entryCounts[category]++;
  }
  const intervals=Object.fromEntries(['pending','confirmed','archived','disabled'].map(category=>[category,mergeRanges(refs.filter(ref=>ref.category===category))]));
  intervals.current=mergeRanges(refs.filter(ref=>ref.category==='pending'||ref.category==='confirmed'));
  return {refs,intervals,entryCounts,ignored};
}
function asciiSentenceEnd(text,index,end){
  if(text[index]!=='.')return false;
  let stop=index+1;while(stop<end&&/["'”’）)\]]/.test(text[stop]))stop++;
  if(stop<end&&!/\s/u.test(text[stop]))return false;
  // A local reading boundary, not an English parser. Keep decimal points,
  // common title abbreviations, initials and dotted acronyms together.
  const prefix=text.slice(Math.max(0,index-16),index+1);
  if(/(?:\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc)\.|\b[A-Za-z]\.|(?:\b[A-Za-z]\.){2,})$/iu.test(prefix))return false;
  return stop;
}
function* units(text){
  // Newlines and sentence terminators are local, language-independent reading
  // hints. Long paragraphs are bounded pieces, not claimed semantic sentences.
  for(const match of text.matchAll(/(?:[^\r\n。！？!?]+[。！？!?]*|[。！？!?]+)[”’"')\]】）]*/gu)){
    let start=match.index,end=match.index+match[0].length;
    while(start<end){
      let stop=Math.min(end,start+SOURCE_COVERAGE_LIMITS.unitCharacters);if(boundary(text,stop))stop++;
      const bounded=text.slice(start,stop);
      for(let at=bounded.indexOf('.');at>=0;at=bounded.indexOf('.',at+1)){
        const sentenceEnd=asciiSentenceEnd(text,start+at,end);if(sentenceEnd&&sentenceEnd<=stop){stop=sentenceEnd;break;}
      }
      const part=text.slice(start,stop),leading=part.search(/\S/u);
      if(leading>=0){const trimmedEnd=stop-(part.match(/\s*$/u)?.[0].length||0);yield {start:start+leading,end:trimmedEnd};}
      start=stop;
    }
  }
}
function taskWords(state,libraryId,taskId,query){
  const task=(state.tasks||[]).find(row=>row.id===taskId&&row.libraryId===libraryId);
  const cores=new Set(task?.coreEntryIds||[]),coreText=state.entries.filter(entry=>entry.libraryId===libraryId&&cores.has(entry.id)&&entry.lifecycleStatus==='active').map(entry=>[entry.title,entry.content].join('\n')).join('\n');
  const terms=fieldTerms([query,task?.name,task?.goal,task?.constraints,task?.openQuestions,coreText].filter(Boolean).join('\n'));
  const limit=SOURCE_COVERAGE_LIMITS.taskTerms,words=terms.length<=limit?terms:Array.from({length:limit},(_,i)=>terms[Math.floor(i*(terms.length-1)/(limit-1))]);
  return {words,taskId:task?.id||'',taskUnavailable:!!taskId&&!task,termsLimited:terms.length>limit};
}
function rank(text,words,normalized=norm(text)){
  const reasons=[];let score=0;
  for(const rule of signalRules){const matches=[...new Set(Array.from(text.matchAll(rule.pattern),match=>match[0]))].slice(0,6);if(matches.length){score+=rule.weight;reasons.push({code:rule.code,label:rule.label,matches});}}
  const matches=words.filter(word=>normalized.includes(word));
  if(matches.length){score+=Math.min(20,matches.length*3);reasons.push({code:'task',label:'命中当前任务或问题用词',matches:matches.slice(0,8)});}
  return {score,priority:score>=40?'high':score>=15?'medium':'low',reasons};
}
function matchedFilter(row,filter){
  if(filter==='gaps')return row.currentCoverage!=='full';
  if(filter==='all')return true;
  return row.coverage[`${filter}Characters`]>0;
}

/** A local, read-only citation-coverage view. Neither task terms nor quoted
 * text establish truth or outbound permission. Only current inferred entries
 * tagged as source extraction count; imported source chunks never count.
 * Archived/disabled quotes are separately visible, never current coverage.
 * Positions are zero-based, half-open UTF-16 offsets into the exact source.
 * A reread suggestion must still pass createSourceExtraction at preparation.
 */
export function inspectSourceCoverage(state,{libraryId='',sourceId='',taskId='',query='',filter='gaps',page=1,pageSize=SOURCE_COVERAGE_LIMITS.pageSize}={}){
  const source=accessibleSource(state,libraryId,sourceId);if(!source)return null;
  const {refs,intervals,entryCounts,ignored}=collectReferences(state,libraryId,source),ranking=taskWords(state,libraryId,taskId,String(query||'')),mode=FILTERS.has(filter)?filter:'gaps';
  const summary={units:0,unquotedUnits:0,partiallyQuotedUnits:0,fullyQuotedUnits:0,pendingUnits:0,confirmedUnits:0,archivedUnits:0,disabledUnits:0,
    ...Object.fromEntries(Object.entries(intervals).map(([key,ranges])=>[`${key}QuotedCharacters`,ranges.reduce((sum,range)=>sum+range.end-range.start,0)])),entryCounts,ignored};
  const rows=[],repetitions=new Map();let scanEnd=0,scanTruncated=false;
  for(const unit of units(source.text)){
    if(summary.units>=SOURCE_COVERAGE_LIMITS.maxUnits){scanTruncated=true;break;}
    summary.units++;scanEnd=unit.end;const characters=unit.end-unit.start;
    const coverage=Object.fromEntries(Object.entries(intervals).map(([key,ranges])=>[`${key}Characters`,overlapCharacters(ranges,unit.start,unit.end)]));
    const currentCoverage=!coverage.currentCharacters?'none':coverage.currentCharacters===characters?'full':'partial';
    summary[currentCoverage==='none'?'unquotedUnits':currentCoverage==='full'?'fullyQuotedUnits':'partiallyQuotedUnits']++;
    for(const key of ['pending','confirmed','archived','disabled'])if(coverage[`${key}Characters`])summary[`${key}Units`]++;
    const text=source.text.slice(unit.start,unit.end),textKey=norm(text);repetitions.set(textKey,(repetitions.get(textKey)||0)+1);
    const row={...unit,characters,coverage,currentCoverage};if(matchedFilter(row,mode))rows.push({...row,_textKey:textKey,...rank(text,ranking.words,textKey)});
  }
  summary.repeatedTextGroups=0;summary.repeatedUnits=0;
  for(const count of repetitions.values())if(count>1){summary.repeatedTextGroups++;summary.repeatedUnits+=count;}
  for(const row of rows){
    row.repetitionCount=repetitions.get(row._textKey);row.repetitionPenalty=0;
    if(row.repetitionCount>1){
      // Repeated boilerplate must not fill the first page ahead of a one-off
      // status. Keep every position; this is a bounded ordering adjustment,
      // not deduplication, evidence rejection or a truth/confidence score.
      row.repetitionPenalty=Math.min(row.score,SOURCE_COVERAGE_LIMITS.maxRepetitionPenalty,8*Math.ceil(Math.log2(row.repetitionCount)));
      row.score-=row.repetitionPenalty;
      row.reasons.push({code:'repeated_text',label:`相同文字在${scanTruncated?'已扫描原文':'原文'}重复 ${row.repetitionCount} 处`,matches:[]});
      row.priority=row.score>=40?'high':row.score>=15?'medium':'low';
    }
    delete row._textKey;
  }
  // Stable source order breaks heuristic ties; scores are not probabilities.
  rows.sort((a,b)=>b.score-a.score||a.start-b.start||a.end-b.end);
  const requestedSize=Number(pageSize),size=Number.isFinite(requestedSize)?Math.min(SOURCE_COVERAGE_LIMITS.maxPageSize,Math.max(1,Math.floor(requestedSize))):SOURCE_COVERAGE_LIMITS.pageSize;
  const total=rows.length,pageCount=Math.max(1,Math.ceil(total/size)),requestedPage=Number(page),currentPage=Number.isFinite(requestedPage)?Math.min(pageCount,Math.max(1,Math.floor(requestedPage))):1,offset=(currentPage-1)*size;
  const result=rows.slice(offset,offset+size).map(row=>{
    const relevant=refs.filter(ref=>ref.start<row.end&&ref.end>row.start),length=Math.min(SOURCE_EXTRACTION_LIMITS.defaultLength,source.text.length-row.start),slice=readingSourceSlice(source,{offset:row.start,length});
    return {...row,text:source.text.slice(row.start,row.end),unquoted:gapsWithin(intervals.current,row.start,row.end),references:relevant.slice(0,SOURCE_COVERAGE_LIMITS.rowReferences).map(ref=>({...ref})),referenceCount:relevant.length,referencesTruncated:relevant.length>SOURCE_COVERAGE_LIMITS.rowReferences,
      reread:{libraryId,sourceId,sourceVersion:source.version,sourceSha256:source.sha256,start:slice.start,end:slice.end,length}};
  });
  return {libraryId,sourceId,sourceVersion:source.version,sourceSha256:source.sha256,name:source.name,characters:source.text.length,coordinates:'utf16',taskId:ranking.taskId,taskUnavailable:ranking.taskUnavailable,taskTermsLimited:ranking.termsLimited,filter:mode,summary,
    scan:{complete:!scanTruncated,scannedThrough:scanTruncated?scanEnd:source.text.length,unitLimit:SOURCE_COVERAGE_LIMITS.maxUnits},total,page:currentPage,pageSize:size,pageCount,start:total?offset+1:0,end:offset+result.length,rows:result,semanticsChecked:false,note:SOURCE_COVERAGE_NOTE};
}
