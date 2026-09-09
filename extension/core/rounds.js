import {clone,id,now,string,requireThat,equal,stable,LIMITS} from './base.js';
import {event} from './library.js';
import {taskById} from './tasks.js';
import {validatePack} from './pack.js';
import {validateSourceExtractionShape} from './source-extraction.js';

export const ROUND_LIMITS={count:200,snapshotBytes:1024*1024,totalBytes:8*1024*1024};
const activeStatuses=new Set(['prepared','delivered']);
const roundKeys=['id','taskId','libraryId','baseVersion','question','packSnapshot','packChecksum','status','version','deliveryKind','createdAt','updatedAt','deliveredAt','completedAt','abandonedAt'];
const packKeys=['id','createdAt','task','options','binding','maxChars','included','excluded','selectedIds','pinnedIds','retrieved','text','stale','blocked','budgetMethod','memoryTask','characters','estimatedTokens','taskProtocolVersion','sourceExtraction'];
const taskKeys=['id','libraryId','name','goal','constraints','progress','openQuestions','coreEntryIds','version','createdAt','updatedAt'];
const bytes=value=>new TextEncoder().encode(JSON.stringify(value)).length;
function shape(value,keys,label,{optional=[]}={}){
  requireThat(value&&typeof value==='object'&&!Array.isArray(value),`${label} 必须是对象`);
  requireThat(Object.keys(value).every(key=>keys.includes(key))&&keys.filter(key=>!optional.includes(key)).every(key=>Object.hasOwn(value,key)),`${label} 存在缺失或不支持的字段`);
}
function safeJSON(value,depth=0){
  requireThat(depth<=12,'轮次快照嵌套过深');
  if(value&&typeof value==='object')for(const [key,item]of Object.entries(value)){
    requireThat(!['__proto__','prototype','constructor'].includes(key),'轮次快照包含保留字段');safeJSON(item,depth+1);
  }
  else requireThat(value===null||['string','boolean','undefined'].includes(typeof value)||typeof value==='number'&&Number.isFinite(value),'轮次快照不是有效 JSON 数据');
}
function ids(value,label,max=LIMITS.entries){requireThat(Array.isArray(value)&&value.length<=max&&value.every(item=>typeof item==='string'&&item.length>0&&item.length<200)&&new Set(value).size===value.length,`${label} 必须是有界且去重的 ID 数组`);}
function timestamp(value,label,{nullable=false}={}){requireThat(nullable&&value===null||typeof value==='string'&&value.length<=40&&!Number.isNaN(Date.parse(value))&&new Date(value).toISOString()===value,`${label} 无效`);}
// A synchronous checksum keeps transaction callbacks synchronous. It detects
// accidental corruption; it is explicitly not a signature or proof of origin.
export function roundPackChecksum(pack){
  const text=stable(JSON.parse(JSON.stringify(pack)));let value=0x811c9dc5;
  for(let i=0;i<text.length;i++)value=Math.imul(value^text.charCodeAt(i),0x01000193)>>>0;
  return value.toString(16).padStart(8,'0');
}
export function roundById(state,roundId){return state.rounds?.find(round=>round.id===roundId)||null;}
export function activeRound(state,taskId){return state.rounds?.find(round=>round.taskId===taskId&&activeStatuses.has(round.status))||null;}

function validateSnapshot(pack){
  safeJSON(pack);shape(pack,packKeys,'轮次资料包',{optional:['taskProtocolVersion','sourceExtraction']});shape(pack.options,['libraryIds','scope','asOf','includeDisputed'],'轮次资料范围');shape(pack.memoryTask,taskKeys,'轮次任务快照');
  requireThat([undefined,1,2,3].includes(pack.taskProtocolVersion),'轮次任务协议版本无效');
  if(Object.hasOwn(pack,'sourceExtraction')){
    validateSourceExtractionShape(pack.sourceExtraction);
    requireThat(pack.taskProtocolVersion===3&&pack.sourceExtraction.libraryId===pack.memoryTask.libraryId,'轮次提炼来源与任务资料库或协议不一致');
    requireThat(typeof pack.text==='string'&&pack.text.includes(JSON.stringify(pack.sourceExtraction,null,2)),'轮次提炼原文快照与正文不一致');
  }else requireThat(pack.taskProtocolVersion!==3,'轮次提炼资料包缺少原文片段');
  string(pack.id,'轮次资料包 ID',199);timestamp(pack.createdAt,'轮次资料包创建时间');string(pack.task,'轮次问题',4000,false);
  ids(pack.options.libraryIds,'轮次资料库');requireThat(pack.options.libraryIds.length>0,'轮次资料范围不能为空');
  string(pack.options.scope,'轮次适用范围',1000,false);string(pack.options.asOf,'轮次日期',10,false);requireThat(typeof pack.options.includeDisputed==='boolean','轮次争议选项无效');
  if(pack.binding!==null){shape(pack.binding,['tabId','documentId','url','pageKey','conversation','temporary','adapter','adapterVersion'],'轮次网页绑定',{optional:['documentId','pageKey','conversation','temporary','adapter','adapterVersion']});}
  requireThat(Number.isInteger(pack.maxChars)&&pack.maxChars>=128&&pack.maxChars<=LIMITS.packChars,'轮次预算无效');
  string(pack.text,'轮次资料包正文',LIMITS.packChars);
  requireThat(pack.stale===false&&pack.blocked===false&&pack.characters===pack.text.length&&pack.characters<=pack.maxChars&&pack.estimatedTokens===Math.ceil(new TextEncoder().encode(pack.text).length/3),'轮次资料包状态、长度或预算无效');
  string(pack.budgetMethod,'轮次预算方法',500);
  ids(pack.selectedIds,'轮次选择');ids(pack.pinnedIds,'轮次固定选择');requireThat(pack.pinnedIds.every(key=>pack.selectedIds.includes(key)),'轮次固定条目未选中');
  requireThat(Array.isArray(pack.included)&&Array.isArray(pack.excluded)&&pack.included.length<=LIMITS.entries&&pack.excluded.length<=LIMITS.entries*2,'轮次条目数量无效');
  for(const item of pack.included){
    shape(item,['id','version','libraryId','fields','block','sourceRefs','sensitivity','constraint'],'轮次已包含条目');
    string(item.id,'轮次条目 ID',199);string(item.libraryId,'轮次条目资料库',199);requireThat(Number.isSafeInteger(item.version)&&item.version>=1&&item.sensitivity==='normal','轮次条目版本或分类无效');
    string(item.block,'轮次条目正文',LIMITS.packChars);string(item.constraint,'轮次条目约束',LIMITS.packChars,false);
    requireThat(item.fields&&typeof item.fields==='object'&&!Array.isArray(item.fields)&&Array.isArray(item.sourceRefs)&&item.sourceRefs.length<=100,'轮次条目字段或来源无效');
    requireThat(pack.selectedIds.includes(item.id)&&pack.options.libraryIds.includes(item.libraryId)&&pack.text.includes(item.block),'轮次条目选择、资料范围或正文不一致');
  }
  requireThat(new Set(pack.included.map(item=>item.id)).size===pack.included.length,'轮次包含重复条目');
  for(const item of pack.excluded){shape(item,['id','version','reason'],'轮次排除条目');string(item.id,'排除条目 ID',199);requireThat(item.version===null||Number.isSafeInteger(item.version)&&item.version>=1,'轮次排除版本无效');string(item.reason,'轮次排除原因',100);}
  if(pack.retrieved!==null){
    shape(pack.retrieved,['query','options','hits','excluded','method','coverage'],'轮次检索结果');
    requireThat(Array.isArray(pack.retrieved.hits)&&Array.isArray(pack.retrieved.excluded),'轮次检索结果列表无效');
    for(const item of pack.retrieved.hits)shape(item,['id','version','score','reasons'],'轮次检索命中');
    for(const item of pack.retrieved.excluded)shape(item,['id','reason'],'轮次检索排除');
  }
  requireThat(bytes(pack)<=ROUND_LIMITS.snapshotBytes,'单轮快照超过 1 MB 上限');
}
function baseTask(state,round){
  const snapshot=state.taskVersions?.find(task=>task.taskId===round.taskId&&task.version===round.baseVersion);
  if(!snapshot)return null;
  const task={...clone(snapshot),id:snapshot.taskId};delete task.taskId;return task;
}
function validateRound(state,round){
  shape(round,roundKeys,'轮次');validateSnapshot(round.packSnapshot);
  for(const field of ['id','taskId','libraryId'])string(round[field],`轮次 ${field}`,199);
  requireThat(Number.isSafeInteger(round.baseVersion)&&round.baseVersion>=1&&Number.isSafeInteger(round.version)&&round.version>=1,'轮次版本无效');
  requireThat(['prepared','delivered','completed','abandoned'].includes(round.status),'轮次状态无效');
  requireThat(round.question===round.packSnapshot.task&&round.taskId===round.packSnapshot.memoryTask.id&&round.libraryId===round.packSnapshot.memoryTask.libraryId&&round.baseVersion===round.packSnapshot.memoryTask.version,'轮次与资料包任务不一致');
  requireThat(round.packChecksum===roundPackChecksum(round.packSnapshot),'轮次资料包校验和不匹配');
  const task=taskById(state,round.taskId),base=baseTask(state,round);
  requireThat(task&&task.libraryId===round.libraryId&&task.version>=round.baseVersion&&base&&equal(base,round.packSnapshot.memoryTask),'轮次任务或历史快照缺失、不一致');
  for(const field of ['createdAt','updatedAt'])timestamp(round[field],`轮次 ${field}`);
  for(const field of ['deliveredAt','completedAt','abandonedAt'])timestamp(round[field],`轮次 ${field}`,{nullable:true});
  requireThat(round.createdAt<=round.updatedAt&&[round.deliveredAt,round.completedAt,round.abandonedAt].filter(Boolean).every(at=>at>=round.createdAt&&at<=round.updatedAt),'轮次时间顺序无效');
  requireThat(round.deliveryKind===null||['clipboard','draft'].includes(round.deliveryKind),'轮次交付类型无效');
  requireThat((round.deliveryKind===null)===(round.deliveredAt===null),'轮次交付时间与类型不一致');
  if(round.status==='prepared')requireThat(round.deliveredAt===null&&round.completedAt===null&&round.abandonedAt===null,'未交付轮次状态不一致');
  if(round.status==='delivered')requireThat(round.version>=2&&round.deliveredAt!==null&&round.completedAt===null&&round.abandonedAt===null,'已交付轮次状态不一致');
  if(round.status==='completed')requireThat(round.version>=3&&round.deliveredAt!==null&&round.completedAt!==null&&round.abandonedAt===null&&task.version>round.baseVersion,'已完成轮次状态不一致');
  if(round.status==='abandoned')requireThat(round.version>=2&&round.abandonedAt!==null&&round.completedAt===null,'已放弃轮次状态不一致');
}
function budget(rounds){requireThat(rounds.length<=ROUND_LIMITS.count,'轮次数量达到 200 条上限，请先导出备份并整理已结束轮次');requireThat(bytes(rounds)<=ROUND_LIMITS.totalBytes,'轮次快照合计超过 8 MB 上限，请先导出备份并整理已结束轮次');}
export function validateRounds(state){
  requireThat(Array.isArray(state.rounds),'缺少 rounds 表');budget(state.rounds);
  const active=new Set();for(const round of state.rounds){validateRound(state,round);if(activeStatuses.has(round.status)){requireThat(!active.has(round.taskId),'同一任务存在多个未结束轮次');active.add(round.taskId);}}
}
function currentPack(state,round,context){
  validateRound(state,round);requireThat(activeStatuses.has(round.status),'轮次已结束，请查看记录或准备新轮次','round_closed');
  const pack=round.packSnapshot,options=context||{...pack.options,memoryTaskId:round.taskId};
  requireThat(options.memoryTaskId===undefined||options.memoryTaskId===round.taskId,'轮次已过期，当前任务选择不一致','round_stale');
  requireThat(options.includeDisputed===undefined||options.includeDisputed===pack.options.includeDisputed,'轮次已过期，争议资料选项已改变','round_stale');
  const errors=validatePack(state,pack,{...options,binding:pack.binding,memoryTaskId:round.taskId});
  requireThat(!errors.length,'轮次已过期，仍可查看或放弃：'+errors.join('；'),'round_stale');return pack;
}
export function prepareRound(state,pack){
  requireThat(pack?.memoryTask,'请先生成持续任务资料包');validateSnapshot(pack);
  const errors=validatePack(state,pack,{...pack.options,binding:pack.binding,memoryTaskId:pack.memoryTask.id});
  requireThat(!errors.length,errors.join('；'),'round_stale');
  requireThat(!activeRound(state,pack.memoryTask.id),'该任务已有未结束轮次，请恢复或明确放弃后再准备','active_round_exists');
  const at=now(),round={id:id('round'),taskId:pack.memoryTask.id,libraryId:pack.memoryTask.libraryId,baseVersion:pack.memoryTask.version,question:pack.task,
    packSnapshot:clone(pack),packChecksum:roundPackChecksum(pack),status:'prepared',version:1,deliveryKind:null,createdAt:at,updatedAt:at,deliveredAt:null,completedAt:null,abandonedAt:null};
  validateRound(state,round);budget([...(state.rounds||[]),round]);state.rounds??=[];state.rounds.push(round);event(state,'round_prepared',round.id);return round;
}
export function resumeRound(state,roundId,context){const round=roundById(state,roundId);requireThat(round,'轮次不存在');const original=currentPack(state,round,context),pack=clone(original);pack.binding=null;return{round:clone(round),pack};}
function expected(state,roundId,expectedVersion){const round=roundById(state,roundId);requireThat(round&&Number.isSafeInteger(expectedVersion)&&round.version===expectedVersion,'轮次已改变，请重新载入','version_conflict');requireThat(activeStatuses.has(round.status),'轮次已结束','round_closed');return round;}
function replace(state,previous,next,type){validateRound(state,next);budget(state.rounds.map(round=>round===previous?next:round));state.rounds[state.rounds.indexOf(previous)]=next;event(state,type,next.id);return next;}
function invalidateCachedPacks(state,packIds){const ids=new Set(packIds);for(const pack of state.packs||[])if(ids.has(pack.id))pack.stale=true;}
export function markRoundDelivered(state,roundId,{expectedVersion,deliveryKind}={}){
  const previous=expected(state,roundId,expectedVersion);currentPack(state,previous);
  requireThat(['clipboard','draft'].includes(deliveryKind),'交付类型只能为 clipboard 或 draft；不代表已发送');
  // Repeating the same successful delivery does not change the receipt or
  // invalidate an already prepared update. CAS and pack validity still apply.
  if(previous.status==='delivered'&&previous.deliveryKind===deliveryKind)return previous;
  const at=now();return replace(state,previous,{...clone(previous),status:'delivered',version:previous.version+1,deliveryKind,deliveredAt:previous.deliveredAt||at,updatedAt:at},'round_delivered');
}
export function replaceRoundPack(state,roundId,pack,{expectedVersion}={}){
  const previous=expected(state,roundId,expectedVersion);validateRound(state,previous);validateSnapshot(pack);
  requireThat(pack.memoryTask.id===previous.taskId&&pack.memoryTask.version===previous.baseVersion&&pack.task===previous.question,'补充资料包必须属于同一任务、基础版本和原始问题','version_conflict');
  requireThat(pack.id!==previous.packSnapshot.id,'替换轮次资料必须使用新的资料包 ID','version_conflict');
  const errors=validatePack(state,pack,{...pack.options,binding:pack.binding,memoryTaskId:previous.taskId});requireThat(!errors.length,errors.join('；'),'round_stale');
  const updated=replace(state,previous,{...clone(previous),packSnapshot:clone(pack),packChecksum:roundPackChecksum(pack),status:'prepared',version:previous.version+1,deliveryKind:null,deliveredAt:null,updatedAt:now()},'round_pack_replaced');
  invalidateCachedPacks(state,[previous.packSnapshot.id]);return updated;
}
function updateIdentity(state,roundId,{expectedVersion,taskId,baseVersion,packId}={}){
  const round=expected(state,roundId,expectedVersion);requireThat(round.status==='delivered','请先成功复制或加入草稿，再确认该轮更新','round_not_delivered');
  requireThat(taskId===round.taskId&&baseVersion===round.baseVersion,'更新不属于该轮任务或基础版本','version_conflict');
  requireThat(typeof packId==='string'&&packId===round.packSnapshot.id,'更新缺少当前资料包 ID，或属于已放弃、替换的旧资料包，请使用当前包重新生成回复','version_conflict');return round;
}
export function validateRoundUpdate(state,roundId,options){const round=updateIdentity(state,roundId,options);currentPack(state,round);return clone(round);}
export function completeRound(state,roundId,options){
  const previous=updateIdentity(state,roundId,options),task=taskById(state,previous.taskId),base=baseTask(state,previous);
  requireThat(task?.version===previous.baseVersion+1&&equal(base,previous.packSnapshot.memoryTask),'任务更新版本与该轮基础版本不一致','version_conflict');
  const unchanged=value=>Object.fromEntries(Object.entries(value).filter(([key])=>!['progress','openQuestions','version','updatedAt'].includes(key)));
  requireThat(equal(unchanged(task),unchanged(base)),'该轮更新改变了任务目标、约束或核心选择','version_conflict');
  const shadow={...state,tasks:state.tasks.map(value=>value.id===base.id?base:value)};currentPack(shadow,previous);
  const at=now();return replace(state,previous,{...clone(previous),status:'completed',version:previous.version+1,completedAt:at,updatedAt:at},'round_completed');
}
export function abandonRound(state,roundId,{expectedVersion}={}){
  const previous=expected(state,roundId,expectedVersion),at=now(),abandoned=replace(state,previous,{...clone(previous),status:'abandoned',version:previous.version+1,abandonedAt:at,updatedAt:at},'round_abandoned');
  invalidateCachedPacks(state,[previous.packSnapshot.id]);return abandoned;
}

export function closedRoundsPreview(state,taskId){
  requireThat(taskById(state,taskId),'任务不存在');
  return{taskId,rounds:(state.rounds||[]).filter(r=>r.taskId===taskId&&!activeStatuses.has(r.status)).map(r=>({id:r.id,version:r.version})).sort((a,b)=>a.id.localeCompare(b.id))};
}
export function clearClosedRounds(state,preview){
  requireThat(preview&&equal(preview,closedRoundsPreview(state,preview.taskId)),'轮次记录在预检后改变，请重新查看','version_conflict');
  const ids=new Set(preview.rounds.map(r=>r.id));invalidateCachedPacks(state,state.rounds.filter(round=>ids.has(round.id)).map(round=>round.packSnapshot.id));state.rounds=state.rounds.filter(r=>!ids.has(r.id));
  if(ids.size)event(state,'closed_rounds_cleared',preview.taskId);return ids.size;
}
