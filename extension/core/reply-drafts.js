import {clone,equal,id,now,requireThat,string} from './base.js';
import {taskById} from './tasks.js';
import {activeRound,roundById,resumeRound} from './rounds.js';
import {validateInboxReply} from './reply-inbox.js';

export const REPLY_DRAFTS_KEY='replyDraftsV1';
export const REPLY_DRAFT_LIMITS={records:32,bytes:2*1024*1024,text:100000};
const methods=['latest_reply_read','selection_read','manual_edit','unknown'];
const recordKeys=['id','revision','writerId','context','text','method','status','createdAt','updatedAt'];
const contextKeys=['taskId','libraryId','baseVersion','roundId','packId'];
const bytes=value=>new TextEncoder().encode(JSON.stringify(value)).length;

function shape(value,keys,label,{optional=[]}={}){
  requireThat(value&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype,`${label}必须是对象`);
  requireThat(Object.keys(value).every(key=>keys.includes(key))&&keys.filter(key=>!optional.includes(key)).every(key=>Object.hasOwn(value,key)),`${label}字段缺失或不受支持`);
}
function positive(value,label){requireThat(Number.isSafeInteger(value)&&value>=1,`${label}必须是正整数`);}
function contextShape(context){
  shape(context,contextKeys,'草稿上下文');
  string(context.taskId,'任务 ID',199);string(context.libraryId,'资料库 ID',199);positive(context.baseVersion,'任务基础版本');
  const absent=value=>value===null||value==='';
  if(absent(context.roundId)||absent(context.packId))requireThat(absent(context.roundId)&&absent(context.packId),'轮次与资料包必须同时指定或同时留空');
  else{string(context.roundId,'轮次 ID',199);string(context.packId,'资料包 ID',199);}
}
function recordShape(record){
  shape(record,recordKeys,'接收草稿');string(record.id,'草稿 ID',199);string(record.writerId,'草稿写者 ID',199);positive(record.revision,'草稿版本');contextShape(record.context);
  string(record.text,'接收原文',REPLY_DRAFT_LIMITS.text,false);requireThat(methods.includes(record.method),'草稿来源方式无效');requireThat(['pending','cleared','processed'].includes(record.status),'草稿状态无效');
  for(const key of ['createdAt','updatedAt'])requireThat(typeof record[key]==='string'&&record[key].length<=40&&!Number.isNaN(Date.parse(record[key]))&&new Date(record[key]).toISOString()===record[key],'草稿时间无效');
  requireThat(record.createdAt<=record.updatedAt,'草稿更新时间早于创建时间');
}
function envelopeShape(envelope){
  shape(envelope,['version','records'],'接收草稿存储');requireThat(envelope.version===1,'接收草稿存储版本不受支持');
  requireThat(Array.isArray(envelope.records)&&envelope.records.length<=REPLY_DRAFT_LIMITS.records,'接收草稿记录数量无效');
  envelope.records.forEach(recordShape);requireThat(new Set(envelope.records.map(record=>record.id)).size===envelope.records.length,'接收草稿 ID 重复');
  requireThat(bytes(envelope)<=REPLY_DRAFT_LIMITS.bytes,'接收草稿存储超过大小上限');
}
function taskContext(state,context){
  const task=taskById(state,context.taskId);
  requireThat(task&&task.libraryId===context.libraryId&&state.libraries.some(library=>library.id===context.libraryId),'草稿所属任务或资料库不存在、不匹配','draft_context');
  return task;
}
function eligible(state,record){
  const stale=message=>({record:clone(record),eligibility:'stale',message});
  if(record.status!=='pending')return stale(record.status==='processed'?'这份原文已标记为已处理，仅供查看。':'这份原文已明确清空，仅供查看。');
  const context=record.context;let task;
  try{task=taskContext(state,context);}catch(error){return stale(error.message+'；原文保留，仅供查看。');}
  const round=activeRound(state,context.taskId);
  if(task.version!==context.baseVersion||!context.roundId||!context.packId||!round||round.id!==context.roundId||round.baseVersion!==context.baseVersion||round.packSnapshot.id!==context.packId)return stale('原任务版本、轮次或资料包已不再是当前状态；原文保留，仅供查看。');
  try{resumeRound(state,round.id);}catch(error){return stale('当前资料包的来源、权限或完整性校验未通过：'+error.message+'；原文保留，仅供查看。');}
  try{
    validateInboxReply(state,context.taskId,record.text,round.packSnapshot.options);
    return{record:clone(record),eligibility:'current',message:'原文与当前任务、轮次及资料包匹配。恢复后仍须重新预览并由用户确认。'};
  }catch(error){return{record:clone(record),eligibility:'invalid',message:'原文已保存，但尚不能作为当前回执预览：'+error.message};}
}
function matching(envelope,{recordId,expectedRevision,writerId},sameWriter=true){
  string(recordId,'草稿 ID',199);positive(expectedRevision,'草稿预期版本');string(writerId,'草稿写者 ID',199);
  const record=envelope.records.find(record=>record.id===recordId);
  requireThat(record&&record.revision===expectedRevision&&(!sameWriter||record.writerId===writerId),'草稿已由其他面板修改、接管或整理，请重新读取；当前原文不会被覆盖','draft_conflict');
  return record;
}
function fit(envelope){
  // Only terminal records may make room. Build the full next value first, so
  // rejection or a failed storage write cannot remove an older pending draft.
  const candidates=envelope.records.filter(record=>record.status!=='pending').sort((a,b)=>a.updatedAt.localeCompare(b.updatedAt)||a.id.localeCompare(b.id));
  while(envelope.records.length>REPLY_DRAFT_LIMITS.records||bytes(envelope)>REPLY_DRAFT_LIMITS.bytes){
    const victim=candidates.shift();requireThat(victim,'接收草稿已满（最多 32 份、2 MiB）；未确认原文不会被淘汰，请先明确处理或清空旧稿','draft_capacity');
    envelope.records=envelope.records.filter(record=>record.id!==victim.id);
  }
}

export function createReplyDraftStore({local,repository}){
  requireThat(typeof local?.get==='function'&&typeof local?.set==='function'&&typeof repository?.snapshot==='function','缺少本地草稿存储或资料库读取接口');
  let pending=Promise.resolve();
  const serial=action=>{const next=pending.catch(()=>{}).then(action);pending=next;return next;};
  const read=async()=>{
    const response=await local.get(REPLY_DRAFTS_KEY);
    requireThat(response&&typeof response==='object'&&!Array.isArray(response),'读取接收草稿失败，未覆盖已有存储','draft_corrupt');
    if(!Object.hasOwn(response,REPLY_DRAFTS_KEY))return{version:1,records:[]};
    try{const value=clone(response[REPLY_DRAFTS_KEY]);envelopeShape(value);return value;}
    catch{const error=Error('接收草稿存储损坏或版本不受支持，已停止覆盖；请保留原存储以便恢复');error.code='draft_corrupt';throw error;}
  };
  const persist=async(envelope,record)=>{envelopeShape(envelope);await local.set({[REPLY_DRAFTS_KEY]:envelope});return clone(record);};
  return{
    save:args=>serial(async()=>{
      shape(args,['writerId','recordId','expectedRevision','context','text','method'],'保存草稿请求',{optional:['recordId','expectedRevision']});
      const {writerId,recordId,context,text,method}=args,expectedRevision=args.expectedRevision===undefined?0:args.expectedRevision;
      string(writerId,'草稿写者 ID',199);contextShape(context);string(text,'接收原文',REPLY_DRAFT_LIMITS.text,false);requireThat(methods.includes(method),'草稿来源方式无效');
      const envelope=await read(),state=await repository.snapshot();taskContext(state,context);
      const previous=recordId===undefined?null:matching(envelope,{recordId,expectedRevision,writerId});
      if(!previous)requireThat(expectedRevision===0,'新草稿预期版本必须为 0','draft_conflict');
      else requireThat(equal(previous.context,context),'已有草稿不能切换上下文，请为新的任务轮次建立新草稿','draft_context');
      const at=now(),record={id:previous?.id||id('reply_draft'),revision:(previous?.revision||0)+1,writerId,context:clone(context),text,method,status:'pending',createdAt:previous?.createdAt||at,updatedAt:at};
      if(previous)envelope.records[envelope.records.indexOf(previous)]=record;else envelope.records.push(record);
      fit(envelope);return persist(envelope,record);
    }),
    list:args=>serial(async()=>{
      shape(args,['taskId'],'读取草稿请求');string(args.taskId,'任务 ID',199);
      const envelope=await read(),state=await repository.snapshot();
      return envelope.records.filter(record=>record.context.taskId===args.taskId).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||a.id.localeCompare(b.id)).map(record=>eligible(state,record));
    }),
    claim:args=>serial(async()=>{
      shape(args,['recordId','expectedRevision','writerId'],'接管草稿请求');
      const envelope=await read(),previous=matching(envelope,args,false),record={...previous,writerId:args.writerId,revision:previous.revision+1,updatedAt:now()};
      envelope.records[envelope.records.indexOf(previous)]=record;return persist(envelope,record);
    }),
    settle:args=>serial(async()=>{
      shape(args,['recordId','expectedRevision','writerId','status'],'处理草稿请求');requireThat(['cleared','processed'].includes(args.status),'只能明确清空或标记已处理');
      const envelope=await read(),previous=matching(envelope,args);
      if(args.status==='processed'){
        const state=await repository.snapshot(),context=previous.context,task=taskContext(state,context),round=context.roundId?roundById(state,context.roundId):null,current=activeRound(state,context.taskId);
        requireThat(round&&round.taskId===context.taskId&&round.libraryId===context.libraryId&&round.baseVersion===context.baseVersion&&context.packId&&current?.packSnapshot.id!==context.packId&&(
          round.status==='completed'&&round.packSnapshot.id===context.packId&&task.version>context.baseVersion||
          ['prepared','delivered','completed'].includes(round.status)&&round.packSnapshot.id!==context.packId&&round.version>1
        ),'此草稿的轮次尚未完成或补充换包，不能标记为已处理；原文已保留','draft_unprocessed');
      }
      const record={...previous,status:args.status,revision:previous.revision+1,updatedAt:now()};envelope.records[envelope.records.indexOf(previous)]=record;return persist(envelope,record);
    }),
  };
}
