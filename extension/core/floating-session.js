import {supportedSites} from './sites.js';

// Capabilities are kept in trusted, browser-session storage only. This module
// deliberately has no repository, task, document-text, or webpage-write API.
export const FLOATING_SESSIONS_KEY='floatingSessionsV1';
export const FLOATING_RPC_TYPES=Object.freeze([
  'TARGET','BIND','INSERT','UNDO','READ_LATEST_REPLY','READ_SELECTION','PAUSE','OPEN_MANAGER',
  'SAVE_REPLY_DRAFT','LIST_REPLY_DRAFTS','CLAIM_REPLY_DRAFT','SETTLE_REPLY_DRAFT',
  'FLOATING_HELLO','CLOSE_FLOATING',
  'SEND_PACK','LOAD_CHAT_VIEW','SAVE_CHAT_VIEW',
]);
const allowedTypes=new Set(FLOATING_RPC_TYPES),allowedOrigins=new Set(supportedSites.map(site=>site.origin));
const recordKeys=['token','tabId','url','documentId','frameId','frameDocumentId'];
export const SENT_TRANSITION_WINDOW_MS=60000;
const newPaths={
  'chatgpt.com':['/'], 'chat.deepseek.com':['/','/a/chat'],
  'www.kimi.com':['/'], 'grok.com':['/'], 'claude.ai':['/','/new'],
  'www.qianwen.com':['/'], 'gemini.google.com':['/app'],
};
const conversationPaths={
  // Guest/mobile conversations use /uc/; the same send/document/echo gate
  // applies to both routes. This never permits arbitrary same-origin navigation.
  'chatgpt.com':/^\/(?:c|uc)\/[A-Za-z0-9_-]{1,200}$/,
  'chat.deepseek.com':/^\/a\/chat\/s\/[A-Za-z0-9_-]{1,200}$/,
  'www.kimi.com':/^\/chat\/[A-Za-z0-9_-]{1,200}$/,
  'grok.com':/^\/c\/[A-Za-z0-9_-]{1,200}$/,
  'claude.ai':/^\/chat\/[A-Za-z0-9_-]{1,200}$/,
  // Observed on the real Qianwen guest chat after a user-confirmed test send.
  'www.qianwen.com':/^\/chat\/[a-f0-9]{32}$/,
};
const maxRecords=128;
const copy=value=>structuredClone(value);
function fail(code,message){const error=Error(message);error.code=code;throw error;}
function check(condition,code,message){if(!condition)fail(code,message);}
function plain(value){return value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;}
function exact(value,keys,optional=[]){return plain(value)&&Object.keys(value).every(key=>keys.includes(key))&&keys.filter(key=>!optional.includes(key)).every(key=>Object.hasOwn(value,key));}
function tokenValid(value){return typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);}
function documentValid(value){return typeof value==='string'&&value.length>0&&value.length<=200&&value.trim()===value;}
function tabValid(value){return Number.isSafeInteger(value)&&value>=0;}
function urlValid(value){
  if(typeof value!=='string'||value.length>8192)return false;
  try{const parsed=new URL(value);return parsed.href===value&&!parsed.username&&!parsed.password&&allowedOrigins.has(parsed.origin);}catch{return false;}
}
export function isSupportedNewConversationUrl(value){
  if(!urlValid(value))return false;const url=new URL(value);
  return !url.search&&!url.hash&&newPaths[url.hostname]?.includes(url.pathname)===true;
}
function allowedTransition(from,to){
  if(!isSupportedNewConversationUrl(from)||!urlValid(to))return false;
  const previous=new URL(from),next=new URL(to);
  return previous.origin===next.origin&&!next.search&&!next.hash&&conversationPaths[next.hostname]?.test(next.pathname)===true;
}
function transitionValid(value,record){
  return exact(value,['fromUrl','attemptId','packId','expiresAt'])&&record.frameId!==null&&value.fromUrl===record.url&&isSupportedNewConversationUrl(value.fromUrl)
    &&typeof value.attemptId==='string'&&/^[A-Za-z0-9_-]{1,200}$/.test(value.attemptId)&&documentValid(value.packId)&&Number.isSafeInteger(value.expiresAt)&&value.expiresAt>0;
}
function recordValid(record){
  return exact(record,[...recordKeys,'sentTransition'],['sentTransition'])&&tokenValid(record.token)&&tabValid(record.tabId)&&urlValid(record.url)&&documentValid(record.documentId)
    &&(!Object.hasOwn(record,'sentTransition')||transitionValid(record.sentTransition,record))
    &&((record.frameId===null&&record.frameDocumentId===null)||(Number.isSafeInteger(record.frameId)&&record.frameId>0&&documentValid(record.frameDocumentId)));
}
function envelopeValid(envelope){
  return exact(envelope,['version','records'])&&envelope.version===1&&Array.isArray(envelope.records)&&envelope.records.length<=maxRecords
    &&envelope.records.every(recordValid)&&new Set(envelope.records.map(record=>record.tabId)).size===envelope.records.length
    &&new Set(envelope.records.map(record=>record.token)).size===envelope.records.length;
}
function newToken(){return Array.from(globalThis.crypto.getRandomValues(new Uint8Array(32)),value=>value.toString(16).padStart(2,'0')).join('');}

export function createFloatingSessions({sessionStorage,runtimeId,getActiveTab,verifyTopDocument,verifySentTransition,now=()=>Date.now()}){
  check(typeof sessionStorage?.get==='function'&&typeof sessionStorage?.set==='function'&&typeof getActiveTab==='function'&&typeof verifyTopDocument==='function','floating_configuration','浮窗授权接口未配置');
  check(typeof runtimeId==='string'&&/^[A-Za-z0-9_-]{1,200}$/.test(runtimeId),'floating_configuration','扩展标识无效');
  const origin='chrome-extension://'+runtimeId;
  let pending=Promise.resolve();
  const serial=action=>{const next=pending.catch(()=>{}).then(action);pending=next;return next;};
  async function read(){
    let response;
    try{response=await sessionStorage.get(FLOATING_SESSIONS_KEY);}catch{fail('floating_storage','无法读取浮窗授权，已停止操作');}
    check(plain(response),'floating_storage','浮窗授权存储不可读取，已停止操作');
    if(!Object.hasOwn(response,FLOATING_SESSIONS_KEY))return{version:1,records:[]};
    check(envelopeValid(response[FLOATING_SESSIONS_KEY]),'floating_storage','浮窗授权存储损坏，已停止操作且未覆盖原记录');
    return copy(response[FLOATING_SESSIONS_KEY]);
  }
  async function write(envelope){
    check(envelopeValid(envelope),'floating_storage','浮窗授权存储格式无效，已停止操作');
    try{await sessionStorage.set({[FLOATING_SESSIONS_KEY]:copy(envelope)});}catch{fail('floating_storage','无法保存浮窗授权，已停止操作');}
  }
  async function active(record){
    let tab;
    try{tab=await getActiveTab();}catch{fail('floating_stale','无法确认当前 AI 网页，请重新打开浮窗');}
    check(tab?.id===record.tabId&&tab.url===record.url&&urlValid(tab.url),'floating_stale','当前网页已切换，请在目标 AI 网页重新打开浮窗');
  }
  async function verify(record){
    await active(record);
    let valid=false;
    try{valid=await verifyTopDocument(copy(record));}catch{fail('floating_stale','无法确认原网页文档，请重新打开浮窗');}
    check(valid===true,'floating_stale','原网页已刷新或不再可访问，请重新打开浮窗');
    // A tab switch while executeScript is pending must not grant access.
    await active(record);
  }
  function matching(record,args){check(record&&record.token===args.token,'floating_identity','浮窗授权已更换，旧发送请求无效');}
  return{
    open:args=>serial(async()=>{
      check(exact(args,['tabId','url','documentId'])&&tabValid(args.tabId)&&urlValid(args.url)&&documentValid(args.documentId),'floating_request','浮窗目标网页无效');
      const envelope=await read(),record={token:newToken(),tabId:args.tabId,url:args.url,documentId:args.documentId,frameId:null,frameDocumentId:null};
      await verify(record);
      const oldIndex=envelope.records.findIndex(item=>item.tabId===record.tabId);
      check(oldIndex>=0||envelope.records.length<maxRecords,'floating_capacity','打开的浮窗过多，请先关闭不使用的浮窗');
      if(oldIndex>=0)envelope.records[oldIndex]=record;else envelope.records.push(record);
      await write(envelope);return copy(record);
    }),
    allowSentTransition:args=>serial(async()=>{
      check(exact(args,['tabId','token','fromUrl','documentId','attemptId','packId'])&&tabValid(args.tabId)&&tokenValid(args.token)&&urlValid(args.fromUrl)&&documentValid(args.documentId)&&documentValid(args.packId)
        &&typeof args.attemptId==='string'&&/^[A-Za-z0-9_-]{1,200}$/.test(args.attemptId),'floating_request','发送后会话延续请求无效');
      const envelope=await read(),record=envelope.records.find(item=>item.tabId===args.tabId);matching(record,args);
      check(record.frameId!==null&&record.url===args.fromUrl&&record.documentId===args.documentId,'floating_identity','发送目标与已连接的浮窗文档不一致');
      await verify(record);if(!isSupportedNewConversationUrl(record.url))return null;
      const at=now();check(Number.isSafeInteger(at)&&at>0,'floating_configuration','发送许可时钟无效');
      if(record.sentTransition&&record.sentTransition.expiresAt>at){
        check(record.sentTransition.attemptId===args.attemptId&&record.sentTransition.packId===args.packId,'floating_transition_pending','上次发送的会话切换仍待确认，请稍后重试');
        return copy(record.sentTransition);
      }
      record.sentTransition={fromUrl:record.url,attemptId:args.attemptId,packId:args.packId,expiresAt:at+SENT_TRANSITION_WINDOW_MS};
      await write(envelope);return copy(record.sentTransition);
    }),
    clearSentTransition:args=>serial(async()=>{
      check(exact(args,['tabId','token','attemptId'])&&tabValid(args.tabId)&&tokenValid(args.token)&&typeof args.attemptId==='string'&&/^[A-Za-z0-9_-]{1,200}$/.test(args.attemptId),'floating_request','撤销发送许可请求无效');
      const envelope=await read(),record=envelope.records.find(item=>item.tabId===args.tabId);matching(record,args);
      if(!record.sentTransition)return null;
      check(record.sentTransition.attemptId===args.attemptId,'floating_identity','旧发送请求不能撤销新的会话延续许可');
      const removed=copy(record.sentTransition);delete record.sentTransition;await write(envelope);return removed;
    }),
    close:args=>serial(async()=>{
      check(exact(args,['tabId','token'],['token'])&&tabValid(args.tabId)&&(args.token===undefined||tokenValid(args.token)),'floating_request','关闭浮窗请求无效');
      const envelope=await read(),record=envelope.records.find(item=>item.tabId===args.tabId);
      if(!record)return null;
      check(args.token===undefined||args.token===record.token,'floating_identity','浮窗授权已更换，旧请求不能关闭新浮窗');
      envelope.records=envelope.records.filter(item=>item.tabId!==args.tabId);
      await write(envelope);return copy(record);
    }),
    authorize:(message,sender,{hello=false}={})=>serial(async()=>{
      check(plain(message)&&allowedTypes.has(message.type),'floating_command','浮窗不支持此操作');
      check(hello===true?message.type==='FLOATING_HELLO':message.type!=='FLOATING_HELLO','floating_command','浮窗握手状态无效');
      // There is intentionally no missing-origin fallback. Only browser-issued
      // extension-origin iframe senders may claim a capability, never page DOM.
      check(sender?.id===runtimeId&&sender.origin===origin&&tokenValid(message.floatingToken)
        &&sender.url===origin+'/floating.html?token='+message.floatingToken
        &&Number.isSafeInteger(sender.frameId)&&sender.frameId>0&&documentValid(sender.documentId)&&tabValid(sender.tab?.id),
      'floating_identity','浮窗来源或文档身份无效');
      const envelope=await read(),record=envelope.records.find(item=>item.tabId===sender.tab.id);
      check(record&&record.token===message.floatingToken,'floating_identity','浮窗授权已过期，请重新打开浮窗');
      if(record.frameId!==null)check(record.frameId===sender.frameId&&record.frameDocumentId===sender.documentId,'floating_identity','此浮窗授权已绑定另一文档');
      else check(hello===true,'floating_identity','浮窗尚未完成握手');
      let activeTab;try{activeTab=await getActiveTab();}catch{fail('floating_stale','无法确认当前 AI 网页，请重新打开浮窗');}
      if(activeTab?.id===record.tabId&&activeTab.url!==record.url){
        const allowance=record.sentTransition;
        check(record.frameId!==null&&allowance&&allowance.expiresAt>now()&&allowedTransition(record.url,activeTab.url),'floating_stale','网页已离开本次发送允许的新会话路径，请重新打开浮窗');
        check(!Object.hasOwn(sender.tab,'url')||sender.tab.url===record.url||sender.tab.url===activeTab.url,'floating_identity','浮窗所在网页与发送许可不一致');
        const next={...record,url:activeTab.url};delete next.sentTransition;
        await verify(next);
        let confirmed=false;try{confirmed=typeof verifySentTransition==='function'&&await verifySentTransition(copy(record),activeTab.url);}catch{/* Unknown page evidence is never treated as a successful send. */}
        check(confirmed===true,'floating_transition_pending','新会话尚未确认本次资料包的用户消息回显，请稍候重新检查');
        await verify(next);check(allowance.expiresAt>now(),'floating_stale','本次发送的会话延续许可已到期，请重新打开浮窗');
        Object.assign(record,next);delete record.sentTransition;await write(envelope);await verify(record);
      }else{
        check(!Object.hasOwn(sender.tab,'url')||sender.tab.url===record.url,'floating_identity','浮窗所在网页与授权不一致');
        await verify(record);
      }
      if(record.frameId===null){
        record.frameId=sender.frameId;record.frameDocumentId=sender.documentId;
        await write(envelope);
        await verify(record);
      }
      return copy(record);
    }),
  };
}
