import {clone,requireThat,string} from './base.js';
import {readingSourceSlice} from './source-browser.js';

const keys=['libraryId','sourceId','sourceVersion','sourceSha256','name','start','end','text'];
export const SOURCE_EXTRACTION_LIMITS={defaultLength:4000,maxLength:6000};

/** Shape validation is also used for historical round snapshots. It does not
 * authorize sending a source or require that a historical source still exists. */
export function validateSourceExtractionShape(meta){
  requireThat(meta&&typeof meta==='object'&&!Array.isArray(meta)&&Object.keys(meta).length===keys.length&&keys.every(key=>Object.hasOwn(meta,key)),'原文提炼信息字段不完整或包含额外字段');
  for(const key of ['libraryId','sourceId'])string(meta[key],`原文提炼 ${key}`,199);
  string(meta.name,'原文提炼来源名称',500);requireThat(Number.isSafeInteger(meta.sourceVersion)&&meta.sourceVersion>0,'原文提炼来源版本无效');
  requireThat(typeof meta.sourceSha256==='string'&&/^[a-f0-9]{64}$/.test(meta.sourceSha256),'原文提炼来源哈希无效');
  requireThat(Number.isSafeInteger(meta.start)&&Number.isSafeInteger(meta.end)&&meta.start>=0&&meta.end>meta.start&&meta.end-meta.start<=SOURCE_EXTRACTION_LIMITS.maxLength+1,'原文提炼片段位置或长度无效');
  requireThat(typeof meta.text==='string'&&meta.text.length===meta.end-meta.start&&meta.text.trim(),'原文提炼片段正文与位置不一致');return meta;
}

function authorizedSource(state,libraryId,sourceId){
  requireThat(state.libraries.some(library=>library.id===libraryId),'原文提炼资料库不存在');
  const source=state.sources.find(item=>item.id===sourceId);requireThat(source,'原文提炼来源已不存在');
  requireThat(source.coordinates==='utf16'&&typeof source.text==='string','原文提炼来源位置格式无效');
  requireThat(state.entries.some(entry=>entry.libraryId===libraryId&&(entry.sourceRefs||[]).some(ref=>ref.sourceId===sourceId&&ref.sourceVersion===source.version)),'原文提炼来源不属于当前资料库的关联条目');
  requireThat(source.sensitivity==='normal','此来源仅限本地，不能发送到 AI 网页');
  const sourceMap=new Map(state.sources.map(item=>[item.id,item]));
  const restricted=entry=>entry.sensitivity==='local_only'||(entry.sourceRefs||[]).some(ref=>sourceMap.get(ref.sourceId)?.sensitivity==='local_only');
  for(const entry of [...state.entries,...(state.versions||[])])if((entry.sourceRefs||[]).some(ref=>ref.sourceId===sourceId))requireThat(!restricted(entry),'此来源被仅限本地的当前或历史条目引用，不能通过原文提炼绕过限制');
  requireThat(!state.entries.some(entry=>entry.enabledForContext===false&&(entry.sourceRefs||[]).some(ref=>ref.sourceId===sourceId)),'此来源关联了已停用条目，请先核对该限制，不能直接发送原文');
  return source;
}

/** Exact live validation is required at every outgoing or applying boundary.
 * Source hashes are the persisted import hashes; canonical text equality also
 * detects edited source text even if its hash/version metadata was not updated. */
export function validateSourceExtraction(state,meta){
  validateSourceExtractionShape(meta);const source=authorizedSource(state,meta.libraryId,meta.sourceId);
  requireThat(source.version===meta.sourceVersion&&source.sha256===meta.sourceSha256&&source.name===meta.name,'原文提炼来源版本、名称或哈希已改变，请重新准备');
  requireThat(meta.end<=source.text.length&&source.text.slice(meta.start,meta.end)===meta.text,'原文提炼片段与保存的来源不一致');
  const boundary=offset=>offset>0&&offset<source.text.length&&/[\uDC00-\uDFFF]/.test(source.text[offset])&&/[\uD800-\uDBFF]/.test(source.text[offset-1]);
  requireThat(!boundary(meta.start)&&!boundary(meta.end),'原文提炼片段不能截断 UTF-16 字符');return meta;
}

export function createSourceExtraction(state,{libraryId,sourceId,start=0,length=SOURCE_EXTRACTION_LIMITS.defaultLength}={}){
  requireThat(Number.isSafeInteger(start)&&start>=0,'原文提炼起点必须为非负整数');requireThat(Number.isSafeInteger(length)&&length>0&&length<=SOURCE_EXTRACTION_LIMITS.maxLength,'原文提炼长度须为 1—6000 字符');
  const source=authorizedSource(state,libraryId,sourceId);requireThat(start<source.text.length,'此来源已读完或提炼起点超出原文');
  const slice=readingSourceSlice(source,{offset:start,length});
  return clone(validateSourceExtraction(state,{libraryId,sourceId,sourceVersion:source.version,sourceSha256:source.sha256,name:source.name,start:slice.start,end:slice.end,text:slice.text}));
}

/** Resume only the contiguous prefix completed by this task for the current
 * exact source snapshot. Later completed islands never skip an unread gap. */
export function nextExtractionOffset(state,{taskId,sourceId}={}){
  const task=state.tasks?.find(item=>item.id===taskId),source=state.sources.find(item=>item.id===sourceId);if(!task||!source)return 0;
  const ranges=[];
  for(const round of state.rounds||[]){
    const meta=round.packSnapshot?.sourceExtraction;
    if(round.status!=='completed'||round.taskId!==taskId||round.libraryId!==task.libraryId||round.packSnapshot?.memoryTask?.id!==taskId||!meta||meta.sourceId!==sourceId||meta.libraryId!==task.libraryId||meta.sourceVersion!==source.version||meta.sourceSha256!==source.sha256||meta.name!==source.name)continue;
    try{validateSourceExtractionShape(meta);}catch{continue;}
    if(meta.end<=source.text.length&&source.text.slice(meta.start,meta.end)===meta.text)ranges.push([meta.start,meta.end]);
  }
  ranges.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);let end=0;for(const [start,stop]of ranges){if(start>end)break;end=Math.max(end,stop);}return end;
}
