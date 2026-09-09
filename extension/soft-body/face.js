import {EXPRESSIONS} from './catalog.js';

// The original kaomoji IS the visible character. No flesh-shaped body, invented
// eyes, accessory illustration, shadow or bitmap is drawn by this renderer.
// Feedback reads the same text and phase; only the main view accepts physics.
const NS='http://www.w3.org/2000/svg';
const FONT='"Segoe UI Symbol","Microsoft YaHei","Noto Sans Symbols 2","Noto Sans",sans-serif';
const NEUTRAL_TEXT='(・_・)';
const CENTER={x:150,y:174},WIDTH=222,HEIGHT=64;
const ink={chatgpt:['#544663','#766086'],deepseek:['#244d86','#407bae'],gemini:['#615095','#966595'],claude:['#794831','#a26446'],grok:['#493941','#8b6236'],kimi:['#515d90','#757cb0'],qianwen:['#554a89','#8b72ab'],neutral:['#596473','#768292']};
const byId=new Map(EXPRESSIONS.map(entry=>[entry.id,entry]));
// Before a site is chosen there is no persona catalog entry. Keep these generic
// UI fallbacks separate from the original 224 configurations and accept only
// explicit semantic IDs; a misspelled/unknown recipe must still return null.
const neutralById=new Map(Object.entries({
  idle:NEUTRAL_TEXT,attentive:'(•_•)',expectant:'(・ω・)',rest:'(-_-)',
  loading:'(・_・)…',thinking:'(¬_¬)',validating:'(•̀_•́)',awaiting_result:'(・_・) ?',
  save_success:'(＾▽＾)',package_success:'ヽ(＾▽＾)ﾉ',insert_success:'(＾_＾)b',
  send_success:'(＾▽＾)ノ',copy_success:'(＾_＾)✓',conflict_resolved:'(˘▽˘)',task_success:'ヽ(＾◇＾)ﾉ',
  missing_field:'(・_・;)',target_unselected:'(・・?)',page_not_ready:'(・_・)…',
  permission_required:'(・_・)×',conflict_detected:'(>_<)',unverified:'(・・?)',partial_success:'(＾_＾;)',
  network_error:'(×_×)',write_error:'(;_;)',insert_error:'(>_<;)',parse_error:'(？_？)',
  permission_error:'(-_-;)',timeout:'(._.)…',canceled:'(-_-)ﾉ',
}).map(([semanticState,richText])=>{
  const id='neutral.'+semanticState;
  return[id,Object.freeze({id,personaId:'neutral',semanticState,richText,provenance:'neutral_renderer_fallback'})];
}));
const clamp=(value,min,max)=>Math.max(min,Math.min(max,Number.isFinite(value)?value:0));
let sequence=0;
function node(doc,tag,attributes={}){const element=doc.createElementNS(NS,tag);for(const[key,value]of Object.entries(attributes))element.setAttribute(key,String(value));return element;}
function restNodes(count=48){return Array.from({length:count},(_,index)=>{const angle=index/count*Math.PI*2;return{x:CENTER.x+Math.cos(angle)*WIDTH/2,y:CENTER.y+Math.sin(angle)*HEIGHT/2};});}
function pathFromNodes(nodes){return nodes.map((point,index)=>`${index?'L':'M'}${point.x.toFixed(3)},${point.y.toFixed(3)}`).join(' ')+' Z';}
const REST_PATH=pathFromNodes(restNodes());
export function expressionForSnapshot(snapshot){return byId.get(snapshot?.recipeId)||neutralById.get(snapshot?.recipeId)||null;}
export function expressionText(entry){
  if(typeof entry?.richText==='string'&&entry.richText.length)return entry.richText;
  const inherited=byId.get(entry?.baseExpressionId);
  return inherited?.richText||NEUTRAL_TEXT;
}
// Never split a combining mark from its base. The fallback covers this supplied
// catalog when Intl.Segmenter is unavailable; it is not an arbitrary emoji parser.
export function expressionGraphemes(text){
  if(typeof Intl.Segmenter==='function')return [...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(text)].map(part=>part.segment);
  const parts=[];
  for(const codepoint of Array.from(text)){
    if(parts.length&&(/[\p{Mark}\uFE0E\uFE0F]/u.test(codepoint)||parts.at(-1).endsWith('\u200d')||codepoint==='\u200d'))parts[parts.length-1]+=codepoint;
    else parts.push(codepoint);
  }
  return parts;
}
function metrics(doc,parts){
  let context=null;
  try{context=doc.createElement?.('canvas')?.getContext?.('2d')||null;if(context)context.font=`55px ${FONT}`;}catch{}
  const advances=parts.map(part=>{
    const measured=context?.measureText(part)?.width;
    if(Number.isFinite(measured)&&measured>0)return measured;
    if(/^\s+$/u.test(part))return 16;
    if(/^[()꒰꒱\[\]]$/u.test(part))return 25;
    if(/^[.·｡˶๑;；:？?]$/u.test(part))return 25;
    return 38;
  });
  const total=advances.reduce((sum,width)=>sum+width,0)||1;
  const ratio=Math.min(1,WIDTH/total);
  let cursor=CENTER.x-total*ratio/2;
  return{fontSize:55*ratio,slots:parts.map((text,index)=>{const advance=advances[index]*ratio;const result={text,x:cursor+advance/2,y:CENTER.y,advance,index};cursor+=advance;return result;})};
}
function displacement(frame,point){
  if(!frame?.nodes?.length)return{x:0,y:0};
  const resting=restNodes(frame.nodes.length);let dx=0,dy=0,total=0;
  for(let index=0;index<resting.length;index++){
    const origin=resting[index],actual=frame.nodes[index];
    if(!Number.isFinite(actual?.x)||!Number.isFinite(actual?.y))continue;
    const distance=Math.hypot(point.x-origin.x,point.y-origin.y)/WIDTH;
    const weight=1/(distance**3+.016);
    dx+=(actual.x-origin.x)*weight;dy+=(actual.y-origin.y)*weight;total+=weight;
  }
  return total?{x:clamp(dx/total,-12,12),y:clamp(dy/total,-8,8)}:{x:0,y:0};
}
export function createSoftFace({document:doc=globalThis.document,expression=null,feedback=false}={}){
  const svg=node(doc,'svg',{viewBox:feedback?'24 126 252 96':'0 0 300 300',preserveAspectRatio:'xMidYMid meet','aria-hidden':'true',focusable:'false',class:'soft-face soft-kaomoji','data-renderer':'original-grapheme-kaomoji'});
  const defs=node(doc,'defs'),uid=`soft-ink-${++sequence}`,gradient=node(doc,'linearGradient',{id:uid,x1:'0%',x2:'100%',y1:'0%',y2:'40%'});
  const first=node(doc,'stop',{offset:'0%'}),last=node(doc,'stop',{offset:'100%'});gradient.append(first,last);defs.append(gradient);svg.append(defs);
  // Invisible geometry exactly matches cx150/cy174/222x64 interaction rest nodes.
  const contour=node(doc,'path',{d:REST_PATH,fill:'none',stroke:'none','pointer-events':'none',class:'soft-body-shape','aria-hidden':'true'});
  const glyphLayer=node(doc,'g',{'xml:space':'preserve',class:'soft-graphemes','pointer-events':'none'});svg.append(contour,glyphLayer);
  let current=expression,currentPhase='hold',lastFrame=null,slots=[],interactionReaction=null;
  function reactionOffset(slot,offset,hand){
    if(feedback||!interactionReaction||!lastFrame?.active||!lastFrame?.held)return{x:0,y:0,rotation:0};
    const face=interactionReaction.face||{},motion=interactionReaction.phaseMotion?.main||{};
    // Reuse the original blocked-rub response as a force modifier, not as a
    // replacement face. Only glyphs near actual displacement move differently.
    const pressure=clamp(Math.hypot(offset.x,offset.y)/5,0,1);
    const compression=clamp(1-((face.eyes?.opennessL??1)+(face.eyes?.opennessR??1))/2,0,1);
    const lift=clamp(motion.gestureLift||0,0,1),resistance=.8+lift*2;
    const decor=face.decor||[],marked=/[;；…Σ]/u.test(slot.text);
    return{
      x:-Math.sign(slot.x-CENTER.x)*pressure*compression*resistance+clamp(face.eyes?.gazeX||0,-1,1)*pressure,
      y:hand&&face.gesture==='reach'?-pressure*lift*3:marked&&decor.includes('sweat')?pressure*.55:0,
      rotation:decor.includes('tremble')?clamp(offset.x*.08,-.6,.6)*pressure:0,
    };
  }
  function arrange(){
    const motion=current?.phaseMotion?.[currentPhase==='recover'?'exit':currentPhase]||{};
    let previousX=-Infinity,previousAdvance=0;
    for(const slot of slots){
      const offset=feedback?{x:0,y:0}:displacement(lastFrame,slot);
      const nearby=feedback?{x:0,y:0}:displacement(lastFrame,{x:slot.x+7,y:slot.y});
      // Keep letters ordered and legible; only local positions and tiny rotations
      // vary. No string-wide or per-glyph scale distorts the original letterform.
      const hand=/[っつﾉノ٩۶وงヾヽゞ]/u.test(slot.text);
      const reaction=reactionOffset(slot,offset,hand);
      const minGap=Math.min(previousAdvance,slot.advance)*.35;
      const x=Math.max(slot.x+clamp(offset.x+reaction.x,-13.5,13.5),previousX+minGap);
      const phaseLift=hand?-clamp(motion.gestureLift||0,-1,1)*2:0;
      const phaseTilt=clamp(motion.faceTilt||0,-5,5)*(slot.x-CENTER.x)/WIDTH*.35;
      const rotation=clamp((nearby.y-offset.y)*.3+phaseTilt+reaction.rotation,-3,3);
      slot.element.setAttribute('transform',`translate(${x.toFixed(3)} ${(slot.y+clamp(offset.y+reaction.y,-8,8)+phaseLift).toFixed(3)}) rotate(${rotation.toFixed(3)})`);
      previousX=x;previousAdvance=slot.advance;
    }
  }
  function setFrame(frame){
    if(feedback)return; // A misplaced caller cannot make feedback rubbable.
    lastFrame=frame||null;contour.setAttribute('d',frame?.path||REST_PATH);
    if(!frame?.held)setInteractionReaction(null);
    svg.dataset.deformed=String(Boolean(frame?.active));arrange();
  }
  function setInteractionReaction(entry){
    // Even an accidental caller cannot deform the feedback copy or borrow a
    // different persona. Accept only the canonical, preserved V2 record.
    const canonical=byId.get(entry?.id);
    const next=!feedback&&canonical?.stateId==='blocked_rub'&&canonical.personaId===current?.personaId?canonical:null;
    if(next===interactionReaction)return;
    interactionReaction=next;
    if(next){svg.dataset.interactionState='blocked_rub';svg.dataset.reactionId=next.id;}
    else{delete svg.dataset.interactionState;delete svg.dataset.reactionId;}
    arrange();
  }
  function setExpression(entry,phase='hold'){
    current=entry;currentPhase=phase;
    if(interactionReaction&&interactionReaction.personaId!==entry?.personaId)setInteractionReaction(null);
    const text=expressionText(entry),persona=entry?.personaId||'neutral',colors=ink[persona]||ink.neutral;
    first.setAttribute('stop-color',colors[0]);last.setAttribute('stop-color',colors[1]);
    const layout=metrics(doc,expressionGraphemes(text));glyphLayer.replaceChildren();
    slots=layout.slots.map(slot=>{
      const group=node(doc,'g',{'data-grapheme-index':slot.index});
      const glyph=node(doc,'text',{x:(-slot.advance/2).toFixed(3),y:0,'dominant-baseline':'central','text-anchor':'start','font-family':FONT,'font-size':layout.fontSize.toFixed(3),'font-weight':500,'xml:space':'preserve',fill:`url(#${uid})`});
      glyph.textContent=slot.text;group.append(glyph);glyphLayer.append(group);return{...slot,element:group};
    });
    svg.dataset.expressionId=entry?.id||'neutral';svg.dataset.persona=persona;
    svg.dataset.phase=phase;svg.dataset.richText=text;svg.dataset.graphemeCount=String(slots.length);svg.dataset.glyphFontSize=layout.fontSize.toFixed(3);arrange();
  }
  setExpression(current,currentPhase);
  return{element:svg,setExpression,setFrame,setInteractionReaction,get expression(){return current;}};
}
export function renderFeedback({document,snapshot}){
  const view=createSoftFace({document,expression:expressionForSnapshot(snapshot),feedback:true});
  view.setExpression(view.expression,snapshot.phase);view.element.dataset.revision=String(snapshot.revision);return view.element;
}
