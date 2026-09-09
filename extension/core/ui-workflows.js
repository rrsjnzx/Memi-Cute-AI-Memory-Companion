import {clone,hash,requireThat} from './base.js';
import {addSource,saveEntry} from './library.js';
import {commitBackup,importExchange,importRows,importText} from './imports.js';
import {readBusinessFields} from './ui-fields.js';

export function revisionGate(){let revision=0;return{next:()=>++revision,current:value=>value===revision};}

export function importSession(){
  const gate=revisionGate();let ready=null,busy=false;
  return {
    get ready(){return ready;},get busy(){return busy;},
    invalidate(){ready=null;return gate.next();},current:gate.current,
    async prepare(form,prepare){
      requireThat(!busy,'导入正在提交，请稍候');const token=this.invalidate(),frozen=clone(form),prepared=await prepare(frozen);
      if(!gate.current(token))return null;
      ready={...prepared,form:frozen};return ready;
    },
    async commit(commit){
      requireThat(!busy&&ready,'请先预检；同一预检不能重复提交');
      const prepared=ready;ready=null;busy=true;
      try{return await commit(prepared);}finally{busy=false;}
    }
  };
}

export function requireImportLibrary(state,libraryId){
  requireThat(state.libraries.length>0,'还没有资料库。请先在左侧“新建资料库”填写名称并点击“创建”，再选择导入目标库。','missing_import_library');
  requireThat(typeof libraryId==='string'&&libraryId,'请选择导入目标库，然后重新预检。','missing_import_library');
  const library=state.libraries.find(item=>item.id===libraryId);
  requireThat(library,'所选导入目标库已不存在，请重新选择资料库并预检。','missing_import_library');
  return library;
}

export function commitPreparedImport(state,prepared){
  const {kind,data,form}=prepared;
  if(kind==='backup')return commitBackup(state,data);
  if(kind==='exchange'){
    const preview=clone(data);
    if(form.sensitivity==='local_only')for(const row of [...preview.value.entries,...preview.value.sources])row.sensitivity='local_only';
    return importExchange(state,preview);
  }
  requireImportLibrary(state,form.libraryId);
  if(kind==='rows')return importRows(state,data,form.libraryId,'',null,form.sensitivity);
  return importText(state,data,form.libraryId);
}

// Capture every form value before hashing or waiting for a write transaction.
// A newly opened editor must never donate its version, reason, or consent.
export function captureEntryEdit(root,entry,template,source,confirm){
  const get=key=>root.querySelector(`[data-edit="${key}"]`),draft={...clone(entry),fields:readBusinessFields(root,template),schemaId:template?.id||'',schemaVersion:template?.version||null};
  for(const key of ['title','content','kind','entityId','predicate','scope','effectiveFrom','effectiveTo','evidenceKind','sensitivity'])draft[key]=get(key).value;
  for(const key of ['aliases','tags'])draft[key]=get(key).value.split(/[,，]/).map(value=>value.trim()).filter(Boolean);
  for(const key of ['singleValued','enabledForContext'])draft[key]=get(key).checked;
  return {draft,options:{expectedVersion:entry.version||null,confirm,reason:get('reason').value,transitionConfirmed:get('transitionConfirmed').checked},
    source:{text:get('source-text').value,quote:get('source-quote').value,name:get('source-name').value,
      changed:get('source-text').value!==(source?.text||'')||get('source-quote').value!==(entry.sourceRefs[0]?.quote||'')||get('source-name').value!==(source?.name||'手动来源')}};
}

export async function persistEntryEdit(repository,captured,{hashText=hash}={}){
  const {draft,options,source}=clone(captured);let replacement=null;
  if(source.changed){
    if(!source.text&&!source.quote)draft.sourceRefs=[];
    else {
      requireThat(source.text&&source.quote,'更换证据需要原文和摘录；移除证据请同时清空两项');
      const start=source.text.indexOf(source.quote);requireThat(start>=0,'摘录不在原文中');
      replacement={name:source.name,text:source.text,sha256:await hashText(source.text),sensitivity:draft.sensitivity,start};
    }
  }
  return repository.mutate(state=>{
    if(replacement){const saved=addSource(state,replacement);draft.sourceRefs=[{sourceId:saved.id,sourceVersion:1,quote:source.quote,start:replacement.start,end:replacement.start+source.quote.length}];}
    return saveEntry(state,draft,options);
  });
}
