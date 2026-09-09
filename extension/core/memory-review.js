import {requireThat,string} from './base.js';
import {TASK_LIMITS} from './tasks.js';

const FIELDS=[['progress','当前进度'],['openQuestions','未解决事项']];
const MAX_SEGMENT_EXAMPLES=8;

// Exact sentence/line comparison is only a reading aid. It deliberately does
// not classify truth, contradiction, completion, or the meaning of a rewrite.
function segments(text){
  return text.split(/(?<=[。！？!?；;])|\r\n|\r|\n|(?<=\.)[ \t]+/u).map(part=>part.trim()).filter(Boolean);
}

function missingSegments(from,to){
  const counts=new Map();
  for(const part of to)counts.set(part,(counts.get(part)||0)+1);
  const missing=[];let count=0;
  for(const part of from){
    const available=counts.get(part)||0;
    if(available)counts.set(part,available-1);
    else {count++;if(missing.length<MAX_SEGMENT_EXAMPLES)missing.push(part);}
  }
  return {examples:missing,count};
}

/**
 * Present an existing memory_update_preview without changing it or granting
 * permission to apply it. Callers must render all returned strings as text.
 * applyMemoryUpdate remains responsible for preview authenticity and races.
 */
export function describeMemoryUpdate(task,preview){
  requireThat(task&&preview&&preview.kind==='memory_update_preview','请先生成有效的记忆更新预览');
  requireThat(typeof task.id==='string'&&task.id&&task.id===preview.taskId&&Number.isSafeInteger(task.version)&&task.version>=1&&task.version===preview.baseVersion,
    '审核内容不属于当前任务版本，请重新读取回复','version_conflict');
  requireThat(Array.isArray(preview.facts)&&preview.facts.length<=20,'记忆更新预览的候选数量无效');
  const fields=FIELDS.map(([key,label])=>{
    const before=string(task[key],`原${label}`,TASK_LIMITS.text,false),after=string(preview[key],`新${label}`,TASK_LIMITS.text,false);
    const oldSegments=segments(before),newSegments=segments(after),removed=missingSegments(oldSegments,newSegments),added=missingSegments(newSegments,oldSegments);
    return {key,label,before,after,changed:before!==after,cleared:Boolean(before.trim())&&!after.trim(),
      removedText:removed.examples,addedText:added.examples,removedCount:removed.count,addedCount:added.count,
      differencesTruncated:removed.count>removed.examples.length||added.count>added.examples.length};
  });
  const receivedFactCount=preview.facts.length,counts=preview.deduplication,evidenceReview=preview.evidenceReview??null,extraction=preview.extraction===true,excludedCount=evidenceReview?.excludedCount??0;
  if(extraction){
    requireThat(counts&&evidenceReview&&Array.isArray(evidenceReview.factChecks)&&evidenceReview.factChecks.length===receivedFactCount&&evidenceReview.receivedCount===receivedFactCount&&
      evidenceReview.factChecks.every((check,index)=>check.factIndex===index&&['eligible','excluded'].includes(check.status)&&Array.isArray(check.issues)&&Array.isArray(check.sourceRefs)&&
        (check.status==='eligible'?check.issues.length===0&&check.sourceRefs.length>0:check.issues.length>0&&check.sourceRefs.length===0)&&
        ['supported','uncertain','conflict'].includes(check.assessment)&&check.assessment===preview.facts[index].assessment),'原文引用核对结果无效');
    requireThat(excludedCount===evidenceReview.factChecks.filter(check=>check.status==='excluded').length&&evidenceReview.eligibleCount+excludedCount===receivedFactCount&&
      counts.excludedCount===excludedCount&&evidenceReview.attentionCount===evidenceReview.factChecks.filter(check=>check.status==='excluded'||check.assessment!=='supported').length,'原文引用核对计数无效');
  }else requireThat(!evidenceReview,'普通记忆更新不能混入提炼核对结果');
  requireThat(!counts||Number.isSafeInteger(counts.newFacts)&&counts.newFacts>=0&&Number.isSafeInteger(counts.deduplicated)&&counts.deduplicated>=0&&counts.newFacts+counts.deduplicated+excludedCount===receivedFactCount,'记忆候选去重计数无效');
  const changedFields=fields.filter(field=>field.changed).map(field=>field.key),factCount=counts?.newFacts??receivedFactCount,duplicateCount=counts?.deduplicated??0;
  const notices=['以下仅比较文字变化，不能判断内容是否真实、是否矛盾或行动是否已完成；请核对原回答与资料。'];
  for(const field of fields){
    if(field.cleared)notices.push(`本次更新将清空“${field.label}”，请确认是否保留原内容。`);
    else if(field.removedCount)notices.push(`“${field.label}”中有 ${field.removedCount} 个原句段未原样出现；这可能是改写、合并或删除，请对照全文。`);
  }
  notices.push(factCount?`${factCount} 条新增内容将保存为待审核的模型候选，不会自动成为已确认事实或任务核心。`:'本次没有新增事实候选。');
  if(duplicateCount)notices.push(`${duplicateCount} 条候选与当前库可复用条目或本次其他候选完全重复，将跳过重复写入；已有内容、来源和审核状态保持原样。保存时会按最新资料重新核对。`);
  if(extraction)notices.push('原文核对只检查摘录是否精确位于本轮提供的片段；模型自评不是事实结论，候选含义仍需逐条审核。');
  if(excludedCount)notices.push(`${excludedCount} 条候选的引用未通过，确认时不会写入这些条目；请查看每条排除原因。`);
  const assessmentCount=evidenceReview?.factChecks.filter(check=>check.assessment!=='supported').length||0;
  if(assessmentCount)notices.push(`${assessmentCount} 条候选被模型自评为不确定或冲突，需要手动核对；此标记不会自动解决或建立结构化事实冲突。`);
  if(!changedFields.length)notices.push('任务进度与未解决事项的文字均未改变；确认仍会结束本轮并保存下一任务版本。');
  return {taskId:task.id,baseVersion:task.version,fields,changedFields,hasChanges:changedFields.length>0||factCount>0,factCount,receivedFactCount,duplicateCount,notices,
    extraction,excludedCount,evidenceReview,hasEvidenceIssues:Boolean(evidenceReview?.attentionCount)};
}
