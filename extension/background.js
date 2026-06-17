// Kestrel Companion — MV3 service worker.
// Long-polls the Kestrel daemon (mode=extension) for commands and executes them
// against the ACTIVE tab using chrome.debugger Input (isTrusted=true) at VIEWPORT
// coordinates — so there is NO screen/monitor/DPI coordinate math, and it works on
// the user's real, logged-in Chrome with no debug port. Attaches/detaches the
// debugger per action burst (the "debugging this tab" banner shows only briefly).

const DAEMON = `http://127.0.0.1:${self.KESTREL_PORT || 39817}`;

function dbg(tabId, method, params) {
  return new Promise((resolve, reject) =>
    chrome.debugger.sendCommand({ tabId }, method, params || {}, (r) =>
      chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve(r)
    )
  );
}
async function attach(tabId) {
  await new Promise((resolve, reject) =>
    chrome.debugger.attach({ tabId }, '1.3', () =>
      chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve()
    )
  );
}
async function detach(tabId) {
  await new Promise((resolve) => chrome.debugger.detach({ tabId }, () => resolve()));
}
async function activeTab() {
  const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return t;
}

// Snapshot of interactive elements (viewport coords + a stable data-kref index).
function SNAP() {
  const sel = 'a,button,input,select,textarea,[role=button],[role=link],[role=tab],[role=checkbox],[onclick],[tabindex]';
  const out = [];
  let i = 0;
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
    const st = getComputedStyle(el);
    if (st.visibility === 'hidden' || st.display === 'none' || st.opacity === '0') continue;
    i++;
    el.setAttribute('data-kref', String(i));
    out.push({ i, role: el.getAttribute('role') || el.tagName.toLowerCase(), name: (el.innerText || el.value || el.getAttribute('aria-label') || el.placeholder || '').trim().slice(0, 60) });
  }
  return out;
}

async function viewportCoords(tabId, selector, ref) {
  // refs are integers (data-kref index). Reject anything non-numeric so a crafted
  // ref can't break out of the attribute selector into a different element.
  const rf = ref != null && /^\d+$/.test(String(ref)) ? String(ref) : null;
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (sel, rfi) => {
      let el = null;
      if (rfi) el = document.querySelector('[data-kref="' + rfi + '"]');
      if (!el && sel) el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    },
    args: [selector || null, rf],
  });
  return result;
}

async function trustedClick(tabId, x, y) {
  await attach(tabId);
  try {
    await dbg(tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await dbg(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await dbg(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  } finally {
    await detach(tabId);
  }
}
async function trustedType(tabId, text, submit) {
  await attach(tabId);
  try {
    if (text) await dbg(tabId, 'Input.insertText', { text });
    if (submit) {
      const k = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
      await dbg(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', ...k });
      await dbg(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', ...k });
    }
  } finally {
    await detach(tabId);
  }
}

// Trusted key press, e.g. "Enter", "Tab", "Meta+a", "Control+Shift+r".
const KEYS = {
  enter: { key: 'Enter', code: 'Enter', vk: 13 }, tab: { key: 'Tab', code: 'Tab', vk: 9 },
  escape: { key: 'Escape', code: 'Escape', vk: 27 }, backspace: { key: 'Backspace', code: 'Backspace', vk: 8 },
  delete: { key: 'Delete', code: 'Delete', vk: 46 }, space: { key: ' ', code: 'Space', vk: 32 },
  arrowdown: { key: 'ArrowDown', code: 'ArrowDown', vk: 40 }, arrowup: { key: 'ArrowUp', code: 'ArrowUp', vk: 38 },
  arrowleft: { key: 'ArrowLeft', code: 'ArrowLeft', vk: 37 }, arrowright: { key: 'ArrowRight', code: 'ArrowRight', vk: 39 },
  pagedown: { key: 'PageDown', code: 'PageDown', vk: 34 }, pageup: { key: 'PageUp', code: 'PageUp', vk: 33 },
  home: { key: 'Home', code: 'Home', vk: 36 }, end: { key: 'End', code: 'End', vk: 35 },
};
async function trustedPress(tabId, combo) {
  const parts = String(combo).split('+');
  const keyName = parts.pop();
  let modifiers = 0;
  for (const m of parts.map((s) => s.toLowerCase())) {
    if (m === 'alt' || m === 'option') modifiers |= 1;
    else if (m === 'control' || m === 'ctrl') modifiers |= 2;
    else if (m === 'meta' || m === 'cmd' || m === 'command') modifiers |= 4;
    else if (m === 'shift') modifiers |= 8;
  }
  const known = KEYS[keyName.toLowerCase()];
  const k = known
    ? { key: known.key, code: known.code, windowsVirtualKeyCode: known.vk, nativeVirtualKeyCode: known.vk }
    : { key: keyName, code: 'Key' + keyName.toUpperCase(), windowsVirtualKeyCode: keyName.toUpperCase().charCodeAt(0), nativeVirtualKeyCode: keyName.toUpperCase().charCodeAt(0) };
  await attach(tabId);
  try {
    await dbg(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', modifiers, ...k, text: k.key.length === 1 ? k.key : undefined });
    await dbg(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', modifiers, ...k });
  } finally {
    await detach(tabId);
  }
}

async function handle(cmd) {
  const { action, args = {} } = cmd;
  const t = await activeTab();
  if (!t) return { ok: false, error: 'no active tab' };
  // Page-content actions need a real web page; chrome://, chrome-extension://,
  // devtools://, the Web Store, etc. can't be scripted — fail fast with a clear msg.
  const NEEDS_PAGE = new Set(['snapshot', 'click', 'click_xy', 'type', 'paste', 'extract', 'eval', 'scroll', 'press', 'upload_file']);
  if (NEEDS_PAGE.has(action) && !/^(https?|file):/.test(t.url || '')) {
    return { ok: false, error: 'active tab is not a scriptable web page: ' + (t.url || '(none)') };
  }
  try {
    if (action === 'goto') {
      await chrome.tabs.update(t.id, { url: args.url });
      return { ok: true, url: args.url };
    }
    if (action === 'snapshot') {
      const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: t.id }, func: SNAP });
      return { ok: true, mode: 'extension', count: result.length, marks: result };
    }
    if (action === 'click' || action === 'click_xy') {
      let c;
      if (args.x != null && args.y != null) c = { x: +args.x, y: +args.y };
      else c = await viewportCoords(t.id, args.selector, args.ref || args.i);
      if (!c) return { ok: false, error: 'element not found (snapshot first; use ref=/selector=/x=,y=)' };
      await trustedClick(t.id, c.x, c.y);
      return { ok: true, clicked: c, trusted: true };
    }
    if (action === 'type' || action === 'paste') {
      if (args.selector || args.ref || args.i) {
        const c = await viewportCoords(t.id, args.selector, args.ref || args.i);
        if (c) await trustedClick(t.id, c.x, c.y);
      }
      await trustedType(t.id, args.text || '', !!args.submit);
      return { ok: true, trusted: true };
    }
    if (action === 'upload_file') {
      // Trusted file upload: resolve the <input type=file> (by data-kref ref or
      // selector), then call CDP DOM.setFileInputFiles so the files arrive with
      // isTrusted=true (JS-set .files / DataTransfer can't do that). Paths are
      // local to the machine running Chrome; comma-separated = multi-file.
      const filePaths = String(args.path || '').split(',').map((p) => p.trim()).filter(Boolean);
      if (!filePaths.length) return { ok: false, error: 'no file paths provided (path= required)' };
      // Mark the target input with a unique attribute so CDP can re-find it after
      // we switch from the scripting world into the debugger world.
      const mark = 'k' + Math.random().toString(36).slice(2);
      const rf = args.ref != null && /^\d+$/.test(String(args.ref)) ? String(args.ref) : null;
      const [{ result: found }] = await chrome.scripting.executeScript({
        target: { tabId: t.id },
        func: (sel, rfi, m) => {
          let el = null;
          if (rfi) el = document.querySelector('[data-kref="' + rfi + '"]');
          if (!el && sel) el = document.querySelector(sel);
          if (!el) return null;
          el.setAttribute('data-kupload', m);
          return { tag: el.tagName, type: el.type };
        },
        args: [args.selector || null, rf, mark],
      });
      if (!found) return { ok: false, error: 'element not found (snapshot first; use ref=/selector=)' };
      if (found.tag !== 'INPUT' || found.type !== 'file')
        return { ok: false, error: `target is not <input type=file> (got <${found.tag.toLowerCase()} type="${found.type}">)` };
      await attach(t.id);
      try {
        await dbg(t.id, 'DOM.enable');
        const { root } = await dbg(t.id, 'DOM.getDocument', { depth: 0 });
        const { nodeId } = await dbg(t.id, 'DOM.querySelector', { nodeId: root.nodeId, selector: `input[data-kupload="${mark}"]` });
        if (!nodeId) return { ok: false, error: 'CDP could not locate the input (DOM changed?)' };
        await dbg(t.id, 'DOM.setFileInputFiles', { nodeId, files: filePaths });
        return { ok: true, uploaded: filePaths, trusted: true };
      } finally {
        await detach(t.id);
        // Best-effort cleanup of the marker attribute.
        chrome.scripting.executeScript({
          target: { tabId: t.id },
          func: (m) => { const el = document.querySelector(`input[data-kupload="${m}"]`); if (el) el.removeAttribute('data-kupload'); },
          args: [mark],
        }).catch(() => {});
      }
    }
    if (action === 'extract') {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: t.id },
        func: () => (document.body ? document.body.innerText.slice(0, 16000) : ''),
      });
      return { ok: true, url: t.url, text: result };
    }
    if (action === 'eval') {
      const [{ result }] = await chrome.scripting.executeScript({
        world: 'MAIN',
        target: { tabId: t.id },
        func: (code) => {
          try {
            return String(eval(code));
          } catch (e) {
            return 'evalerr:' + e.message;
          }
        },
        args: [args.js],
      });
      return { ok: true, value: result };
    }
    if (action === 'press') {
      await trustedPress(t.id, args.keys || args.key || 'Enter');
      return { ok: true, pressed: args.keys || args.key || 'Enter', trusted: true };
    }
    if (action === 'scroll') {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: t.id },
        func: (dir, toText) => {
          if (toText) {
            const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
            let n;
            while ((n = walk.nextNode())) {
              if (n.textContent.toLowerCase().includes(toText.toLowerCase())) {
                n.parentElement.scrollIntoView({ block: 'center' });
                return { found: true, y: Math.round(scrollY) };
              }
            }
            return { found: false, y: Math.round(scrollY) };
          }
          scrollBy({ top: (dir === 'up' ? -1 : 1) * Math.round(innerHeight * 0.8), behavior: 'instant' });
          return { y: Math.round(scrollY) };
        },
        args: [args.direction || 'down', args.to_text || null],
      });
      return { ok: true, ...result, note: 'refs are viewport-scoped — re-snapshot after scrolling' };
    }
    if (action === 'back') { await chrome.tabs.goBack(t.id); return { ok: true }; }
    if (action === 'forward') { await chrome.tabs.goForward(t.id); return { ok: true }; }
    if (action === 'screenshot') {
      const dataUrl = await chrome.tabs.captureVisibleTab(t.windowId, { format: 'png' });
      return { ok: true, dataUrl }; // daemon saves it to ~/.kestrel/shots and returns the path
    }
    if (action === 'wait_for') {
      const timeout = +args.timeout || 15000;
      const t0 = Date.now();
      for (;;) {
        const tab = await activeTab();
        if (args.url && tab?.url?.includes(args.url)) return { ok: true, matched: 'url', url: tab.url };
        if (args.text || args.selector) {
          const [{ result }] = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: (txt, sel) => (sel ? !!document.querySelector(sel) : (document.body?.innerText || '').includes(txt)),
            args: [args.text || '', args.selector || null],
          }).catch(() => [{ result: false }]);
          if (result) return { ok: true, matched: args.selector ? 'selector' : 'text' };
        }
        if (Date.now() - t0 > timeout) return { ok: false, error: 'wait_for timed out', waited: timeout };
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    if (action === 'tabs') {
      const all = await chrome.tabs.query({});
      return { ok: true, tabs: all.map((x, idx) => ({ index: idx, id: x.id, url: x.url, title: x.title, active: x.active })) };
    }
    if (action === 'new_tab') {
      const nt = await chrome.tabs.create({ url: args.url || 'about:blank', active: true });
      return { ok: true, id: nt.id, url: args.url || 'about:blank' };
    }
    if (action === 'switch_tab') {
      const all = await chrome.tabs.query({});
      const target = all[+args.index];
      if (!target) return { ok: false, error: 'no tab at index ' + args.index };
      await chrome.tabs.update(target.id, { active: true });
      await chrome.windows.update(target.windowId, { focused: true });
      return { ok: true, index: +args.index, url: target.url };
    }
    if (action === 'close_tab') {
      let target = t;
      if (args.index != null) {
        const all = await chrome.tabs.query({});
        target = all[+args.index];
        if (!target) return { ok: false, error: 'no tab at index ' + args.index };
      }
      await chrome.tabs.remove(target.id);
      return { ok: true, closed: target.url };
    }
    return { ok: false, error: 'unsupported in extension mode: ' + action };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

let running = false;
async function loop() {
  if (running) return;
  running = true;
  try {
    for (;;) {
      try {
        // Abort a stalled long-poll (TCP half-open / daemon hung) so the loop can't
        // wedge forever; the daemon's own long-poll returns within ~25s.
        const r = await fetch(DAEMON + '/ext/next', { signal: AbortSignal.timeout(35000) });
        const cmd = await r.json();
        if (cmd && cmd.action) {
          const result = await handle(cmd);
          await fetch(DAEMON + '/ext/result', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: cmd.id, result }),
            signal: AbortSignal.timeout(35000),
          });
        }
      } catch (e) {
        await new Promise((res) => setTimeout(res, 1500)); // daemon not up / not in extension mode / poll timed out
      }
    }
  } finally {
    // Always clear the guard so the keepalive alarm or a restart can re-enter loop()
    // even if the for(;;) ever exits unexpectedly.
    running = false;
  }
}
chrome.runtime.onInstalled.addListener(() => loop());
chrome.runtime.onStartup.addListener(() => loop());
// MV3 service workers go dormant after ~30s idle, which would silently kill the
// long-poll. A short alarm wakes the worker and re-arms the loop (loop() is a
// no-op while already running, so this only matters after a suspend).
try {
  chrome.alarms.create('kestrel-keepalive', { periodInMinutes: 0.4 });
  chrome.alarms.onAlarm.addListener(() => loop());
} catch {}
loop();
