import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
// Actual host and unmodified production adapter executed against a bounded DOM.
// This verifies fixture wiring, not a real browser, native extension, or AI.
const source=await readFile(new URL('./host.js',import.meta.url),'utf8');
const contentSource=await readFile(new URL('../qa/production-adapters/content.js',import.meta.url),'utf8');
class Element{
  constructor(){this.children=[];this.listeners={};this.attributes={};this.style={};this.textContent='';this.value='valid';this.hidden=false;this.disabled=false;this.classList={toggle:(key,value)=>{this[key]=value;},contains:key=>this[key]===true};}
  addEventListener(type,callback){this.listeners[type]=callback;}
  setAttribute(name,value){this.attributes[name]=value;}
  getAttribute(name){return this.attributes[name]??null;}
  hasAttribute(name){return Object.hasOwn(this.attributes,name);}
  append(...nodes){for(const node of nodes){node.parent=this;this.children.push(node);}}
  get firstChild(){return this.children[0];}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(node=>node!==this);this.parent=null;}
  get isConnected(){return this.documentRoot===true||this.parent?.isConnected===true;}
  getClientRects(){return this.isConnected?[{}]:[];}
  replaceChildren(...nodes){this.children=[];this.append(...nodes);}
}
class Textarea extends Element{constructor(){super();this.value='';}}
async function fixture({mobile=false}={}){
  const nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);};
  const calls={page:[],mounts:[],delays:[]},timers=[];
  const body=new Element();body.documentRoot=true;const original=new Textarea();original.id=mobile?'mobile-composer-prompt':'prompt-textarea';if(mobile)original.setAttribute('data-mobile-composer-prompt','');original.value='保留的原网页草稿';body.append(original);
  const descendants=root=>root.children.flatMap(child=>[child,...descendants(child)]);
  const doc={body,visibilityState:'visible',addEventListener(){},removeEventListener(){},
    createElement(tag){const value=tag==='textarea'?new Textarea():new Element();value.ownerDocument=doc;return value;},
    querySelector(selector){return selector==='#mockComposer textarea'?original:null;},
    querySelectorAll(selector){return descendants(body).filter(item=>item instanceof Textarea&&((selector==='textarea#prompt-textarea'&&item.id==='prompt-textarea')||(selector==='textarea#mobile-composer-prompt[data-mobile-composer-prompt]'&&item.id==='mobile-composer-prompt'&&item.hasAttribute('data-mobile-composer-prompt'))));}};original.ownerDocument=doc;
  const page={document:doc,location:new URL('https://chatgpt.com/c/web-test-local'),crypto:globalThis.crypto,HTMLTextAreaElement:Textarea,TextEncoder,Uint8Array};vm.createContext(page);vm.runInContext(contentSource,page);
  const site={shell:{open:config=>{calls.mounts.push(config);return{status:'mounted'};}},setScenario(){},execute:async request=>{calls.page.push(structuredClone(request));assert.equal(request.action,'snapshot');return page.__textMemoryAdapterV2.execute(request);}};
  node('mockFrame').src='http://127.0.0.1:8800/web/mock-site.html';node('mockFrame').contentWindow={__tmMockSite:site,location:{href:node('mockFrame').src}};node('mockFrame').contentDocument=doc;
  const context={location:{origin:'http://127.0.0.1:8800'},document:{getElementById:node,createElement:()=>new Element(),createTextNode:text=>({textContent:text}),documentElement:{style:{setProperty(){}}}},crypto:globalThis.crypto,structuredClone,URL,Date,setTimeout(callback,ms){calls.delays.push(ms);timers.push(callback);return timers.length;}};
  vm.createContext(context);vm.runInContext(source,context);await new Promise(setImmediate);
  return{api:context.__tmWebHost,context,node,calls,timers,doc,original,async tick(){assert.ok(timers.length);timers.shift()();await new Promise(setImmediate);}};
}
test('actual content adapter rejects the added desktop/mobile candidate and restores only its untouched original draft',async()=>{
  for(const mobile of [false,true]){
    const f=await fixture({mobile}),before=await f.api.target();assert.equal(before.status,'ready');assert.equal(before.draft,'保留的原网页草稿');
    assert.equal((await f.api.setAmbiguousEditor(true)).created,true);assert.equal((await f.api.setAmbiguousEditor(true)).created,false);assert.equal((await f.api.target()).status,'ambiguous_target');
    assert.equal((await f.api.openFloating()).status,'ambiguous_target');assert.equal(f.calls.mounts.length,0);
    const unrelated=f.doc.createElement('label');f.doc.body.append(unrelated);await f.api.setAmbiguousEditor(false);assert.equal(unrelated.isConnected,true);
    const after=await f.api.target();assert.equal(after.status,'ready');assert.equal(after.draft,before.draft);assert.equal(after.draftHash,before.draftHash);assert.equal(f.original.isConnected,true);
  }
});
test('extra editor controls use actual checkbox events and remove only their own fixture',async()=>{
  const f=await fixture(),checkbox=f.node('ambiguousEditor');checkbox.checked=true;await checkbox.listeners.change();assert.equal(checkbox.disabled,false);assert.equal((await f.api.target()).status,'ambiguous_target');
  checkbox.checked=false;await checkbox.listeners.change();assert.equal(checkbox.disabled,false);assert.equal((await f.api.target()).status,'ready');assert.equal(f.original.value,'保留的原网页草稿');
});
test('extra editor refuses remote or replaced mock documents without touching their content',async()=>{
  for(const change of [f=>{f.node('mockFrame').src='https://chatgpt.com/web/mock-site.html';},f=>{f.node('mockFrame').contentWindow.location.href='http://127.0.0.1:8800/other.html';}]){
    const f=await fixture();change(f);await assert.rejects(f.api.setAmbiguousEditor(true));assert.equal(f.doc.body.children.length,1);assert.equal(f.original.value,'保留的原网页草稿');
  }
});
test('read delay holds the real completed result for two seconds without executing twice or changing its draft',async()=>{
  const f=await fixture();f.node('delayTargetRead').checked=true;let completed=false;const pending=f.api.target().then(result=>{completed=true;return result;});
  for(let i=0;i<20&&!f.timers.length;i++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(completed,false);assert.equal(f.calls.page.length,1);assert.deepEqual(f.calls.delays,[2000]);
  f.original.value='后续用户修改';f.node('delayTargetRead').checked=false;await f.tick();const result=await pending;assert.equal(result.status,'ready');assert.equal(result.draft,'保留的原网页草稿');assert.equal(f.original.value,'后续用户修改');assert.equal(f.calls.page.length,1);
});
test('disconnect button invokes the local bridge port disconnection without page writes or expression events',async()=>{
  const f=await fixture();let disconnected=0;f.context.__tmLocalFeedbackBridge={disconnectPage(){disconnected++;return{disconnected:1};}};
  f.node('disconnectFeedback').listeners.click();assert.equal(disconnected,1);assert.match(f.node('hostStatus').textContent,/端口已断开/);assert.equal(f.calls.page.length,0);assert.equal(f.calls.mounts.length,0);
});
