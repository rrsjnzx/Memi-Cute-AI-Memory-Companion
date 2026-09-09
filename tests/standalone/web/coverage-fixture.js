// Original public evaluation material only. This rebuilds an isolated local
// fixture; it does not resume or modify the earlier browser's database.
import {Repository} from '../product/storage.js';
import {createLibrary,addSource,saveEntry,setLifecycle} from '../product/core/library.js';
import {saveTask} from '../product/core/tasks.js';

document.getElementById('seedCoverage').addEventListener('click',async event=>{
  const button=event.currentTarget,status=document.getElementById('hostStatus'),repository=new Repository();button.disabled=true;
  try{
    const response=await fetch('./web/coverage-state.json');if(!response.ok)throw Error('原创验收资料读取失败');
    const original=await response.json(),name='覆盖补读验收 · 原创澄湾资料';
    const result=await repository.mutate(state=>{
      const found=state.libraries.find(row=>row.name===name);if(found)return {existing:true,libraryId:found.id};
      const library=createLibrary(state,name),sourceIds=new Map(),entryIds=new Map();
      for(const source of original.sources){const saved=addSource(state,{name:source.name,text:source.text,sha256:source.sha256,kind:source.kind,sensitivity:source.sensitivity});sourceIds.set(source.id,saved.id);}
      for(const entry of original.entries){
        const {id,version,libraryId,createdAt,updatedAt,...fields}=entry;
        const saved=saveEntry(state,{...fields,libraryId:library.id,lifecycleStatus:'active',sourceRefs:entry.sourceRefs.map(ref=>({...ref,sourceId:sourceIds.get(ref.sourceId)}))},{confirm:entry.reviewStatus==='confirmed',reason:'从已有原创真实回执重建独立覆盖验收样本'});
        entryIds.set(id,saved.id);
        if(['archived','superseded'].includes(entry.lifecycleStatus))setLifecycle(state,saved.id,entry.lifecycleStatus,saved.version,'保留原创样本的旧值归档状态');
      }
      const task=original.tasks[0];const savedTask=saveTask(state,{libraryId:library.id,name:'覆盖补读验收任务',goal:task.goal,constraints:task.constraints,progress:task.progress,openQuestions:task.openQuestions,coreEntryIds:task.coreEntryIds.map(id=>entryIds.get(id))});
      return {libraryId:library.id,taskId:savedTask.id,entries:entryIds.size};
    });
    const channel=new BroadcastChannel('text-memory-changed');channel.postMessage({kind:'coverage_fixture'});channel.close();
    status.textContent=(result.existing?'复用已有验收库，不覆盖修改。':'已重建原创资料与实际回执引用。')+' 在资料库选择“覆盖补读验收 · 原创澄湾资料” → 按文档查看 → 原文覆盖检查与补读。此重建不算模型新测或原库续跑。';
    button.textContent='覆盖补读验收资料已载入';
  }catch(error){status.textContent='载入失败：'+error.message;button.disabled=false;}
  finally{repository.close();}
});
