import {clone,equal,string,requireThat,isoDate,LIMITS} from './base.js';
import {supportedSites} from './sites.js';
import {validatePack} from './pack.js';
import {activeRound,resumeRound} from './rounds.js';

const identityKeys=['tabId','documentId','url','pageKey','conversation','temporary','adapter','adapterVersion'];
const contextKeys=['libraryIds','scope','asOf','includeDisputed','memoryTaskId'];
function exactKeys(value,keys,label){
  requireThat(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key)),`${label} 必须明确提供全部字段，不能包含额外字段`);
}
function contextFor(state,context){
  exactKeys(context,contextKeys,'资料范围');
  requireThat(Array.isArray(context.libraryIds)&&context.libraryIds.length>0&&new Set(context.libraryIds).size===context.libraryIds.length&&context.libraryIds.every(key=>typeof key==='string'&&state.libraries.some(library=>library.id===key)),'请明确选择存在且不重复的资料库');
  string(context.scope,'适用范围',1000,false);string(context.asOf,'适用日期',10,false);isoDate(context.asOf);
  requireThat(typeof context.includeDisputed==='boolean','请明确选择是否包含争议资料');string(context.memoryTaskId,'任务 ID',199,false);
  return{libraryIds:[...context.libraryIds].sort(),scope:context.scope,asOf:context.asOf,includeDisputed:context.includeDisputed,memoryTaskId:context.memoryTaskId};
}
function destination(identity){
  exactKeys(identity,identityKeys,'目标网页标识');
  requireThat(Number.isSafeInteger(identity.tabId)&&identity.tabId>=0,'目标标签页 ID 无效');
  for(const [key,max]of [['documentId',200],['pageKey',200],['conversation',4096],['adapter',50],['adapterVersion',50],['url',8192]])string(identity[key],`目标 ${key}`,max);
  requireThat(typeof identity.temporary==='boolean','目标会话类型无效');
  let url;try{url=new URL(identity.url);}catch{throw Error('目标网页 URL 无效');}
  const site=supportedSites.find(value=>value.origin===url.origin);
  requireThat(url.protocol==='https:'&&!url.username&&!url.password&&url.href===identity.url&&site,'目标必须是支持的 AI 网站 HTTPS 页面');
  requireThat(identity.adapter===site.name.toLowerCase(),'目标网页与适配器不一致');
  return clone(identity);
}
function withoutBinding(pack){const result=clone(pack);delete result.binding;return result;}
function checkedPack(state,packId,context){
  string(packId,'资料包 ID',199);const current=contextFor(state,context);
  const cached=state.packs.filter(pack=>pack.id===packId);requireThat(cached.length<=1,'缓存中存在重复资料包 ID');
  const matching=(state.rounds||[]).filter(round=>round.packSnapshot?.id===packId);
  requireThat(!matching.some(round=>['completed','abandoned'].includes(round.status)),'该资料包所属轮次已结束，请使用当前轮次','round_closed');
  const checkpoints=matching.filter(round=>['prepared','delivered'].includes(round.status));requireThat(checkpoints.length<=1,'存在重复轮次快照');
  let pack=cached[0];
  if(checkpoints.length){
    const restored=resumeRound(state,checkpoints[0].id,current).pack;
    // Retargeting may change a cache binding only. Never quietly replace an
    // inconsistent cache body with a checkpoint that happens to share its ID.
    if(pack)requireThat(equal(withoutBinding(pack),withoutBinding(restored)),'缓存资料包与轮次快照不一致，请重新查看轮次','version_conflict');
    else pack=restored;
  }
  requireThat(pack,'资料包不存在；若已清理，请重新准备本轮资料');
  requireThat(pack.id===packId&&typeof pack.text==='string'&&Number.isInteger(pack.maxChars)&&pack.maxChars>=128&&pack.maxChars<=LIMITS.packChars&&pack.characters===pack.text.length&&pack.characters<=pack.maxChars&&pack.estimatedTokens===Math.ceil(new TextEncoder().encode(pack.text).length/3),'资料包长度或预算校验失败');
  requireThat(equal(current.libraryIds,pack.options?.libraryIds)&&current.scope===pack.options?.scope&&current.asOf===pack.options?.asOf&&current.includeDisputed===pack.options?.includeDisputed&&current.memoryTaskId===(pack.memoryTask?.id||''),'资料库、任务、范围、日期或争议选项已改变，请重新核对资料包','version_conflict');
  const active=current.memoryTaskId?activeRound(state,current.memoryTaskId):null;
  requireThat(!active||active.packSnapshot.id===packId,'任务已有另一未结束轮次，请恢复该轮次或明确放弃后再继续','active_round_exists');
  const errors=validatePack(state,pack,{...current,binding:pack.binding});
  requireThat(!errors.length,errors.join('；'),'stale_pack');return clone(pack);
}

// The caller obtains this identity from an explicit, fresh target selection.
// No website is read here, and no permission or delivery claim is inferred.
export function retargetPack(state,packId,identity,context){
  const binding=destination(identity),pack=checkedPack(state,packId,context);pack.binding=binding;
  const stored=clone(pack),index=state.packs.findIndex(value=>value.id===packId);
  if(index>=0)state.packs[index]=stored;else{state.packs.push(stored);if(state.packs.length>100)state.packs.splice(0,state.packs.length-100);}
  return pack;
}

// Copying needs no live browser target. Leave any cache binding intact so a
// separate insertion operation is not redirected by a concurrent copy.
export function clipboardPack(state,packId,context){const pack=checkedPack(state,packId,context);pack.binding=null;return pack;}
