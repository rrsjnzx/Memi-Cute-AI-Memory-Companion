import {createLibrary,saveTemplate,addSource,saveEntry} from './library.js';
import {id,now,requireThat,hash,freshState} from './base.js';
export const demoText='Atlas 产品的额定功率为 80 W，普通模式上限为 100 W。批准的实验模式可超过普通上限。\n项目 T1：方案已查看，实施尚未确认完成，负责人为林悦。\n另一个未核实资料把 Atlas 额定功率写成 90 W。';
export async function seedDemo(state){
  // Hash is prepared before entering an IndexedDB transaction by the caller.
  return populateDemo(state,await hash(demoText));
}
export function populateDemo(state,sourceHash){
  requireThat(!state.libraries.some(l=>l.demo),'原创样例已载入，无需重复创建');
  const products=createLibrary(state,'产品参数 · 原创示例');products.demo=true;
  const tasks=createLibrary(state,'项目任务 · 原创示例');tasks.demo=true;
  const source=addSource(state,{name:'原创验收资料',text:demoText,sha256:sourceHash});
  const parameter=saveTemplate(state,{name:'数值参数',fields:[{name:'value',label:'参数值',type:'number',required:true},{name:'approved',label:'已批准例外',type:'boolean',required:true}]});
  const taskSchema=saveTemplate(state,{name:'任务状态',fields:[{name:'status',label:'状态',type:'enum',values:['awaiting_confirmation','completed'],required:true},{name:'owner',label:'负责人',type:'string',required:true,readonly:true}]});
  const ref=quote=>[{sourceId:source.id,sourceVersion:1,quote,start:demoText.indexOf(quote),end:demoText.indexOf(quote)+quote.length}];
  const product=saveEntry(state,{libraryId:products.id,kind:'fact',title:'Atlas 额定功率',content:'额定功率为 80 W。普通模式的数值上限为 100 W，实验模式须明确批准。',fields:{value:80,approved:false},schemaId:parameter.id,schemaVersion:1,entityId:'product-atlas',predicate:'rated_power',singleValued:true,aliases:['阿特拉斯','Atlas'],tags:['功率','产品参数'],evidenceKind:'direct',sourceRefs:ref('Atlas 产品的额定功率为 80 W，普通模式上限为 100 W。')},{confirm:true,reason:'载入原创人工标注样例'});
  const task=saveEntry(state,{libraryId:tasks.id,kind:'event',title:'T1 实施等待确认',content:'方案已查看不等于实施已完成。转为 completed 需要用户确认。',fields:{status:'awaiting_confirmation',owner:'林悦'},schemaId:taskSchema.id,schemaVersion:1,entityId:'task-t1',aliases:['一号任务'],evidenceKind:'direct',sourceRefs:ref('项目 T1：方案已查看，实施尚未确认完成，负责人为林悦。')},{confirm:true,reason:'载入原创人工标注样例'});
  const alternate=saveEntry(state,{libraryId:products.id,title:'Atlas 参数的待核实来源',content:'另一份资料给出不同功率，需核对来源。',fields:{value:90,approved:false},schemaId:parameter.id,schemaVersion:1,entityId:'product-atlas',predicate:'rated_power',singleValued:true,evidenceKind:'direct',sourceRefs:ref('另一个未核实资料把 Atlas 额定功率写成 90 W。')},{reason:'保留冲突候选，不自动采用'});
  const ruleEntry=saveEntry(state,{libraryId:tasks.id,title:'完成状态必须经过确认',kind:'rule',content:'不得把“已经看过方案”解释为“已经实施完成”。确认实施结果后才能更新完成状态。',fields:{requireConfirmation:true},evidenceKind:'user_asserted'},{confirm:true,reason:'用户通过载入演示确认使用的虚构约束'});
  state.rules.push({id:id('rule'),version:1,libraryId:products.id,entryId:product.id,type:'max',field:'value',value:100,exception:{field:'approved',equals:true},confirmed:true,scope:'',createdAt:now()},
    {id:id('rule'),version:1,libraryId:tasks.id,entryId:task.id,type:'transition',field:'status',allowed:[['awaiting_confirmation','completed']],confirmationRequired:'completed',confirmed:true,scope:'',createdAt:now()});
  for(const [entry,fields]of [[product,['value']],[task,['status']],[ruleEntry,['requireConfirmation']]])state.watches.push({id:id('watch'),entryId:entry.id,libraryId:entry.libraryId,fields,taskType:'',confirmed:true,createdAt:now()});
  return{products,tasks,product,task,alternate,ruleEntry};
}
