import {createSoftBody} from './physics.js';

export function svgPointerPoint(event, svg) {
  if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return null;
  try {
    const matrix = svg.getScreenCTM();
    if (!matrix) return null;
    const point = svg.createSVGPoint();
    point.x = event.clientX; point.y = event.clientY;
    const local = point.matrixTransform(matrix.inverse());
    return Number.isFinite(local.x) && Number.isFinite(local.y) ? {x: local.x, y: local.y} : null;
  } catch { return null; }
}

// Instantiate only for MainBodyCard. FeedbackBubble is a static snapshot renderer
// and must never be passed here. No pointer event leaves this component.
export function createBodyInteraction({svg, stage, body = createSoftBody(), getPoint = svgPointerPoint,
  onFrame = () => {}, onInteraction = () => {}, window: win = globalThis.window,
  document: doc = svg?.ownerDocument || globalThis.document,
  requestAnimationFrame: schedule = win?.requestAnimationFrame?.bind(win),
  cancelAnimationFrame: unschedule = win?.cancelAnimationFrame?.bind(win)} = {}) {
  if (!svg || !stage || typeof schedule !== 'function' || typeof unschedule !== 'function') {
    throw new TypeError('Interactive body needs an SVG, a stage and animation scheduling');
  }
  let pointerId = null, raf = null, lastFrame = null, disposed = false, lastInteraction = null;
  let originalTouchAction = '', suppressClick = false, gestureEndAt = -Infinity;
  let keyboardPokeElapsed = null;
  const listeners = [];
  const listen = (target, name, handler, options) => {
    if (!target?.addEventListener) return;
    target.addEventListener(name, handler, options);
    listeners.push(() => target.removeEventListener(name, handler, options));
  };
  function publish(frame = body.getFrame()) {
    onFrame(frame);
    if (frame.interaction !== lastInteraction) {
      lastInteraction = frame.interaction;
      onInteraction(frame.interaction, frame);
    }
  }
  function stopFrames() {
    if (raf !== null) unschedule(raf);
    raf = null; lastFrame = null;
  }
  function animate(time) {
    raf = null;
    if (disposed) return;
    const dt = lastFrame === null ? 1 / 60 : Math.min(.064, Math.max(.001, (time - lastFrame) / 1000));
    lastFrame = time;
    body.step(dt);
    if (keyboardPokeElapsed !== null) {
      keyboardPokeElapsed += dt;
      if (keyboardPokeElapsed >= .12) { keyboardPokeElapsed = null; body.release(); }
    }
    publish();
    if (body.active) raf = schedule(animate);
    else lastFrame = null;
  }
  function startFrames() { if (!disposed && raf === null) raf = schedule(animate); }
  function releaseCapture() {
    const id = pointerId;
    pointerId = null;
    if (stage.style) stage.style.touchAction = originalTouchAction;
    if (id !== null) {
      try { if (!stage.hasPointerCapture || stage.hasPointerCapture(id)) stage.releasePointerCapture(id); } catch { /* Already lost on navigation/cancel. */ }
    }
  }
  function cancel() {
    if (disposed) return;
    keyboardPokeElapsed = null;
    if (pointerId !== null) body.release({cancelled: true});
    else body.reset();
    suppressClick = false;
    releaseCapture(); stopFrames(); publish();
  }
  function down(event) {
    if (disposed || pointerId !== null || event.isPrimary === false || (event.button !== undefined && event.button !== 0)) return;
    if (event.target?.closest?.('button,a,input,textarea,select,[data-soft-noninteractive]')) return;
    const point = getPoint(event, svg);
    if (!point || !body.begin(point, event.timeStamp)) return;
    pointerId = event.pointerId;
    originalTouchAction = stage.style?.touchAction || '';
    if (stage.style) stage.style.touchAction = 'none';
    try { stage.setPointerCapture(pointerId); } catch { cancel(); return; }
    suppressClick = true;
    event.preventDefault();
    publish(); startFrames();
  }
  function move(event) {
    if (disposed || pointerId === null || event.pointerId !== pointerId) return;
    const point = getPoint(event, svg);
    if (point) body.move(point, event.timeStamp);
    event.preventDefault(); publish(); startFrames();
  }
  function up(event) {
    if (disposed || pointerId === null || event.pointerId !== pointerId) return;
    body.release({timeMs: event.timeStamp});
    gestureEndAt = event.timeStamp;
    releaseCapture(); event.preventDefault(); publish(); startFrames();
  }
  function lost(event) { if (pointerId !== null && event.pointerId === pointerId) cancel(); }
  listen(stage, 'pointerdown', down);
  listen(stage, 'pointermove', move);
  listen(stage, 'pointerup', up);
  listen(stage, 'pointercancel', lost);
  listen(stage, 'lostpointercapture', lost);
  listen(stage, 'click', event => {
    // Suppress only the synthetic click following a captured body gesture.
    const followsGesture = suppressClick && event.detail !== 0 && event.timeStamp - gestureEndAt >= 0 && event.timeStamp - gestureEndAt < 500;
    suppressClick = false;
    if (followsGesture && !event.target?.closest?.('button,a,input,textarea,select,[data-soft-noninteractive]')) {
      event.preventDefault(); event.stopPropagation();
    }
  }, true);
  listen(win, 'blur', cancel);
  listen(doc, 'visibilitychange', () => { if (doc.hidden) cancel(); });
  publish();
  return {
    body,
    cancel,
    poke(point) {
      if (disposed || pointerId !== null || body.getFrame().held) return false;
      const anchors = body.getFrame().anchors;
      const target = point || {x: (anchors.eyeLeft.x + anchors.eyeRight.x) / 2, y: anchors.mouth.y};
      if (!body.begin(target)) return false;
      keyboardPokeElapsed = 0;
      publish(); startFrames();
      return true;
    },
    setReducedMotion(value) { body.setReducedMotion(value); publish(); if (body.active) startFrames(); },
    dispose() {
      if (disposed) return;
      cancel(); disposed = true;
      for (const remove of listeners) remove();
      listeners.length = 0;
    },
  };
}
