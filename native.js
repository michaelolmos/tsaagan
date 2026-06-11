// kestrel NATIVE mode — drive the user's REAL browser with NO debug port and NO
// CDP/Playwright. This is the most reliable path on strict sites that ignore
// synthetic input, because input is REAL OS-level mouse/keyboard → DOM events are
// isTrusted=true, which CDP/JS-dispatched input can never produce.
//
// Cross-platform input:
//   • macOS   — cliclick (clicks) + osascript System Events (keys/paste); FULL
//               DOM perception via AppleScript `execute javascript`. (Validated.)
//   • Linux   — xdotool (clicks/keys/type) + xclip/wl-copy (clipboard).  [UNTESTED]
//   • Windows — PowerShell SendInput/SendKeys + Set-Clipboard.            [UNTESTED]
// On Linux/Windows there is no AppleScript DOM read, so perception is screenshot-
// based: use `snapshot` (returns a screenshot) + vision + `click_xy x= y=`.
//
// Prereqs: macOS needs `cliclick` (brew install cliclick) and Chrome ▸ View ▸
// Developer ▸ "Allow JavaScript from Apple Events". Linux needs `xdotool`.

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const PLATFORM = process.platform; // 'darwin' | 'linux' | 'win32'
const MEM_DIR = path.join(os.homedir(), '.kestrel', 'memory');

function sh(cmd, args, input) {
  return new Promise((resolve, reject) => {
    const p = execFile(cmd, args, { timeout: 20000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) =>
      err ? reject(err) : resolve(stdout)
    );
    if (input != null) {
      p.stdin.write(input);
      p.stdin.end();
    }
  });
}
const osa = (s) => sh('osascript', ['-e', s]);
const ps = (s) => sh('powershell', ['-NoProfile', '-Command', s]);
async function which(bin) {
  try {
    const cmd = PLATFORM === 'win32' ? 'where' : 'which';
    return (await sh(cmd, [bin])).trim().split('\n')[0] || null;
  } catch {
    return null;
  }
}

// Pin a specific Chrome window so AppleScript perception and OS-level clicks
// always target the SAME window even when many windows are open across monitors.
// Set at launch (the front window) and changeable via the `target_window` action.
let winId = null;
function winRef() {
  return winId ? `window id ${winId}` : 'front window';
}
async function listWindows() {
  const out = await osa(`tell application "Google Chrome"
  set s to ""
  repeat with w in windows
    set s to s & (id of w) & "\t" & (title of active tab of w) & "\t" & (URL of active tab of w) & linefeed
  end repeat
  return s
end tell`);
  return out
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [id, title, url] = l.split('\t');
      return { id: parseInt(id, 10), title, url };
    });
}
async function raiseWindow() {
  if (PLATFORM === 'darwin' && winId) await osa(`tell application "Google Chrome" to set index of window id ${winId} to 1`).catch(() => {});
}

// ---- DOM perception via AppleScript (macOS only; no CDP) ----
async function execJS(js) {
  if (PLATFORM !== 'darwin') throw new Error('AppleScript DOM read is macOS-only; use screenshot+vision+click_xy');
  // Per-call temp file so two concurrent calls can't overwrite each other's JS.
  const tmp = path.join(os.tmpdir(), `kestrel-native-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}.js`);
  fs.writeFileSync(tmp, js, 'utf8');
  try {
    const script = `set theJS to (read POSIX file ${JSON.stringify(tmp)} as «class utf8»)
tell application "Google Chrome" to execute active tab of ${winRef()} javascript theJS`;
    return (await osa(script)).replace(/\n$/, '');
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
}
async function setURL(url) {
  if (PLATFORM === 'darwin')
    return osa(`tell application "Google Chrome" to set URL of active tab of ${winRef()} to ${JSON.stringify(url)}`);
  if (PLATFORM === 'linux') return sh('xdg-open', [url]);
  if (PLATFORM === 'win32') return ps(`Start-Process '${url}'`);
}
async function activateBrowser() {
  if (PLATFORM === 'darwin') {
    await raiseWindow(); // bring the pinned window to the front so clicks land on it
    await osa('tell application "Google Chrome" to activate');
  } else if (PLATFORM === 'linux') {
    await sh('xdotool', ['search', '--onlyvisible', '--class', 'chrome', 'windowactivate']).catch(() => {});
  } else if (PLATFORM === 'win32') {
    await ps(`(New-Object -ComObject WScript.Shell).AppActivate('Chrome')`).catch(() => {});
  }
  await new Promise((r) => setTimeout(r, 200));
}

// ---- OS-level input (trusted; isTrusted=true) ----
async function clickAt(state, x, y) {
  x = Math.round(x);
  y = Math.round(y);
  if (PLATFORM === 'darwin') {
    if (!state.inputTool) throw new Error('cliclick not installed (brew install cliclick)');
    // `=` forces ABSOLUTE coords so a left/secondary monitor's negative X works
    // (cliclick treats a bare leading `-` as a relative move). Coords are
    // top-left logical points = the CSS px we computed. NOTE: on fractionally
    // scaled displays (devicePixelRatio not 1 or 2) clicks can still be skewed —
    // use `mode=extension` (viewport coords, no screen math) for full reliability.
    await sh(state.inputTool, [`c:=${x},${y}`]);
  } else if (PLATFORM === 'linux') {
    if (!state.inputTool) throw new Error('xdotool not installed (apt install xdotool)');
    await sh('xdotool', ['mousemove', String(x), String(y), 'click', '1']);
  } else if (PLATFORM === 'win32') {
    await ps(
      `$t=@"\nusing System;using System.Runtime.InteropServices;public class M{[DllImport("user32.dll")]public static extern bool SetCursorPos(int x,int y);[DllImport("user32.dll")]public static extern void mouse_event(uint f,uint x,uint y,uint d,int e);}\n"@;Add-Type $t;[M]::SetCursorPos(${x},${y});[M]::mouse_event(2,0,0,0,0);[M]::mouse_event(4,0,0,0,0)`
    );
  }
}
function sendKeysEscape(t) {
  return String(t).replace(/([+^%~(){}\[\]])/g, '{$1}');
}
async function typeText(text) {
  if (PLATFORM === 'darwin') await osa(`tell application "System Events" to keystroke ${JSON.stringify(String(text))}`);
  else if (PLATFORM === 'linux') await sh('xdotool', ['type', '--clearmodifiers', '--', String(text)]);
  else if (PLATFORM === 'win32') await ps(`Add-Type -AssemblyName System.Windows.Forms;[System.Windows.Forms.SendKeys]::SendWait('${sendKeysEscape(text).replace(/'/g, "''")}')`);
}
const MAC_KEYS = { return: 36, enter: 36, tab: 48, escape: 53, esc: 53, space: 49, delete: 51 };
const X_KEYS = { return: 'Return', enter: 'Return', tab: 'Tab', escape: 'Escape', esc: 'Escape', space: 'space', delete: 'BackSpace' };
const WIN_KEYS = { return: '{ENTER}', enter: '{ENTER}', tab: '{TAB}', escape: '{ESC}', esc: '{ESC}', space: ' ', delete: '{BACKSPACE}' };
async function pressKey(key) {
  const k = String(key).toLowerCase();
  if (PLATFORM === 'darwin') {
    const c = MAC_KEYS[k];
    if (c != null) await osa(`tell application "System Events" to key code ${c}`);
    else await typeText(key);
  } else if (PLATFORM === 'linux') {
    await sh('xdotool', ['key', X_KEYS[k] || key]);
  } else if (PLATFORM === 'win32') {
    await ps(`Add-Type -AssemblyName System.Windows.Forms;[System.Windows.Forms.SendKeys]::SendWait('${WIN_KEYS[k] || key}')`);
  }
}
async function setClipboard(text) {
  if (PLATFORM === 'darwin') await sh('pbcopy', [], String(text));
  else if (PLATFORM === 'linux') {
    try {
      await sh('wl-copy', [], String(text));
    } catch {
      await sh('xclip', ['-selection', 'clipboard'], String(text));
    }
  } else if (PLATFORM === 'win32') await ps('Set-Clipboard -Value ([Console]::In.ReadToEnd())', String(text)).catch(async () => {
    await sh('clip', [], String(text));
  });
}
async function paste(text) {
  await setClipboard(text);
  if (PLATFORM === 'darwin') await osa('tell application "System Events" to keystroke "v" using command down');
  else if (PLATFORM === 'linux') await sh('xdotool', ['key', 'ctrl+v']);
  else if (PLATFORM === 'win32') await ps(`Add-Type -AssemblyName System.Windows.Forms;[System.Windows.Forms.SendKeys]::SendWait('^v')`);
}
async function screenshot(out) {
  if (PLATFORM === 'darwin') {
    await sh('screencapture', ['-x', '-o', out]).catch(() => sh('screencapture', ['-x', out]));
  } else if (PLATFORM === 'linux') {
    for (const [c, a] of [['grim', [out]], ['scrot', [out]], ['import', ['-window', 'root', out]]]) {
      try {
        await sh(c, a);
        return;
      } catch {}
    }
    throw new Error('no screenshot tool (install grim/scrot/imagemagick)');
  } else if (PLATFORM === 'win32') {
    await ps(
      `Add-Type -AssemblyName System.Windows.Forms,System.Drawing;$b=[System.Windows.Forms.SystemInformation]::VirtualScreen;$bmp=New-Object Drawing.Bitmap $b.Width,$b.Height;$g=[Drawing.Graphics]::FromImage($bmp);$g.CopyFromScreen($b.Location,[Drawing.Point]::Empty,$b.Size);$bmp.Save('${out}')`
    );
  }
}

// ---- auto-learn anti-abuse (same as CDP mode) ----
const ABUSE_RE = /unusual (activity|traffic)|are you a robot|verify (you are|you're) human|detected unusual|too many requests|rate.?limit|suspicious activity|complete the captcha|checking your browser|access denied/i;
function noteAbuse(url, text) {
  const m = String(text || '').match(ABUSE_RE);
  if (!m) return null;
  try {
    let domain = 'local';
    try { domain = new URL(url).hostname || 'local'; } catch {}
    fs.mkdirSync(MEM_DIR, { recursive: true });
    const f = path.join(MEM_DIR, domain.replace(/[^a-z0-9.-]/gi, '_') + '.json');
    let mem = { selectors: {}, notes: [] };
    try { mem = JSON.parse(fs.readFileSync(f, 'utf8')); } catch {}
    mem.pace = 'human';
    if (!mem.notes.some((n) => n.note && n.note.startsWith('⚠ anti-abuse')))
      mem.notes.push({ note: `⚠ anti-abuse "${m[0]}" in NATIVE mode — reduce volume / cooldown.`, ts: Date.now(), auto: true });
    fs.writeFileSync(f, JSON.stringify(mem, null, 2));
  } catch {}
  return m[0];
}

const PERCEIVE_JS = `(() => {
  const originX = window.screenX;
  const originY = window.screenY + (window.outerHeight - window.innerHeight);
  const sel = 'a,button,input,select,textarea,[role=button],[role=link],[role=tab],[onclick],[tabindex]';
  const out = []; let i = 0;
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
    const st = getComputedStyle(el);
    if (st.visibility === 'hidden' || st.display === 'none' || st.opacity === '0') continue;
    i++;
    out.push({ i, role: el.getAttribute('role') || el.tagName.toLowerCase(),
      name: (el.innerText || el.value || el.getAttribute('aria-label') || el.placeholder || '').trim().slice(0, 60),
      x: Math.round(originX + r.left + r.width / 2), y: Math.round(originY + r.top + r.height / 2) });
  }
  return JSON.stringify({ url: location.href, title: document.title,
    bodyText: (document.body ? document.body.innerText : '').slice(0, 4000), els: out });
})()`;

export async function nativeLaunch(state) {
  state.platform = PLATFORM;
  state.inputTool = PLATFORM === 'darwin' ? await which('cliclick') : PLATFORM === 'linux' ? await which('xdotool') : 'powershell';
  if (PLATFORM === 'darwin') {
    // Pin the target window so perception + clicks stay on the SAME one.
    if (state.nativeWindow) winId = parseInt(state.nativeWindow, 10);
    else {
      try {
        winId = parseInt((await osa('tell application "Google Chrome" to id of front window')).trim(), 10);
      } catch {}
    }
    try {
      await execJS('document.title');
    } catch (e) {
      throw new Error(
        'Native mode (macOS) needs Chrome running + "Allow JavaScript from Apple Events" ON (Chrome ▸ View ▸ Developer) and Terminal granted Automation permission. (' +
          String(e?.message || e).slice(0, 120) +
          ')'
      );
    }
  }
  state.windowId = winId;
  return { platform: PLATFORM, inputTool: state.inputTool, windowId: winId };
}

export function makeNativeActions(state) {
  let marks = [];
  const hasDom = PLATFORM === 'darwin';
  async function perceive() {
    if (!hasDom) return { url: state.nativeLastUrl || '', title: '', els: [], bodyText: '' };
    const raw = await execJS(PERCEIVE_JS);
    let data = {};
    try { data = JSON.parse(raw); } catch { data = { url: '', title: '', els: [], bodyText: '' }; }
    marks = data.els || [];
    state.nativeLastUrl = data.url;
    noteAbuse(data.url, data.bodyText);
    return data;
  }
  function findMark(args) {
    if (args.i || args.ref) {
      const n = parseInt(String(args.i || args.ref).replace(/\D/g, ''), 10);
      return marks.find((m) => m.i === n);
    }
    if (args.text) {
      const t = String(args.text).toLowerCase();
      return marks.find((m) => m.name.toLowerCase().includes(t));
    }
    return null;
  }
  return {
    async status() {
      return { ok: true, ready: state.ready, mode: 'native', platform: PLATFORM, inputTool: !!state.inputTool, domPerception: hasDom, windowId: winId, url: state.nativeLastUrl || null, marks: marks.length };
    },
    // List all Chrome windows (id + active tab) so you can pick which to drive.
    async windows() {
      return { ok: true, targeted: winId, windows: await listWindows() };
    },
    // Pin native mode to a specific window id (perception + clicks both target it).
    async target_window({ id }) {
      winId = parseInt(id, 10);
      state.windowId = winId;
      await raiseWindow();
      return { ok: true, targeted: winId };
    },
    async goto({ url }) {
      await setURL(url);
      await new Promise((r) => setTimeout(r, 1500));
      const d = await perceive();
      return { ok: true, url: d.url || url, title: d.title, abuse: noteAbuse(d.url, d.bodyText), domPerception: hasDom };
    },
    async snapshot() {
      const d = await perceive();
      if (!hasDom) {
        const shot = path.join(os.tmpdir(), `kestrel-native-${Date.now()}.png`);
        await screenshot(shot).catch(() => {});
        return { ok: true, mode: 'native', domPerception: false, screenshot: shot, note: 'No DOM read on this platform — use vision + click_xy x= y=.' };
      }
      return { ok: true, mode: 'native', url: d.url, title: d.title, count: marks.length, marks: marks.map((m) => ({ i: m.i, role: m.role, name: m.name })) };
    },
    async click(args) {
      await activateBrowser();
      const m = findMark(args);
      if (!m) return { ok: false, error: 'no matching element (snapshot first; use i= or text=, or click_xy)' };
      await clickAt(state, m.x, m.y);
      await new Promise((r) => setTimeout(r, 600));
      return { ok: true, clicked: { i: m.i, name: m.name } };
    },
    async click_xy({ x, y }) {
      await activateBrowser();
      await clickAt(state, Number(x), Number(y));
      await new Promise((r) => setTimeout(r, 400));
      return { ok: true };
    },
    async type(args) {
      await activateBrowser();
      const m = findMark(args);
      if (m) { await clickAt(state, m.x, m.y); await new Promise((r) => setTimeout(r, 300)); }
      if (args.text) await paste(args.text);
      if (args.submit) { await new Promise((r) => setTimeout(r, 300)); await pressKey('return'); }
      return { ok: true };
    },
    async paste(args) {
      await activateBrowser();
      const m = findMark(args);
      if (m) { await clickAt(state, m.x, m.y); await new Promise((r) => setTimeout(r, 300)); }
      await paste(args.text);
      if (args.submit) { await new Promise((r) => setTimeout(r, 300)); await pressKey('return'); }
      return { ok: true };
    },
    async type_human(args) {
      await activateBrowser();
      const m = findMark(args);
      if (m) { await clickAt(state, m.x, m.y); await new Promise((r) => setTimeout(r, 300)); }
      if (args.text) await typeText(args.text);
      if (args.submit) { await new Promise((r) => setTimeout(r, 300)); await pressKey('return'); }
      return { ok: true };
    },
    async key_human({ keys }) {
      await activateBrowser();
      await pressKey(keys);
      return { ok: true };
    },
    async press({ keys }) {
      await activateBrowser();
      await pressKey(keys);
      return { ok: true };
    },
    async extract() {
      const d = await perceive();
      return { ok: true, url: d.url, text: d.bodyText };
    },
    async eval({ js }) {
      return { ok: true, value: await execJS(js) };
    },
    async screenshot({ path: p }) {
      const out = p || path.join(os.tmpdir(), `kestrel-native-${Date.now()}.png`);
      await screenshot(out);
      return { ok: true, path: out };
    },
    async stop() {
      setTimeout(() => process.exit(0), 50);
      return { ok: true, stopping: true };
    },
  };
}
