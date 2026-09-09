import {fieldTerms,scopeMatches,within,isoDate,requireThat} from './base.js';
import {effectiveSensitivity,entryErrors,conflictIdsAt} from './library.js';
import {prepareKeywordIndex} from './keyword-index.js';

export const reasons={library:'未启用的库',unconfirmed:'尚未确认',archived:'已归档',superseded:'已替代',disabled:'已停用',
  conflict:'存在未解决冲突',scope:'适用范围不符',time:'不在有效期',needs_time:'需指定生效日期',local_only:'仅限本地',
  invalid:'字段或引用不完整',user_excluded:'用户未选择',budget:'超过预算',no_match:'无检索词命中'};
export function exclusion(state,entry,options,{outbound=false}={}) {
  if(!options.libraryIds.includes(entry.libraryId))return 'library';
  if(entry.lifecycleStatus!=='active')return entry.lifecycleStatus;
  if(!entry.enabledForContext)return 'disabled';
  if(entry.reviewStatus!=='confirmed')return 'unconfirmed';
  if(!scopeMatches(entry.scope,options.scope))return 'scope';
  if(entry.effectiveFrom||entry.effectiveTo){if(!options.asOf)return 'needs_time';if(!within(entry,options.asOf))return 'time';}
  if(conflictIdsAt(state,entry,options.asOf).length&&!options.includeDisputed)return 'conflict';
  if(entryErrors(state,entry).length)return 'invalid';
  if(outbound&&effectiveSensitivity(state,entry)==='local_only')return 'local_only';
  return null;
}
export function retrieve(state,query,options) {
  requireThat(Array.isArray(options.libraryIds),'请明确选择本轮资料库');isoDate(options.asOf);
  const terms=fieldTerms(query),hits=[],excluded=[],eligible=[],entryReasons=[];
  for(let position=0;position<state.entries.length;position++){
    const entry=state.entries[position],reason=exclusion(state,entry,options);entryReasons.push(reason);
    if(!reason)eligible.push({entry,position});
  }
  const index=prepareKeywordIndex(state,eligible),candidates=index.candidates(terms),trimmed=query.trim();
  for(let position=0;position<state.entries.length;position++) {
    const entry=state.entries[position],reason=entryReasons[position];
    if(reason){excluded.push({id:entry.id,reason});continue;}
    if(trimmed&&trimmed!==entry.id&&candidates&&!candidates.has(position)){excluded.push({id:entry.id,reason:'no_match'});continue;}
    let score=0;const why=[];
    const row=index.rowAt(position),components=[['标题命中',6],['别名命中',8],['标签命中',4],['字段命中',3],['正文命中',1]];
    for(let i=0;i<components.length;i++){const [label,weight]=components[i],n=terms.filter(t=>row.texts[i].includes(t)).length;if(n){score+=n*weight;why.push(`${label} ${n} 项`);}}
    const exact=terms.filter(t=>/^[a-z0-9_]+(?:-[a-z0-9_]+)*$/.test(t)&&row.identifiers.has(t)).length;
    if(exact){score+=exact*20;why.push(`完整标识命中 ${exact} 项`);}
    if(query.trim()===entry.id){score+=100;why.push('精确条目 ID');}
    if(!query.trim()){score=1;why.push('浏览当前有效条目');}
    if(score)hits.push({id:entry.id,version:entry.version,score,reasons:why});else excluded.push({id:entry.id,reason:'no_match'});
  }
  hits.sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));
  return {query,options:structuredClone(options),hits,excluded,method:'weighted_keyword',coverage:'仅针对当前启用范围，匹配分数不是语义置信度'};
}
