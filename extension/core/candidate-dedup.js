import {requireThat,stable} from './base.js';
import {effectiveSensitivity,entryErrors} from './library.js';

// This is literal duplicate detection, not semantic reconciliation. Preserve
// case, compatibility characters, indentation and punctuation: any of these
// can distinguish names, code or quoted source text. Only canonical Unicode
// composition and platform line endings are treated as equivalent.
function literal(text){return text.normalize('NFC').replace(/\r\n?/g,'\n');}
function candidateKey(fact){
  return JSON.stringify([literal(fact.title),literal(fact.content),[...new Set(fact.aliases.map(literal))].sort()]);
}
function citedKey(fact,sourceRefs,sensitivity,assessment){
  // Evidence-bearing candidates never reuse a prose-only record or silently
  // discard a different source. Quotes retain their exact stored spelling.
  const refs=[...new Set(sourceRefs.map(ref=>stable(ref)))].sort();
  return stable([candidateKey(fact),refs,sensitivity,assessment]);
}
function savedAssessment(entry){return entry.tags?.includes('提炼自评：conflict')?'conflict':entry.tags?.includes('提炼自评：uncertain')?'uncertain':'supported';}

function reusableEntry(state,entry,libraryId){
  // An unrestricted model candidate cannot replace a scoped, dated, disabled,
  // historical, conflicting or structured record, even when its prose agrees.
  if(entry.libraryId!==libraryId||entry.kind!=='fact'||entry.lifecycleStatus!=='active'||
    !['pending','confirmed'].includes(entry.reviewStatus)||entry.enabledForContext!==true||
    entry.conflictState!=='none'||entry.conflictIds?.length||entry.scope||entry.effectiveFrom||entry.effectiveTo||
    entry.schemaId||entry.entityId||entry.predicate||entry.singleValued||
    !entry.fields||Object.keys(entry.fields).length||
    typeof entry.title!=='string'||typeof entry.content!=='string'||!Array.isArray(entry.aliases)||
    entry.aliases.some(alias=>typeof alias!=='string')||!Array.isArray(entry.sourceRefs))return false;
  return effectiveSensitivity(state,entry)==='normal'&&entryErrors(state,entry).length===0;
}

/**
 * Plan candidates against current entries without modifying any record.
 * A duplicate retains its original record, including review status, evidence,
 * sources, tags and version. Facts are still untrusted candidates.
 * Recompute this plan inside the applying transaction; IDs and counts from a
 * preview must never authorize writes against a later database snapshot.
 */
export function planCandidateFacts(state,libraryId,facts,{evidenceReview=null}={}){
  requireThat(Array.isArray(facts),'记忆候选必须是数组');
  if(evidenceReview)requireThat(evidenceReview.receivedCount===facts.length&&evidenceReview.factChecks.length===facts.length&&
    evidenceReview.factChecks.every((check,index)=>check.factIndex===index&&['eligible','excluded'].includes(check.status)&&Array.isArray(check.sourceRefs)),'引用核对与候选不对应');
  const available=new Map();
  for(const entry of state.entries){
    if(!reusableEntry(state,entry,libraryId))continue;
    if(evidenceReview&&!entry.sourceRefs.length)continue;
    const key=evidenceReview?citedKey(entry,entry.sourceRefs,effectiveSensitivity(state,entry),savedAssessment(entry)):candidateKey(entry),previous=available.get(key);
    // Prefer a confirmed record when both pending and reviewed copies exist.
    // This does not delete or merge either existing copy.
    if(!previous||previous.reviewStatus!=='confirmed'&&entry.reviewStatus==='confirmed')
      available.set(key,{entryId:entry.id,duplicateOfFactIndex:null,reviewStatus:entry.reviewStatus});
  }
  const newFactIndexes=[],duplicates=[];
  facts.forEach((fact,factIndex)=>{
    requireThat(fact&&typeof fact.title==='string'&&typeof fact.content==='string'&&Array.isArray(fact.aliases)&&fact.aliases.every(alias=>typeof alias==='string'),'记忆候选格式无效');
    const check=evidenceReview?.factChecks[factIndex];if(check?.status==='excluded')return;
    const sensitivity=check?effectiveSensitivity(state,{sensitivity:'normal',sourceRefs:check.sourceRefs}):'normal';
    const key=check?citedKey(fact,check.sourceRefs,sensitivity,check.assessment):candidateKey(fact),match=available.get(key);
    if(match)duplicates.push({factIndex,entryId:match.entryId,duplicateOfFactIndex:match.duplicateOfFactIndex});
    else{
      newFactIndexes.push(factIndex);
      available.set(key,{entryId:null,duplicateOfFactIndex:factIndex,reviewStatus:'pending'});
    }
  });
  return {newFacts:newFactIndexes.length,deduplicated:duplicates.length,newFactIndexes,duplicates,...(evidenceReview?{excludedCount:evidenceReview.excludedCount}:{})};
}
