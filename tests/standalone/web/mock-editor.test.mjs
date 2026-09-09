import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

// Local fixture behavior only. This does not execute the production browser
// editing command or reproduce ChatGPT's framework.
const source=await readFile(new URL('./mock-site.js',import.meta.url),'utf8');
class Element {
  constructor(){this.children=[];this.listeners={};this.attributes={};this._value='';this.valueWrites=0;this.disabled=false;this.checked=false;this.textContent='';this.id='';}
  get value(){return this._value;}
  set value(value){this._value=value;this.valueWrites++;}
  append(...nodes){this.children.push(...nodes);}
  setAttribute(name,value){this.attributes[name]=value;}
  removeAttribute(name){delete this.attributes[name];}
  addEventListener(type,fn){this.listeners[type]=fn;}
  dispatchEvent(){}
  remove(){}
}
function fixture(){
  const ids=new Map(),get=id=>{if(!ids.has(id))ids.set(id,new Element());return ids.get(id);};
  const editor=get('prompt-textarea');editor.id='prompt-textarea';
  get('mockComposer').querySelector=()=>get('send');
  const records=[];
  const context={document:{getElementById:get,createElement:()=>new Element()},parent:{__tmWebHost:{log:(kind,details)=>records.push({kind,...details})}},structuredClone,Event:class{},setTimeout:fn=>{fn();}};
  vm.createContext(context);vm.runInContext(source,context);
  const change=mode=>{get('editor-mode').value=mode;get('editor-mode').listeners.change({target:get('editor-mode')});};
  return{get,editor,context,records,change};
}
test('switching local mobile and desktop selectors never writes the draft or sends',()=>{
  const {change,editor,context}=fixture();
  change('mobile');assert.equal(editor.id,'mobile-composer-prompt');assert.ok(Object.hasOwn(editor.attributes,'data-mobile-composer-prompt'));
  assert.equal(editor.valueWrites,0);assert.equal(context.__tmMockSite.state.count,0);assert.equal(context.__tmMockSite.state.editorMode,'mobile');
  change('desktop');assert.equal(editor.id,'prompt-textarea');assert.ok(!Object.hasOwn(editor.attributes,'data-mobile-composer-prompt'));
  assert.equal(editor.valueWrites,0);assert.equal(context.__tmMockSite.state.count,0);
});
test('mode change preserves a pending draft and rejects switching while the reply is busy',()=>{
  const {change,editor,get,context}=fixture();
  editor.value='未发送的原创草稿';const writes=editor.valueWrites;
  change('mobile');assert.equal(editor.id,'prompt-textarea');assert.equal(editor.value,'未发送的原创草稿');assert.equal(editor.valueWrites,writes);assert.equal(get('editor-mode').value,'desktop');
  editor.value='';get('send').disabled=true;
  change('mobile');assert.equal(editor.id,'prompt-textarea');assert.equal(context.__tmMockSite.state.editorMode,'desktop');assert.equal(context.__tmMockSite.state.count,0);
});
test('the same local form continues to submit after the textarea ID changes',async()=>{
  const {change,editor,get,context,records}=fixture();
  change('mobile');editor.value='只用于本地夹具的连通问题。';
  await get('mockComposer').listeners.submit({preventDefault(){}});
  assert.equal(editor.value,'');assert.equal(context.__tmMockSite.state.count,1);assert.equal(context.__tmMockSite.state.editorMode,'mobile');
  assert.equal(records.filter(row=>row.kind==='模拟发送控件点击').length,1);
  assert.equal(get('transcript').children[0].children[1].children[0].textContent,'只用于本地夹具的连通问题。');
  assert.match(get('transcript').children[1].children[1].children[0].textContent,/本地模拟回答/);
});
