// Local body geometry only. This module has no business, messaging or storage API.
const TAU = Math.PI * 2;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const angleDistance = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const validPoint = point => point && Number.isFinite(point.x) && Number.isFinite(point.y);

export const INTERACTION_STATES = Object.freeze([
  'none', 'poke', 'press_hold', 'rub_soft', 'rub_fast', 'rub_overload', 'drag_pull',
  'release_bounce', 'cancelled_reset',
]);

// These timings gate cosmetic gesture expressions, not local force response.
// Only time backed by fresh, effective motion advances rubbing expressions.
export const INTERACTION_TIMING = Object.freeze({
  holdMs: 700, softRubMs: 1200, strongRubMs: 3600, overloadRubMs: 7200,
  motionFreshMs: 180, interruptionMs: 900, faceDwellMs: 900, pullConfirmMs: 400,
});

// A polygonal hit test deliberately excludes accessories and the square stage.
// It follows the live nodes, including a stretched edge after a grab.
export function pointInContour(point, nodes) {
  if (!validPoint(point) || !Array.isArray(nodes) || nodes.length < 3) return false;
  let inside = false;
  for (let i = 0, j = nodes.length - 1; i < nodes.length; j = i++) {
    const a = nodes[j], b = nodes[i];
    const cross = (point.y - a.y) * (b.x - a.x) - (point.x - a.x) * (b.y - a.y);
    if (Math.abs(cross) < 1e-6 && point.x >= Math.min(a.x, b.x) - 1e-6 &&
        point.x <= Math.max(a.x, b.x) + 1e-6 && point.y >= Math.min(a.y, b.y) - 1e-6 &&
        point.y <= Math.max(a.y, b.y) + 1e-6) return true;
    if ((a.y > point.y) !== (b.y > point.y) &&
        point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// The outline uses the same finite segments as hit testing; 48 segments at the
// default size form a smooth silhouette without a spline overshooting the grab area.
export function contourPath(nodes) {
  if (!nodes.length) return '';
  return nodes.map((node, index) => `${index ? 'L' : 'M'}${node.x.toFixed(3)},${node.y.toFixed(3)}`).join(' ') + ' Z';
}

export function createSoftBody({cx = 150, cy = 160, width = 216, height = 168,
  nodeCount = 48, reducedMotion = false} = {}) {
  if (![cx, cy, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    throw new TypeError('Soft-body dimensions must be finite and positive');
  }
  const count = Math.round(clamp(Number.isFinite(nodeCount) ? nodeCount : 48, 24, 96));
  const rx = width / 2, ry = height / 2, maxPull = width * .35;
  const rest = Array.from({length: count}, (_, index) => {
    const angle = index * TAU / count;
    return {x: cx + Math.cos(angle) * rx, y: cy + Math.sin(angle) * ry, angle};
  });
  const nodes = rest.map(node => ({x: node.x, y: node.y, vx: 0, vy: 0}));
  let held = null, interaction = 'none', moving = false, clock = 0;
  let lowMotion = Boolean(reducedMotion), reversalTimes = [];
  const anchorRest = {
    eyeLeft: {x: cx - width * .16, y: cy - height * .06},
    eyeRight: {x: cx + width * .16, y: cy - height * .06},
    browLeft: {x: cx - width * .16, y: cy - height * .16},
    browRight: {x: cx + width * .16, y: cy - height * .16},
    mouth: {x: cx, y: cy + height * .15},
    cheekLeft: {x: cx - width * .27, y: cy + height * .09},
    cheekRight: {x: cx + width * .27, y: cy + height * .09},
    accessory: {x: cx, y: cy - height * .42},
  };

  function now(time) {
    clock = Number.isFinite(time) ? Math.max(clock, time) : clock;
    return clock;
  }
  function classify(time) {
    if (!held) return;
    const travel = distance(held.point, held.start) / width;
    reversalTimes = reversalTimes.filter(at => time - at < 360);
    const freshUntil = held.lastMovedAt + INTERACTION_TIMING.motionFreshMs;
    const fresh = time < freshUntil;
    const pulling = travel > (interaction === 'drag_pull' ? .115 : .16) && reversalTimes.length < 2;
    const motion = held.speed > .025 && held.totalTravel / width > .012 && !pulling;
    const strong = held.speed > 1.8 || (reversalTimes.length >= 2 && held.speed > .5);
    // Clip credited duration to the previous effective sample's freshness.
    // move() calls classify before updating its sample, so a new move after a
    // long pause cannot retroactively count the idle time as continuous rubbing.
    const credited = motion ? Math.max(0, Math.min(time, freshUntil) - held.classifiedAt) : 0;
    if (credited > 0) {
      held.rubMs += credited; held.lastRubAt = Math.min(time, freshUntil);
      if (strong) { held.strongRubMs += credited; held.lastStrongAt = held.lastRubAt; }
    }
    held.classifiedAt = time;
    if (time - held.lastRubAt >= INTERACTION_TIMING.interruptionMs) held.rubMs = 0;
    if (time - held.lastStrongAt >= INTERACTION_TIMING.interruptionMs) held.strongRubMs = 0;
    if (pulling) held.pullSince ??= time;
    else held.pullSince = null;

    let next = interaction;
    if (pulling && time - held.pullSince >= INTERACTION_TIMING.pullConfirmMs) next = 'drag_pull';
    else if (fresh && motion && held.rubMs >= INTERACTION_TIMING.softRubMs) {
      next = held.strongRubMs >= INTERACTION_TIMING.overloadRubMs ? 'rub_overload' : held.strongRubMs >= INTERACTION_TIMING.strongRubMs ? 'rub_fast' : 'rub_soft';
    } else if (!fresh && time - held.startedAt >= INTERACTION_TIMING.holdMs &&
      (held.totalTravel === 0 || time - held.lastRubAt >= INTERACTION_TIMING.interruptionMs)) next = 'press_hold';

    // Keep an established reaction readable through short pauses, reversals and
    // threshold noise. Physical position continues updating independently.
    const established = ['rub_soft', 'rub_fast', 'rub_overload', 'drag_pull'].includes(interaction);
    if (next !== interaction && (!established || time - held.faceSince >= INTERACTION_TIMING.faceDwellMs)) {
      interaction = next; held.faceSince = time;
    }
  }
  function targets() {
    if (!held) return rest;
    const dx = held.point.x - held.start.x, dy = held.point.y - held.start.y;
    const raw = Math.hypot(dx, dy);
    // Saturating resistance: the first millimetres are soft, further pulling
    // increasingly resists, and no pointer distance can exceed 35% body width.
    const pull = maxPull * Math.tanh(raw / maxPull);
    const dragX = raw ? dx / raw * pull : 0, dragY = raw ? dy / raw * pull : 0;
    const elapsed = clock - held.startedAt;
    const depth = height * (.052 + .052 * clamp(elapsed / 700, 0, 1));
    const pressFactor = 1 - clamp(raw / (width * .26), 0, .86);
    return rest.map(node => {
      const diff = angleDistance(node.angle, held.angle);
      const local = Math.exp(-diff * diff / (.48 * .48 * 2));
      const shoulder = Math.exp(-((Math.abs(diff) - .88) ** 2) / (.24 * .24 * 2));
      const broad = Math.exp(-diff * diff / (.75 * .75 * 2));
      const pressure = -depth * pressFactor * local + depth * .25 * pressFactor * shoulder;
      let x = node.x + Math.cos(node.angle) * pressure + dragX * broad;
      let y = node.y + Math.sin(node.angle) * pressure + dragY * broad;
      // Prevent inward drags collapsing the body or crossing its centre.
      const radial = Math.hypot((x - cx) / rx, (y - cy) / ry);
      if (radial < .62) {
        x = cx + (radial > 1e-6 ? (x - cx) / radial : Math.cos(node.angle) * rx) * .62;
        y = cy + (radial > 1e-6 ? (y - cy) / radial : Math.sin(node.angle) * ry) * .62;
      }
      const displacement = Math.hypot(x - node.x, y - node.y);
      if (displacement > maxPull) { x = node.x + (x - node.x) * maxPull / displacement; y = node.y + (y - node.y) * maxPull / displacement; }
      return {x, y};
    });
  }
  function constrain() {
    for (let index = 0; index < count; index++) {
      const node = nodes[index], origin = rest[index];
      const amount = distance(node, origin);
      if (amount > maxPull) {
        node.x = origin.x + (node.x - origin.x) * maxPull / amount;
        node.y = origin.y + (node.y - origin.y) * maxPull / amount;
        node.vx *= .45; node.vy *= .45;
      }
    }
    const minY = Math.min(...nodes.map(node => node.y)), maxY = Math.max(...nodes.map(node => node.y));
    if (maxY - minY < height * .60) {
      const midY = (minY + maxY) / 2, scale = height * .60 / Math.max(.001, maxY - minY);
      for (const node of nodes) { node.y = midY + (node.y - midY) * scale; node.vy = 0; }
    }
  }
  function mapAnchor(point) {
    let dx = 0, dy = 0, total = 0;
    for (let index = 0; index < count; index++) {
      const weight = 1 / (Math.pow(distance(point, rest[index]) / width, 3) + .016);
      dx += (nodes[index].x - rest[index].x) * weight;
      dy += (nodes[index].y - rest[index].y) * weight;
      total += weight;
    }
    dx = clamp(dx / total, -width * .12, width * .12);
    dy = clamp(dy / total, -height * .12, height * .12);
    // Local face anchors move continuously, without crushing the glyphs.
    return {x: point.x + dx, y: point.y + dy, dx, dy,
      rotation: clamp(dx / width * 30, -4, 4), scaleX: 1, scaleY: 1};
  }
  function getFrame() {
    const outline = nodes.map(({x, y}) => ({x, y}));
    return {nodes: outline, path: contourPath(outline),
      anchors: Object.fromEntries(Object.entries(anchorRest).map(([name, point]) => [name, mapAnchor(point)])),
      interaction, active: Boolean(held || moving), held: Boolean(held), reducedMotion: lowMotion};
  }
  function reset(state = 'none') {
    held = null; reversalTimes = []; moving = false; interaction = state;
    for (let index = 0; index < count; index++) Object.assign(nodes[index], {x: rest[index].x, y: rest[index].y, vx: 0, vy: 0});
    return getFrame();
  }
  return {
    get nodes() { return nodes.map(({x, y}) => ({x, y})); },
    get width() { return width; },
    get height() { return height; },
    get active() { return Boolean(held || moving); },
    get interaction() { return interaction; },
    getFrame,
    hitTest(point) { return pointInContour(point, nodes); },
    begin(point, timeMs = 0) {
      if (held || !validPoint(point) || !pointInContour(point, nodes)) return false;
      const time = now(timeMs), px = (point.x - cx) / rx, py = (point.y - cy) / ry;
      held = {start: {...point}, point: {...point}, angle: Math.hypot(px, py) < .18 ? -Math.PI / 2 : Math.atan2(py, px),
        startedAt: time, lastAt: time, lastMovedAt: -Infinity, speed: 0, totalTravel: 0,
        lastVector: null, classifiedAt: time, rubMs: 0, strongRubMs: 0,
        lastRubAt: -Infinity, lastStrongAt: -Infinity, faceSince: time, pullSince: null};
      interaction = 'poke'; moving = true; reversalTimes = [];
      return true;
    },
    move(point, timeMs) {
      if (!held || !validPoint(point)) return false;
      const time = now(timeMs), elapsed = Math.max(8, time - held.lastAt);
      classify(time);
      const vector = {x: point.x - held.point.x, y: point.y - held.point.y};
      const travelled = Math.hypot(vector.x, vector.y);
      if (travelled > width * .001) {
        if (held.lastVector && vector.x * held.lastVector.x + vector.y * held.lastVector.y <
          -Math.hypot(vector.x, vector.y) * Math.hypot(held.lastVector.x, held.lastVector.y) * .35) reversalTimes.push(time);
        held.lastVector = vector; held.lastMovedAt = time;
      }
      held.speed = held.speed * .25 + (travelled / width / (elapsed / 1000)) * .75;
      held.totalTravel += travelled; held.lastAt = time; held.point = {...point};
      classify(time); moving = true;
      return true;
    },
    release({cancelled = false, timeMs} = {}) {
      now(timeMs);
      if (!held) return false;
      held = null; reversalTimes = [];
      if (cancelled) { reset('cancelled_reset'); return true; }
      interaction = 'release_bounce'; moving = true;
      if (lowMotion) for (const node of nodes) { node.vx = 0; node.vy = 0; }
      return true;
    },
    step(dtSeconds) {
      if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) return getFrame();
      const dt = Math.min(dtSeconds, .064);
      clock += dt * 1000;
      if (!held && !moving) return getFrame();
      classify(clock);
      const target = targets(), steps = Math.ceil(dt / (1 / 120)), h = dt / steps;
      for (let step = 0; step < steps; step++) {
        for (let index = 0; index < count; index++) {
          const node = nodes[index], aim = target[index];
          if (lowMotion) {
            const weight = 1 - Math.exp(-h * 17);
            node.x += (aim.x - node.x) * weight; node.y += (aim.y - node.y) * weight;
            node.vx = 0; node.vy = 0;
          } else {
            const stiffness = held ? 290 : 230, damping = held ? 29 : 14;
            node.vx += ((aim.x - node.x) * stiffness - node.vx * damping) * h;
            node.vy += ((aim.y - node.y) * stiffness - node.vy * damping) * h;
            node.x += node.vx * h; node.y += node.vy * h;
          }
        }
        constrain();
      }
      if (!held && nodes.every((node, index) => distance(node, rest[index]) < .035 && Math.hypot(node.vx, node.vy) < .15)) reset();
      return getFrame();
    },
    setReducedMotion(value) {
      lowMotion = Boolean(value);
      if (lowMotion) for (const node of nodes) { node.vx = 0; node.vy = 0; }
      return getFrame();
    },
    reset,
  };
}
