import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {createLocalFeedbackHost,localPortPair,PANEL_PORT} from './local-feedback.js';
const adapter=await readFile(new URL('../product/adapters/soft-feedback.js',import.meta.url),'utf8');
const flush=async()=>{for(let i=0;i<5;i++)await new Promise(setImmediate);};
function events(){const listeners=new Map();return{addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn);},removeEventListener(type,fn){listeners.get(type)?.delete(fn);},emit(type,value={}){for(const fn of [...listeners.get(type)||[]])fn(value);}};}
function fixture({ack=true}={}){
  const all=[],timers=new Map(),rafs=[],observers=[];let seq=0,lastMain=null;
  class Node{
    constructor(tag){Object.assign(this,events());this.tagName=tag;this.namespaceURI=tag==='svg'?'http://www.w3.org/2000/svg':'http://www.w3.org/1999/xhtml';this.attrs={};this.style={};this.children=[];this.hidden=false;all.push(this);}
    setAttribute(key,value){this.attrs[key]=String(value);}getAttribute(key){return this.attrs[key]??null;}
    append(...nodes){this.children.push(...nodes);for(const child of nodes)child.parentNode=this;}replaceChildren(...nodes){this.children=[];this.append(...nodes);}
    attachShadow(){this.shadow=new Node('shadow');return this.shadow;}remove(){this.removed=true;}
    getBoundingClientRect(){const width=parseFloat(this.style.width)||240,height=140,right=page.innerWidth-(parseFloat(this.style.right)||0),top=(parseFloat(this.style.top)||0)-height/2;return{left:right-width,right,top,bottom:top+height,width,height};}
  }
  const pageDocument={...events(),visibilityState:'visible',documentElement:new Node('html'),createElement:tag=>new Node(tag),querySelector:()=>all.findLast(node=>node.attrs['data-text-memory-soft-feedback']!==undefined&&!node.removed)||null};
  const page={...events(),location:new URL('http://127.0.0.1:8802/web/mock-site.html'),document:pageDocument,chrome:{runtime:{id:'text-memory-web-test'}},innerWidth:810,innerHeight:700,visualViewport:{...events(),width:810,height:700,offsetLeft:0,offsetTop:0},setInterval:()=>1,clearInterval(){},requestAnimationFrame:fn=>{if(ack)queueMicrotask(fn);else rafs.push(fn);},Date,__textMemorySoftFace:{renderFeedback:()=>new Node('svg')}};
  vm.createContext(page);vm.runInContext(adapter,page);
  const panel={...events(),location:new URL('http://127.0.0.1:8802/product/sidepanel.html'),document:{documentElement:{dataset:{site:'claude'}}},__textMemorySoftBodyDiagnostics:{snapshot:()=>lastMain}};
  const panelFrame={hidden:false,contentWindow:panel,classList:{contains:value=>value==='sidebar-preview'},getBoundingClientRect:()=>({left:810,right:1200,top:100,bottom:800,width:390,height:700})};
  const mockFrame={hidden:false,contentWindow:page,contentDocument:pageDocument,getBoundingClientRect:()=>({left:0,right:810,top:100,bottom:800,width:810,height:700})},grant={checked:true};
  const elements={managerFrame:panelFrame,mockFrame,simulateSiteGrant:grant,delayFeedbackReceipt:{checked:false}};
  const root={location:new URL('http://127.0.0.1:8802/'),document:{getElementById:id=>elements[id]},crypto:globalThis.crypto};
  const host=createLocalFeedbackHost(root,{now:()=>1000,uuid:()=>String(++seq),setTimer:fn=>{const id=++seq;timers.set(id,fn);return id;},clearTimer:id=>timers.delete(id),Observer:class{constructor(fn){this.fn=fn;observers.push(this);}observe(){}disconnect(){this.closed=true;}}});
  const port=host.connect(panel,{name:PANEL_PORT}),received=[];port.onMessage.addListener(message=>received.push(message));
  const hello=async()=>{port.postMessage({type:'hello'});await flush();return received.findLast(message=>message.type==='context');};
  const snapshot=(context,revision=2,patch={})=>({contextKey:context.key,operationId:'save-memory-task',attemptId:'actual-attempt',eventId:'event-'+revision,revision,personaId:context.siteId,semanticState:'save_success',recipeId:context.siteId+'.success',phase:'enter',startedAt:1000,duration:2560,feedbackVisible:true,statusCode:'save_success',...patch});
  const publish=async value=>{lastMain=value;port.postMessage({type:'presentation',snapshot:value});await flush();};
  return{host,port,received,page,panel,panelFrame,mockFrame,grant,root,elements,all,timers,rafs,observers,hello,snapshot,publish,get overlay(){return pageDocument.querySelector();}};
}

test('disconnect closes the actual page port and removes its overlay before explicit fresh hello',async()=>{
  const f=fixture(),first=await f.hello();await f.publish(f.snapshot(first.context));const old=f.overlay;let panelEnded=false;f.port.onDisconnect.addListener(()=>panelEnded=true);
  assert.deepEqual(f.host.disconnectPage(),{disconnected:1});await flush();assert.equal(old.removed,true);assert.equal(panelEnded,false);assert.equal(f.host.sample().contextKey,null);assert.equal(f.received.at(-1).reason,'overlay_disconnected');
  assert.deepEqual(f.host.disconnectPage(),{disconnected:0});await f.publish(f.snapshot(first.context,3));assert.equal(f.received.at(-1).type,'rejected');
  const second=await f.hello();assert.notEqual(second.context.key,first.context.key);await f.publish(f.snapshot(second.context));assert.equal(f.received.at(-1).mode,'external');assert.equal(f.overlay.hidden,false);f.host.dispose();
});
test('receipt delay holds an actual rendered ACK; disconnect cancels it without inventing success',async()=>{
  const f=fixture(),hello=await f.hello();f.elements.delayFeedbackReceipt.checked=true;await f.publish(f.snapshot(hello.context));
  assert.equal(f.overlay.hidden,false);assert.equal(f.received.some(row=>row.type==='presented'),false);assert.equal(f.timers.size,1);
  f.host.disconnectPage();await flush();assert.equal(f.timers.size,0);assert.equal(f.received.at(-1).reason,'overlay_disconnected');assert.equal(f.received.some(row=>row.type==='presented'),false);
  f.elements.delayFeedbackReceipt.checked=false;const fresh=await f.hello();await f.publish(f.snapshot(fresh.context));assert.equal(f.received.at(-1).type,'presented');assert.equal(f.received.at(-1).contextKey,fresh.context.key);f.host.dispose();
});
test('held real receipt is forwarded unchanged when its bounded timer completes',async()=>{
  const f=fixture(),hello=await f.hello();f.elements.delayFeedbackReceipt.checked=true;await f.publish(f.snapshot(hello.context));assert.equal(f.received.some(row=>row.type==='presented'),false);
  for(const callback of [...f.timers.values()])callback();await flush();assert.equal(f.received.at(-1).mode,'external');assert.equal(f.received.at(-1).reason,'');assert.equal(f.received.at(-1).revision,2);f.host.dispose();
});

test('local port values are cloned asynchronously and queued messages stop after disconnect',async()=>{
  const queue=[],[a,b]=localPortPair('test',fn=>queue.push(fn)),received=[];let disconnected=0;b.onMessage.addListener(value=>received.push(value));b.onDisconnect.addListener(()=>disconnected++);
  const value={revision:1};a.postMessage(value);value.revision=999;assert.equal(received.length,0);queue.shift()();assert.deepEqual(received,[{revision:1}]);
  a.postMessage({revision:2});a.disconnect();queue.shift()();assert.equal(received.length,1);assert.equal(disconnected,1);assert.throws(()=>a.postMessage({}),/closed/);
});
test('real copied webpage adapter renders the actual transmitted snapshot and acknowledges it',async()=>{
  const f=fixture(),hello=await f.hello();assert.equal(hello.capability.environment,'local_split_iframes');assert.equal(hello.capability.mode,'external');assert.equal(f.overlay,null);
  await f.publish(f.snapshot(hello.context));assert.equal(f.overlay.hidden,false);assert.equal(f.overlay.style.right,'10px');assert.equal(f.overlay.style.top,'350px');
  const receipt=f.received.at(-1);assert.equal(receipt.type,'presented');assert.equal(receipt.mode,'external');assert.equal(receipt.revision,2);assert.equal(f.overlay.getAttribute('data-recipe-id'),'claude.success');
  const geometry=f.host.sample();assert.equal(geometry.nativeExtensionVerified,false);assert.equal(geometry.environment,'local_split_iframes');assert.equal(geometry.leftOutside,true);assert.equal(geometry.midpointDelta,0);assert.equal(geometry.rightGap,10);assert.equal(geometry.main.recipeId,geometry.external.recipeId);assert.equal(geometry.main.revision,geometry.external.revision);f.host.dispose();
});
test('no external confirmation is invented when the webpage animation-frame receipt is missing',async()=>{
  const f=fixture({ack:false}),hello=await f.hello();await f.publish(f.snapshot(hello.context));assert.equal(f.received.some(row=>row.type==='presented'),false);
  for(const callback of [...f.timers.values()])callback();await flush();assert.equal(f.received.at(-1).mode,'internal');assert.equal(f.received.at(-1).reason,'render_ack_timeout');f.host.dispose();
});
test('closing external feedback requests the same revision; only the shared client snapshot hides it',async()=>{
  const f=fixture(),hello=await f.hello();await f.publish(f.snapshot(hello.context));const close=f.all.findLast(node=>node.tagName==='button');close.emit('click',{isTrusted:true});await flush();
  assert.equal(f.received.at(-1).type,'dismiss_requested');assert.equal(f.received.at(-1).revision,2);assert.equal(f.overlay.hidden,false);
  await f.publish(f.snapshot(hello.context,3,{feedbackVisible:false,phase:'hold'}));assert.equal(f.overlay.hidden,true);f.host.dispose();
});
test('source/target changes clean the actual overlay and reject late old snapshots',async()=>{
  const f=fixture(),first=await f.hello();await f.publish(f.snapshot(first.context));const old=f.overlay;
  f.panel.document.documentElement.dataset.site='grok';f.observers[0].fn();await flush();assert.equal(old.removed,true);assert.equal(f.received.at(-1).type,'context_invalidated');
  const second=await f.hello();assert.notEqual(second.context.key,first.context.key);assert.equal(second.context.siteId,'grok');await f.publish(f.snapshot(first.context,4));assert.equal(f.received.at(-1).type,'rejected');assert.equal(f.overlay,null);
  await f.publish(f.snapshot(second.context));assert.equal(f.overlay.getAttribute('data-recipe-id'),'grok.success');f.host.dispose();
});
test('hidden sidebar, denied simulated permission, and actual page navigation cannot retain external feedback',async()=>{
  for(const change of [f=>{f.panelFrame.hidden=true;},f=>{f.grant.checked=false;},f=>{f.page.location=new URL('http://127.0.0.1:8802/replaced');}]){
    const f=fixture(),hello=await f.hello();await f.publish(f.snapshot(hello.context));const old=f.overlay;change(f);f.host.layoutChanged();await flush();assert.equal(old.removed,true);assert.equal(f.received.at(-1).type,'context_invalidated');f.host.dispose();
  }
});
test('missing layout or page renderer returns an explicit local limitation instead of external success',async()=>{
  for(const change of [f=>{f.panelFrame.hidden=true;},f=>{f.grant.checked=false;},f=>{delete f.page.__textMemorySoftFace;}]){
    const f=fixture();change(f);const hello=await f.hello();assert.equal(hello.context,null);assert.equal(hello.capability.mode,'internal');assert.ok(hello.capability.reason.startsWith('local_'));assert.equal(f.overlay,null);f.host.dispose();
  }
});
test('restoring a visible split layout after denied local permission establishes a fresh context',async()=>{
  const f=fixture();f.grant.checked=false;const denied=await f.hello();assert.equal(denied.context,null);
  f.grant.checked=true;f.host.layoutChanged();await flush();const connected=f.received.at(-1);assert.equal(connected.type,'context');assert.equal(connected.capability.mode,'external');await f.publish(f.snapshot(connected.context));assert.equal(f.received.at(-1).mode,'external');f.host.dispose();
});
test('unrecognized panels, ports, private snapshot fields and stale revisions are rejected',async()=>{
  const f=fixture();assert.throws(()=>f.host.connect({...f.panel},{name:PANEL_PORT}));assert.throws(()=>f.host.connect(f.panel,{name:'unknown'}));
  const hello=await f.hello();await f.publish(f.snapshot(hello.context,2,{privateText:'MUST NOT RENDER'}));assert.equal(f.overlay,null);assert.equal(f.received.at(-1).type,'rejected');
  await f.publish(f.snapshot(hello.context));await f.publish(f.snapshot(hello.context));assert.equal(f.received.at(-1).type,'rejected');assert.equal(JSON.stringify(f.host.sample()).includes('MUST NOT RENDER'),false);f.host.dispose();
});
test('narrow webpage viewport acknowledges internal mode and restores external only after actual resize receipt',async()=>{
  const f=fixture(),hello=await f.hello();f.page.visualViewport.width=190;await f.publish(f.snapshot(hello.context));assert.equal(f.overlay.hidden,true);assert.equal(f.received.at(-1).mode,'internal');
  f.page.visualViewport.width=810;f.page.visualViewport.emit('resize');await flush();assert.equal(f.overlay.hidden,false);assert.equal(f.received.at(-1).mode,'external');f.host.dispose();
});
test('disposing local bridge removes the webpage layer and disconnects panel listeners',async()=>{
  const f=fixture(),hello=await f.hello();await f.publish(f.snapshot(hello.context));const old=f.overlay;let ended=false;f.port.onDisconnect.addListener(()=>{ended=true;});f.host.dispose();await flush();assert.equal(old.removed,true);assert.equal(ended,true);assert.equal(f.observers[0].closed,true);assert.throws(()=>f.port.postMessage({type:'hello'}),/closed/);
});
