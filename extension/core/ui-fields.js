import {clone,requireThat} from './base.js';

// Presence is independent of text: missing, null, an empty string, and the
// literal string "null" are different business values.
export function renderBusinessFields(root,fields,template){
  const doc=root.ownerDocument;
  const node=(tag,attrs={})=>{const e=doc.createElement(tag);for(const [key,value]of Object.entries(attrs))e.setAttribute(key,value);return e;};
  const option=(select,value,label)=>{const e=node('option',{value});e.textContent=label;select.append(e);};
  const json=(labelText,key,value)=>{const label=node('label');label.textContent=labelText;const control=node('textarea',{'data-edit':key,rows:'5'});control.value=JSON.stringify(value,null,2);label.append(control);root.append(label);};
  root.replaceChildren();
  if(!template){json('业务字段（JSON）','fields-json',fields);return;}
  for(const field of template.fields){
    const name=field.name,value=fields[name],label=node('label');label.textContent=`${field.label||name}${field.required?' *':''}`;
    const mode=node('select',{'data-field-mode':name,'aria-label':`${field.label||name} 的填写状态`});
    option(mode,'missing','未填写');option(mode,'value','填写值');if(field.nullable||value===null)option(mode,'null',field.nullable?'null（明确空值）':'null（模板不允许，请修正）');
    mode.value=!Object.hasOwn(fields,name)||value===undefined?'missing':value===null?'null':'value';
    const control=node(['enum','boolean'].includes(field.type)?'select':'input',{'data-edit':`field:${name}`});
    if(field.type==='enum'){option(control,'','请选择');field.values.forEach((item,index)=>option(control,String(index),item===''?'空字符串':item));control.value=field.values.includes(value)?String(field.values.indexOf(value)):'';}
    else if(field.type==='boolean'){option(control,'','请选择');option(control,'true','true');option(control,'false','false');control.value=typeof value==='boolean'?String(value):'';}
    else {control.type=field.type==='number'?'number':field.type==='date'?'date':'text';if(field.type==='number')control.step='any';control.value=value===null||value===undefined?'':String(value);}
    const update=()=>{control.disabled=mode.value!=='value';};mode.addEventListener('change',update);update();
    label.append(mode,control);root.append(label);
    if(field.description){const hint=node('p',{class:'hint'});hint.textContent=field.description;root.append(hint);}
  }
  const extra=Object.fromEntries(Object.entries(fields).filter(([name])=>!template.fields.some(field=>field.name===name)));
  if(Object.keys(extra).length)json('模板外字段（保留原值；确认前请调整模板或移除）','extra-fields-json',extra);
}

export function readBusinessFields(root,template){
  const json=key=>JSON.parse(root.querySelector(`[data-edit="${key}"]`).value);
  if(!template){const fields=json('fields-json');requireThat(fields&&typeof fields==='object'&&!Array.isArray(fields),'业务字段必须是 JSON 对象');return fields;}
  const extra=root.querySelector('[data-edit="extra-fields-json"]');
  const fields=extra?JSON.parse(extra.value):{};
  requireThat(fields&&typeof fields==='object'&&!Array.isArray(fields),'模板外字段必须是 JSON 对象');
  requireThat(!Object.keys(fields).some(name=>template.fields.some(field=>field.name===name)),'模板字段请在上方对应控件中编辑，不要重复放入模板外字段');
  for(const field of template.fields){
    delete fields[field.name];
    const mode=root.querySelector(`[data-field-mode="${field.name}"]`).value;
    if(mode==='missing')continue;
    if(mode==='null'){fields[field.name]=null;continue;}
    requireThat(mode==='value','字段填写状态无效');
    const raw=root.querySelector(`[data-edit="field:${field.name}"]`).value;
    if(field.type==='enum'){requireThat(/^\d+$/.test(raw)&&Number(raw)<field.values.length,`${field.label||field.name} 请选择枚举值`);fields[field.name]=field.values[Number(raw)];}
    else if(field.type==='boolean'){requireThat(raw==='true'||raw==='false',`${field.label||field.name} 请选择 true 或 false`);fields[field.name]=raw==='true';}
    else if(field.type==='number'){requireThat(raw!==''&&Number.isFinite(Number(raw)),`${field.label||field.name} 请输入数字，或选择未填写/null`);fields[field.name]=Number(raw);}
    else {if(field.type==='date')requireThat(raw!=='',`${field.label||field.name} 请选择日期，或选择未填写/null`);fields[field.name]=raw;}
  }
  return fields;
}

export const templateKey=template=>template?JSON.stringify([template.id,template.version]):'';
export function editorTemplates(templates,entry){
  const latest=new Map();for(const template of templates)if(!latest.has(template.id)||latest.get(template.id).version<template.version)latest.set(template.id,template);
  const choices=[...latest.values()],pinned=templates.find(t=>t.id===entry.schemaId&&t.version===entry.schemaVersion);
  if(pinned&&!choices.some(t=>templateKey(t)===templateKey(pinned)))choices.unshift(pinned);
  return clone(choices);
}
