import {clone,id,now,requireThat} from './base.js';

// Durable before-click receipts survive worker and browser restarts. They hold
// identity and a digest only, never the user's prompt or a memory pack body.
export const SEND_LEDGER_KEY='sendLedgerV1';
const statuses=new Set(['pending','send_invoked','send_uncertain','not_sent']);
const text=value=>typeof value==='string'&&value.length>0&&value.length<=200;
const origin=value=>{try{const url=new URL(value);return url.protocol==='https:'?url.origin:null;}catch{return null;}};
const shape=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
function valid(record){return shape(record,['packId','taskId','attemptId','tabId','documentId','url','draftHash','status','at','draftCleared'])&&[record.packId,record.taskId,record.at,record.attemptId,record.documentId].every(text)&&Number.isSafeInteger(record.tabId)&&record.tabId>=0&&typeof record.url==='string'&&record.url.length<=8192&&/^https:\/\//.test(record.url)&&/^[a-f0-9]{64}$/.test(record.draftHash)&&statuses.has(record.status)&&typeof record.draftCleared==='boolean'&&Number.isFinite(Date.parse(record.at));}
export function createSendLedger({local}){
  let tail=Promise.resolve();
  const serial=action=>{const next=tail.catch(()=>{}).then(action);tail=next;return next;};
  async function read(){
    let value;try{const result=await local.get(SEND_LEDGER_KEY);value=result[SEND_LEDGER_KEY];}catch{throw Error('无法读取发送记录，未点击发送');}
    if(value===undefined)return{version:1,records:[]};
    requireThat(shape(value,['version','records'])&&value.version===1&&Array.isArray(value.records)&&value.records.length<=1000&&value.records.every(row=>valid(row)&&origin(row.url))&&new Set(value.records.map(row=>row.packId+'@'+origin(row.url))).size===value.records.length,'发送记录损坏，已停止，未覆盖原记录');return clone(value);
  }
  async function write(value){try{await local.set({[SEND_LEDGER_KEY]:clone(value)});}catch{throw Error('无法保存发送记录，已停止；不要重复发送，请先核对原网页');}}
  return{
    lookup:({packId,url})=>serial(async()=>{requireThat(text(packId)&&origin(url),'资料包或发送目标无效');return clone((await read()).records.find(row=>row.packId===packId&&origin(row.url)===origin(url))||null);}),
    begin:args=>serial(async()=>{
      const {packId,taskId,identity,draftHash}=args;
      requireThat(text(packId)&&text(taskId)&&identity&&text(identity.documentId)&&Number.isSafeInteger(identity.tabId)&&identity.tabId>=0&&typeof identity.url==='string'&&identity.url.length<=8192&&/^https:\/\//.test(identity.url)&&typeof draftHash==='string'&&/^[a-f0-9]{64}$/.test(draftHash),'发送身份无效');
      requireThat(origin(identity.url),'发送网站无效');
      const envelope=await read(),old=envelope.records.find(row=>row.packId===packId&&origin(row.url)===origin(identity.url));
      if(old&&old.status!=='not_sent')return{attempt:clone(old),duplicate:true};
      // Discard only IDs absent from both retained rounds and cached packs.
      // A valid current pack is always retained by the background caller.
      if(Array.isArray(args.retainedPackIds)&&args.retainedPackIds.includes(packId))envelope.records=envelope.records.filter(row=>args.retainedPackIds.includes(row.packId));
      const attempt={packId,taskId,attemptId:id('send'),tabId:identity.tabId,documentId:identity.documentId,url:identity.url,draftHash,status:'pending',at:now(),draftCleared:false};
      const index=envelope.records.findIndex(row=>row.packId===packId&&origin(row.url)===origin(identity.url));
      requireThat(index>=0||envelope.records.length<1000,'发送记录已满，请先整理已备份的旧轮次');
      if(index>=0)envelope.records[index]=attempt;else envelope.records.push(attempt);
      await write(envelope);return{attempt:clone(attempt),duplicate:false};
    }),
    finish:args=>serial(async()=>{
      requireThat(text(args.packId)&&text(args.attemptId)&&['send_invoked','send_uncertain','not_sent'].includes(args.status),'发送结果无效');
      const envelope=await read(),attempt=envelope.records.find(row=>row.packId===args.packId&&row.attemptId===args.attemptId);
      requireThat(attempt?.attemptId===args.attemptId,'发送记录已改变，请核对原网页');
      if(attempt.status!=='pending')return clone(attempt);
      attempt.status=args.status;attempt.draftCleared=args.draftCleared===true;await write(envelope);return clone(attempt);
    }),
  };
}
