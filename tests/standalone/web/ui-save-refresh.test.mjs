// Runs the actual copied manager refresh function against controlled concurrent
// repository reads. DOM rendering is represented by observed header/history
// values, so these tests exercise the async race without inventing an IDB pass.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {revisionGate} from '../product/core/ui-workflows.js';

const source=await fs.readFile(new URL('../product/ui.js',import.meta.url),'utf8');
const body=source.slice(source.indexOf('async function refresh('),source.indexOf('\nfunction renderLibraries(')).replace(/\r\n/g,'\n');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
function snapshot(version,id='entry-A'){
  return{libraries:[{id:'library-1'}],entries:[{id,version,lifecycleStatus:'active'}],versions:Array.from({length:version},(_,i)=>({entryId:id,version:i+1})),packs:[]};
}
function fixture(){
  const reads=[],rendered=[],controls=new Map(),editorGate=revisionGate(),editorToken=editorGate.next();
  const control=selector=>{if(!controls.has(selector))controls.set(selector,{value:'library-1',replaceChildren(){},textContent:''});return controls.get(selector);};
  const context={
    state:snapshot(2),selectedEntry:'entry-A',editorToken,editorGate,refreshGate:revisionGate(),pendingDetailRefresh:null,refreshRead:Promise.resolve(),enabled:['library-1'],pendingLibrarySelection:null,pack:null,
    repository:{snapshot(){const read=deferred();reads.push(read);return read.promise;}},
    $:control,element:()=>({}),renderLibraries(){},selectOptions(){},invalidateImport(){},latestTemplates:()=>[],renderList(){},renderRules(){},renderWatches(){},renderEvents(){},renderMemoryTasks(){},
    renderDetail(id){const entry=context.state.entries.find(row=>row.id===id);rendered.push({id,headerVersion:entry?.version,history:context.state.versions.filter(row=>row.entryId===id).map(row=>row.version)});context.editorToken=context.editorGate.next();},
  };
  vm.createContext(context);vm.runInContext(body,context);
  return{context,reads,rendered,refresh:options=>context.refresh(options),switchEditor(id){context.selectedEntry=id;context.editorToken=context.editorGate.next();}};
}

test('save detail request survives a later notification refresh and paints latest header/history',async()=>{
  const f=fixture(),save=f.refresh({detail:true}),notification=f.refresh();let completed=false;save.then(()=>completed=true);
  f.reads[0].resolve(snapshot(3));await Promise.resolve();await Promise.resolve();assert.equal(completed,false,'saved editor must remain frozen while the winning read is pending');
  f.reads[1].resolve(snapshot(3));await Promise.all([save,notification]);
  assert.deepEqual(f.rendered,[{id:'entry-A',headerVersion:3,history:[1,2,3]}]);assert.equal(completed,true);
});
test('out-of-order old snapshot cannot roll back the saved editor',async()=>{
  const f=fixture(),save=f.refresh({detail:true}),notification=f.refresh();
  f.reads[1].resolve(snapshot(4));await notification;f.reads[0].resolve(snapshot(3));await save;
  assert.deepEqual(f.rendered,[{id:'entry-A',headerVersion:4,history:[1,2,3,4]}]);assert.equal(f.context.state.entries[0].version,4);
});
test('switching to another editor while saving prevents replacement by the old detail request',async()=>{
  const f=fixture(),save=f.refresh({detail:true});f.switchEditor('entry-B');const notification=f.refresh();
  f.reads[0].resolve(snapshot(3));f.reads[1].resolve(snapshot(1,'entry-B'));await Promise.all([save,notification]);
  assert.deepEqual(f.rendered,[]);assert.equal(f.context.selectedEntry,'entry-B');assert.equal(f.context.pendingDetailRefresh,null);
});
test('winning read failure rejects save refresh and does not defer a destructive repaint',async()=>{
  const f=fixture(),save=f.refresh({detail:true}),notification=f.refresh();const saveFailure=assert.rejects(save,/read failed/),notificationFailure=assert.rejects(notification,/read failed/);
  f.reads[0].resolve(snapshot(3));f.reads[1].reject(Error('read failed'));await Promise.all([saveFailure,notificationFailure]);
  assert.deepEqual(f.rendered,[]);assert.equal(f.context.pendingDetailRefresh,null);
  const later=f.refresh();f.reads[2].resolve(snapshot(3));await later;assert.deepEqual(f.rendered,[],'a failed refresh must not overwrite later unsaved editor changes');
});
