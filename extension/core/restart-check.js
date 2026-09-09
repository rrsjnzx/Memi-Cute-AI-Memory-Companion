import {VERSION} from './version.js';
import {TABLES,id,now,hash,stable,clone,requireThat} from './base.js';
import {createLibrary,addSource,saveEntry} from './library.js';
import {retrieve} from './retrieval.js';
import {buildPack,rememberPack,validatePack} from './pack.js';

const DATABASE='text-memory-restart-check-v1';
const CHECKPOINT='restartCheckCheckpoint';
const snapshotHash=state=>hash(stable(Object.fromEntries(TABLES.map(t=>[t,[...state[t]].sort((a,b)=>String(a.id).localeCompare(String(b.id))||((a.version||0)-(b.version||0)))]))));
const counts=state=>Object.fromEntries(TABLES.map(t=>[t,state[t].length]));
const validTimestamp=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  &&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const report=(phase,storageKind)=>({id:id('restart_test'),version:VERSION,at:now(),kind:'isolated_restart_persistence_check',phase,
  status:'fail',storageKind,steps:[],sendsMessages:false,touchesDraft:false,
  note:'仅检查已提交的独立原创资料在浏览器启动事件前后是否一致；不是断电、写入途中崩溃或正式资料库验收。'});

export async function prepareRestartCheck({createRepository,local,startupMarker,storageKind='indexeddb'}){
  const result=report('prepare',storageKind),repo=createRepository(DATABASE);
  try{
    // Invalidate the old receipt before replacing its isolated data. A failed
    // preparation must not leave a previous checkpoint looking ready to verify.
    await local.set({[CHECKPOINT]:null});
    const text='原创重启验收：设备 RESTART-P17 的限额是 42，状态 awaiting_confirmation。';
    const sha256=await hash(text);
    const {expected,...ids}=await repo.mutate(s=>{
      for(const table of TABLES)s[table]=[];
      const library=createLibrary(s,'独立重启验收'),source=addSource(s,{name:'原创重启确认单',text,sha256});
      let entry=saveEntry(s,{libraryId:library.id,title:'RESTART-P17',content:text,fields:{value:41,status:'awaiting_confirmation'},sourceRefs:[{sourceId:source.id,sourceVersion:1,start:0,end:text.length,quote:text}],evidenceKind:'direct'},{reason:'原创旧版本，待审核'});
      entry=saveEntry(s,{...entry,fields:{value:42,status:'awaiting_confirmation'}},{expectedVersion:entry.version,confirm:true,reason:'按原创确认单核对'});
      s.rules.push({id:id('rule'),version:1,libraryId:library.id,entryId:entry.id,type:'max',field:'value',value:42,confirmed:true});
      for(let i=0;i<100;i++)saveEntry(s,{libraryId:library.id,title:`重启填充 ${i}`,content:'原创持久化测试文本。'.repeat(20),fields:{index:i},sensitivity:'local_only'},{confirm:true,reason:'原创独立填充'});
      const pack=buildPack(s,{libraryIds:[library.id],task:'重启后核对原有资料包',selectedIds:[entry.id],pinnedIds:[entry.id]});rememberPack(s,pack);
      const fillers=s.entries.filter(e=>e.id!==entry.id),indexes=new Set(fillers.map(e=>e.fields.index));
      requireThat(s.libraries.length===1&&s.sources.length===1&&s.entries.length===101&&s.versions.length===102,'准备的资料或版本数量不完整');
      requireThat(fillers.length===100&&indexes.size===100&&Array.from({length:100},(_,i)=>i).every(i=>indexes.has(i))
        &&fillers.every(e=>e.libraryId===library.id&&e.reviewStatus==='confirmed'&&e.sensitivity==='local_only'),'准备的填充记录缺失、重复或状态异常');
      requireThat(entry.fields.value===42&&entry.reviewStatus==='confirmed'
        &&s.versions.some(v=>v.entryId===entry.id&&v.fields.value===41&&v.reviewStatus==='pending'),'准备的主记录或历史版本异常');
      requireThat(s.rules.length===1&&s.rules[0].entryId===entry.id&&s.rules[0].confirmed&&s.rules[0].value===42
        &&s.packs.length===1&&pack.included.length===1&&pack.included[0].id===entry.id
        &&validatePack(s,pack,{libraryIds:[library.id]}).length===0,'准备的规则或资料包不可用');
      // Capture the complete intended state before the repository persists it.
      // Repeated reads of the same incomplete write must not sign themselves.
      return{libraryId:library.id,entryId:entry.id,packId:pack.id,expected:clone(s)};
    });
    const digest=await snapshotHash(expected),saved=await repo.snapshot();
    requireThat(await snapshotHash(saved)===digest,'检查点实际提交的数据与完整预期数据不一致');
    result.steps.push({name:'提交独立资料、版本、规则和资料包',ok:true,result:'committed',counts:counts(saved)});
    repo.close();
    const reopened=await repo.snapshot();requireThat(await snapshotHash(reopened)===digest,'检查点提交后重读不一致');
    const checkpoint={format:1,id:id('checkpoint'),preparedAt:now(),preparedVersion:'0.9.5',startupId:startupMarker?.id||null,digest,counts:counts(saved),...ids};
    await local.set({[CHECKPOINT]:checkpoint});
    result.steps.push({name:'独立保存重启前摘要',ok:true,result:'prepared'});
    result.status='prepared';result.checkpointId=checkpoint.id;
    result.message='检查点已保存。请正常关闭并重新启动浏览器，再点击“验证重启后数据”；无需再次准备检查点。';
  }catch(error){result.steps.push({name:'准备失败',ok:false,result:'error',message:error.message});}
  finally{repo.close();}
  return result;
}

export async function verifyRestartCheck({createRepository,local,startupMarker,storageKind='indexeddb'}){
  const result=report('verify',storageKind);let repo;
  try{
    const checkpoint=(await local.get(CHECKPOINT))[CHECKPOINT];
    requireThat(checkpoint?.format===1&&/^[a-f0-9]{64}$/.test(checkpoint.digest)&&validTimestamp(checkpoint.preparedAt),'缺少有效的重启前检查点，请先准备');
    result.checkpointId=checkpoint.id;
    if(startupMarker?.event!=='runtime.onStartup'||typeof startupMarker.id!=='string'||!startupMarker.id
      ||startupMarker.id===checkpoint.startupId||!validTimestamp(startupMarker.at)||Date.parse(startupMarker.at)<=Date.parse(checkpoint.preparedAt)){
      result.status='restart_not_observed';result.message='尚未观察到准备检查点之后的新浏览器启动事件；重载扩展或重开面板不算浏览器重启。';
      result.steps.push({name:'确认新的浏览器启动事件',ok:false,result:'not_observed'});return result;
    }
    result.steps.push({name:'确认新的浏览器启动事件',ok:true,result:'new_runtime_onStartup',at:startupMarker.at});
    repo=createRepository(DATABASE);const saved=await repo.snapshot();
    requireThat(await snapshotHash(saved)===checkpoint.digest,'重启后的资料、版本、规则或审计记录与检查点不一致');
    result.steps.push({name:'全表摘要与重启前一致',ok:true,result:'equal',counts:counts(saved)});
    const options={libraryIds:[checkpoint.libraryId]};
    requireThat(retrieve(saved,'RESTART-P17',options).hits[0]?.id===checkpoint.entryId,'重启后未召回已保存的条目');
    const entry=saved.entries.find(e=>e.id===checkpoint.entryId),pack=saved.packs.find(p=>p.id===checkpoint.packId);
    requireThat(entry?.fields.value===42&&entry.reviewStatus==='confirmed'&&saved.versions.some(v=>v.entryId===entry.id&&v.fields.value===41),'重启后版本链或确认状态异常');
    requireThat(pack&&validatePack(saved,pack,options).length===0,'重启后原资料包校验失败');
    result.steps.push({name:'检索、历史版本和原资料包仍可用',ok:true,result:'valid'});
    result.status='pass';result.message='观察到新的浏览器启动事件，已提交的独立资料与原检查点一致。';
  }catch(error){result.steps.push({name:'重启验证失败',ok:false,result:'error',message:error.message});}
  finally{repo?.close();}
  return result;
}
