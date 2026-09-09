import {clone,equal,requireThat} from './base.js';
import {validatePack} from './pack.js';
import {roundById,prepareRound,resumeRound,replaceRoundPack,abandonRound,validateRounds} from './rounds.js';

const generatedFields=new Set(['id','createdAt','text','characters','estimatedTokens','binding']);
const comparable=pack=>Object.fromEntries(Object.entries(pack).filter(([key])=>!generatedFields.has(key)));
const packContext=pack=>({...pack.options,binding:pack.binding,memoryTaskId:pack.memoryTask?.id||''});

function validateCandidate(state,candidate){
  requireThat(candidate?.memoryTask,'请先生成持续任务资料包');
  const errors=validatePack(state,candidate,packContext(candidate));
  requireThat(!errors.length,errors.join('；'),'round_stale');
  // Reuse the full snapshot validator without exposing it or mutating stored
  // rounds. prepareRound writes only these two fresh arrays in this probe.
  const probe={...state,rounds:[],events:[]};
  prepareRound(probe,candidate);
}

// Re-rendering a preview must not change the receipt identity of an unchanged
// delivered round. All source data and selection/options still compare exactly;
// only generated presentation fields and the temporary website binding differ.
export function reuseUnchangedRoundPack(state,roundId,candidate){
  validateRounds(state);
  const previous=roundById(state,roundId);
  requireThat(previous,'轮次不存在');
  try{
    validateCandidate(state,candidate);
    const restored=resumeRound(state,roundId).pack;
    if(equal(comparable(restored),comparable(candidate)))return restored;
  }catch{
    // The caller retains an invalid candidate for its normal diagnostics.
    // A stale/restricted original must never be revived merely by comparison.
  }
  return candidate;
}

// Called only for an explicit refresh/change-question action. A changed task
// base or question creates a new checkpoint and keeps the old one as abandoned
// history. Never relabel an AI reply or relax receipt identity validation.
export function refreshTaskRound(state,roundId,candidate,{expectedVersion}={}){
  const previous=roundById(state,roundId);
  requireThat(previous&&Number.isSafeInteger(expectedVersion)&&previous.version===expectedVersion,'轮次已改变，请重新载入','version_conflict');
  requireThat(['prepared','delivered'].includes(previous.status),'轮次已结束','round_closed');
  requireThat(candidate?.memoryTask?.id===previous.taskId&&candidate.memoryTask.libraryId===previous.libraryId,'更新资料必须属于同一任务与资料库','version_conflict');
  validateRounds(state);
  validateCandidate(state,candidate);
  const reused=reuseUnchangedRoundPack(state,roundId,candidate);
  if(reused!==candidate)return{round:clone(previous),pack:reused,reused:true,restarted:false};
  requireThat(candidate.id!==previous.packSnapshot.id,'更新资料必须使用新的资料包 ID','version_conflict');

  const staged=clone(state),next=clone(candidate);
  const restarted=next.memoryTask.version!==previous.baseVersion||next.task!==previous.question;
  let round;
  if(restarted){
    abandonRound(staged,roundId,{expectedVersion});
    round=prepareRound(staged,next);
  }else round=replaceRoundPack(staged,roundId,next,{expectedVersion});
  validateRounds(staged);
  Object.assign(state,staged);
  return{round:clone(round),pack:clone(next),reused:false,restarted};
}
