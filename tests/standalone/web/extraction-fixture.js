// Original local-only extraction fixture. Imported through product core APIs.
import {Repository} from '../product/storage.js';
import {createLibrary,saveEntry} from '../product/core/library.js';
import {prepareText,importText} from '../product/core/imports.js';
import {saveTask} from '../product/core/tasks.js';
import {EXTRACTION_FIXTURES} from './extraction-fixture-data.js';

function register(buttonId,fixture){document.getElementById(buttonId).addEventListener('click',async event=>{
  const button=event.currentTarget,status=document.getElementById('hostStatus'),repository=new Repository();button.disabled=true;
  try{
    const preview=await prepareText(fixture.sourceName,fixture.text);
    const result=await repository.mutate(state=>{
      const existing=state.libraries.find(library=>library.name===fixture.libraryName);if(existing)return{existing:true,libraryId:existing.id};
      const library=createLibrary(state,fixture.libraryName),entries=importText(state,preview,library.id);
      const core=saveEntry(state,{libraryId:library.id,title:'固定任务原则',content:'以文档证据为准，不推断角色未写明的能力。',fields:{},evidenceKind:'user_asserted'},{confirm:true});
      const task=saveTask(state,{libraryId:library.id,name:fixture.taskName,goal:'提炼人物职责、物品位置与行为约束，保留原文出处。',constraints:'没有出处的说法不要当作事实；不要改变既有任务目标。',coreEntryIds:[core.id]});
      return{libraryId:library.id,taskId:task.id,sourceId:entries[0].sourceRefs[0].sourceId,characters:fixture.text.length,chunks:entries.length,expectedSlices:fixture.expectedSlices,expectedCandidates:fixture.expectedCandidates,core:1};
    });
    const channel=new BroadcastChannel('text-memory-changed');channel.postMessage({kind:'local_extraction_fixture',fixture:fixture.key});channel.close();
    status.textContent=(result.existing?'复用已有原创资料，不重置审核或队列进度。':'原创提炼资料已就绪。')+`进入资料库，选择“${fixture.libraryName}”，按文档浏览“${fixture.sourceName}”。`;
    window.__tmWebHost?.log('原创提炼样本已载入',{fixture:fixture.key,...result});button.textContent=fixture.expectedSlices+' 片原创提炼资料已载入';
  }catch(error){status.textContent='提炼样本未完成：'+error.message;button.disabled=false;}
  finally{repository.close();}
});}
register('seedExtraction',EXTRACTION_FIXTURES.original);
register('seedExtractionQueue',EXTRACTION_FIXTURES.queue);
