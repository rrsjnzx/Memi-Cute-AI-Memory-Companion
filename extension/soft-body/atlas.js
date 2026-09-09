import {PERSONAS, getExpressionById} from './catalog.js';
import {atlasEntries,atlasCounts,expressionAvailability} from './availability.js';
import {createSoftFace} from './face.js';
// Read-only view: no client, browser runtime, storage, message or network API.
const $=id=>document.getElementById(id),labels={operation:'真实操作',body:'本体互动',preview_only:'暂仅预览'};
const face=createSoftFace({document,feedback:true});$('atlas-face').append(face.element);
face.element.setAttribute('role','img');face.element.removeAttribute('aria-hidden');
for(const p of PERSONAS){const item=document.createElement('option');item.value=p.id;item.textContent=p.label+' · 32';$('atlas-persona').append(item);}
// A sidebar link selects the exact canonical face, not merely the persona's
// first (idle) entry. URL data only controls this independent read-only preview.
const parameters=new URLSearchParams(location.search),requested=parameters.get('persona');
const requestedPersona=PERSONAS.find(p=>p.id===requested),candidate=getExpressionById(parameters.get('expression'));
const initialEntry=candidate&&(!parameters.has('persona')||candidate.personaId===requestedPersona?.id)?candidate:null;
const initialPhase=['enter','main','hold','recover'].includes(parameters.get('phase'))?parameters.get('phase'):'hold';
if(initialEntry)$('atlas-persona').value=initialEntry.personaId;else if(requestedPersona)$('atlas-persona').value=requestedPersona.id;
let entries=[],selected=initialEntry,firstSelection=true;
function select(id){
  selected=getExpressionById(id);if(!selected)return;
  for(const button of $('atlas-grid').querySelectorAll('button'))button.setAttribute('aria-pressed',String(button.dataset.expressionId===id));
  const persona=PERSONAS.find(p=>p.id===selected.personaId),availability=expressionAvailability(selected.stateId);
  const phase=firstSelection&&selected.id===initialEntry?.id?initialPhase:'hold';firstSelection=false;
  face.setExpression(selected,phase);face.element.setAttribute('aria-label',selected.sourceStateName+'，独立预览');
  $('atlas-persona-name').textContent=persona.label;$('atlas-name').textContent=selected.sourceStateName;$('atlas-rich').textContent=selected.richText;
  $('atlas-position').textContent=`筛选内 ${entries.findIndex(e=>e.id===id)+1} / ${entries.length} · ${labels[availability.mode]}${availability.rendering==='body_geometry'?' · 原设计预览；侧栏保留当前脸，仅表现受力':''}`;
  $('atlas-availability').textContent=availability.description;$('atlas-reaction').textContent=selected.mainReaction;
  $('atlas-source').textContent=`${selected.id} · ${selected.source.document} 第 ${selected.source.line} 行`;
  document.documentElement.style.setProperty('--accent',selected.personaId==='grok'?'#8a673d':persona.colors.accent);
  document.documentElement.style.setProperty('--soft',selected.personaId==='grok'?'#f2ebe1':persona.colors.body);
}
function render(){
  const personaId=$('atlas-persona').value,counts=atlasCounts(personaId);
  entries=atlasEntries({personaId,mode:$('atlas-mode').value,query:$('atlas-search').value});
  $('atlas-count').textContent=`当前 ${entries.length} / ${counts.total} 条 · ${counts.operation} 条操作反馈 · ${counts.body} 条本体互动 · ${counts.previewOnly} 条暂仅保留预览（有原因说明）`;
  const fragment=document.createDocumentFragment();
  for(const entry of entries){
    const button=document.createElement('button');button.type='button';button.className='expression-card';button.dataset.expressionId=entry.id;button.dataset.mode=expressionAvailability(entry.stateId).mode;
    button.setAttribute('aria-label',`${PERSONAS.find(p=>p.id===entry.personaId).label}，${entry.sourceStateName}，仅预览`);button.setAttribute('aria-pressed','false');
    for(const [cls,value] of [['card-text',entry.richText],['card-name',entry.sourceStateName],['card-persona',PERSONAS.find(p=>p.id===entry.personaId).label],['card-mode',labels[button.dataset.mode]]]){const span=document.createElement('span');span.className=cls;span.textContent=value;button.append(span);}
    button.addEventListener('click',()=>select(entry.id));fragment.append(button);
  }
  $('atlas-grid').replaceChildren(fragment);$('atlas-empty').hidden=entries.length>0;
  $('atlas-previous').disabled=$('atlas-next').disabled=!entries.length;
  if(entries.length)select(entries.some(e=>e.id===selected?.id)?selected.id:entries[0].id);
  else $('atlas-position').textContent='没有匹配结果；右侧保留上次预览。';
}
for(const id of ['atlas-persona','atlas-mode'])$(id).addEventListener('change',render);$('atlas-search').addEventListener('input',render);
for(const [id,delta] of [['atlas-previous',-1],['atlas-next',1]])$(id).addEventListener('click',()=>{if(entries.length)select(entries[(entries.findIndex(e=>e.id===selected?.id)+delta+entries.length)%entries.length].id);});
render();
