import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

// Executes the actual local host controller with bounded DOM, shell and timer
// doubles. This is not a browser, extension, IndexedDB or model acceptance run.
const source=await readFile(new URL('./host.js',import.meta.url),'utf8');
class Element{
  constructor(){this.children=[];this.listeners={};this.attributes={};this.textContent='';this.value='valid';this.hidden=false;this.disabled=false;this.classList={toggle:(key,value)=>{this[key]=value;},contains:key=>this[key]===true};}
  addEventListener(type,callback){this.listeners[type]=callback;}
  setAttribute(name,value){this.attributes[name]=value;}
  append(...nodes){for(const node of nodes){node.parent=this;this.children.push(node);}}
  get firstChild(){return this.children[0];}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(node=>node!==this);}
  replaceChildren(...nodes){this.children=[];this.append(...nodes);}
}
async function fixture(){
  const nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);};
  const calls={mounts:[],checks:[],conditionalCloses:[],closes:[],pageCalls:[],faultWrites:[],waits:0},hooks={},timers=[];
  let current=null;
  const frame={attributes:{},hasAttribute(name){return Object.hasOwn(this.attributes,name);},setAttribute(name,value){calls.faultWrites.push({name,value});this.attributes[name]=value;}};
  const localDocument={querySelector(selector){assert.equal(selector,'[data-text-memory-floating]');return{shadowRoot:{querySelector(selector){assert.equal(selector,'iframe');return frame;}}};}};frame.ownerDocument=localDocument;
  const shell={
    open(config){calls.mounts.push(structuredClone(config));current={token:config.token,ready:false};frame.src=config.url;frame.attributes={};return hooks.mountResult||{status:'mounted'};},
    check(token){calls.checks.push(token);hooks.check?.(token,current);if(current?.token===token&&current.unavailable)return{status:'unavailable',reason:'frame_srcdoc_changed',message:'浮窗内容被覆盖，保留故障卡'};return{status:!current||current.token!==token?'not_found':current.ready?'ready':'loading'};},
    close(token){calls.closes.push(token);if(current?.token!==token)return{status:'not_found'};current=null;return{status:'closed'};},
    closeIfLoading(token){calls.conditionalCloses.push(token);hooks.cleanup?.(token,current);if(current?.token!==token)return{status:'not_found'};if(current.unavailable)return{status:'unavailable',reason:'frame_srcdoc_changed',message:'浮窗内容被覆盖，保留故障卡'};if(current.ready)return{status:'ready'};current=null;return{status:'closed'};},
  };
  const site={shell,setScenario(){},execute:async request=>{calls.pageCalls.push(structuredClone(request));assert.equal(request.action,'snapshot','opening must never send, insert or undo');if(hooks.requireVisible&&node('mockFrame').hidden)return{status:'unsupported',message:'Hidden frame fixture'};return{status:'ready',url:'https://chatgpt.com/c/web-test-local',draft:'保留的原网页草稿',draftHash:'fixture-hash'};}};
  node('mockFrame').hidden=true;node('mockFrame').src='http://127.0.0.1:8800/web/mock-site.html';node('mockFrame').contentWindow={__tmMockSite:site,location:{href:node('mockFrame').src}};node('mockFrame').contentDocument=localDocument;
  const context={location:{origin:'http://127.0.0.1:8800'},document:{getElementById:node,createElement:()=>new Element(),createTextNode:text=>({textContent:text}),documentElement:{style:{setProperty:(key,value)=>{calls[key]=value;}}}},crypto:globalThis.crypto,structuredClone,URL,Date,
    setTimeout(callback,ms){assert.equal(ms,400);calls.waits++;timers.push(callback);return calls.waits;}};
  vm.createContext(context);vm.runInContext(source,context);await new Promise(setImmediate);
  return{api:context.__tmWebHost,node,calls,hooks,timers,frame,get current(){return current;},replace:value=>{current=value;},
    async tick(){await new Promise(setImmediate);assert.ok(timers.length,'Expected one bounded loading delay');const callback=timers.shift();callback();await new Promise(setImmediate);}};
}

test('sidebar preview keeps the mock target visible alongside its separate right panel',async()=>{
  const f=await fixture();f.hooks.requireVisible=true;
  assert.equal((await f.api.target()).status,'unsupported','the visibility-sensitive double rejects the initially hidden frame');
  f.node('sidebarView').listeners.click();
  assert.equal(f.node('mockFrame').hidden,false);assert.equal(f.node('managerFrame').hidden,false);
  assert.equal(f.node('stage').classList.contains('sidebar-preview'),true);assert.equal(f.node('managerFrame').src,'./product/sidepanel.html');
  assert.equal(f.node('manageView').attributes['aria-pressed'],'false');assert.equal(f.node('sidebarView').attributes['aria-pressed'],'true');
  assert.equal((await f.api.target()).status,'ready');assert.equal(f.calls.mounts.length,0);
  assert.ok(f.calls.pageCalls.every(call=>call.action==='snapshot'),'layout preview does not send or insert');
});

test('ordinary manager and mock/floating views leave the sidebar split layout without leaking visibility',async()=>{
  const f=await fixture();f.node('sidebarView').listeners.click();f.node('manageView').listeners.click();
  assert.equal(f.node('managerFrame').src,'./product/manager.html');assert.equal(f.node('managerFrame').hidden,false);assert.equal(f.node('mockFrame').hidden,true);
  assert.equal(f.node('stage').classList.contains('sidebar-preview'),false);assert.equal(f.node('managerFrame').classList.contains('sidebar-preview'),false);
  f.node('sidebarView').listeners.click();f.node('mockView').listeners.click();
  assert.equal(f.node('mockFrame').hidden,false);assert.equal(f.node('managerFrame').hidden,true);assert.equal(f.node('stage').classList.contains('sidebar-preview'),false);assert.equal(f.node('sidebarView').attributes['aria-pressed'],'false');
  f.node('sidebarView').listeners.click();f.hooks.check=(_token,current)=>{if(current)current.ready=true;};await f.api.openFloating();
  assert.equal(f.node('mockFrame').hidden,false);assert.equal(f.node('managerFrame').hidden,true);assert.equal(f.node('stage').classList.contains('sidebar-preview'),false);
});

test('sidebar width control and split CSS use one width budget for the right panel and remaining mock viewport',async()=>{
  const f=await fixture();f.node('sidebarView').listeners.click();
  for(const width of ['280','320','390','400']){f.node('sidebarWidth').value=width;f.node('sidebarWidth').listeners.change();assert.equal(f.calls['--preview-width'],width+'px');}
  const css=await readFile(new URL('./host.css',import.meta.url),'utf8');
  assert.match(css,/#stage #managerFrame\.sidebar-preview\{width:min\(var\(--preview-width,390px\),100%\);left:auto;right:0/);
  assert.match(css,/#stage\.sidebar-preview #mockFrame\{left:0;right:min\(var\(--preview-width,390px\),100%\);width:calc\(100% - min\(var\(--preview-width,390px\),100%\)\)/);
});

test('host reports mounted separately and resolves opened only after the frame is ready',async()=>{
  const f=await fixture();let finished=false;const pending=f.api.openFloating().then(result=>{finished=true;return result;});await new Promise(setImmediate);
  assert.equal(finished,false);assert.equal(f.calls.mounts.length,1);assert.match(f.node('hostStatus').textContent,/等待本地浮窗完成加载/);assert.equal(f.api.records.some(record=>record.status==='ready'),false);assert.equal(f.api.authorizeFloating(f.current.token),true,'the loading frame must be allowed to handshake');
  f.current.ready=true;await f.tick();const result=await pending;assert.equal(result.status,'opened');assert.equal(finished,true);assert.equal(result.floating.token,f.current.token);assert.equal(f.api.records.at(-1).status,'ready');assert.match(f.node('hostStatus').textContent,/本地浮窗已加载/);assert.equal(f.calls.conditionalCloses.length,0);assert.equal(f.calls.pageCalls.length,1);
});

test('host rejects duplicate opening while the first frame is loading and reuses a ready frame',async()=>{
  const f=await fixture(),pending=f.api.openFloating();await new Promise(setImmediate);assert.equal((await f.api.openFloating()).status,'busy');assert.equal(f.calls.mounts.length,1);
  f.current.ready=true;await f.tick();const first=await pending,second=await f.api.openFloating();assert.equal(second.status,'opened');assert.equal(second.floating.token,first.floating.token);assert.equal(f.calls.mounts.length,1);
});

test('host timeout removes its own still-loading shell, clears authorization and never retries or sends',async()=>{
  const f=await fixture(),pending=f.api.openFloating();let failure;const settled=pending.catch(error=>{failure=error;});
  for(let attempt=0;attempt<40;attempt++)await f.tick();await settled;
  assert.match(failure.message,/尚未完成加载/);assert.match(failure.message,/已关闭未加载的空白窗口/);assert.equal(f.current,null);assert.equal(f.api.floating,null);assert.equal(f.api.authorizeFloating(f.calls.mounts[0].token),false);assert.equal(f.calls.waits,40);assert.equal(f.calls.mounts.length,1);assert.equal(f.calls.conditionalCloses.length,1);assert.equal(f.calls.pageCalls.length,1);assert.equal(f.node('hostStatus').error,true);assert.equal(f.api.records.some(record=>record.status==='ready'),false);
});

test('host preserves readiness arriving at the timeout boundary',async()=>{
  const f=await fixture();f.hooks.cleanup=()=>{f.current.ready=true;};const pending=f.api.openFloating();
  for(let attempt=0;attempt<40;attempt++)await f.tick();const result=await pending;assert.equal(result.status,'opened');assert.equal(f.current.ready,true);assert.equal(f.api.floating.token,result.floating.token);assert.equal(f.api.authorizeFloating(result.floating.token),true);assert.equal(f.calls.closes.length,0);
});

test('host cannot remove another shell when its old opening request expires',async()=>{
  const f=await fixture(),replacement='e'.repeat(64);f.hooks.cleanup=()=>f.replace({token:replacement,ready:false});let failure;
  const settled=f.api.openFloating().catch(error=>{failure=error;});for(let attempt=0;attempt<40;attempt++)await f.tick();await settled;
  assert.equal(f.current.token,replacement);assert.doesNotMatch(failure.message,/已关闭未加载的空白窗口/);assert.equal(f.calls.closes.length,0);assert.equal(f.api.floating,null);assert.equal(f.api.authorizeFloating(replacement),false,'an unknown replacement must not inherit local authorization');
});

test('host stops after the user closes a loading frame and allows a later explicit reopen',async()=>{
  const f=await fixture();let failure;const settled=f.api.openFloating().catch(error=>{failure=error;});await new Promise(setImmediate);const token=f.current.token;
  assert.equal((await f.api.closeFloating(token)).status,'closed');await f.tick();await settled;assert.match(failure.message,/更换或关闭/);assert.equal(f.current,null);assert.equal(f.calls.mounts.length,1);
  f.hooks.check=(_token,current)=>{if(current)current.ready=true;};const reopened=await f.api.openFloating();assert.equal(reopened.status,'opened');assert.notEqual(reopened.floating.token,token);assert.equal(f.calls.mounts.length,2);
});

test('host mount failure clears only that attempt without claiming ready or touching the mock draft',async()=>{
  const f=await fixture();f.hooks.mountResult={status:'not_found',message:'模拟挂载失败'};await assert.rejects(f.api.openFloating(),/模拟挂载失败/);assert.equal(f.current,null);assert.equal(f.api.floating,null);assert.equal(f.calls.waits,0);assert.equal(f.calls.mounts.length,1);assert.equal(f.calls.pageCalls.length,1);assert.equal(f.api.records.some(record=>record.status==='ready'),false);assert.match(f.node('hostStatus').textContent,/模拟挂载失败/);
});

test('host preserves an unavailable shell and its reason during startup without authorizing it',async()=>{
  const f=await fixture();f.hooks.check=(_token,current)=>{if(current)current.unavailable=true;};
  await assert.rejects(f.api.openFloating(),/保留故障卡/);
  const original=f.current.token;assert.equal(f.api.floating.token,original);assert.equal(f.api.authorizeFloating(original),false);assert.equal(f.calls.closes.length,0);assert.equal(f.calls.conditionalCloses.length,1);assert.equal(f.calls.mounts.length,1);assert.equal(f.api.records.at(-1).reason,'frame_srcdoc_changed');
  f.hooks.check=(_token,current)=>{if(current)current.ready=true;};
  const reopened=await f.api.openFloating();assert.equal(reopened.status,'opened');assert.notEqual(reopened.floating.token,original);assert.equal(f.calls.mounts.length,2);assert.equal(f.calls.pageCalls.length,2);
});

test('host timeout preserves a failure card appearing at the cleanup boundary',async()=>{
  const f=await fixture();f.hooks.cleanup=()=>{f.current.unavailable=true;};let failure;
  const settled=f.api.openFloating().catch(error=>{failure=error;});for(let attempt=0;attempt<40;attempt++)await f.tick();await settled;
  assert.match(failure.message,/保留故障卡/);assert.equal(f.api.floating.token,f.current.token);assert.equal(f.api.authorizeFloating(f.current.token),false);assert.equal(f.calls.closes.length,0);assert.equal(f.api.records.at(-1).reason,'frame_srcdoc_changed');assert.equal(f.calls.mounts.length,1);
});

test('local blank simulation writes srcdoc once to its own ready frame and never repairs or sends',async()=>{
  const f=await fixture();f.hooks.check=(_token,current)=>{if(current)current.ready=true;};await f.api.openFloating();
  const result=await f.api.simulateBlankFloating();assert.equal(result.status,'injected');assert.deepEqual(f.calls.faultWrites,[{name:'srcdoc',value:''}]);assert.equal(f.frame.attributes.srcdoc,'');assert.equal(f.calls.mounts.length,1);assert.equal(f.calls.closes.length,0);assert.equal(f.calls.pageCalls.length,1);assert.equal(f.api.records.at(-1).touchesDraft,false);
  await assert.rejects(f.api.simulateBlankFloating(),/未修改页面/);assert.equal(f.calls.faultWrites.length,1);assert.equal(f.frame.attributes.srcdoc,'');
});

test('local blank simulation refuses a missing, remote, navigated, wrong-token or foreign-document frame',async()=>{
  const empty=await fixture();await assert.rejects(empty.api.simulateBlankFloating(),/先打开/);assert.equal(empty.calls.faultWrites.length,0);
  for(const alter of [
    f=>{f.node('mockFrame').src='https://chatgpt.com/web/mock-site.html';},
    f=>{f.node('mockFrame').contentWindow.location.href='http://127.0.0.1:8800/other.html';},
    f=>{f.frame.src=f.frame.src.replace(/token=.*/,`token=${'f'.repeat(64)}`);},
    f=>{f.frame.ownerDocument={};},
  ]){
    const f=await fixture();f.hooks.check=(_token,current)=>{if(current)current.ready=true;};await f.api.openFloating();alter(f);await assert.rejects(f.api.simulateBlankFloating());assert.equal(f.calls.faultWrites.length,0);assert.equal(f.calls.mounts.length,1);assert.equal(f.calls.pageCalls.length,1);
  }
});
