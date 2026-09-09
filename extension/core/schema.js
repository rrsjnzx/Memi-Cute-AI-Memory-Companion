import {requireThat,string,isoDate,LIMITS,equal,scopeMatches} from './base.js';
const types=['string','number','boolean','enum','date','entity_ref'];
export function validateTemplate(template) {
  string(template.name,'模板名称');
  requireThat(Array.isArray(template.fields)&&template.fields.length>0&&template.fields.length<=LIMITS.fields,'模板需要 1—40 个字段');
  const keys=new Set();
  for(const f of template.fields) {
    requireThat(typeof f.name==='string'&&/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(f.name)&&!['constructor','prototype','__proto__'].includes(f.name),'字段键只能使用安全的英文字母、数字与下划线');
    requireThat(!keys.has(f.name),'字段键重复'); keys.add(f.name);
    requireThat(types.includes(f.type),'不支持的字段类型');
    for(const key of ['required','nullable','readonly','match']) requireThat(f[key]===undefined||typeof f[key]==='boolean',`${key} 必须是布尔值`);
    if(f.type==='enum') requireThat(Array.isArray(f.values)&&f.values.length>0&&f.values.length<=100&&f.values.every(x=>typeof x==='string'),'枚举需要字符串选项');
    if(f.min!==undefined) requireThat(typeof f.min==='number'&&Number.isFinite(f.min),'min 必须是有限数字');
    if(f.max!==undefined) requireThat(typeof f.max==='number'&&Number.isFinite(f.max),'max 必须是有限数字');
  }
  return template;
}
export function validateFields(fields,template,entries=[],libraryId='',{historicalReferences=false}={}) {
  const errors=[];
  if(!fields||typeof fields!=='object'||Array.isArray(fields))return[{field:'*',message:'字段必须是 JSON 对象'}];
  if(Object.keys(fields).some(k=>['__proto__','constructor','prototype'].includes(k)))return[{field:'*',message:'保留字段键不能作为业务字段'}];
  if(!template)return Object.keys(fields).length>LIMITS.fields?[{field:'*',message:'字段过多'}]:[];
  for(const key of Object.keys(fields))if(!template.fields.some(f=>f.name===key))errors.push({field:key,message:'模板未声明此字段'});
  for(const f of template.fields) {
    const value=fields[f.name],missing=!Object.hasOwn(fields,f.name)||value===undefined;
    if(missing){if(f.required)errors.push({field:f.name,message:'缺少必填字段'});continue;}
    if(value===null){if(!f.nullable)errors.push({field:f.name,message:'此字段不允许 null'});continue;}
    let valid=true;
    if(f.type==='number')valid=typeof value==='number'&&Number.isFinite(value);
    else if(f.type==='boolean')valid=typeof value==='boolean';
    else valid=typeof value==='string';
    if(!valid){errors.push({field:f.name,message:`类型应为 ${f.type}`});continue;}
    if(f.required&&value==='')errors.push({field:f.name,message:'必填文本不能为空'});
    if(f.type==='enum'&&!f.values.includes(value))errors.push({field:f.name,message:'不属于枚举选项'});
    if(f.type==='date'){try{isoDate(value);}catch{errors.push({field:f.name,message:'日期格式无效'});}}
    if(f.type==='entity_ref'&&!entries.some(e=>e.id===value&&e.libraryId===libraryId&&(historicalReferences||e.lifecycleStatus==='active')))errors.push({field:f.name,message:historicalReferences?'历史对象引用在同一资料库中不存在':'对象引用不存在于当前库的有效条目'});
    if(typeof value==='number'&&((f.min!==undefined&&value<f.min)||(f.max!==undefined&&value>f.max)))errors.push({field:f.name,message:`应在 ${f.min??'-∞'} 至 ${f.max??'+∞'} 范围内`});
  }
  return errors;
}
export function checkUpdate(previous,next,template,rules,{confirmed=false}={}) {
  const issues=[];
  for(const f of template?.fields||[])if(f.readonly&&!equal(previous.fields[f.name],next.fields[f.name]))issues.push({field:f.name,code:'readonly',message:'只读字段不能通过普通编辑修改'});
  for(const rule of rules.filter(r=>r.confirmed&&r.type==='transition'&&(!r.entryId||r.entryId===previous.id)&&r.libraryId===previous.libraryId&&scopeMatches(r.scope,previous.scope))) {
    const a=previous.fields[rule.field],b=next.fields[rule.field];
    if(equal(a,b))continue;
    if(!rule.allowed.some(pair=>equal(pair[0],a)&&equal(pair[1],b)))issues.push({field:rule.field,code:'transition',message:'不允许此状态转换'});
    if(rule.confirmationRequired&&equal(b,rule.confirmationRequired)&&!confirmed)issues.push({field:rule.field,code:'confirmation_required',message:'此状态转换需要对具体变更再次确认'});
  }
  return issues;
}
