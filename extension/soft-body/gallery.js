import { PERSONAS, V2_STATES, EXPRESSIONS, V3_RECIPES, V3_INTERACTIONS, CATALOG_PROVENANCE, getExpression } from './catalog.js';
import { SEMANTICS, getSemanticExpression, INTERACTION_TO_V2 } from './mapping.js';
import { createSoftFace } from './face.js';
import { createSoftBody } from './physics.js';
import { createBodyInteraction, svgPointerPoint } from './interaction.js';
import { createPresentationController, canUseRubEmotion, STATUS_TEXT } from './presentation.js';

// Development-only page. No client.js, chrome API, memory module, clipboard,
// network request, permission request or page-message adapter is imported.
const $ = id => document.getElementById(id);
const allEntries = new Map([...EXPRESSIONS, ...V3_RECIPES, ...V3_INTERACTIONS].map(entry => [entry.id, entry]));
const stateNames = new Map(V2_STATES.map(state => [state.id, state.name]));
const mainView = createSoftFace({document});
const feedbackView = createSoftFace({document, feedback: true});
$('main-stage').append(mainView.element);
$('feedback-face').append(feedbackView.element);
mainView.element.removeAttribute('aria-hidden');
mainView.element.setAttribute('role', 'img');
mainView.element.setAttribute('aria-label', '只在本体轮廓内可以揉搓的可揉颜表情');

let selectedEntries = [], selectedEntry = null, snapshot = null, presenter = null, ticket = null;
let previewRevision = 0, mode = 'catalog', phaseTimer = null, disposed = false;
let heldBefore = false, grabs = 0, blankPresses = 0, lastPhysicsUpdate = 0, lastInteraction = 'none';
let actionCounts = Object.create(null), timings = [], recording = null, recordingTimer = null, statsTimer = null;
let lastRafTime = null, lastFrame = null;
const body = createSoftBody({cx: 150, cy: 174, width: 222, height: 64});

const interaction = createBodyInteraction({
  svg: mainView.element, stage: $('main-stage'), body,
  requestAnimationFrame(callback) {
    return window.requestAnimationFrame(time => {
      const began = performance.now();
      const previous = lastRafTime;
      lastRafTime = time;
      callback(time);
      if (recording) {
        recording.costs.push(performance.now() - began);
        if (previous !== null && time - previous < 250) recording.intervals.push(time - previous);
      }
      if (!body.active) lastRafTime = null;
    });
  },
  cancelAnimationFrame: id => window.cancelAnimationFrame(id),
  onFrame(frame) {
    lastFrame = frame;
    mainView.setFrame(frame);
    $('main-stage').dataset.active=String(frame.active);
    $('main-stage').dataset.held = String(frame.held);
    $('main-stage').dataset.interaction = frame.interaction;
    if (frame.held && !heldBefore) { grabs++; $('grab-count').textContent = String(grabs); }
    heldBefore = frame.held;
    if (recording) {
      recording.draws++;
      if (frame.held) recording.heldFrames++;
    }
    if (performance.now() - lastPhysicsUpdate > 100 || !frame.active) {
      $('physics-state').textContent = `${frame.interaction}${frame.held ? ' · 抓取中' : ''}`;
      lastPhysicsUpdate = performance.now();
    }
    if (!frame.active && snapshot) setMainFromSnapshot();
  },
  onInteraction(value) {
    lastInteraction = value;
    actionCounts[value] = (actionCounts[value] || 0) + 1;
    const canShowInteraction = snapshot && !snapshot.feedbackVisible &&
      (mode === 'simulation' ? canUseRubEmotion(snapshot) : selectedEntry?.stateId === 'idle');
    if (canShowInteraction && value !== 'none') {
      const expression = getExpression($('persona').value, INTERACTION_TO_V2[value]);
      if (expression) mainView.setExpression(expression, effectiveReduced() ? 'hold' : 'main');
    }
  },
});

function option(value, label) {
  const element = document.createElement('option');
  element.value = value; element.textContent = label;
  return element;
}
for (const persona of PERSONAS) $('persona').append(option(persona.id, persona.label));
for (const semantic of SEMANTICS) {
  const item = option(semantic.id, `${semantic.number} · ${semantic.label} (${semantic.id})`);
  item.disabled = ['idle','attentive','expectant','rest'].includes(semantic.id);
  $('semantic').append(item);
}
$('semantic').value = 'save_success';
$('provenance-output').textContent = JSON.stringify(CATALOG_PROVENANCE, null, 2);

const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
function effectiveReduced() { return $('reduced').checked || reducedQuery.matches; }
function renderPhase() { return effectiveReduced() ? 'hold' : snapshot?.phase || 'hold'; }
function setMainFromSnapshot() {
  if (!snapshot) return;
  mainView.setExpression(allEntries.get(snapshot.recipeId) || null, renderPhase());
  if (lastFrame) mainView.setFrame(lastFrame);
}
function stopPhaseTimer() { clearTimeout(phaseTimer); phaseTimer = null; }
function queueAdvance() {
  stopPhaseTimer();
  if (mode !== 'simulation' || !snapshot || document.hidden || disposed) return;
  const elapsed = Date.now() - snapshot.startedAt;
  const processing = ['loading','thinking','validating','awaiting_result'].includes(snapshot.semanticState);
  const boundaries = processing ? [181] : snapshot.feedbackVisible ? snapshot.duration ? [101,321,2401,2561] : [101,321] : [];
  const next = boundaries.find(at => at > elapsed);
  if (next !== undefined) phaseTimer = setTimeout(() => { presenter?.advance(); queueAdvance(); }, Math.max(1,next-elapsed));
}
function renderSnapshot(next, caption) {
  if (disposed) return;
  snapshot = next;
  const entry = allEntries.get(next.recipeId) || null;
  const phase = renderPhase();
  const start = performance.now();
  mainView.setExpression(entry, phase);
  const mainAt = performance.now();
  feedbackView.setExpression(entry, phase);
  const feedbackAt = performance.now();
  for (const node of [$('main-card'), $('feedback-bubble')]) {
    node.dataset.recipeId = next.recipeId;
    node.dataset.phase = next.phase;
    node.dataset.renderPhase = phase;
    node.dataset.revision = String(next.revision);
  }
  mainView.element.dataset.revision = String(next.revision);
  feedbackView.element.dataset.revision = String(next.revision);
  $('feedback-bubble').hidden = !next.feedbackVisible;
  $('dismiss-feedback').disabled = !next.feedbackVisible;
  const description = caption || (mode === 'simulation' ? `开发模拟：${STATUS_TEXT[next.statusCode] || next.semanticState}` : '原表情预览，无业务操作。');
  $('body-status').textContent = description;
  $('feedback-caption').textContent = description;
  $('snapshot-output').textContent = JSON.stringify({mode: mode === 'simulation' ? 'developer_simulated_controller' : 'catalog_preview_not_business_event', ...next}, null, 2);
  $('sync-summary').textContent = `本体与反馈：${next.recipeId} / ${phase} / revision ${next.revision}。同次同步更新；${next.feedbackVisible ? '反馈可见，仅本体受力' : '反馈隐藏'}。`;
  timings.push({revision: next.revision, recipeId: next.recipeId, phase, mainAtMs: +mainAt.toFixed(3), feedbackAtMs: +feedbackAt.toFixed(3), synchronousScriptDeltaMs: +(feedbackAt-mainAt).toFixed(3), updateScriptMs: +(feedbackAt-start).toFixed(3)});
  timings = timings.slice(-80);
  $('timeline-output').textContent = JSON.stringify(timings.slice(-12), null, 2);
  positionFeedback();
  queueAdvance();
}
function applyCatalog(feedbackVisible = false) {
  mode = 'catalog';
  stopPhaseTimer(); presenter?.dispose(); presenter = null; ticket = null;
  $('simulate-result').disabled = true;
  if (!selectedEntry) return;
  const persona = $('persona').value;
  renderSnapshot({
    contextKey: `gallery-catalog:${persona}`, operationId: 'catalog-preview', attemptId: 'none',
    eventId: `preview-${++previewRevision}`, revision: previewRevision, personaId: persona,
    semanticState: selectedEntry.stateId || selectedEntry.recipeId || selectedEntry.interactionId,
    recipeId: selectedEntry.id, phase: $('phase').value, startedAt: Date.now(), duration: 0,
    feedbackVisible, statusCode: 'developer_preview_only',
  }, `开发预览：${entryLabel(selectedEntry)}`);
}
function entryLabel(entry) { return entry.sourceStateName || entry.label || entry.id; }
function eligible(entry) {
  if (entry.provenance?.text === 'transcribed_v2_1_markdown') return entry.feedbackEligible;
  if (entry.recipeId?.startsWith('R')) return Number(entry.recipeId.slice(1)) >= 5;
  return false;
}
function describeEntry() {
  const entry = selectedEntry;
  const index = selectedEntries.findIndex(row => row.id === entry.id);
  $('position').textContent = `${index+1} / ${selectedEntries.length}`;
  $('expression-title').textContent = `${entryLabel(entry)} · ${entry.id}`;
  $('rich-text').textContent = entry.richText || '此 V3 揉搓差分是动作原文，没有单独的颜文字蓝本。';
  $('compact-text').textContent = [entry.compactText, entry.asciiText].filter(Boolean).join('\n') || '补充条目没有独立的紧凑／ASCII原文。';
  $('main-reaction').textContent = entry.mainReaction;
  $('entry-output').textContent = JSON.stringify(entry, null, 2);
  $('preview-feedback').disabled = !eligible(entry);
  $('feedback-eligibility').textContent = eligible(entry) ? '此条可用于业务反馈；这里只能由明确的开发预览按钮打开，未执行真实操作。' : '此条为本体状态。外侧反馈预览已禁用，揉搓也不会弹出。';
  $('sidebar-persona').textContent = PERSONAS.find(persona => persona.id === entry.personaId)?.label || '未知角色';
  const persona = PERSONAS.find(p => p.id === entry.personaId);
  document.documentElement.style.setProperty('--accent', persona?.colors.accent || '#726689');
  document.documentElement.style.setProperty('--button-ink', entry.personaId === 'grok' ? '#302116' : '#ffffff');
  document.documentElement.dataset.persona = entry.personaId;
}
function selectEntry() {
  interaction.cancel();
  selectedEntry = selectedEntries.find(entry => entry.id === $('expression').value) || selectedEntries[0];
  describeEntry();
  applyCatalog();
}
function populateCatalog() {
  const source = $('catalog-kind').value === 'v3-recipe' ? V3_RECIPES : $('catalog-kind').value === 'v3-interaction' ? V3_INTERACTIONS : EXPRESSIONS;
  selectedEntries = source.filter(entry => entry.personaId === $('persona').value);
  $('expression').replaceChildren(...selectedEntries.map((entry,index) => option(entry.id, `${String(index+1).padStart(2,'0')} · ${entryLabel(entry)} (${entry.stateId || entry.recipeId || entry.interactionId})`)));
  selectEntry();
}
function positionFeedback() {
  const panel = $('test-sidebar').getBoundingClientRect();
  const top = Math.max(0, panel.top), bottom = Math.min(window.innerHeight,panel.bottom);
  const center = top + Math.max(0,bottom-top)/2;
  const available = panel.left - 20;
  const external = available >= 180;
  const width = external ? Math.min(240,available) : Math.max(120,Math.min(240,panel.width-24));
  const bubble = $('feedback-bubble');
  bubble.style.width = `${width}px`;
  bubble.dataset.layout = external ? 'external' : 'internal';
  bubble.dataset.anchorY = center.toFixed(2);
  bubble.dataset.panelLeft = panel.left.toFixed(2);
  bubble.style.left = `${external ? panel.left-10-width : panel.left+12}px`;
  // Height is deterministic from the face and two-line caption even while hidden.
  const height = bubble.hidden ? 170 : bubble.getBoundingClientRect().height;
  bubble.style.top = `${Math.max(8,Math.min(window.innerHeight-height-8,center-height/2))}px`;
  $('layout-status').textContent = external ? `同文档外侧布局：右栏 ${Math.round(panel.width)} px；反馈锚点 Y=${Math.round(center)}。原生面板尚未在此页验收。` : '外侧反馈不可用：网页剩余宽度不足180 px，已降级为栏内中部；不算正常外侧布局通过。';
  $('layout-status').dataset.mode = external ? 'external' : 'internal_fallback';
}
function beginSimulation() {
  mode = 'simulation';
  stopPhaseTimer(); presenter?.dispose();
  const personaId = $('persona').value;
  presenter = createPresentationController({
    contextKey: `gallery-simulation:${personaId}:${crypto.randomUUID()}`, personaId,
    resolveRecipe: (persona, semantic) => getSemanticExpression(persona,semantic)?.recipeId || `${persona}.idle`,
    onChange: renderSnapshot,
  });
  ticket = presenter.begin({operationId:'developer-button-only',semanticState:'loading'});
  $('simulate-result').disabled = false;
  $('simulation-status').textContent = '开发模拟已开始。状态在本地等待；选择语义并点击“返回所选结果”才会提交模拟回执。';
}
function resultSimulation() {
  if (!presenter || !ticket) return;
  const semanticState = $('semantic').value;
  // "confirmed" is synthetic evidence confined to this clearly labelled gallery.
  presenter.result(ticket,{semanticState,evidence:'confirmed',resolved:true,statusCode:semanticState});
  $('simulation-status').textContent = `开发模拟回执：${semanticState}。未执行任何真实操作，不能用于功能通过结论。`;
}
function dismissFeedback() {
  if (mode === 'simulation') presenter?.dismiss(snapshot?.revision);
  else if (snapshot) renderSnapshot({...snapshot,feedbackVisible:false,eventId:`preview-${++previewRevision}`,revision:previewRevision},`开发预览：${entryLabel(selectedEntry)}`);
}
function statistics(samples) {
  if (!samples.length) return {samples:0,meanMs:null,p95Ms:null,maxMs:null};
  const ordered = [...samples].sort((a,b)=>a-b);
  return {samples:samples.length,meanMs:+(samples.reduce((sum,n)=>sum+n,0)/samples.length).toFixed(3),p95Ms:+ordered[Math.ceil(ordered.length*.95)-1].toFixed(3),maxMs:+ordered.at(-1).toFixed(3)};
}
function recordingOutput(active = recording) {
  if (!active) return;
  const now = performance.now();
  const changes = Object.fromEntries(Object.entries(actionCounts).map(([key,count])=>[key,count-(active.beforeCounts[key]||0)]).filter(([,count])=>count>0));
  $('performance-output').textContent = JSON.stringify({
    kind:'real_pointer_local_script_measurement',notBusinessAcceptance:true,
    elapsedSeconds:+((now-active.started)/1000).toFixed(2),requestedSeconds:30,
    visibility:document.visibilityState,reducedMotion:effectiveReduced(),
    pointerGrabs:grabs-active.beforeGrabs,blankStagePresses:blankPresses-active.beforeBlank,
    physicsFramePublications:active.draws,heldFramePublications:active.heldFrames,
    animationCallbackScript:statistics(active.costs),animationFrameInterval:statistics(active.intervals),
    interactionTransitions:changes,finalHeld:body.getFrame().held,
    note:'只有实际发生的指针/键盘本体交互产生受力；未测量浏览器合成或GPU耗时。无交互样本不能判断性能。',
  },null,2);
}
function startRecording() {
  if (recording) return;
  recording={started:performance.now(),costs:[],intervals:[],draws:0,heldFrames:0,beforeGrabs:grabs,beforeBlank:blankPresses,beforeCounts:{...actionCounts}};
  $('record-start').disabled=true; $('record-stop').disabled=false;
  $('record-status').textContent='正在记录30秒。请实际按压、轻揉、快速揉搓、拉扯并松手；记录结束只表示采样结束。';
  recordingTimer=setTimeout(stopRecording,30000);
  statsTimer=setInterval(()=>recordingOutput(),500);
}
function stopRecording() {
  if (!recording) return;
  recordingOutput();
  const hadSamples=recording.heldFrames>0;
  recording=null; clearTimeout(recordingTimer); clearInterval(statsTimer);
  $('record-start').disabled=false; $('record-stop').disabled=true;
  $('record-status').textContent=hadSamples?'记录已结束，可查看实际样本；这不是自动性能通过判定。':'记录已结束，但没有实际受力样本，不能据此评价揉搓性能。';
}
function updateReduced() {
  document.documentElement.classList.toggle('reduced',effectiveReduced());
  interaction.setReducedMotion(effectiveReduced());
  if(snapshot)renderSnapshot(snapshot);
}

$('persona').addEventListener('change',populateCatalog);
$('catalog-kind').addEventListener('change',populateCatalog);
$('expression').addEventListener('change',selectEntry);
for (const [id,delta] of [['previous',-1],['next',1]]) $(id).addEventListener('click',()=>{
  const index=selectedEntries.findIndex(entry=>entry.id===selectedEntry.id);
  $('expression').value=selectedEntries[(index+delta+selectedEntries.length)%selectedEntries.length].id;selectEntry();
});
$('phase').addEventListener('change',()=>applyCatalog(snapshot?.feedbackVisible&&eligible(selectedEntry)));
$('preview-feedback').addEventListener('click',()=>{if(eligible(selectedEntry))applyCatalog(true);});
$('catalog-reset').addEventListener('click',()=>{interaction.cancel();applyCatalog();});
$('panel-width').addEventListener('change',()=>{interaction.cancel();document.documentElement.style.setProperty('--panel-width',`${$('panel-width').value}px`);positionFeedback();});
$('short-height').addEventListener('change',()=>{interaction.cancel();document.documentElement.classList.toggle('short-height',$('short-height').checked);positionFeedback();});
$('reduced').addEventListener('change',updateReduced);
reducedQuery.addEventListener('change',updateReduced);
$('simulate-begin').addEventListener('click',beginSimulation);
$('simulate-result').addEventListener('click',resultSimulation);
$('dismiss-feedback').addEventListener('click',dismissFeedback);
$('keyboard-poke').addEventListener('click',()=>interaction.poke({x:150,y:174}));
$('record-start').addEventListener('click',startRecording);
$('record-stop').addEventListener('click',stopRecording);
$('main-stage').addEventListener('pointerdown',event=>{
  const point=svgPointerPoint(event,mainView.element);
  if(point&&!body.hitTest(point)){blankPresses++;$('blank-count').textContent=String(blankPresses);}
});
const resizeObserver=new ResizeObserver(positionFeedback);
resizeObserver.observe($('test-sidebar'));
window.addEventListener('resize',positionFeedback);
window.visualViewport?.addEventListener('resize',positionFeedback);
document.addEventListener('visibilitychange',()=>{
  document.documentElement.dataset.softPageHidden=String(document.hidden);
  if(document.hidden){stopPhaseTimer();stopRecording();}
  else {if(mode==='simulation')presenter?.advance();queueAdvance();}
});
window.addEventListener('pagehide',()=>{
  disposed=true;interaction.dispose();presenter?.dispose();stopPhaseTimer();stopRecording();
  resizeObserver.disconnect();window.removeEventListener('resize',positionFeedback);
  window.visualViewport?.removeEventListener('resize',positionFeedback);
  reducedQuery.removeEventListener('change',updateReduced);
},{once:true});
document.documentElement.dataset.softPageHidden=String(document.hidden);populateCatalog();updateReduced();positionFeedback();
