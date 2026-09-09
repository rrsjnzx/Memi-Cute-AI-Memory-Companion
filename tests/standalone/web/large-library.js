// Original local-only scale fixture. No external requests or private files.
import {Repository} from '../product/storage.js';
import {createLibrary,addSource,saveEntry} from '../product/core/library.js';
import {saveTask} from '../product/core/tasks.js';
import {hash} from '../product/core/base.js';

const button=document.getElementById('seedLargeLibrary');
button.addEventListener('click',async()=>{
  button.disabled=true;const status=document.getElementById('hostStatus'),repository=new Repository();
  status.textContent='正在创建独立原创规模样本；现有资料保留。';
  try{
    const docs=await Promise.all(['灯塔日志','航道记录','设备档案'].map(async(name,doc)=>{
      const rows=Array.from({length:400},(_,j)=>{const i=doc*400+j+1;return `原创验收记录 ${String(i).padStart(4,'0')}：${['林汐','乔岚','顾棠'][i%3]}核对${name}，设备代号 UNIT-${String(i).padStart(4,'0')}。这是用于界面浏览和批量整理的虚构资料，不构成真实事实。`+(' 附注：仅验证保存、搜索与阅读位置。'.repeat(5));});
      const text=rows.join('\n\n');return{name,rows,text,sha256:await hash(text)};
    }));
    const result=await repository.mutate(state=>{
      const existing=state.libraries.find(lib=>lib.name==='千条资料浏览验收');
      if(existing)return{existing:true,libraryId:existing.id,count:state.entries.filter(e=>e.libraryId===existing.id).length};
      const library=createLibrary(state,'千条资料浏览验收');let core;
      for(let doc=0;doc<docs.length;doc++){
        const source=addSource(state,docs[doc]);let start=0;
        docs[doc].rows.forEach((content,j)=>{
          const i=doc*400+j+1,entry=saveEntry(state,{libraryId:library.id,title:`记录 ${String(i).padStart(4,'0')} · ${docs[doc].name}`,content,kind:['fact','note','entity'][i%3],fields:{unit:`UNIT-${String(i).padStart(4,'0')}`,sequence:i},aliases:[`UNIT-${String(i).padStart(4,'0')}`],tags:[doc===1?'航道':'档案',`第${doc+1}册`],sensitivity:i%10===0?'local_only':'normal',evidenceKind:'direct',sourceRefs:[{sourceId:source.id,sourceVersion:1,start,end:start+content.length,quote:content}]},{confirm:i%4!==0,reason:'原创规模样本'});
          if(i===1)core=entry;start+=content.length+2;
        });
      }
      const task=saveTask(state,{libraryId:library.id,name:'千条资料任务',goal:'在大量来源资料中找到指定记录，保留重要记忆。',coreEntryIds:[core.id]});
      const other=createLibrary(state,'独立对照资料库');
      for(let i=1;i<=30;i++)saveEntry(state,{libraryId:other.id,title:`对照 ${String(i).padStart(2,'0')}`,content:'原创对照资料，用于确认切库不混合筛选或批量选择。',fields:{},evidenceKind:'user_asserted'},{confirm:true});
      return{libraryId:library.id,taskId:task.id,count:1200,otherLibraryId:other.id,otherCount:30};
    });
    const channel=new BroadcastChannel('text-memory-changed');channel.postMessage({kind:'local_scale_fixture'});channel.close();
    status.textContent=`原创规模资料已就绪：主库 ${result.count} 条，另有独立对照库。请进入“资料库”浏览。`;
    window.__tmWebHost?.log('原创规模样本已载入',result);button.textContent='原创规模资料已载入';
  }catch(error){status.textContent='规模资料未完成：'+error.message;button.disabled=false;}
  finally{repository.close();}
});
