import {VERSION} from './version.js';
import {TABLES,id,now,hash,clone} from './base.js';
import {createLibrary,addSource,saveEntry} from './library.js';
import {buildPack,validatePack,rememberPack} from './pack.js';

export function describeLiveCheck(report){
  if(report.status==='pass')return '网页自检通过，临时插入已经撤销。';
  const failures=(report.steps||[]).filter(step=>!step.ok);
  if(failures.length)return '网页自检未通过：'+failures.map(step=>`${step.name} → ${step.message||step.result}`).join('；');
  return `网页自检未通过：${report.message||report.status||'未知错误'}。`;
}

// The caller MUST provide the dedicated test repository. This workflow never
// reads or exports the user's normal memory database, draft text, or chat URL.
export async function runLiveCheck({repository,first,identity,call}){
  const report={id:id('live_test'),version:VERSION,at:now(),site:first.adapter||'unknown',
    kind:'isolated_library_real_editor_check',status:'fail',steps:[],sendsMessages:false,
    serverContext:'unknown',note:'独立测试库与真实编辑器的检查；不代表正常资料库的完整 UI 流程或模型质量。'};
  const step=(name,result,ok,message='')=>{report.steps.push({name,result,ok,message});return ok;};
  let inserted=false,operationId=id('operation'),pack;
  try{
    const residualTest=typeof first.draft==='string'&&first.draft.includes('本轮任务：这是一段临时网页输入自检，插件将自动撤销，勿发送。');
    if(!step('读取当前输入框',residualTest?'unresolved_test_draft':first.status,first.status==='ready'&&!residualTest,
      residualTest?'输入框中仍有上一次自检资料。请核对并清理测试残留后重试，不继续叠加。':first.message||''))return report;
    const text='原创网页自检：项目代号 TM-LIVE-508，功率上限 80 W，实施状态为 awaiting_confirmation。';
    const sha256=await hash(text);
    const ids=await repository.mutate(s=>{
      for(const table of TABLES)s[table]=[]; // Dedicated, disposable test DB only.
      const library=createLibrary(s,'Text Memory · 独立网页自检库');
      const source=addSource(s,{name:'原创网页自检',text,sha256});
      const entry=saveEntry(s,{libraryId:library.id,title:'网页自检条目',content:text,
        fields:{codename:'TM-LIVE-508',maximumPowerW:80,status:'awaiting_confirmation'},
        evidenceKind:'direct',sourceRefs:[{sourceId:source.id,sourceVersion:1,start:0,end:text.length,quote:text}]},
        {confirm:true,reason:'明确的原创测试数据'});
      return{libraryId:library.id,entryId:entry.id};
    });
    const state=await repository.snapshot(),options={libraryIds:[ids.libraryId],binding:identity};
    pack=buildPack(state,{...options,task:'这是一段临时网页输入自检，插件将自动撤销，勿发送。',selectedIds:[ids.entryId],pinnedIds:[ids.entryId],maxChars:3000});
    await repository.mutate(s=>rememberPack(s,pack));
    const persisted=await repository.snapshot(),saved=persisted.packs.find(p=>p.id===pack.id);
    const errors=validatePack(persisted,saved,options);
    if(!step('独立 IndexedDB 写入、读回与资料包校验',errors.length?'invalid':'valid',!errors.length,errors.join('；')))return report;
    const current=await call({action:'snapshot'});
    if(!step('写入前草稿与页面复核',current.status,current.status==='ready'&&current.draftHash===first.draftHash&&current.url===first.url&&current.pageKey===first.pageKey))return report;
    const request={action:'insert',identity,draftHash:first.draftHash,text:saved.text,packId:saved.id,operationId};
    const result=await call(request);inserted=result.status==='written';
    if(!step('真实输入框插入与读回',result.status,inserted,result.message||''))return report;
    const repeated=await call(request);
    step('同一包重复写入不重复插入',repeated.status,repeated.status==='already_present',repeated.message||'');
  }catch(error){step('执行异常','error',false,error.message);}
  finally{
    if(inserted){
      try{
        const undone=await call({action:'undo',identity,operationId});
        step('撤销临时插入',undone.status,undone.status==='undone',undone.message||'');
        const after=await call({action:'snapshot'});
        step('原草稿指纹恢复',after.status,after.status==='ready'&&after.draftHash===first.draftHash);
      }catch(error){step('恢复失败','error',false,error.message);}
    }
    report.status=report.steps.length===7&&report.steps.every(s=>s.ok)?'pass':'fail';
  }
  return report;
}
