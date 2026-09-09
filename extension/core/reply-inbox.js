import {clone,equal,hash,requireThat,stable,string} from './base.js';
import {parseMemoryProtocol} from './protocol.js';
import {prepareMemoryUpdate} from './memory-updates.js';
import {executeMemorySearch} from './memory-requests.js';
import {activeRound,resumeRound,validateRoundUpdate} from './rounds.js';

const validated=new WeakMap();
export const REPLY_INBOX_LIMITS={text:100000,context:12000,fingerprints:256};

// This module never applies an update, records a fact, changes a round, or sends
// a message. The returned update preview still needs the existing explicit
// confirmation flow, whose apply step rechecks the task and round versions.
export function validateInboxReply(state,taskId,text,options){
  string(text,'网页记忆回执',REPLY_INBOX_LIMITS.text);
  const starts=[...text.matchAll(/^[ \t]*(TEXT-MEMORY-(?:UPDATE|SEARCH))[ \t]*\r?$/gm)];
  const ends=[...text.matchAll(/^[ \t]*END-(TEXT-MEMORY-(?:UPDATE|SEARCH))[ \t]*\r?$/gm)];
  requireThat(starts.length===1&&ends.length===1&&starts[0][1]===ends[0][1],'请提供恰好一个完整的记忆更新或检索回执，不能混合多个协议区段','ambiguous_reply');
  const marker=starts[0][1],kind=marker==='TEXT-MEMORY-UPDATE'?'update':'search';
  const payload=parseMemoryProtocol(text,marker,'网页记忆回执'),round=activeRound(state,taskId);
  let preview;
  if(kind==='update'){
    requireThat(round,'网页更新必须关联当前已交付轮次；请先成功复制或加入任务资料包','round_required');
    preview=prepareMemoryUpdate(state,taskId,text);
    validateRoundUpdate(state,round.id,{expectedVersion:round.version,taskId:preview.taskId,baseVersion:preview.baseVersion,packId:preview.packId});
  }else{
    // SEARCH keeps the existing prepared-round/cache-only policy, while a
    // present round must also have an intact independently persisted snapshot.
    if(round)resumeRound(state,round.id);
    preview=executeMemorySearch(state,taskId,text,options);
  }
  // Keep JSON string data from becoming apparent standalone protocol lines
  // under JavaScript multiline matching. Escaping preserves the exact payload.
  const json=JSON.stringify(payload).replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
  const protocolText=`${marker}\n${json}\nEND-${marker}`;
  string(protocolText,'规范化网页回执',REPLY_INBOX_LIMITS.text);
  const reply={kind,taskId:preview.taskId,baseVersion:preview.baseVersion,packId:preview.packId,
    roundId:round?.id??null,roundVersion:round?.version??null,text:protocolText,preview};
  validated.set(reply,{value:clone(reply),canonical:stable({kind,payload})});
  return reply;
}

// One controller belongs to one open panel. Its state is volatile and bounded;
// reset is explicit so a late asynchronous read cannot restore an old context.
export function createReplyInbox({capacity=64}={}){
  requireThat(Number.isInteger(capacity)&&capacity>=1&&capacity<=REPLY_INBOX_LIMITS.fingerprints,'回执去重容量必须为 1—256 的整数');
  let currentContext=null,generation=0;
  const seen=new Set();
  const key=context=>string(context,'回执上下文',REPLY_INBOX_LIMITS.context);
  return{
    reset(context){
      const next=key(context);if(next===currentContext)return false;
      currentContext=next;generation++;seen.clear();return true;
    },
    async offer(reply,{context,currentText}={}){
      const expectedContext=key(context),ticket=generation,original=validated.get(reply);
      requireThat(original&&equal(reply,original.value),'回执未通过验证或预览已改变，请重新读取','version_conflict');
      const readText=()=>string(typeof currentText==='function'?currentText():currentText,'尚未处理的回执文本',REPLY_INBOX_LIMITS.text,false);
      readText();
      if(currentContext!==expectedContext)return{accepted:false,reason:'context_changed',fingerprint:null};
      const fingerprint=await hash(original.canonical);
      if(generation!==ticket||currentContext!==expectedContext)return{accepted:false,reason:'context_changed',fingerprint};
      if(!equal(reply,original.value))return{accepted:false,reason:'preview_changed',fingerprint};
      if(seen.has(fingerprint))return{accepted:false,reason:'duplicate',fingerprint};
      if(readText().trim())return{accepted:false,reason:'manual_pending',fingerprint};
      if(seen.size>=capacity)return{accepted:false,reason:'saturated',fingerprint};
      seen.add(fingerprint);return{accepted:true,reason:'accepted',fingerprint};
    },
  };
}
