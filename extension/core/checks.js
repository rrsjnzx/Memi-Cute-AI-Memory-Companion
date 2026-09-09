import {equal,id,now,requireThat,clone,scopeMatches} from './base.js';
import {validateFields} from './schema.js';
import {templateFor} from './library.js';
import {exclusion} from './retrieval.js';

export function validateRule(rule) {
  requireThat(['equals','max','min','enum','required','unique','transition','reference'].includes(rule.type),'不支持的规则类型');
  requireThat(typeof rule.field==='string'&&rule.field.length>0,'规则需要字段名');
  if(['max','min'].includes(rule.type))requireThat(typeof rule.value==='number'&&Number.isFinite(rule.value),'数值边界必须是有限数字');
  if(rule.type==='enum')requireThat(Array.isArray(rule.values)&&rule.values.length>0,'枚举规则需要 values');
  if(rule.type==='transition')requireThat(Array.isArray(rule.allowed)&&rule.allowed.every(x=>Array.isArray(x)&&x.length===2),'状态转换需要 allowed 数组');
  if(rule.exception)requireThat(typeof rule.exception.field==='string'&&Object.hasOwn(rule.exception,'equals'),'例外条件须为显式字段相等');
  return rule;
}
export function checkStructured(state,input,{libraryIds,scope='',asOf='',packId='',pairingConfirmed=false}={}) {
  const report={id:id('run'),createdAt:now(),packId,inputSource:'manual_json',pairingConfirmed,coverage:'configured_rules_only',entryIds:[],results:[],input:clone(input)};
  if(!Array.isArray(input)||input.length>200){report.results.push({result:'insufficient_evidence',message:'需要最多 200 条 {entryId, fields} JSON 映射；不推断自由文本'});return report;}
  const options={libraryIds,scope,asOf,includeDisputed:false};
  for(const row of input){
    const entry=state.entries.find(e=>e.id===row?.entryId&&libraryIds.includes(e.libraryId));
    if(!entry){report.results.push({result:'insufficient_evidence',message:'条目不存在于本轮允许范围'});continue;}
    report.entryIds.push(entry.id);
    const base={entryId:entry.id,entryVersion:entry.version,inputSource:'manual_json',evidenceKind:'structured_mapping'};
    const invalid=exclusion(state,entry,options);
    if(invalid){report.results.push({...base,result:'not_applicable',message:`当前条目不适用：${invalid}`});continue;}
    const issues=validateFields(row.fields,templateFor(state,entry),state.entries,entry.libraryId);
    for(const issue of issues)report.results.push({...base,result:'fail',field:issue.field,ruleId:entry.schemaId||'field-shape',ruleVersion:entry.schemaVersion,message:issue.message});
    if(!row.fields||typeof row.fields!=='object'||Array.isArray(row.fields))continue;
    const rules=state.rules.filter(r=>r.confirmed&&r.libraryId===entry.libraryId&&(!r.entryId||r.entryId===entry.id)&&scopeMatches(r.scope,scope));
    for(const rule of rules){
      const actual=row.fields[rule.field],expected=rule.value;
      const result={...base,ruleId:rule.id,ruleVersion:rule.version,field:rule.field,actual:actual??null,expected:expected??rule.values??rule.allowed??'required',method:'deterministic',result:'pass',message:'符合已配置规则',sourceRefs:clone(entry.sourceRefs)};
      if(rule.exception){
        if(!Object.hasOwn(row.fields,rule.exception.field)){result.result='insufficient_evidence';result.message='例外条件缺少证据';report.results.push(result);continue;}
        if(equal(row.fields[rule.exception.field],rule.exception.equals)){result.result='not_applicable';result.message='满足明确的合法例外';report.results.push(result);continue;}
      }
      if(!Object.hasOwn(row.fields,rule.field)||actual===null){result.result=rule.type==='required'?'fail':'insufficient_evidence';result.message='必要字段没有可检查值';}
      else {
        let valid=true;
        if(rule.type==='equals')valid=equal(actual,expected);
        if(rule.type==='max'||rule.type==='min')valid=typeof actual==='number'&&Number.isFinite(actual)&&(rule.type==='max'?actual<=expected:actual>=expected);
        if(rule.type==='enum')valid=rule.values.some(v=>equal(v,actual));
        if(rule.type==='required')valid=actual!=='';
        if(rule.type==='unique'){
          const projected=state.entries.filter(e=>e.libraryId===entry.libraryId&&!exclusion(state,e,options)).map(e=>({entry:e,fields:input.find(x=>x.entryId===e.id)?.fields||e.fields}));
          valid=projected.filter(x=>equal(x.fields[rule.field],actual)).length===1;
          if(rule.value!==undefined&&rule.value!==null&&!equal(actual,rule.value)){result.result='not_applicable';result.message='本值不属于指定唯一职位/值';report.results.push(result);continue;}
        }
        if(rule.type==='reference')valid=state.entries.some(e=>e.id===actual&&e.libraryId===entry.libraryId&&e.lifecycleStatus==='active');
        if(rule.type==='transition'){
          valid=equal(entry.fields[rule.field],actual)||rule.allowed.some(pair=>equal(pair[0],entry.fields[rule.field])&&equal(pair[1],actual));
          if(rule.confirmationRequired&&equal(actual,rule.confirmationRequired)&&!equal(actual,entry.fields[rule.field]))valid=false;
        }
        if(!valid){result.result='fail';result.message='输出违反已配置条件';result.repair='对照条目来源和当前值修订；不要自动更新记忆';}
      }report.results.push(result);
    }
    for(const [field,actual]of Object.entries(row.fields)) {
      if(equal(actual,entry.fields[field]))continue;
      if(state.versions.some(v=>v.entryId===entry.id&&v.version<entry.version&&equal(v.fields[field],actual)))report.results.push({...base,field,actual,result:'fail',code:'STALE_VALUE_USED',message:'使用了该条目历史版本中的旧值'});
    }
    if(!rules.length&&!issues.length)report.results.push({...base,result:'insufficient_evidence',message:'没有适用的行为规则；结构合法不能证明事实正确'});
  }return report;
}
export function diagnose(state,{watchIds,options,retrievedIds=null,pack=null,draftResult=null,visibleMessage=null,checkRun=null,hostDelivery=null}) {
  const rows=[];
  for(const watchId of watchIds){
    const watch=state.watches.find(w=>w.id===watchId&&w.confirmed);
    if(!watch){rows.push({watchId,codes:['INSUFFICIENT_EVIDENCE'],reason:'没有已确认的预期项'});continue;}
    if(!options.libraryIds.includes(watch.libraryId)||watch.taskType&&watch.taskType!==options.taskType){rows.push({watchId,codes:['NOT_APPLICABLE'],reason:'本轮不需要或未启用此检查项'});continue;}
    const entry=state.entries.find(e=>e.id===watch.entryId&&e.libraryId===watch.libraryId);
    if(!entry){rows.push({watchId,codes:['NOT_STORED'],storage:'fail',reason:'独立预期项关联的记录不存在'});continue;}
    const blocked=exclusion(state,entry,options,{outbound:true});
    if(blocked){rows.push({watchId,entryId:entry.id,codes:['NOT_APPLICABLE'],reason:`当前范围不可使用：${blocked}`});continue;}
    const row={watchId,entryId:entry.id,version:entry.version,codes:[],storage:'pass',retrieval:'not_observable',packing:'not_observable',draft:'not_observable',serverContext:'not_observable',behavior:'not_observable'};
    if(watch.fields.some(f=>!Object.hasOwn(entry.fields,f))){row.storage='fail';row.codes.push('NOT_STORED');}
    if(retrievedIds){row.retrieval=retrievedIds.includes(entry.id)?'pass':'fail';if(row.retrieval==='fail')row.codes.push('NOT_RETRIEVED');}
    if(pack){const item=pack.included.find(x=>x.id===entry.id);const complete=item&&item.version===entry.version&&watch.fields.every(f=>Object.hasOwn(item.fields,f)&&equal(item.fields[f],entry.fields[f]))&&pack.text.includes(item.block);
      row.packing=complete?'pass':'fail';if(!complete){row.codes.push('EXCLUDED_FROM_PACK');row.exclusion=pack.excluded.find(x=>x.id===entry.id)?.reason||'missing_field_or_stale_version';}}
    if(draftResult){row.draft=draftResult.status==='written'||draftResult.status==='already_present'?'pass':'fail';if(row.draft==='fail')row.codes.push('DRAFT_WRITE_FAILED');}
    if(visibleMessage?.packId===pack?.id&&visibleMessage?.verified===true)row.codes.push('VISIBLE_MESSAGE_PRESENT');
    // A controlled host may supply the exact sent projection. The extension never
    // fabricates this object from DOM observations or a model's self-report.
    if(hostDelivery?.kind==='controlled_host_request'&&hostDelivery.packId===pack?.id){const projected=hostDelivery.entries?.find(x=>x.id===entry.id&&x.version===entry.version);row.serverContext=projected&&watch.fields.every(f=>equal(projected.fields[f],entry.fields[f]))?'request_assembled':'fail';}
    else row.codes.push('SERVER_CONTEXT_UNKNOWN');
    const relevant=checkRun?.pairingConfirmed&&checkRun.packId===pack?.id?checkRun.results.filter(x=>x.entryId===entry.id&&x.entryVersion===entry.version&&(!x.ruleId||x.ruleId==='field-shape'||x.ruleId===entry.schemaId&&x.ruleVersion===entry.schemaVersion||state.rules.some(r=>r.id===x.ruleId&&r.version===x.ruleVersion))):[];
    const accepted=x=>x.result==='pass'||x.result==='not_applicable';
    const covered=watch.fields.every(field=>relevant.some(x=>x.field===field&&accepted(x)));
    if(relevant.length){row.behavior=relevant.some(x=>x.result==='fail')?'fail':covered&&relevant.every(accepted)?'pass':'needs_review';
      if(row.behavior==='fail')row.codes.push('OUTPUT_CONSTRAINT_FAILED');if(relevant.some(x=>x.code==='STALE_VALUE_USED'))row.codes.push('STALE_VALUE_USED');}
    if(!row.codes.length||row.behavior==='not_observable'||row.behavior==='needs_review')row.codes.push('INSUFFICIENT_EVIDENCE');rows.push(row);
  }
  return {coverage:'configured_watches_only',rows,note:'这些状态描述可观察的遗漏或规则违反，不判断模型内部是否遗忘。'};
}
