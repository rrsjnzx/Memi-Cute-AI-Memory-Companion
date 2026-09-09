import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

// Exercise the actual local page submit listener. No browser, model or memory
// repository is involved; this only checks the generated review fixture.
const source=await readFile(new URL('./mock-site.js',import.meta.url),'utf8');
class Element {
  constructor(){this.children=[];this.listeners={};this.value='';this.checked=false;this.disabled=false;this.textContent='';this.attributes={};}
  append(...nodes){this.children.push(...nodes);}
  setAttribute(key,value){this.attributes[key]=value;}
  addEventListener(type,listener){this.listeners[type]=listener;}
  dispatchEvent(){}
  remove(){}
}
async function submitFixture({includeFact,progress}){
  const ids=new Map(),get=id=>{if(!ids.has(id))ids.set(id,new Element());return ids.get(id);};
  get('mockComposer').querySelector=()=>get('send');get('includeFact').checked=includeFact;
  const identity={taskId:'task_clear_fixture',baseVersion:7,packId:'pack_clear_fixture'};
  const task={goal:'保留林汐能力约束',progress,openQuestions:'木匣中是否有备用钥匙？\n尚未核实。'};
  const template={...identity,progress:'仅为格式说明',openQuestions:'',facts:[]};
  get('prompt-textarea').value=`TEXT-MEMORY-PACK ${identity.packId}\n本轮任务：核对清空建议\n\n用户保存的持续任务档案（可跨 AI 网站使用）：\n${JSON.stringify(task)}\n\n记忆更新格式：\nTEXT-MEMORY-UPDATE\n${JSON.stringify(template)}\nEND-TEXT-MEMORY-UPDATE\n\nEND-TEXT-MEMORY-PACK ${identity.packId}`;
  const context={document:{getElementById:get,createElement:()=>new Element()},parent:{},structuredClone,Event:class{},setTimeout:callback=>{callback();}};
  vm.createContext(context);vm.runInContext(source,context);context.__tmMockSite.setScenario('clear_progress');
  await get('mockComposer').listeners.submit({preventDefault(){}});
  const answer=get('transcript').children.at(-1).children[1].children[0].textContent;
  const protocol=answer.match(/\nTEXT-MEMORY-UPDATE\n([\s\S]+)\nEND-TEXT-MEMORY-UPDATE$/);
  assert.ok(protocol,'local fixture must return a complete UPDATE');
  return{identity,task,answer,update:JSON.parse(protocol[1]),state:context.__tmMockSite.state};
}
test('clear-progress fixture proposes an empty progress with current identity and unchanged questions',async()=>{
  for(const includeFact of [false,true]){
    const result=await submitFixture({includeFact,progress:'已检查仓库，尚未取得钥匙。'});
    assert.deepEqual(Object.fromEntries(['taskId','baseVersion','packId'].map(key=>[key,result.update[key]])),result.identity);
    assert.equal(result.update.progress,'');assert.equal(result.update.openQuestions,result.task.openQuestions);
    assert.equal(result.update.facts.length,includeFact?1:0);assert.match(result.answer,/只是待审核建议，尚未保存到记忆库/);
    assert.equal(result.state.count,1);assert.equal(result.state.modelCalls,0);
  }
});
test('clear-progress fixture preserves an already empty progress without inventing completion',async()=>{
  const result=await submitFixture({includeFact:false,progress:''});
  assert.equal(result.update.progress,'');assert.equal(result.update.openQuestions,result.task.openQuestions);assert.deepEqual(result.update.facts,[]);
});
