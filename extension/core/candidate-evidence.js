import {clone,requireThat} from './base.js';

const issue=(code,message)=>({code,message});

// The caller must validate the authoritative delivered pack first. This checks
// exact provenance only; a matching quotation cannot establish semantic truth.
export function planCandidateEvidence(state,task,pack,facts){
  requireThat(pack?.taskProtocolVersion===3&&pack.sourceExtraction,'当前资料包没有可核对的提炼片段');
  requireThat(Array.isArray(facts),'记忆候选必须是数组');
  const extraction=pack.sourceExtraction,source=state.sources.find(item=>item.id===extraction.sourceId),contextIssues=[];
  if(task.libraryId!==extraction.libraryId||!state.libraries.some(item=>item.id===task.libraryId))
    contextIssues.push(issue('library_mismatch','引用片段不属于当前任务资料库'));
  if(!source)contextIssues.push(issue('source_missing','提炼来源已不存在'));
  else{
    if(source.version!==extraction.sourceVersion||source.sha256!==extraction.sourceSha256||
      !Number.isSafeInteger(extraction.start)||!Number.isSafeInteger(extraction.end)||extraction.start<0||extraction.end<=extraction.start||
      extraction.end>source.text.length||source.text.slice(extraction.start,extraction.end)!==extraction.text)
      contextIssues.push(issue('source_changed','提炼来源版本、摘要或原文片段已变化'));
    if(source.sensitivity==='local_only')contextIssues.push(issue('source_restricted','提炼来源仅限本地，不能用于网页 AI 提炼'));
  }
  const factChecks=facts.map((fact,factIndex)=>{
    const issues=clone(contextIssues),refs=[];
    if(!Array.isArray(fact.evidence)||!fact.evidence.length)issues.push(issue('missing_evidence','此提炼候选没有原文引用，已排除'));
    else for(const evidence of fact.evidence){
      if(evidence.sourceId!==extraction.sourceId){issues.push(issue('source_mismatch','引用来源不是本轮提供的文档'));continue;}
      if(evidence.version!==extraction.sourceVersion){issues.push(issue('version_mismatch','引用版本不是本轮提供的版本'));continue;}
      if(typeof evidence.quote!=='string'||!evidence.quote.trim()){issues.push(issue('empty_quote','引用摘录不能为空'));continue;}
      const relative=extraction.text.indexOf(evidence.quote);
      if(relative<0){issues.push(issue('quote_not_provided','引用不是本轮已提供片段中的连续原文'));continue;}
      if(extraction.text.indexOf(evidence.quote,relative+1)>=0){issues.push(issue('ambiguous_quote','引用在本轮片段出现多次，请提供更长的唯一摘录'));continue;}
      const start=extraction.start+relative;
      refs.push({sourceId:extraction.sourceId,sourceVersion:extraction.sourceVersion,start,end:start+evidence.quote.length,quote:evidence.quote});
    }
    const unique=[...new Map(refs.map(ref=>[JSON.stringify(ref),ref])).values()];
    return {factIndex,status:issues.length?'excluded':'eligible',sourceRefs:issues.length?[]:unique,issues,assessment:fact.assessment};
  });
  const excludedCount=factChecks.filter(check=>check.status==='excluded').length;
  return {factChecks,excludedCount,eligibleCount:facts.length-excludedCount,receivedCount:facts.length,
    attentionCount:factChecks.filter(check=>check.status==='excluded'||check.assessment!=='supported').length};
}
