// Transport regression only: real product core with an in-memory Repository
// and local host doubles. This does not exercise browser DOM or IndexedDB.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Repository} from '../product/storage.js';
import {clone,freshState,hash} from '../product/core/base.js';
import {createLibrary,saveEntry} from '../product/core/library.js';
import {saveTask} from '../product/core/tasks.js';
import {buildPack,rememberPack} from '../product/core/pack.js';
import {prepareRound,markRoundDelivered} from '../product/core/rounds.js';

let imports=0;
async function fixture(run){
  const state=freshState(),library=createLibrary(state,'本地桥接原创测试库');
  const core=saveEntry(state,{libraryId:library.id,title:'原创核心',content:'检修区编号42',fields:{},evidenceKind:'user_asserted'},{confirm:true});
  const task=saveTask(state,{libraryId:library.id,name:'桥接测试任务',goal:'核对检修进度',coreEntryIds:[core.id]});
  const identity={tabId:1,documentId:'mock-document',url:'https://chatgpt.com/c/web-test-local',pageKey:'mock-key',conversation:'/c/web-test-local',temporary:false,adapter:'chatgpt',adapterVersion:'0.12.1'};
  const pack=buildPack(state,{task:'核对编号',libraryIds:[library.id],memoryTaskId:task.id,binding:clone(identity),maxChars:12000});rememberPack(state,pack);
  const prepared=prepareRound(state,pack),round=markRoundDelivered(state,prepared.id,{expectedVersion:prepared.version,deliveryKind:'draft'});
  const expected={taskId:task.id,baseVersion:task.version,packId:pack.id};
  const text='TEXT-MEMORY-UPDATE\n'+JSON.stringify({...expected,progress:'完成编号核对',openQuestions:'',facts:[]})+'\nEND-TEXT-MEMORY-UPDATE';
  let result={status:'reply_ready',...clone(identity),kind:'UPDATE',text,answerText:'编号是42。'};
  const calls=[],hooks={},snapshot=Repository.prototype.snapshot,mutate=Repository.prototype.mutate;
  const names=['window','location','localStorage','chrome','__tmWebBridge','__tmWebHost','__tmLocalFeedbackBridge','__TEXT_MEMORY_STANDALONE_TEST__'],prior=new Map(names.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  Repository.prototype.snapshot=async()=>clone(state);
  Repository.prototype.mutate=async action=>{const next=clone(state),value=action(next);Object.assign(state,next);return value;};
  const values={};
  const storage={getItem:key=>values[key]??null,setItem:(key,value)=>values[key]=String(value),removeItem:key=>delete values[key]};
  globalThis.window=globalThis;globalThis.location=new URL('http://127.0.0.1:8793/index.html');globalThis.localStorage=storage;globalThis.top=globalThis;
  delete globalThis.__tmWebBridge;
  globalThis.__tmWebHost={
    target:async()=>({status:'ready',...clone(identity),draft:pack.text,draftHash:await hash(pack.text)}),
    pageCall:async request=>{calls.push(clone(request));await hooks.page?.(request);return request.action==='send'?{status:'send_invoked',tabId:identity.tabId,documentId:identity.documentId,draftCleared:true}:clone(result);},
    authorizeFloating:token=>token==='a'.repeat(64),log(){},
  };
  try{
    await import('./bridge.js?test='+ ++imports);
    const send=message=>chrome.runtime.sendMessage(message),read=(patch={})=>send({type:'READ_LATEST_REPLY',identity:clone(identity),expected:clone(expected),...patch});
    assert.equal((await send({type:'BIND',identity:clone(identity),libraryIds:[library.id]})).status,'bound');
    await run({state,library,core,task,pack,round,expected,identity,text,calls,hooks,values,send,read,setResult:value=>result=value});
  }finally{
    Repository.prototype.snapshot=snapshot;Repository.prototype.mutate=mutate;
    for(const [key,descriptor] of prior)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];
    delete globalThis.top;
  }
}

test('bridge validates complete current memory receipt without mutating business data',()=>fixture(async f=>{
  const before=clone(f.state),result=await f.read();assert.equal(result.status,'reply_ready');assert.equal(result.text,f.text);assert.deepEqual(f.state,before);
  assert.ok(Object.keys(f.values).every(key=>key.startsWith('text-memory-web-test-0.12.1:')));
}));
test('bridge separates optional stable display from protocol and drops raw non-ready text',()=>fixture(async f=>{
  f.setResult({status:'waiting',...f.identity,text:'DO NOT LEAK',display:{text:'正常回答',phase:'stable',pairing:'user_pack',messageKey:'message-1'}});
  const hidden=await f.read();assert.equal(hidden.text,undefined);assert.equal(hidden.display,undefined);
  const shown=await f.read({includeDisplay:true});assert.equal(shown.text,undefined);assert.equal(shown.display.text,'正常回答');
}));
test('bridge display read rejects a core restriction changed during DOM read',()=>fixture(async f=>{
  f.setResult({status:'waiting',...f.identity,display:{text:'正常回答',phase:'stable',pairing:'user_pack',messageKey:'message-1'}});
  f.hooks.page=()=>{f.state.entries.find(row=>row.id===f.core.id).sensitivity='local_only';};
  const result=await f.read({includeDisplay:true});assert.equal(result.status,'stale_reply');assert.equal(result.display,undefined);
}));
test('bridge rejects a reply from another simulated document even if its protocol matches',()=>fixture(async f=>{
  f.setResult({status:'reply_ready',...f.identity,documentId:'other-document',kind:'UPDATE',text:f.text});
  const result=await f.read();assert.equal(result.status,'stale_target');assert.equal(result.text,undefined);
}));
test('bridge rejects old task version before reading the mock page',()=>fixture(async f=>{
  f.state.tasks[0].version++;const result=await f.read();assert.equal(result.status,'stale_reply');assert.equal(f.calls.length,0);
}));

test('bridge mirrors rejected diagnostic filtering and preserves malformed raw JSON only for opt-in recovery',()=>fixture(async f=>{
  const raw=f.text.replace('}\nEND-',',}\nEND-'),diagnostic={text:raw,phase:'stable',pairing:'user_pack',messageKey:'invalid-receipt'};
  f.setResult({status:'invalid_reply',reason:'invalid_json',...f.identity,diagnostic});
  assert.equal((await f.read()).diagnostic,undefined);const result=await f.read({includeDisplay:true});assert.equal(result.status,'invalid_reply');assert.equal(result.diagnostic.text,raw);assert.equal(result.text,undefined);assert.equal(result.display,undefined);assert.equal(f.state.tasks[0].version,1);
}));
test('bridge rejects stale identity, streaming, ambiguous and cross-document malformed diagnostics',async()=>{
  for(const change of ['task','pack','version','streaming','pairing','extra','multiple','document','prepared','changed-during-read'])await fixture(async f=>{
    let raw=f.text.replace('}\nEND-',',}\nEND-');if(change==='task')raw=raw.replace(f.expected.taskId,'other-task');if(change==='pack')raw=raw.replace(f.expected.packId,'other-pack');if(change==='version')raw=raw.replace('"baseVersion":1','"baseVersion":2');if(change==='multiple')raw+='\n'+raw;
    const diagnostic={text:raw,phase:change==='streaming'?'streaming':'stable',pairing:change==='pairing'?'protocol':'user_pack',messageKey:'rejected',...(change==='extra'?{unexpected:true}:{})};
    if(change==='prepared')f.state.rounds[0].status='prepared';if(change==='changed-during-read')f.hooks.page=()=>f.state.tasks[0].version++;
    f.setResult({status:'invalid_reply',reason:'invalid_json',...f.identity,...(change==='document'?{documentId:'wrong-document'}:{}),diagnostic});const result=await f.read({includeDisplay:true});assert.equal(result.diagnostic,undefined,change);assert.equal(result.text,undefined,change);
  });
});
test('bridge uses original chat store CAS and does not overwrite a winning concurrent save',()=>fixture(async f=>{
  const loaded=await f.send({type:'LOAD_CHAT_VIEW',payload:{taskId:f.task.id}});assert.equal(loaded.status,'loaded');assert.equal(loaded.view.revision,0);
  const payload={taskId:f.task.id,expectedRevision:0,question:'待发送输入',rows:[],flow:null,automaticMemory:true};
  const results=await Promise.all([f.send({type:'SAVE_CHAT_VIEW',payload}),f.send({type:'SAVE_CHAT_VIEW',payload:{...payload,question:'竞争输入'}})]);
  assert.deepEqual(results.map(row=>row.status),['saved','error']);
  assert.equal((await f.send({type:'LOAD_CHAT_VIEW',payload:{taskId:f.task.id}})).view.question,'待发送输入');
}));
test('bridge accepts real content send result with tab/document only and deduplicates next send',()=>fixture(async f=>{
  const message={type:'SEND_PACK',identity:f.identity,packId:f.pack.id,floatingToken:'a'.repeat(64)};
  const first=await f.send(message);assert.equal(first.status,'send_invoked');assert.equal(first.draftCleared,true);
  const second=await f.send(message);assert.equal(second.status,'send_invoked');assert.equal(second.duplicate,true);assert.equal(f.calls.filter(row=>row.action==='send').length,1);
}));
test('bridge refuses send without floating authorization and does not simulate restart evidence',()=>fixture(async f=>{
  assert.equal((await f.send({type:'SEND_PACK',identity:f.identity,packId:f.pack.id})).status,'error');
  assert.equal((await f.send({type:'SEND_PACK',identity:f.identity,packId:f.pack.id,floatingToken:'bad'})).status,'rejected');
  assert.equal((await f.send({type:'PREPARE_RESTART_CHECK'})).status,'unsupported');assert.equal(f.calls.length,0);
}));
