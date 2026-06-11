#!/usr/bin/env node
// kestrel thin client. Usage:
//   kestrel start [mode=fresh|clone|live] [port=39817] [headless=true]
//   kestrel <action> [key=value ...]   e.g.  kestrel goto url=https://example.com
//   kestrel snapshot                   kestrel click ref=e5
//   kestrel type ref=e3 text="hello" submit=true
//   kestrel stop
//
// Every non-start command POSTs {action,args} to the daemon and prints JSON.

import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const [, , cmd, ...rest] = process.argv;

function parseArgs(list) {
  const args = {};
  for (const item of list) {
    const m = item.match(/^([^=]+)=([\s\S]*)$/);
    if (!m) {
      args[item] = true;
      continue;
    }
    let [, k, v] = m;
    if (v === 'true') v = true;
    else if (v === 'false') v = false;
    else if (/^-?\d+$/.test(v)) v = parseInt(v, 10);
    args[k] = v;
  }
  return args;
}

const args = parseArgs(rest);
const PORT = parseInt(process.env.KES_PORT || args.port || '39817', 10);
const URL = `http://127.0.0.1:${PORT}`;

const AUTH = process.env.KES_TOKEN ? { 'x-kestrel-token': process.env.KES_TOKEN } : {};
async function send(action, a) {
  const res = await fetch(`${URL}/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...AUTH },
    body: JSON.stringify({ action, args: a }),
  });
  return res.json();
}

async function alive() {
  try {
    const r = await fetch(`${URL}/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...AUTH },
      body: JSON.stringify({ action: 'status', args: {} }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

function print(o) {
  process.stdout.write(JSON.stringify(o, null, 2) + '\n');
}

if (cmd === 'start') {
  if (await alive()) {
    print({ ok: true, already: true, note: 'daemon already running', port: PORT });
    process.exit(0);
  }
  const logDir = path.join(os.homedir(), '.kestrel');
  fs.mkdirSync(logDir, { recursive: true });
  const log = fs.openSync(path.join(logDir, 'daemon.log'), 'a');
  const dArgs = [path.join(__dirname, 'daemon.js'), `--port=${PORT}`, `--mode=${args.mode || 'fresh'}`];
  if (args.headless) dArgs.push('--headless=true');
  if (args.cdp) dArgs.push(`--cdp=${args.cdp}`);
  if (args.userdata) dArgs.push(`--userdata=${args.userdata}`);
  // pass-through start flags the daemon understands (network / pace / locale)
  for (const k of ['proxy', 'channel', 'pace', 'timezone']) {
    if (args[k] !== undefined) dArgs.push(`--${k}=${args[k]}`);
  }
  const child = spawn('node', dArgs, { detached: true, stdio: ['ignore', log, log] });
  child.unref();
  // poll for readiness
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 300));
    if (await alive()) {
      print(await send('status', {}));
      process.exit(0);
    }
  }
  print({ ok: false, error: 'daemon did not become ready in time; see ~/.kestrel/daemon.log' });
  process.exit(1);
} else if (cmd === 'run') {
  // Delegate to the autonomous runner (Groq brain), streaming its output.
  const child = spawn('node', [path.join(__dirname, 'run.js'), ...rest], { stdio: 'inherit' });
  child.on('exit', (code) => process.exit(code || 0));
} else if (cmd === 'bench') {
  const child = spawn('node', [path.join(__dirname, 'bench.js'), ...rest], { stdio: 'inherit', env: process.env });
  child.on('exit', (code) => process.exit(code || 0));
} else if (cmd === 'serve') {
  // Start the standalone agent server (detached). Hand it goals via HTTP.
  const logDir = path.join(os.homedir(), '.kestrel');
  fs.mkdirSync(logDir, { recursive: true });
  const log = fs.openSync(path.join(logDir, 'server.log'), 'a');
  const child = spawn('node', [path.join(__dirname, 'server.js'), ...rest], {
    detached: true,
    stdio: ['ignore', log, log],
    env: process.env,
  });
  child.unref();
  print({ ok: true, started: 'agent server', log: path.join(logDir, 'server.log'), hint: 'POST /goal to it' });
} else if (cmd === 'journal') {
  const f = path.join(os.homedir(), '.kestrel', 'agent', 'journal.jsonl');
  try {
    const n = parseInt(args.n || '5', 10);
    const runs = fs
      .readFileSync(f, 'utf8')
      .trim()
      .split('\n')
      .slice(-n)
      .map((l) => {
        try {
          const j = JSON.parse(l);
          return { ts: j.ts, goal: j.goal, ok: j.ok, steps: j.steps, result: (j.result || '').slice(0, 160) };
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    print({ ok: true, runs });
  } catch {
    print({ ok: true, runs: [] });
  }
} else if (cmd === 'vault') {
  // Secure secret vault (macOS Keychain). vault set|get|delete|list
  const v = await import('./lib/vault.js');
  try {
    if (args.set) print(await v.setKey(args.service, args.account, args.secret));
    else if (args.get) print({ ok: true, secret: await v.getKey(args.service, args.account) });
    else if (args.delete) print(await v.deleteKey(args.service, args.account));
    else print({ ok: true, vault: v.listKeys() });
  } catch (e) {
    print({ ok: false, error: String(e?.message || e) });
  }
} else if (cmd === 'api') {
  // Layer 3 — authenticated API calls with a stored key (no browser).
  const a = await import('./lib/api.js');
  if (args.providers) print({ ok: true, providers: Object.keys(a.PROVIDERS) });
  else if (args.detect) print(a.detectApi(typeof args.detect === 'string' ? args.detect : args.url || args.host));
  else {
    let body = args.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch {} }
    print(await a.apiCall({ service: args.service, account: args.account, method: args.method, url: args.url, path: args.path, body }));
  }
} else if (cmd === 'brain') {
  // Kestrel's evolving memory. brain stats | recall query=.. | advise domain=.. | synthesize domain=..
  const b = await import('./lib/brain.js');
  if (args.synthesize) {
    const reflect = await import('./lib/reflect.js');
    let dom = typeof args.synthesize === 'string' ? args.synthesize : args.domain || '';
    try { dom = new URL(dom).hostname; } catch {}
    print(await reflect.synthesizeDomain(dom, parseInt(args.min || '1', 10)));
  } else if (args.advise) {
    let dom = typeof args.advise === 'string' ? args.advise : args.domain || '';
    try { dom = new URL(dom).hostname; } catch {}
    print(await b.getAdvice(dom, args.query));
  } else if (args.recall || args.query) print(await b.recall(typeof args.recall === 'string' ? args.recall : args.query || '', parseInt(args.limit || '10', 10)));
  else print(b.stats());
} else if (cmd === 'ext-setup') {
  // Launch a browser with the companion extension preloaded and start the daemon
  // in extension mode. Resolution order:
  //   1) browser=chrome  → your branded Google Chrome (NOTE: Chrome 137+ silently
  //      ignores --load-extension, so this usually needs a one-time manual load)
  //   2) default         → Playwright's Chrome for Testing, which still honors
  //      --load-extension → the extension auto-loads with ZERO manual steps.
  // profile=fresh (default) | clone (copies your logged-in profile — macOS only).
  const extDir = path.join(__dirname, 'extension');
  const profileDir = path.join(os.homedir(), '.kestrel', 'ext-profile');
  if (args.profile === 'clone' && process.platform === 'darwin') {
    const src = path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome');
    try {
      fs.rmSync(profileDir, { recursive: true, force: true });
      await new Promise((res, rej) => spawn('cp', ['-c', '-R', src, profileDir], { stdio: 'ignore' }).on('exit', (c) => (c ? rej(new Error('clone failed')) : res())));
    } catch (e) {
      print({ ok: false, error: 'profile clone failed: ' + String(e?.message || e) });
      process.exit(1);
    }
  } else {
    fs.mkdirSync(profileDir, { recursive: true });
  }
  // start the daemon in extension mode (so the extension has something to talk to)
  if (!(await alive())) {
    const logDir = path.join(os.homedir(), '.kestrel');
    fs.mkdirSync(logDir, { recursive: true });
    const log = fs.openSync(path.join(logDir, 'daemon.log'), 'a');
    spawn('node', [path.join(__dirname, 'daemon.js'), `--port=${PORT}`, '--mode=extension'], { detached: true, stdio: ['ignore', log, log] }).unref();
    for (let i = 0; i < 30 && !(await alive()); i++) await new Promise((r) => setTimeout(r, 200));
  }
  // Pick the browser binary. Default: Chrome for Testing from the Playwright cache —
  // unlike branded Chrome 137+, it still honors --load-extension (developer flags
  // are the whole point of CfT), so the extension self-loads with no file picker.
  let bin = null;
  let flavor = '';
  if (args.browser === 'chrome') {
    const branded = process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome';
    if (process.platform === 'darwin' && !fs.existsSync(branded)) {
      print({ ok: false, error: 'Google Chrome not found at the default path' });
      process.exit(1);
    }
    bin = branded;
    flavor = 'branded Chrome (137+ may ignore --load-extension)';
  } else {
    try {
      const { chromium } = await import('playwright');
      bin = chromium.executablePath();
      flavor = 'Chrome for Testing (auto-loads the extension)';
    } catch {}
    if (!bin || !fs.existsSync(bin)) {
      print({ ok: false, error: 'Playwright Chrome for Testing not found — run: npx playwright install chromium (or use browser=chrome for branded Chrome + manual load)' });
      process.exit(1);
    }
  }
  const chromeArgs = [`--user-data-dir=${profileDir}`, `--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, '--no-first-run', '--no-default-browser-check', args.url || 'about:blank'];
  spawn(bin, chromeArgs, { detached: true, stdio: 'ignore' }).unref();
  let connected = false;
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 1200));
    try {
      if ((await send('status', {})).connected) {
        connected = true;
        break;
      }
    } catch {}
  }
  if (connected) {
    print({ ok: true, connected: true, browser: flavor, profile: args.profile === 'clone' ? 'clone (your logins)' : 'fresh', note: 'Extension connected — drive it with snapshot/click/type (mode=extension is running).' });
  } else {
    print({
      ok: true,
      connected: false,
      browser: flavor,
      note: args.browser === 'chrome'
        ? 'Branded Chrome (137+) blocks --load-extension. One-time manual load:'
        : 'Extension did not connect — check ~/.kestrel/daemon.log and that the browser window opened.',
      steps: args.browser === 'chrome'
        ? ['1) open chrome://extensions and toggle Developer mode (top-right)', `2) Load unpacked → select the FOLDER ${extDir} (highlight it from its parent — don't enter it)`, '3) it auto-connects. Check: kestrel status']
        : ['retry: node kestrel.js ext-setup', 'or use your own Chrome: node kestrel.js ext-setup browser=chrome'],
    });
  }
} else if (!cmd || cmd === 'help' || cmd === '--help') {
  print({
    ok: true,
    usage: [
      'kestrel start [mode=fresh|clone|live] [port=] [headless=true] [cdp=http://127.0.0.1:9222]',
      '             [channel=chrome|chromium] [proxy=..] [pace=fast|slow|human] [timezone=..]',
      'kestrel status | snapshot [full=true] | extract [query=..]',
      'kestrel goto url=.. [expectText=..]',
      'kestrel click ref=e5 | click selector=.. | click text=..  [expectText=..] [expectGone=..]',
      'kestrel type ref=e3 text=".." [submit=true]',
      'kestrel select ref=e7 value=".."',
      'kestrel press keys="Enter" | scroll [direction=down|up] [to_text=..]',
      'kestrel wait_for [text=..|selector=..|url=..|networkidle=true] [timeout=15000]',
      'kestrel tabs | switch_tab index=1 | new_tab url=.. | close_tab [index=]',
      'kestrel back | forward | console_log [limit=20] | screenshot [path=..] [fullPage=true]',
      'kestrel stop',
      '— extension mode —  kestrel ext-setup [browser=chrome] [profile=clone]   (zero-step trusted input)',
      '— secrets/API —     kestrel vault set service=.. secret=.. | vault get|list|delete   |   kestrel api service=.. path=/..',
      '— memory —          kestrel brain [stats] | brain recall query=.. | brain advise domain=.. | advise domain=..',
      '— autonomous —      kestrel run goal=".." [max=]   |   kestrel serve [port=39820]   |   kestrel journal [n=]   |   kestrel bench',
    ],
  });
} else {
  if (!(await alive())) {
    print({ ok: false, error: `no daemon on ${URL}. Run: kestrel start` });
    process.exit(1);
  }
  print(await send(cmd, args));
}
