// A single browser editing command followed by bounded, read-only observation.
// Never use a value setter, synthetic input/change, or a second write fallback.
(() => {
  async function check(element, expected, options = {}) {
    const {ready, readText = () => element.value, stableMs = 600, timeoutMs = 1800, pollMs = 50, requireFocus = false} = options;
    const doc = element?.ownerDocument, view = doc?.defaultView;
    let latest = '';
    const result = (stable, reason) => ({stable, text: latest, reason});
    const validTime = value => Number.isFinite(value) && value > 0;
    if(typeof expected !== 'string' || typeof ready !== 'function' || typeof readText !== 'function' || typeof requireFocus !== 'boolean'
      || !view || typeof view.setTimeout !== 'function' || typeof view.clearTimeout !== 'function' || typeof view.performance?.now !== 'function'
      || !validTime(stableMs) || !validTime(timeoutMs) || !validTime(pollMs) || stableMs > timeoutMs || pollMs > timeoutMs)
      return result(false, 'invalid_request');
    const connected = () => element?.tagName === 'TEXTAREA' && element.ownerDocument === doc && doc.defaultView === view
      && element.isConnected === true && !element.disabled && !element.readOnly && doc.visibilityState === 'visible'
      && element.getClientRects().length > 0 && (!requireFocus || doc.activeElement === element) && ready() === true;
    const read = () => {
      const value = readText(); if(typeof value !== 'string') throw Error('unreadable draft');
      latest = value; return value;
    };
    try {
      if(!connected()) return result(false, 'not_ready');
      if(read() !== expected) return result(false, 'draft_mismatch');
      if(!connected()) return result(false, 'context_changed');
    } catch { return result(false, 'verification_failed'); }
    return new Promise(resolve => {
      let timer = null, deadline = null, done = false;
      const start = view.performance.now();
      const finish = (stable, reason) => {
        if(done) return; done = true;
        if(timer !== null) view.clearTimeout(timer);
        if(deadline !== null) view.clearTimeout(deadline);
        resolve(result(stable, reason));
      };
      const sample = () => {
        if(done) return;
        try {
          if(!connected()) return finish(false, 'context_changed');
          if(read() !== expected) return finish(false, 'draft_mismatch');
          if(!connected()) return finish(false, 'context_changed');
          const elapsed = view.performance.now() - start;
          if(!Number.isFinite(elapsed) || elapsed < 0) return finish(false, 'clock_changed');
          if(elapsed > timeoutMs) return finish(false, 'timeout');
          if(elapsed >= stableMs) return finish(true, 'stable');
          timer = view.setTimeout(sample, Math.min(pollMs, stableMs - elapsed));
        } catch { finish(false, 'verification_failed'); }
      };
      deadline = view.setTimeout(() => {
        try { read(); } catch { /* Return the last readable value without claiming success. */ }
        finish(false, 'timeout');
      }, timeoutMs);
      timer = view.setTimeout(sample, Math.min(pollMs, stableMs));
    });
  }
  async function write(element, expected, options = {}) {
    const {ready, readText = () => element.value, stableMs = 600, timeoutMs = 1800, pollMs = 50} = options;
    const doc = element?.ownerDocument, view = doc?.defaultView;
    let before = '', latest = '', changed = false, commandAccepted = null, commandAttempted = false;
    const result = (stable, reason) => ({stable, text: latest, changed, commandAccepted, commandAttempted, reason});
    const read = () => {
      const value = readText();
      if(typeof value !== 'string') throw Error('unreadable draft');
      latest = value; if(value !== before) changed = true;
      return value;
    };
    const connected = () => element?.tagName === 'TEXTAREA' && element.ownerDocument === doc && doc.defaultView === view
      && element.isConnected === true && !element.disabled && !element.readOnly && doc.visibilityState === 'visible'
      && element.getClientRects().length > 0 && ready() === true;
    const focused = () => connected() && doc.activeElement === element;
    const validTime = value => Number.isFinite(value) && value > 0;
    if(typeof expected !== 'string' || typeof ready !== 'function' || typeof readText !== 'function'
      || !view || typeof view.setTimeout !== 'function' || typeof view.clearTimeout !== 'function' || typeof view.performance?.now !== 'function'
      || !validTime(stableMs) || !validTime(timeoutMs) || !validTime(pollMs) || stableMs > timeoutMs || pollMs > timeoutMs)
      return result(false, 'invalid_request');
    try {
      before = readText(); if(typeof before !== 'string') return result(false, 'read_failed'); latest = before;
      if(!connected()) return result(false, 'not_ready');
      element.focus();
      if(!focused()) return result(false, 'context_changed');
      if(read() !== before) return result(false, 'draft_changed_before_write');
      element.setSelectionRange(0, before.length);
      if(!focused()) return result(false, 'context_changed');
      if(read() !== before) return result(false, 'draft_changed_before_write');
      if(element.selectionStart !== 0 || element.selectionEnd !== before.length) return result(false, 'selection_changed');
      // Recheck after reading selection: focus/selection handlers can synchronously
      // rerender the editor or change the draft. A rejected command is never retried.
      if(!focused()) return result(false, 'context_changed');
      if(read() !== before) return result(false, 'draft_changed_before_write');
      if(before !== expected) {
        commandAttempted = true;
        try { commandAccepted = doc.execCommand(expected ? 'insertText' : 'delete', false, expected || undefined) === true; }
        catch {
          try { read(); } catch { changed = true; }
          return result(false, changed ? 'command_failed_after_change' : 'command_failed');
        }
        try { read(); } catch { changed = true; return result(false, 'read_failed'); }
        if(!commandAccepted) return result(false, changed ? 'command_rejected_after_change' : 'command_rejected');
      }
      if(!focused()) return result(false, 'context_changed');
      if(read() !== expected) return result(false, 'draft_mismatch');
    } catch {
      // Unknown state after an attempted command must not authorize a retry.
      if(commandAttempted) changed = true;
      return result(false, 'verification_failed');
    }
    const checked = await check(element, expected, {...options, requireFocus: true, readText: read});
    if(!checked.stable && checked.reason === 'verification_failed' && commandAttempted) changed = true;
    return result(checked.stable, checked.reason);
  }
  globalThis.__textMemoryMobileTextarea = {write, check};
})();
