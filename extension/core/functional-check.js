import {VERSION} from './version.js';
import {TABLES,equal,hash,id,now,requireThat} from './base.js';
import {createLibrary,addSource,saveEntry,saveTemplate,resolveConflict,deletionPreview,deleteEntry} from './library.js';
import {prepareText,importText,preflightExchange,importExchange,exportBackup,preflightBackup,commitBackup} from './imports.js';
import {retrieve} from './retrieval.js';
import {buildPack,rememberPack,validatePack} from './pack.js';
import {checkStructured,diagnose} from './checks.js';
import {saveTask,taskById,taskSelection} from './tasks.js';
import {prepareMemoryUpdate,applyMemoryUpdate} from './memory-updates.js';
import {executeMemorySearch} from './memory-requests.js';
import {prepareRound,roundById,activeRound,resumeRound,replaceRoundPack,markRoundDelivered,validateRoundUpdate,completeRound} from './rounds.js';
import {createExtractionQueue,extractionQueueById,prepareQueuedSlice,completeQueuedSlice,pauseExtractionQueue,resumeExtractionQueue,validateExtractionQueues} from './extraction-queue.js';
import {browseExtractionCandidates,prepareCandidateReview,applyCandidateReview} from './candidate-review.js';

// The names are internal constants. No caller-supplied normal database is ever
// reset, and no existing memory, draft, chat address or model is consulted.
const TEST_DATABASE='text-memory-functional-tests-v1';
const RESTORE_DATABASE='text-memory-functional-restore-v1';
export async function runFunctionalCheck({createRepository,storageKind='indexeddb'}){
  const report={id:id('functional_test'),version:VERSION,at:now(),kind:'isolated_memory_functional_check',
    status:'fail',storageKind,steps:[],sendsMessages:false,touchesDraft:false,
    note:'独立原创资料库的业务、持续任务、轮次、有限提炼队列、候选审核与存储验收；跨 AI 部分检查本地协议，模型回执与交付成功均由脚本构造，未操作剪贴板或网页。关闭重开仅指数据库连接，不代表浏览器重启、真实模型效果或崩溃恢复。'};
  let repository=createRepository(TEST_DATABASE),restored=createRepository(RESTORE_DATABASE),peer;
  const check=async(name,action)=>{
    try{const details=await action();report.steps.push({name,ok:true,result:'pass',...(details?{details}: {})});}
    catch(error){report.steps.push({name,ok:false,result:'fail',message:error.message});throw error;}
  };
  const reset=r=>r.mutate(s=>{for(const table of TABLES)s[table]=[];});
  const assert=(condition,message)=>requireThat(condition,message,'acceptance_failed');
  let imported,entryId,libraryId,localId,foreignId,oldPack,memoryTaskId,oldTaskPack,currentTaskPack,harnessTaskId,harnessRoundId,harnessNextRoundId,harnessExtraId;
  let extractionFixture,completedQueueId,pausedQueueId;
  const extractionQuotes=['原创队列验收：航海员白榆不会游泳。','原创队列验收：铜钥匙保存在蓝色灯塔二层。','原创队列验收：石门只能在日落前打开。'];
  const options={libraryIds:[],scope:'展馆试点',asOf:'2026-09-06'};
  const quote='原创验收：PUMP-Q47（温室甲泵）的流量上限为 8 L/min，试运行状态为 awaiting_confirmation，负责人为岚青。';
  const sourceText='🧪 原创长文功能验收\n\n'+Array.from({length:1600},(_,n)=>`附录 ${n}：这是无业务权威的填充段落，只用于验证跨分段后的字符位置。\n`).join('')+quote+'\n\n末行保留连续空格 A  B 与字面文本 <tag>。';
  const fields={value:8,status:'awaiting_confirmation',owner:'岚青'};
  try{
    await check('创建隔离验收库',async()=>{await reset(repository);await reset(restored);});
    await check('长文本导入、分段与逐字引用',async()=>{
      const preview=await prepareText('原创长文功能验收',sourceText);
      await repository.mutate(s=>{const lib=createLibrary(s,'原创长文待审核库');return importText(s,preview,lib.id);});
      const s=await repository.snapshot();
      assert(s.entries.length>1,'原文没有跨段，无法检验分段引用');
      assert(s.entries.every(e=>e.reviewStatus==='pending'),'原文导入不应自动确认');
      const ordered=[...s.entries].sort((a,b)=>a.sourceRefs[0].start-b.sourceRefs[0].start);
      assert(ordered[0].sourceRefs[0].start===0&&ordered.at(-1).sourceRefs[0].end===sourceText.length&&ordered.every((e,i)=>!i||ordered[i-1].sourceRefs[0].end===e.sourceRefs[0].start),'分段坐标没有连续覆盖原文');
      assert(ordered.map(e=>e.content).join('')===sourceText,'分段重组与原文不一致');
      assert(s.entries.every(e=>e.sourceRefs.every(r=>s.sources.find(x=>x.id===r.sourceId).text.slice(r.start,r.end)===r.quote)),'原文位置不一致');
      return{characters:sourceText.length,chunks:s.entries.length};
    });
    await check('文件交换导入与待审核阻塞',async()=>{
      const start=sourceText.indexOf(quote);
      const exchange={format:'text-memory-exchange',version:1,library:{name:'原创温室设备验收'},
        sources:[{id:'source-q47',name:'原创设备原文',text:sourceText,sha256:await hash(sourceText),coordinates:'utf16',sensitivity:'normal'}],
        entries:[{title:'PUMP-Q47',content:quote,fields,aliases:['温室甲泵'],entityId:'pump-q47',predicate:'flow_limit',singleValued:true,
          scope:options.scope,effectiveFrom:'2026-01-01',effectiveTo:'2027-01-01',evidenceKind:'direct',sensitivity:'normal',
          sourceRefs:[{sourceId:'source-q47',sourceVersion:1,start,end:start+quote.length,quote}]}]};
      const preview=await preflightExchange(exchange);
      imported=await repository.mutate(s=>importExchange(s,preview));
      entryId=imported.entries[0].id;libraryId=imported.library.id;options.libraryIds=[libraryId];
      const s=await repository.snapshot(),found=retrieve(s,'温室甲泵',options);
      assert(found.hits.length===0&&found.excluded.some(e=>e.id===entryId&&e.reason==='unconfirmed'),'待审核数据被当作确认记忆召回');
    });
    await check('审核、别名检索与库/时间/范围隔离',async()=>{
      await repository.mutate(s=>{
        const template=saveTemplate(s,{name:'原创设备字段',fields:[{name:'value',type:'number',required:true},{name:'status',type:'enum',values:['awaiting_confirmation','completed'],required:true},{name:'owner',type:'string',required:true}]});
        const e=s.entries.find(x=>x.id===entryId);saveEntry(s,{...e,schemaId:template.id,schemaVersion:template.version},{expectedVersion:e.version,confirm:true,reason:'逐字核对本脚本原创资料'});
        const foreign=createLibrary(s,'不参与本轮的隔离库');
        foreignId=saveEntry(s,{libraryId:foreign.id,title:'PUMP-Q47',content:'其他试点的不同设备',fields:{value:999}},{confirm:true,reason:'原创隔离对照'}).id;
        localId=saveEntry(s,{libraryId,title:'PUMP-Q47 本地维护备注',content:'原创本地保留备注',fields:{value:'local'},sensitivity:'local_only',sourceRefs:e.sourceRefs,evidenceKind:'direct'},{confirm:true,reason:'原创本地限制对照'}).id;
      });
      const s=await repository.snapshot();
      assert(retrieve(s,'温室甲泵',options).hits[0]?.id===entryId,'登记的别名未召回正确设备');
      assert(!retrieve(s,'PUMP-Q47',options).hits.some(h=>h.id===foreignId),'混入另一资料库');
      for(const changed of [{scope:'其他试点'},{asOf:'2027-01-01'},{asOf:''}])assert(!retrieve(s,'温室甲泵',{...options,...changed}).hits.some(h=>h.id===entryId),'范围或有效期边界失效');
    });
    await check('关闭连接后重开并读取保存值',async()=>{
      const before=await repository.snapshot();repository.close();repository=createRepository(TEST_DATABASE);
      assert(equal(before,await repository.snapshot()),'重新打开数据库后内容不一致');
    });
    await check('资料包包含原文与规则，受限资料不能入包',async()=>{
      await repository.mutate(s=>{
        s.rules.push({id:'functional-flow-rule',version:1,libraryId,entryId,field:'value',type:'max',value:8,scope:options.scope,confirmed:true,createdAt:now()});
        s.watches.push({id:'functional-watch',libraryId,entryId,fields:['value','status'],confirmed:true,taskType:''});
      });
      const s=await repository.snapshot();
      oldPack=buildPack(s,{...options,task:'核对温室甲泵的流量和状态',selectedIds:[entryId,localId,foreignId],pinnedIds:[entryId],maxChars:6000});
      assert(oldPack.included.length===1&&oldPack.included[0].id===entryId,'资料包混入受限或异库条目');
      assert(oldPack.text.includes(quote)&&oldPack.text.includes('functional-flow-rule'),'原文或已确认规则丢失');
      assert(oldPack.excluded.some(e=>e.id===localId&&e.reason==='local_only'),'没有说明本地条目被排除');
      assert(validatePack(s,oldPack,options).length===0,'有效资料包未通过预检');
      await repository.mutate(s=>rememberPack(s,oldPack));
      const small=buildPack(s,{...options,task:'核对温室甲泵',selectedIds:[entryId],pinnedIds:[entryId],maxChars:128});
      assert(small.blocked&&validatePack(s,small,options).length>0,'关键条目放不下时未阻止输出');
    });
    await check('规则检查区分合规、违规与缺少证据',async()=>{
      const s=await repository.snapshot();
      const run=value=>checkStructured(s,[{entryId,fields:value}],options);
      assert(run(fields).results.some(r=>r.ruleId==='functional-flow-rule'&&r.result==='pass'),'合规值未通过');
      assert(run({...fields,value:9}).results.some(r=>r.result==='fail'),'超出流量上限未检出');
      assert(run({status:'awaiting_confirmation'}).results.some(r=>r.result==='insufficient_evidence'),'缺失值被当成通过');
      const diagnostic=diagnose(s,{watchIds:['functional-watch'],options,retrievedIds:[],pack:oldPack});
      assert(diagnostic.rows[0].codes.includes('NOT_RETRIEVED')&&diagnostic.rows[0].codes.includes('SERVER_CONTEXT_UNKNOWN'),'遗漏诊断误报已召回或已送达');
    });
    await check('更新版本、旧包失效与旧值检查',async()=>{
      const updatedQuote='原创变更单：温室甲泵流量上限修订为 10 L/min，状态仍为 awaiting_confirmation。';
      const digest=await hash(updatedQuote);
      await repository.mutate(s=>{
        const e=s.entries.find(x=>x.id===entryId),src=addSource(s,{name:'原创变更单',text:updatedQuote,sha256:digest});
        saveEntry(s,{...e,content:updatedQuote,fields:{...e.fields,value:10},sourceRefs:[{sourceId:src.id,sourceVersion:1,start:0,end:updatedQuote.length,quote:updatedQuote}]},{expectedVersion:e.version,confirm:true,reason:'原创变更单核对完成'});
        const rule=s.rules.find(r=>r.id==='functional-flow-rule');rule.value=10;rule.version++;
      });
      const s=await repository.snapshot();
      assert(validatePack(s,oldPack,options).length>0,'旧资料包在版本变化后仍可使用');
      assert(s.versions.some(v=>v.entryId===entryId&&v.fields.value===8),'旧版本审计记录丢失');
      assert(checkStructured(s,[{entryId,fields}],options).results.some(r=>r.code==='STALE_VALUE_USED'),'旧版本值没有被指出');
    });
    await check('相互矛盾的记录阻塞，明确解决后恢复',async()=>{
      let rivalId;
      await repository.mutate(s=>{const e=s.entries.find(x=>x.id===entryId);rivalId=saveEntry(s,{...e,id:undefined,title:'温室甲泵待核实变更',fields:{...e.fields,value:11},content:'原创争议资料',sourceRefs:[],evidenceKind:'user_asserted'},{confirm:true,reason:'原创争议对照'}).id;});
      const conflict=await repository.snapshot();
      assert(!retrieve(conflict,'温室甲泵',options).hits.some(h=>[entryId,rivalId].includes(h.id)),'未处理的冲突被当成单一确定事实');
      await repository.mutate(s=>{const a=s.entries.find(e=>e.id===entryId),b=s.entries.find(e=>e.id===rivalId);resolveConflict(s,a.id,b.id,[a.version,b.version],'采用有原文的 10 L/min 变更单');});
      const resolved=await repository.snapshot();
      assert(retrieve(resolved,'温室甲泵',options).hits[0]?.id===entryId,'明确解决冲突后未恢复检索');
      assert(resolved.entries.find(e=>e.id===rivalId).lifecycleStatus==='superseded','争议来源未保留为已替代历史');
    });
    await check('事务失败完整回滚',async()=>{
      const before=await repository.snapshot();let rejected=false;
      // Repository queues earlier stores' put requests before validating the
      // later events table. Its duplicate key then aborts those pending writes.
      try{await repository.mutate(s=>{createLibrary(s,'这笔事务必须回滚');s.entries[0].title='不应落盘';s.events.push({...s.events[0]});});}catch{rejected=true;}
      assert(rejected&&equal(before,await repository.snapshot()),'失败事务留下了部分更新');
    });
    await check('两个独立连接同时保存不丢更新',async()=>{
      peer=createRepository(TEST_DATABASE);await peer.open();
      await Promise.all([repository.mutate(s=>createLibrary(s,'并发验收甲')),peer.mutate(s=>createLibrary(s,'并发验收乙'))]);
      const names=(await repository.snapshot()).libraries.map(l=>l.name);
      assert(names.includes('并发验收甲')&&names.includes('并发验收乙'),'两个连接保存发生更新丢失');
      peer.close();peer=null;
    });
    await check('持续任务与长期核心保存、关闭重开和历史读回',async()=>{
      const task=await repository.mutate(s=>saveTask(s,{libraryId,name:'原创温室试运行跟进',goal:'核对流量限制并记录试运行进度',constraints:'保持设备身份和当前已确认参数，不把模型推断视为已确认事实',progress:'已确认当前流量上限，尚未完成试运行',openQuestions:'试运行结果待确认',coreEntryIds:[entryId]}));
      memoryTaskId=task.id;
      const before=await repository.snapshot();repository.close();repository=createRepository(TEST_DATABASE);
      const actual=await repository.snapshot();
      assert(equal(before,actual),'任务保存后重新打开数据库，数据不一致');
      assert(equal(taskById(actual,memoryTaskId),task)&&actual.taskVersions.some(v=>v.taskId===task.id&&v.version===1&&v.goal===task.goal),'任务档案或历史快照没有持久保存');
      return{tasks:actual.tasks.length,taskVersions:actual.taskVersions.length,coreEntries:task.coreEntryIds.length};
    });
    await check('无关键词仍携带长期核心并生成跨 AI 任务协议',async()=>{
      const s=await repository.snapshot(),selection=taskSelection(s,memoryTaskId,'',options);
      assert(selection.selectedIds.includes(entryId)&&selection.pinnedIds.includes(entryId),'无关键词时永久核心被清空');
      oldTaskPack=buildPack(s,{...options,...selection,task:'继续当前任务',memoryTaskId,binding:null,maxChars:6000});
      assert(oldTaskPack.memoryTask?.id===memoryTaskId&&oldTaskPack.binding===null&&oldTaskPack.included.some(item=>item.id===entryId),'跨 AI 包缺少任务、永久核心或错误绑定网站');
      assert(!oldTaskPack.included.some(item=>[localId,foreignId].includes(item.id)),'跨 AI 包混入仅限本地或其他项目资料');
      assert(oldTaskPack.text.includes('TEXT-MEMORY-UPDATE')&&oldTaskPack.text.includes('END-TEXT-MEMORY-UPDATE')&&oldTaskPack.text.includes('"baseVersion": 1'),'任务更新协议缺失');
      assert(!oldTaskPack.blocked&&oldTaskPack.characters<=6000&&validatePack(s,oldTaskPack,{...options,binding:null,memoryTaskId}).length===0,'跨 AI 任务包未通过预算或版本复核');
      await repository.mutate(s=>rememberPack(s,oldTaskPack));
      return{characters:oldTaskPack.characters,coreIncluded:true,providerIndependent:true};
    });
    await check('候选更新任务进度、保留待审核事实并拒绝旧回复',async()=>{
      const before=await repository.snapshot(),task=taskById(before,memoryTaskId);
      const text='TEXT-MEMORY-UPDATE\n'+JSON.stringify({taskId:memoryTaskId,baseVersion:task.version,packId:oldTaskPack.id,progress:'原创验收更新：已记录第一次试运行观察，尚待人工核验',openQuestions:'观察结果与实测记录是否一致',facts:[{title:'原创试运行观察候选',content:'这是本脚本构造的模型候选；观察结果尚未经过人工核验。',aliases:['试运行观察']} ]})+'\nEND-TEXT-MEMORY-UPDATE';
      const preview=prepareMemoryUpdate(before,memoryTaskId,text);
      assert(equal(before,await repository.snapshot()),'预览候选时已经写入数据库');
      const result=await repository.mutate(s=>applyMemoryUpdate(s,preview)),after=await repository.snapshot(),updated=taskById(after,memoryTaskId);
      assert(updated.version===2&&updated.progress===preview.progress&&updated.openQuestions===preview.openQuestions,'任务候选进度未保存为下一版本');
      assert(updated.goal===task.goal&&updated.constraints===task.constraints&&equal(updated.coreEntryIds,task.coreEntryIds),'候选改写了目标、约束或核心选择');
      assert(result.entries.length===1&&result.entries.every(e=>after.entries.some(saved=>saved.id===e.id&&saved.reviewStatus==='pending'&&saved.evidenceKind==='inferred')),'新增模型事实没有保持待审核/推断分类');
      assert(after.taskVersions.filter(v=>v.taskId===memoryTaskId).length===2&&after.packs.find(p=>p.id===oldTaskPack.id)?.stale,'任务历史或旧资料包失效状态缺失');
      assert(validatePack(after,oldTaskPack,{...options,memoryTaskId}).length>0,'旧任务资料包仍可使用');
      let replayRejected=false;try{prepareMemoryUpdate(after,memoryTaskId,text);}catch(error){replayRejected=error.code==='version_conflict';}
      assert(replayRejected&&equal(after,await repository.snapshot()),'旧回复未被拒绝或改变了已保存资料');
      currentTaskPack=buildPack(after,{...options,task:'继续当前任务',memoryTaskId,binding:null,maxChars:6000});
      assert(validatePack(after,currentTaskPack,{...options,memoryTaskId}).length===0,'更新后的任务包无法重新生成');
      await repository.mutate(s=>rememberPack(s,currentTaskPack));
      return{taskVersion:updated.version,pendingFacts:result.entries.length,oldReplyRejected:true};
    });
    await check('轮次独立快照保存及关闭连接后恢复原问题',async()=>{
      const created=await repository.mutate(s=>{
        const task=saveTask(s,{libraryId,name:'原创轮次接续验收',goal:'核对温室甲泵并保留原始巡检问题',progress:'等待第一轮巡检资料',constraints:'仅使用当前项目的已确认资料',openQuestions:'巡检还缺少哪些信息',coreEntryIds:[entryId]});
        const pack=buildPack(s,{...options,task:'完成温室甲泵第一轮巡检',memoryTaskId:task.id,binding:null,maxChars:8000});
        return{task,round:prepareRound(s,pack)};
      });
      harnessTaskId=created.task.id;harnessRoundId=created.round.id;
      const before=await repository.snapshot();
      assert(!before.packs.some(pack=>pack.id===created.round.packSnapshot.id),'本例必须不依赖最近资料包缓存');
      repository.close();repository=createRepository(TEST_DATABASE);
      const actual=await repository.snapshot(),resumed=resumeRound(actual,harnessRoundId);
      assert(equal(before,actual)&&equal(resumed.round,created.round),'重开连接后轮次快照不一致');
      assert(resumed.pack.id===created.round.packSnapshot.id&&resumed.pack.text===created.round.packSnapshot.text&&resumed.pack.task===created.round.question,'恢复丢失原问题或完整资料包');
      assert(validatePack(actual,resumed.pack,{...options,memoryTaskId:harnessTaskId}).length===0,'恢复的轮次包不能通过当前状态检查');
      return{roundStatus:resumed.round.status,cacheIndependent:true,reopenKind:'database_connection_only'};
    });
    await check('AI 检索请求补充当前库资料并保护原问题与核心',async()=>{
      harnessExtraId=(await repository.mutate(s=>saveEntry(s,{libraryId,title:'Q47 轮次补充资料',content:'原创补充：巡检结束后还需人工复核阀门状态。',fields:{},aliases:['Q47 补充资料'],evidenceKind:'user_asserted'},{confirm:true,reason:'原创轮次补充夹具'}))).id;
      const before=await repository.snapshot(),task=taskById(before,harnessTaskId),round=roundById(before,harnessRoundId);
      const request='TEXT-MEMORY-SEARCH\n'+JSON.stringify({taskId:task.id,baseVersion:task.version,packId:round.packSnapshot.id,query:'Q47 补充资料'})+'\nEND-TEXT-MEMORY-SEARCH';
      const foreignLibrary=before.entries.find(entry=>entry.id===foreignId).libraryId;
      const result=executeMemorySearch(before,task.id,request,{...options,libraryIds:[libraryId,foreignLibrary]});
      assert(equal(result.retrieved.options.libraryIds,[libraryId]),'模型检索请求扩大了任务资料库范围');
      assert(result.selectedIds.includes(entryId)&&result.pinnedIds.includes(entryId)&&result.selectedIds.includes(harnessExtraId),'补充检索丢失长期核心或新增资料');
      assert(!result.retrieved.hits.some(hit=>[localId,foreignId].includes(hit.id))&&!JSON.stringify(result).includes('原创本地保留备注'),'补充结果包含仅限本地或其他项目内容');
      assert(equal(before,await repository.snapshot()),'执行只读检索时已经修改轮次或任务');
      const pack=buildPack(before,{...options,...result,task:round.question,memoryTaskId:task.id,binding:null,maxChars:8000});
      const replaced=await repository.mutate(s=>replaceRoundPack(s,round.id,pack,{expectedVersion:round.version}));
      assert(replaced.status==='prepared'&&replaced.question===round.question&&replaced.packSnapshot.included.some(item=>item.id===entryId)&&replaced.packSnapshot.included.some(item=>item.id===harnessExtraId),'替换补充包后丢失原问题、核心或补充资料');
      assert(taskById(await repository.snapshot(),task.id).version===task.version,'补充检索不应更新任务进度版本');
      return{coreRetained:true,supplementIncluded:true,questionUnchanged:true};
    });
    await check('模拟交付、候选确认与轮次完成同事务提交及回滚',async()=>{
      const before=await repository.snapshot(),prepared=roundById(before,harnessRoundId);
      // The state transition receives an original synthetic success result;
      // this acceptance runner never writes the clipboard or a webpage.
      const delivered=await repository.mutate(s=>markRoundDelivered(s,prepared.id,{expectedVersion:prepared.version,deliveryKind:'clipboard'}));
      const current=await repository.snapshot(),task=taskById(current,harnessTaskId);
      const text='TEXT-MEMORY-UPDATE\n'+JSON.stringify({taskId:task.id,baseVersion:task.version,packId:delivered.packSnapshot.id,progress:'原创轮次验收：第一轮资料已整理，结果仍待核验',openQuestions:'人工复核是否通过',facts:[{title:'原创轮次待审核观察',content:'本轮补充得到的原创观察，尚未经人工确认。',aliases:[]}]})+'\nEND-TEXT-MEMORY-UPDATE';
      const preview=prepareMemoryUpdate(current,task.id,text),identity={expectedVersion:delivered.version,taskId:task.id,baseVersion:task.version,packId:preview.packId};
      let rejected=false;
      try{await repository.mutate(s=>{validateRoundUpdate(s,delivered.id,identity);applyMemoryUpdate(s,preview);completeRound(s,delivered.id,{...identity,expectedVersion:delivered.version+100});});}catch(error){rejected=error.code==='version_conflict';}
      assert(rejected&&equal(current,await repository.snapshot()),'轮次完成失败后留下任务、候选或轮次的部分写入');
      await repository.mutate(s=>{validateRoundUpdate(s,delivered.id,identity);const result=applyMemoryUpdate(s,preview);completeRound(s,delivered.id,identity);return result;});
      const after=await repository.snapshot();
      assert(roundById(after,delivered.id).status==='completed'&&taskById(after,task.id).version===task.version+1&&activeRound(after,task.id)===null,'任务进度与轮次完成状态没有一起提交');
      assert(after.entries.some(entry=>entry.title==='原创轮次待审核观察'&&entry.reviewStatus==='pending'&&entry.evidenceKind==='inferred'),'轮次候选错误获得已确认地位');
      let replayRejected=false;try{prepareMemoryUpdate(after,task.id,text);}catch(error){replayRejected=error.code==='version_conflict';}assert(replayRejected,'已完成轮次的旧回复仍被接受');
      harnessNextRoundId=(await repository.mutate(s=>prepareRound(s,buildPack(s,{...options,task:'继续第二轮温室甲泵巡检',memoryTaskId:task.id,binding:null,maxChars:8000})))).id;
      return{deliveryEvidence:'synthetic_success_only',completed:true,rollbackVerified:true,pendingFacts:1,nextRoundPrepared:true};
    });
    await check('备份预检、异库恢复与限制保留',async()=>{
      const s=await repository.snapshot(),backup=exportBackup(s),preview=await preflightBackup(backup,await restored.snapshot());
      await restored.mutate(s=>commitBackup(s,preview));restored.close();restored=createRepository(RESTORE_DATABASE);
      const actual=await restored.snapshot();
      for(const table of ['libraries','entries','versions','sources','templates','rules','watches'])assert(equal(s[table],actual[table]),`${table} 恢复后不一致`);
      assert(actual.templates.length>0,'没有恢复非空模板');
      assert(s.packs.length>0&&equal(s.packs.map(p=>p.id),actual.packs.map(p=>p.id))&&actual.packs.every(p=>p.stale),'备份中的资料包丢失或没有失效');
      assert(s.events.every(e=>actual.events.some(a=>equal(a,e))),'恢复丢失原有审计事件');
      assert(actual.entries.find(e=>e.id===localId).sensitivity==='local_only','恢复丢失仅本地限制');
    });
    await check('备份恢复持续任务历史且旧任务包失效',async()=>{
      const original=await repository.snapshot(),actual=await restored.snapshot();
      for(const table of ['tasks','taskVersions'])assert(equal(original[table],actual[table]),`${table} 恢复后不一致`);
      const task=taskById(actual,memoryTaskId),restoredPack=actual.packs.find(p=>p.id===currentTaskPack.id);
      assert(task?.version===2&&task.coreEntryIds.includes(entryId),'恢复后的任务或长期核心不完整');
      assert(restoredPack?.stale&&validatePack(actual,restoredPack,{...options,memoryTaskId}).length>0,'恢复后的旧任务包未强制失效');
      const rebuilt=buildPack(actual,{...options,task:'在另一个 AI 继续',memoryTaskId,binding:null,maxChars:6000});
      assert(validatePack(actual,rebuilt,{...options,memoryTaskId}).length===0&&rebuilt.text.includes(task.progress),'恢复任务无法用已保存进度重新生成跨 AI 包');
      return{tasks:actual.tasks.length,taskVersions:actual.taskVersions.length,rebuildValid:true};
    });
    await check('备份恢复已完成轮次与可继续的独立快照',async()=>{
      const original=await repository.snapshot(),actual=await restored.snapshot();
      assert(equal(original.rounds,actual.rounds),'轮次备份恢复缺少记录或改变了快照');
      assert(roundById(actual,harnessRoundId)?.status==='completed','已完成轮次状态没有保留');
      const resumed=resumeRound(actual,harnessNextRoundId);
      assert(resumed.round.status==='prepared'&&resumed.pack.task==='继续第二轮温室甲泵巡检'&&resumed.pack.memoryTask.version===2,'未完成轮次不能恢复原问题和当前任务版本');
      assert(!actual.packs.some(pack=>pack.id===resumed.pack.id)&&validatePack(actual,resumed.pack,{...options,memoryTaskId:harnessTaskId}).length===0,'备份轮次恢复依赖缓存或无法通过最新状态检查');
      return{rounds:actual.rounds.length,completed:1,resumable:1,cacheIndependent:true};
    });
    await check('损坏备份被拒绝且不影响已恢复库',async()=>{
      const before=await restored.snapshot(),corrupt=exportBackup(await repository.snapshot());
      corrupt.tables.sources[0].text+='篡改';let rejected=false;
      try{await preflightBackup(corrupt,Object.fromEntries(TABLES.map(t=>[t,[]])));}catch{rejected=true;}
      assert(rejected&&equal(before,await restored.snapshot()),'损坏备份被放行或改变了恢复库');
    });
    await check('恢复库删除条目保留共享来源和独立原库',async()=>{
      const original=await repository.snapshot(),before=await restored.snapshot(),preview=deletionPreview(before,entryId);
      await restored.mutate(s=>deleteEntry(s,preview,preview.sources.filter(x=>!x.shared).map(x=>x.sourceId)));
      const s=await restored.snapshot();
      assert(!s.entries.some(e=>e.id===entryId)&&!s.versions.some(v=>v.entryId===entryId),'删除后仍有条目历史副本');
      assert(!s.packs.some(p=>p.included.some(e=>e.id===entryId)),'删除后仍有关联资料包');
      assert(!s.rounds.some(round=>round.packSnapshot.included.some(entry=>entry.id===entryId)),'删除后仍有包含该条目正文的轮次快照');
      assert(preview.sources.some(x=>x.shared)&&preview.sources.filter(x=>x.shared).every(x=>s.sources.some(source=>source.id===x.sourceId)),'共享来源被误删');
      assert(equal(original,await repository.snapshot()),'恢复库删除影响了原库');
    });
    await check('连续回执精确去重、变更候选保留与重开核对',async()=>{
      const fixture=await repository.mutate(s=>{const library=createLibrary(s,'原创去重验收库');return saveTask(s,{libraryId:library.id,name:'去重任务',goal:'保留风向记录',constraints:'未核实的观察仍待审核',coreEntryIds:[]});});
      const fact={title:'海湾风向',content:'原创测试：海湾风向为东风。',aliases:['海湾']};
      const update=async facts=>{const s=await repository.snapshot(),task=taskById(s,fixture.id),preview=prepareMemoryUpdate(s,task.id,`TEXT-MEMORY-UPDATE\n${JSON.stringify({taskId:task.id,baseVersion:task.version,progress:'已收集观察',openQuestions:'待复核',facts})}\nEND-TEXT-MEMORY-UPDATE`);return repository.mutate(s=>applyMemoryUpdate(s,preview));};
      const first=await update([fact,fact]),stored=(await repository.snapshot()).entries.find(e=>e.id===first.entries[0]?.id);
      assert(first.entries.length===1&&first.deduplicated===1&&stored?.reviewStatus==='pending','批内重复没有折叠为单条待审核候选');
      const second=await update([fact]);assert(second.entries.length===0&&second.deduplicated===1,'跨轮重复写入了新条目');
      const changed=await update([{...fact,content:'原创测试：海湾风向为西风。'}]);assert(changed.entries.length===1&&changed.entries[0].reviewStatus==='pending','变化被误合并或自动确认');
      repository.close();repository=createRepository(TEST_DATABASE);const after=await repository.snapshot(),task=taskById(after,fixture.id);
      assert(equal(stored,after.entries.find(e=>e.id===stored.id)),'重复处理改变了原条目或重开后丢失');
      assert(after.entries.filter(e=>e.libraryId===fixture.libraryId).length===2&&task.version===4&&task.goal===fixture.goal&&equal(task.coreEntryIds,fixture.coreEntryIds)&&task.constraints===fixture.constraints,'去重结果或原任务目标约束不一致');
      return{receivedFacts:4,newCandidates:2,duplicatesSkipped:2,pendingOnly:true,reopenKind:'database_connection_only'};
    });
    await check('三片提炼计划与两个独立连接的版本竞争不重复准备',async()=>{
      const text=extractionQuotes.map((quote,index)=>quote+'\n'+(`原创片段 ${index+1} 的测试背景。`.repeat(400)).slice(0,(index===2?700:4000)-quote.length-1)).join(''),sha256=await hash(text);
      extractionFixture=await repository.mutate(s=>{const library=createLibrary(s,'原创三片提炼验收'),source=addSource(s,{name:'原创航海三片文档',text,sha256}),raw=saveEntry(s,{libraryId:library.id,title:'原始待审核文档',content:text,fields:{},evidenceKind:'direct',sourceRefs:[{sourceId:source.id,sourceVersion:1,start:0,end:text.length,quote:text}]}),core=saveEntry(s,{libraryId:library.id,title:'航海任务约束',content:'只整理原文有出处的线索，候选仍须核对。',fields:{},evidenceKind:'user_asserted'},{confirm:true}),task=saveTask(s,{libraryId:library.id,name:'原创三片提炼任务',goal:'整理人物能力、钥匙位置和石门约束',constraints:'原文引用与候选含义分开核对',coreEntryIds:[core.id]}),queue=createExtractionQueue(s,{taskId:task.id,sourceId:source.id,sliceCount:3,maxChars:16000});return{library,source,raw,core,task,queue};});
      completedQueueId=extractionFixture.queue.id;assert(equal(extractionFixture.queue.ranges,[{start:0,end:4000},{start:4000,end:8000},{start:8000,end:8700}]),'三片计划没有按原文形成连续边界');
      peer=createRepository(TEST_DATABASE);await peer.open();
      const competing=await Promise.allSettled([repository.mutate(s=>prepareQueuedSlice(s,completedQueueId,{expectedVersion:1})),peer.mutate(s=>prepareQueuedSlice(s,completedQueueId,{expectedVersion:1}))]);
      const successes=competing.filter(item=>item.status==='fulfilled'),failures=competing.filter(item=>item.status==='rejected'),s=await repository.snapshot(),queue=extractionQueueById(s,completedQueueId),rounds=s.rounds.filter(round=>round.taskId===extractionFixture.task.id);
      assert(successes.length===1&&failures.length===1&&failures[0].reason.code==='version_conflict','两连接没有按同一队列版本拒绝过时准备');
      assert(rounds.length===1&&queue.activeRoundId===rounds[0].id&&queue.currentIndex===0,'竞争准备重复创建轮次或提前推进片段');peer.close();peer=null;
      return{slices:3,characters:text.length,independentConnections:2,successfulPrepare:1,versionRejected:1,rounds:1,sendsMessages:false};
    });
    await check('三片模拟提炼回执顺序提交、出处保留且候选仍待审核',async()=>{
      const packIds=[];
      for(let index=0;index<3;index++){
        const before=await repository.snapshot(),queue=extractionQueueById(before,completedQueueId),prepared=await repository.mutate(s=>prepareQueuedSlice(s,queue.id,{expectedVersion:queue.version})),meta=prepared.pack.sourceExtraction;
        assert(meta.start===index*4000&&meta.text.includes(extractionQuotes[index])&&prepared.pack.memoryTask.version===index+1&&prepared.pack.memoryTask.goal===extractionFixture.task.goal&&prepared.pack.included.some(entry=>entry.id===extractionFixture.core.id),'当前片段、任务版本、目标或核心未保留');packIds.push(prepared.pack.id);
        const delivered=await repository.mutate(s=>markRoundDelivered(s,prepared.round.id,{expectedVersion:prepared.round.version,deliveryKind:'clipboard'})),snapshot=await repository.snapshot(),task=taskById(snapshot,extractionFixture.task.id);
        const payload={taskId:task.id,baseVersion:task.version,packId:prepared.pack.id,progress:`已处理第 ${index+1} 片原创模拟回执`,openQuestions:'候选含义仍待人工核对',facts:[{title:`航海提炼候选 ${index+1}`,content:extractionQuotes[index],aliases:[],evidence:[{sourceId:meta.sourceId,version:meta.sourceVersion,quote:extractionQuotes[index]}],assessment:'supported'}]},preview=prepareMemoryUpdate(snapshot,task.id,'TEXT-MEMORY-UPDATE\n'+JSON.stringify(payload)+'\nEND-TEXT-MEMORY-UPDATE'),identity={expectedVersion:delivered.version,taskId:task.id,baseVersion:task.version,packId:prepared.pack.id};
        assert(preview.evidenceReview.eligibleCount===1&&preview.evidenceReview.excludedCount===0,'原创回执的逐字引用未通过');
        await repository.mutate(s=>{validateRoundUpdate(s,delivered.id,identity);const result=applyMemoryUpdate(s,preview);completeRound(s,delivered.id,identity);completeQueuedSlice(s,queue.id,delivered.id);return result;});
      }
      const actual=await repository.snapshot(),queue=extractionQueueById(actual,completedQueueId),task=taskById(actual,extractionFixture.task.id),candidates=browseExtractionCandidates(actual,{libraryId:task.libraryId}).candidates;
      assert(queue.status==='completed'&&queue.currentIndex===3&&queue.activeRoundId===null&&queue.completedRoundIds.length===3&&new Set(packIds).size===3&&task.version===4,'三片没有在有限边界完整提交');validateExtractionQueues(actual);
      assert(candidates.length===3&&candidates.every(row=>row.entry.evidenceKind==='inferred'&&row.entry.reviewStatus==='pending'&&row.references.length===1&&row.references[0].valid),'回执候选被自动确认或丢失原文出处');
      assert(equal(task.coreEntryIds,extractionFixture.task.coreEntryIds)&&task.constraints===extractionFixture.task.constraints&&actual.entries.find(entry=>entry.id===extractionFixture.raw.id).reviewStatus==='pending','提炼改变了重要记忆或自动审核原始文档');
      return{completedSlices:3,distinctPacks:3,pendingCandidates:3,exactReferences:3,taskVersion:4,receiptEvidence:'scripted_original_payloads',deliveryEvidence:'synthetic_success_only'};
    });
    await check('暂停提炼队列在关闭重开后保留位置且不会自行准备下一片',async()=>{
      const paused=await repository.mutate(s=>{const created=createExtractionQueue(s,{taskId:extractionFixture.task.id,sourceId:extractionFixture.source.id,sliceCount:3,maxChars:16000}),prepared=prepareQueuedSlice(s,created.id,{expectedVersion:created.version});return pauseExtractionQueue(s,created.id,{expectedVersion:prepared.queue.version});});pausedQueueId=paused.id;
      const before=await repository.snapshot();repository.close();repository=createRepository(TEST_DATABASE);const actual=await repository.snapshot(),queue=extractionQueueById(actual,pausedQueueId);assert(equal(before,actual)&&queue?.status==='paused'&&queue.currentIndex===0&&queue.activeRoundId===paused.activeRoundId,'暂停位置或绑定轮次在重开后丢失');
      let rejected=false;try{await repository.mutate(s=>prepareQueuedSlice(s,queue.id,{expectedVersion:queue.version}));}catch(error){rejected=error.code==='queue_not_ready';}assert(rejected&&equal(actual,await repository.snapshot()),'暂停队列仍可推进或修改数据');
      return{status:'paused',preparedSlices:1,currentIndex:0,reopenKind:'database_connection_only',automaticResume:false};
    });
    await check('备份恢复已完成和暂停队列，显式恢复后复用原片段',async()=>{
      const original=await repository.snapshot();await reset(restored);const preview=await preflightBackup(exportBackup(original),await restored.snapshot());await restored.mutate(s=>commitBackup(s,preview));restored.close();restored=createRepository(RESTORE_DATABASE);
      const actual=await restored.snapshot();assert(equal(original.extractionQueues,actual.extractionQueues)&&equal(original.rounds,actual.rounds),'备份恢复丢失或改写队列和轮次');validateExtractionQueues(actual);
      const completed=extractionQueueById(actual,completedQueueId),paused=extractionQueueById(actual,pausedQueueId);assert(completed.status==='completed'&&completed.currentIndex===3&&paused.status==='paused','恢复没有保留完成与暂停状态');
      const next=await restored.mutate(s=>{const ready=resumeExtractionQueue(s,paused.id,{expectedVersion:paused.version});return prepareQueuedSlice(s,ready.id,{expectedVersion:ready.version});}),after=await restored.snapshot();
      assert(next.round.id===paused.activeRoundId&&next.pack.sourceExtraction.start===0&&after.rounds.length===actual.rounds.length&&after.extractionQueues.length===2,'显式恢复重复创建轮次或跳过片段');assert(equal(original,await repository.snapshot()),'恢复队列操作影响了原数据库');
      return{completedQueues:1,pausedQueues:1,restoredQueues:2,reusedPreparedRound:true,sourceDatabaseUnchanged:true};
    });
    await check('候选集中确认保留本地限制，陈旧预览整笔回滚后可重新核对',async()=>{
      const localText='原创审核验收：本地保留的航海备注。',sha256=await hash(localText),local=await repository.mutate(s=>{const source=addSource(s,{name:'仅限本地的原创审核来源',text:localText,sha256,sensitivity:'local_only'});return saveEntry(s,{libraryId:extractionFixture.library.id,title:'仅限本地的提炼候选',content:localText,fields:{},evidenceKind:'inferred',tags:['模型候选','原文提炼','提炼自评：uncertain'],sourceRefs:[{sourceId:source.id,sourceVersion:1,start:0,end:localText.length,quote:localText}]});});
      const before=await repository.snapshot(),ordinary=before.entries.find(entry=>entry.title==='航海提炼候选 1'),ids=[ordinary.id,local.id],preview=prepareCandidateReview(before,{libraryId:extractionFixture.library.id,entryIds:ids});assert(preview.restrictedCount===1&&equal(before,await repository.snapshot()),'审核预览改变数据或丢失本地分类');
      await repository.mutate(s=>{const entry=s.entries.find(row=>row.id===ordinary.id);saveEntry(s,{...entry,content:entry.content+'（另一面板待核对补充）'},{expectedVersion:entry.version});});const changed=await repository.snapshot();let rejected=false;
      try{await repository.mutate(s=>applyCandidateReview(s,preview));}catch(error){rejected=error.code==='version_conflict';}assert(rejected&&equal(changed,await repository.snapshot())&&ids.every(id=>changed.entries.find(entry=>entry.id===id).reviewStatus==='pending'),'陈旧审核预览留下部分确认或历史写入');
      const current=await repository.snapshot(),review=prepareCandidateReview(current,{libraryId:extractionFixture.library.id,entryIds:ids}),result=await repository.mutate(s=>applyCandidateReview(s,review)),after=await repository.snapshot();
      assert(result.confirmed===2&&ids.every(id=>{const a=after.entries.find(entry=>entry.id===id),b=current.entries.find(entry=>entry.id===id);return a.reviewStatus==='confirmed'&&a.evidenceKind==='inferred'&&a.version===b.version+1&&equal(a.sourceRefs,b.sourceRefs);})&&after.entries.find(entry=>entry.id===local.id).sensitivity==='local_only','确认没有保留引用、推断性质或仅限本地限制');
      assert(equal(current.tasks,after.tasks)&&equal(current.sources,after.sources)&&after.entries.find(entry=>entry.id===extractionFixture.raw.id).reviewStatus==='pending','集中审核改写任务核心、原文或原始片段审核状态');
      repository.close();repository=createRepository(TEST_DATABASE);assert(equal(after,await repository.snapshot()),'集中确认结果在重开后丢失');return{explicitlyConfirmed:2,restrictedPreserved:1,stalePreviewRejected:true,atomicRollback:true,taskCoreUnchanged:true,reopenKind:'database_connection_only'};
    });
    report.status='pass';
  }catch{/* First failure stops dependent scenarios; its reason is in steps. */}
  finally{repository.close();restored.close();peer?.close();}
  report.passed=report.steps.filter(s=>s.ok).length;report.total=28;
  return report;
}
