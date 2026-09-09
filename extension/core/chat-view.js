import {clone,equal,requireThat,string,now} from './base.js';
import {supportedSites} from './sites.js';

export const CHAT_VIEW_KEY='chatViewsV1';
export const CHAT_VIEW_LIMITS={views:64,totalBytes:4*1024*1024,viewBytes:512*1024,rows:80,text:100000,question:4000};
const bytes=value=>new TextEncoder().encode(JSON.stringify(value)).length;
const statuses=['prepared','sending','waiting','reply_visible','uncertain','not_sent','review','complete','blocked'];
function shape(value,keys,label,{optional=[]}={}){requireThat(value&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype&&Object.keys(value).every(key=>keys.includes(key))&&keys.filter(key=>!optional.includes(key)).every(key=>Object.hasOwn(value,key)),label+'字段缺失或不受支持');}
function timestamp(value,label){requireThat(typeof value==='string'&&value.length<41&&!Number.isNaN(Date.parse(value))&&new Date(value).toISOString()===value,label+'时间无效');}
function rowShape(row){shape(row,['packId','role','text','at'],'聊天显示记录');string(row.packId,'显示记录资料包 ID',199);requireThat(['user','assistant'].includes(row.role),'聊天显示身份无效');string(row.text,'聊天显示正文',CHAT_VIEW_LIMITS.text,false);timestamp(row.at,'聊天记录');}
function flowShape(flow){
  if(flow===null)return;shape(flow,['packId','roundId','baseVersion','question','rootPackId','searches','status','attemptId','destinationOrigin'],'聊天处理状态',{optional:['destinationOrigin']});
  for(const key of ['packId','roundId','rootPackId'])string(flow[key],'聊天 '+key,199);
  requireThat(Number.isSafeInteger(flow.baseVersion)&&flow.baseVersion>0,'聊天基础版本无效');string(flow.question,'聊天问题',CHAT_VIEW_LIMITS.question);requireThat(Number.isInteger(flow.searches)&&flow.searches>=0&&flow.searches<=2,'自动补充资料最多两次');requireThat(statuses.includes(flow.status),'聊天发送状态无效');requireThat(flow.attemptId===null||typeof flow.attemptId==='string'&&flow.attemptId.length>0&&flow.attemptId.length<=199,'聊天发送尝试标识无效');
  requireThat(flow.destinationOrigin===undefined||flow.destinationOrigin===null||supportedSites.some(site=>site.origin===flow.destinationOrigin),'聊天发送目标站点无效');
}
function viewShape(view,{empty=false}={}){
  shape(view,['taskId','revision','question','rows','flow','automaticMemory','updatedAt'],'聊天视图');string(view.taskId,'聊天任务 ID',199);requireThat(Number.isSafeInteger(view.revision)&&view.revision>=(empty?0:1),'聊天视图版本无效');string(view.question,'未发送输入',CHAT_VIEW_LIMITS.question,false);
  requireThat(Array.isArray(view.rows)&&view.rows.length<=CHAT_VIEW_LIMITS.rows,'聊天显示记录超限');view.rows.forEach(rowShape);requireThat(new Set(view.rows.map(row=>row.role+'/'+row.packId)).size===view.rows.length,'聊天显示记录重复');flowShape(view.flow);requireThat(typeof view.automaticMemory==='boolean','自动记忆设置无效');if(empty&&view.updatedAt===null){}else timestamp(view.updatedAt,'聊天视图');requireThat(bytes(view)<=CHAT_VIEW_LIMITS.viewBytes,'当前聊天显示记录超出本地容量，请清理显示历史；任务记忆不受影响');
}
export function emptyChatView(taskId){return{taskId,revision:0,question:'',rows:[],flow:null,automaticMemory:false,updatedAt:null};}
// Keep a finite display history. Never discard the unsent question or active
// sending state; neither is reconstructed from or confused with the transcript.
export function appendChatRow(view,row){
  row=clone(row);rowShape(row);const next=clone(view),index=next.rows.findIndex(item=>item.packId===row.packId&&item.role===row.role);
  if(index>=0){requireThat(next.rows[index].text===row.text,'同一回复标识出现不同正文，已保留原显示记录');return next;}
  next.rows.push(clone(row));const protectedIds=new Set([row.packId,next.flow?.packId,next.flow?.rootPackId]);
  while(next.rows.length>CHAT_VIEW_LIMITS.rows||bytes(next)>CHAT_VIEW_LIMITS.viewBytes){const oldest=next.rows.findIndex(item=>!protectedIds.has(item.packId));requireThat(oldest>=0,'当前回复超过显示记录容量，原文仍可在网页和接收记录中查看');next.rows.splice(oldest,1);}
  return next;
}
// Only the active, unfinished assistant answer is replaceable while the website
// streams or appends its memory receipt. Older answers and user messages remain
// append-only through appendChatRow; seeing an answer never completes a task.
export function upsertAssistantDisplay(view,row){
  row=clone(row);rowShape(row);
  requireThat(row.role==='assistant'&&view.flow?.packId===row.packId&&view.flow.status!=='complete','只能更新当前未完成问题的回答显示');
  const existing=view.rows.find(item=>item.packId===row.packId&&item.role==='assistant');
  if(!row.text.trim()){const next=clone(view);next.rows=next.rows.filter(item=>item.packId!==row.packId||item.role!=='assistant');return next;}
  if(existing?.text===row.text)return clone(view);
  if(!existing)return appendChatRow(view,row);
  const next=clone(view);next.rows=next.rows.filter(item=>item.packId!==row.packId||item.role!=='assistant');
  return appendChatRow(next,{...row,at:existing.at});
}
export function createChatViewStore({local,repository}){
  requireThat(typeof local?.get==='function'&&typeof local?.set==='function'&&typeof repository?.snapshot==='function','缺少聊天视图存储');let queued=Promise.resolve();
  const serial=action=>{const result=queued.catch(()=>{}).then(action);queued=result;return result;};
  const taskExists=async taskId=>{string(taskId,'聊天任务 ID',199);const state=await repository.snapshot();requireThat(state.tasks.some(task=>task.id===taskId),'聊天任务已不存在');};
  const read=async()=>{const stored=await local.get(CHAT_VIEW_KEY);if(!Object.hasOwn(stored,CHAT_VIEW_KEY))return{version:1,views:[]};const value=clone(stored[CHAT_VIEW_KEY]);
    try{shape(value,['version','views'],'聊天视图存储');requireThat(value.version===1&&Array.isArray(value.views)&&value.views.length<=CHAT_VIEW_LIMITS.views,'聊天视图存储版本或数量无效');value.views.forEach(view=>viewShape(view));requireThat(new Set(value.views.map(view=>view.taskId)).size===value.views.length&&bytes(value)<=CHAT_VIEW_LIMITS.totalBytes,'聊天视图存储重复或超限');return value;}
    catch{throw Error('本地聊天显示存储损坏，已停止覆盖；任务记忆和接收原文保持原样');}
  };
  return{
    load:args=>serial(async()=>{shape(args,['taskId'],'读取聊天视图');await taskExists(args.taskId);const stored=await read();return clone(stored.views.find(view=>view.taskId===args.taskId)||emptyChatView(args.taskId));}),
    save:args=>serial(async()=>{
      shape(args,['taskId','expectedRevision','question','rows','flow','automaticMemory'],'保存聊天视图');requireThat(Number.isSafeInteger(args.expectedRevision)&&args.expectedRevision>=0,'聊天预期版本无效');await taskExists(args.taskId);const stored=await read(),index=stored.views.findIndex(view=>view.taskId===args.taskId),previous=index<0?emptyChatView(args.taskId):stored.views[index];requireThat(previous.revision===args.expectedRevision,'聊天视图已由其他浮窗更新，当前输入仍保留；请先核对其他浮窗再重载','chat_conflict');
      const next={taskId:args.taskId,revision:previous.revision+1,question:args.question,rows:clone(args.rows),flow:clone(args.flow),automaticMemory:args.automaticMemory,updatedAt:now()};viewShape(next);if(index<0)stored.views.push(next);else stored.views[index]=next;
      while(stored.views.length>CHAT_VIEW_LIMITS.views||bytes(stored)>CHAT_VIEW_LIMITS.totalBytes){const disposable=stored.views.filter(view=>view.taskId!==next.taskId&&!view.question&&!view.rows.length&&(!view.flow||view.flow.status==='complete')).sort((a,b)=>a.updatedAt.localeCompare(b.updatedAt))[0];requireThat(disposable,'本地聊天显示存储已满，未删除未发送输入或发送状态；请在旧任务设置中清理显示历史');stored.views=stored.views.filter(view=>view!==disposable);}
      await local.set({[CHAT_VIEW_KEY]:stored});return clone(next);
    }),
  };
}
