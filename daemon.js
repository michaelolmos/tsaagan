#!/usr/bin/env node
// kestrel daemon — holds ONE persistent Playwright page so that
// accessibility-tree `aria-ref` grounding survives across discrete CLI calls,
// and runs the observe -> act -> VERIFY -> self-heal loop server-side.
//
// Control plane: tiny JSON-over-HTTP server on 127.0.0.1:<port>.
// Each thin `kestrel` CLI invocation POSTs {action,args} and prints the JSON result.
//
// The differentiator vs every other harness: every mutating action returns a
// `verify` block built from structural post-conditions (url delta, expected
// text, new console errors, failed network responses) instead of trusting the
// model's self-report. Clicks/types self-heal once by re-snapshotting and
// re-locating the same role+name when a stale ref breaks.

import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { nativeLaunch, makeNativeActions } from './native.js';
import { totpCode } from './lib/totp.js';
import * as brain from './lib/brain.js';

// The Playwright engine is loaded dynamically (below) so native mode can run
// without it installed.
let chromium;
let engineName = 'playwright';

// ---------- OS-level input (macOS) ----------
// Real, trusted keystrokes/paste via System Events. Some sites' anti-abuse
// flags CDP-injected input but not genuine OS input — this is the escape hatch
// for sensitive sites (see paste / type_human / key_human actions). macOS only.
function sh(cmd, args, input) {
  return new Promise((resolve, reject) => {
    const p = execFile(cmd, args, { timeout: 15000 }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
    if (input != null) {
      p.stdin.write(input);
      p.stdin.end();
    }
  });
}
const KEY_CODES = { return: 36, enter: 36, tab: 48, escape: 53, esc: 53, space: 49, delete: 51, down: 125, up: 126 };
async function setClipboard(text) {
  await sh('pbcopy', [], String(text));
}
async function osPaste() {
  await sh('osascript', ['-e', 'tell application "System Events" to keystroke "v" using command down']);
}
async function osKeystroke(text) {
  await sh('osascript', ['-e', `tell application "System Events" to keystroke ${JSON.stringify(String(text))}`]);
}
async function osKey(key) {
  const code = KEY_CODES[String(key).toLowerCase()];
  if (code != null) await sh('osascript', ['-e', `tell application "System Events" to key code ${code}`]);
  else await osKeystroke(key);
}
async function osActivateBrowser() {
  try {
    await state.page.bringToFront();
  } catch {}
  const app = state.mode === 'clone' || state.mode === 'live' ? 'Google Chrome' : 'Chromium';
  await sh('osascript', ['-e', `tell application "${app}" to activate`]).catch(() => {});
  await new Promise((r) => setTimeout(r, 150));
}

// ---------- args ----------
const argv = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true];
  })
);
const PORT = parseInt(argv.port || '39817', 10);
const MODE = argv.mode || 'fresh'; // fresh | clone | live
const CDP = argv.cdp || 'http://127.0.0.1:9222';
const HEADLESS = argv.headless === true || argv.headless === 'true';
const USERDATA =
  argv.userdata || path.join(os.homedir(), '.kestrel', 'profile-fresh');
const GLOBAL_PACE = argv.pace || 'fast'; // fast | slow | human (per-domain memory can override)
const TIMEZONE = argv.timezone || 'America/New_York'; // configurable; used for locale/date consistency
const CHANNEL = argv.channel || 'chrome'; // prefer the real Chrome binary; falls back to bundled chromium
const PROXY = argv.proxy; // e.g. http://user:pass@host:port  or  socks5://host:port (e.g. a corporate proxy)

// Load Playwright (the browser engine).
async function loadEngine() {
  ({ chromium } = await import('playwright'));
}
if (MODE !== 'native') await loadEngine();
// Cadence before each interaction. Pace escalates per-domain: a site that asked us
// to slow down (learned `pace:"human"`) gets multi-second human-style gaps so we stay
// polite and rate-considerate; everything else stays fast.
function paceMs() {
  let pace = GLOBAL_PACE;
  try {
    const d = domainOf(state.page.url());
    ensureLoaded(d);
    if (state.cache[d] && state.cache[d].pace) pace = state.cache[d].pace;
  } catch {}
  if (pace === 'human') return 1500 + Math.floor(Math.random() * 2500); // 1.5–4s
  if (pace === 'slow') return 600 + Math.floor(Math.random() * 900); // 0.6–1.5s
  return 0;
}
const human = () => new Promise((r) => setTimeout(r, paceMs()));

// Heuristic: does this action look consequential / irreversible? Used to surface a
// caution to the driving agent (and optionally hard-block via KES_CONFIRM_CONSEQUENTIAL).
const CONSEQUENTIAL_RE = /\b(buy|purchase|pay|payment|checkout|place order|order now|delete|remove|send|transfer|withdraw|subscribe|unsubscribe|confirm|submit)\b/i;
const consequentialSignal = (args, meta = {}) =>
  CONSEQUENTIAL_RE.test([args.text, args.selector, args.expectText, args.value, args.label, meta?.name].filter(Boolean).join(' '));

// ---------- state ----------
const HOME_KES = path.join(os.homedir(), '.kestrel');
const state = {
  browser: null,
  context: null,
  page: null,
  mode: MODE,
  ready: false,
  startedAt: Date.now(),
  console: [], // {type,text,ts}
  responses: [], // {url,status,ts}
  requests: [], // {method,url,type,ts} — xhr/fetch only (API discovery)
  lastRefMeta: {}, // ref -> {role,name}  (from the most recent snapshot)
  lastSnapshotAt: 0,
  // Wave A: dialogs + downloads
  dialogPolicy: 'dismiss', // 'accept' | 'dismiss'
  dialogPromptText: undefined,
  lastDialog: null,
  downloads: [], // {path, suggested, url, ts}
  downloadDir: path.join(HOME_KES, 'downloads'),
  // Wave B: vision Set-of-Marks label -> selector map
  somMap: {},
  // Wave C: per-domain action cache + learned site memory
  cache: {}, // domain -> { "intent": {selector, role, name, hits, ts} }
  memoryDir: path.join(HOME_KES, 'memory'),
};
fs.mkdirSync(state.downloadDir, { recursive: true });
fs.mkdirSync(state.memoryDir, { recursive: true });
const RING = 250;
function pushRing(arr, item) {
  arr.push(item);
  if (arr.length > RING) arr.shift();
}

// ---------- page wiring ----------
// Pages we've already wired, so re-activating a tab (switch_tab, popups) doesn't
// stack duplicate listeners — which would multiply console/network ring entries and
// leak memory over a long session.
const attachedPages = new WeakSet();
function attach(page) {
  if (attachedPages.has(page)) return;
  attachedPages.add(page);
  // If the active tab is closed or crashes out from under us, fall back to another
  // open page instead of leaving state.page pointing at a dead target.
  const onGone = () => {
    if (state.page === page) {
      const alive = (state.context?.pages?.() || []).filter((p) => p !== page && !p.isClosed?.());
      state.page = alive[0] || null;
      state.ready = !!state.page;
    }
  };
  page.on('close', onGone);
  page.on('crash', onGone);
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      pushRing(state.console, { type: msg.type(), text: msg.text(), ts: Date.now() });
    }
  });
  page.on('pageerror', (err) => {
    pushRing(state.console, { type: 'pageerror', text: String(err?.message || err), ts: Date.now() });
  });
  page.on('response', (res) => {
    pushRing(state.responses, { url: res.url(), status: res.status(), ts: Date.now() });
  });
  page.on('request', (req) => {
    const t = req.resourceType();
    if (t === 'xhr' || t === 'fetch') pushRing(state.requests, { method: req.method(), url: req.url(), type: t, ts: Date.now() });
  });
  // Dialogs (alert/confirm/prompt/beforeunload): apply the current policy so they
  // never silently block the flow, and record what was seen.
  page.on('dialog', async (d) => {
    state.lastDialog = { type: d.type(), message: d.message(), ts: Date.now() };
    try {
      if (state.dialogPolicy === 'accept') await d.accept(state.dialogPromptText);
      else await d.dismiss();
    } catch {}
  });
  // Downloads: persist to the download dir and record the saved path.
  page.on('download', async (dl) => {
    try {
      const suggested = dl.suggestedFilename();
      // basename() so a site-supplied name like "../../.zshrc" can't escape the dir.
      const dest = path.join(state.downloadDir, `${Date.now()}-${path.basename(suggested)}`);
      await dl.saveAs(dest);
      pushRing(state.downloads, { path: dest, suggested, url: dl.url(), ts: Date.now() });
    } catch (e) {
      pushRing(state.downloads, { error: String(e?.message || e), ts: Date.now() });
    }
  });
}

async function setActivePage(page) {
  state.page = page;
  attach(page);
}

async function launch() {
  if (state.mode === 'native') {
    // macOS, real Chrome, NO CDP/Playwright. See native.js.
    await nativeLaunch(state);
    state.native = true;
    state.ready = true;
    return;
  }
  if (state.mode === 'extension') {
    // Drive the user's real Chrome through the Kestrel companion extension
    // (chrome.debugger Input → isTrusted=true, viewport coords → no screen math).
    // No Playwright; commands are bridged to the extension via HTTP long-poll.
    state.ext = { queue: [], waiters: [], pending: {}, seq: 0, connected: false };
    state.ready = true;
    return;
  }
  if (state.mode === 'clone' || state.mode === 'live') {
    // Connect over CDP to an already-running Chrome launched with
    // --remote-debugging-port=9222 (use mode=clone for a logged-in profile).
    state.browser = await chromium.connectOverCDP(CDP);
    state.context = state.browser.contexts()[0] || (await state.browser.newContext());
    const pages = state.context.pages();
    await setActivePage(pages[0] || (await state.context.newPage()));
  } else {
    // Fresh: prefer the real Chrome binary with its own persistent profile.
    // Falls back to bundled chromium.
    fs.mkdirSync(USERDATA, { recursive: true });
    const launchOpts = {
      headless: HEADLESS,
      viewport: { width: 1280, height: 800 },
      acceptDownloads: true,
      locale: 'en-US',
      timezoneId: TIMEZONE,
      proxy: PROXY ? { server: PROXY } : undefined,
      args: ['--no-first-run', '--no-default-browser-check'],
    };
    try {
      state.context = await chromium.launchPersistentContext(USERDATA, { ...launchOpts, channel: CHANNEL });
      state.channel = CHANNEL;
    } catch (e) {
      state.context = await chromium.launchPersistentContext(USERDATA, launchOpts);
      state.channel = 'chromium';
    }
    state.browser = state.context.browser();
    const pages = state.context.pages();
    await setActivePage(pages[0] || (await state.context.newPage()));
  }
  // Track new tabs / popups so the active page follows the user-visible flow.
  state.context.on('page', (p) => setActivePage(p));
  state.ready = true;
}

// ---------- perception ----------
async function snapshot({ full = false } = {}) {
  const page = state.page;
  let yaml = '';
  try {
    // Playwright's ref-annotated a11y snapshot (same source playwright-mcp uses).
    // Returns { full: "<yaml with [ref=eN]>" }. Registers the aria-ref mapping
    // in the page so `aria-ref=eN` resolves until the next snapshot/navigation.
    const r = await page._snapshotForAI();
    yaml = typeof r === 'string' ? r : r.full || r.snapshot || '';
  } catch (e) {
    try {
      yaml = await page.locator('body').ariaSnapshot({ ref: true });
    } catch {
      yaml = await page.locator('body').ariaSnapshot();
    }
  }
  // Parse each `- role "name" ... [ref=eN]` line into ref->{role,name} for
  // self-heal. Robust to attribute ordering, e.g. `[level=1] [ref=e3]`.
  const meta = {};
  for (const line of yaml.split('\n')) {
    const refM = line.match(/\[ref=(e\d+)\]/);
    if (!refM) continue;
    const roleM = line.match(/^\s*-\s+([a-zA-Z]+)/);
    const nameM = line.match(/"([^"]*)"/);
    meta[refM[1]] = { role: roleM ? roleM[1] : '', name: nameM ? nameM[1] : '' };
  }
  state.lastRefMeta = meta;
  state.lastSnapshotAt = Date.now();
  const out = full || yaml.length < 12000 ? yaml : yaml.slice(0, 12000) + '\n… [truncated]';
  return {
    url: page.url(),
    title: await page.title().catch(() => ''),
    refs: Object.keys(meta).length,
    snapshot: out,
  };
}

// Vision Set-of-Marks: overlay a numbered box on every visible interactive
// element, screenshot it, and return label -> {role,name}. Each element is
// tagged with `data-bp-som="N"` so `click som=N` resolves deterministically.
// Use when the a11y tree is empty/insufficient (canvas, custom-rendered UIs).
async function visionSnapshot() {
  const page = state.page;
  const map = await page.evaluate(() => {
    document.querySelectorAll('[data-bp-som]').forEach((e) => e.removeAttribute('data-bp-som'));
    document.querySelectorAll('.__bp_som_label').forEach((e) => e.remove());
    const sel =
      'a,button,input,select,textarea,[role=button],[role=link],[role=checkbox],[role=tab],[role=menuitem],[onclick],[tabindex]';
    const els = Array.from(document.querySelectorAll(sel));
    const out = {};
    let i = 0;
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
      const st = getComputedStyle(el);
      if (st.visibility === 'hidden' || st.display === 'none' || st.opacity === '0') continue;
      i++;
      el.setAttribute('data-bp-som', String(i));
      el.style.outline = '2px solid #ff0080';
      const label = document.createElement('div');
      label.className = '__bp_som_label';
      label.textContent = String(i);
      Object.assign(label.style, {
        position: 'fixed', zIndex: '2147483647', background: '#ff0080', color: '#fff',
        font: 'bold 11px monospace', padding: '0 3px', borderRadius: '2px',
        left: Math.max(0, r.left) + 'px', top: Math.max(0, r.top - 12) + 'px', pointerEvents: 'none',
      });
      document.body.appendChild(label);
      out[i] = {
        role: el.getAttribute('role') || el.tagName.toLowerCase(),
        name: (el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '')
          .trim()
          .slice(0, 60),
        // center point — enables coordinate clicking (click_xy som=N fallback)
        cx: Math.round(r.left + r.width / 2),
        cy: Math.round(r.top + r.height / 2),
      };
    }
    return out;
  });
  state.somMap = map;
  const shotPath = path.join(os.tmpdir(), `bp-som-${Date.now()}.png`);
  await page.screenshot({ path: shotPath });
  return { count: Object.keys(map).length, screenshot: shotPath, marks: map };
}

function findRefByRoleName(role, name) {
  for (const [ref, m] of Object.entries(state.lastRefMeta)) {
    if (m.role === role && m.name === name) return ref;
  }
  // name-only fallback (role may have shifted)
  for (const [ref, m] of Object.entries(state.lastRefMeta)) {
    if (name && m.name === name) return ref;
  }
  return null;
}

// ---------- cross-session site memory (Wave C) ----------
// Per-domain store at ~/.kestrel/memory/<host>.json:
//   { selectors: { "<key>": {selector, role, name, hits, ts} }, notes: [...] }
// Lets the agent learn a site once and replay durable selectors next session.
function domainOf(u) {
  try {
    return new URL(u).hostname || 'local';
  } catch {
    return 'local';
  }
}
function memFile(domain) {
  return path.join(state.memoryDir, domain.replace(/[^a-z0-9.-]/gi, '_') + '.json');
}
function ensureLoaded(domain) {
  if (state.cache[domain]) return;
  try {
    state.cache[domain] = JSON.parse(fs.readFileSync(memFile(domain), 'utf8'));
  } catch {
    state.cache[domain] = { selectors: {}, notes: [] };
  }
}
function saveDomain(domain) {
  try {
    fs.writeFileSync(memFile(domain), JSON.stringify(state.cache[domain], null, 2));
  } catch {}
}
// If the caller passed a `key` but no explicit target, fill the target from the
// learned selector for the current domain (deterministic replay).
function applyCache(args) {
  const d = domainOf(state.page.url());
  ensureLoaded(d);
  // Fill the target selector from cache when a key is given and no explicit
  // target (ref/som/selector) was passed. NB: `text` is an input value for
  // `type`, not a target, so it must not block cache use.
  if (args.key && !args.ref && !args.som && !args.selector) {
    const hit = state.cache[d].selectors[args.key];
    if (hit) {
      args.selector = hit.selector;
      args._cacheHit = true;
    }
  }
  return d;
}
// On a successful action that used a durable selector + key, persist it.
function recordCache(args, d, ok) {
  if (ok && args.key && args.selector) {
    ensureLoaded(d);
    const cur = state.cache[d].selectors[args.key] || { hits: 0 };
    state.cache[d].selectors[args.key] = {
      selector: args.selector,
      role: args.role || cur.role || null,
      name: args.name || cur.name || null,
      hits: (cur.hits || 0) + 1,
      ts: Date.now(),
    };
    saveDomain(d);
  }
}

// ---------- auto-learning (fires WITHOUT being asked) ----------
// Compute a durable CSS selector for a located element, best-effort.
async function deriveSelector(loc) {
  try {
    return await loc.evaluate((el) => {
      if (!el || !el.getAttribute) return null;
      if (el.id && /^[A-Za-z][\w-]*$/.test(el.id)) return '#' + el.id;
      const tid = el.getAttribute('data-testid') || el.getAttribute('data-test-id');
      if (tid) return `[data-testid="${tid.replace(/"/g, '\\"')}"]`;
      const al = el.getAttribute('aria-label');
      if (al) return `[aria-label="${al.replace(/"/g, '\\"')}"]`;
      const nm = el.getAttribute('name');
      if (nm) return `[name="${nm.replace(/"/g, '\\"')}"]`;
      return null;
    });
  } catch {
    return null;
  }
}

// Signals that the site is rate-limiting / showing an anti-abuse wall / challenging us.
const ABUSE_RE =
  /unusual (activity|traffic)|are you a robot|verify (you are|you're) human|i'?m not a robot|detected unusual|automated (queries|traffic)|too many requests|rate.?limit|temporarily (blocked|unavailable)|suspicious activity|complete the captcha|checking your browser|access denied/i;

// After a navigation/action, scan the page for anti-abuse signals and, if found,
// AUTO-write a durable lesson to this domain's memory + mark it "human pace".
// This is the fix for "Kestrel didn't learn the Flow throttle on its own".
async function autoNoteAbuse(domain) {
  let txt = '';
  try {
    txt = (await state.page.evaluate(() => document.body?.innerText || '')).slice(0, 5000);
  } catch {
    return null;
  }
  const m = txt.match(ABUSE_RE);
  if (!m) return null;
  ensureLoaded(domain);
  state.cache[domain].pace = 'human'; // learned: this site needs slow, human-style input
  const tag = '⚠ anti-abuse';
  if (!state.cache[domain].notes.some((n) => n.note.startsWith(tag))) {
    state.cache[domain].notes.push({
      note: `${tag} signal "${m[0]}" detected ${new Date().toISOString()} — switch to human cadence: slow pacing + OS-level paste/keystrokes (paste/type_human), not burst CDP input.`,
      ts: Date.now(),
      auto: true,
    });
  }
  saveDomain(domain);
  try {
    await brain.learn(domain, `anti-abuse "${m[0]}" — switch to human cadence / native or extension mode`, 'anti-abuse');
  } catch {}
  return m[0];
}

// Called after every interaction — captures working selectors automatically and
// records anti-abuse lessons. No `remember` call required.
async function autoLearn(domain, args, r) {
  try {
    if (r && r.ok) {
      let selector = args.selector;
      if (!selector && (args.ref || args.som)) {
        selector = await deriveSelector(locatorFor(args)).catch(() => null);
      }
      if (selector) {
        const meta = args.ref ? state.lastRefMeta[args.ref] : null;
        const key = args.key || `auto:${(meta && meta.name) || selector}`.slice(0, 90);
        ensureLoaded(domain);
        const cur = state.cache[domain].selectors[key] || { hits: 0 };
        state.cache[domain].selectors[key] = {
          selector,
          role: (meta && meta.role) || args.role || cur.role || null,
          name: (meta && meta.name) || args.name || cur.name || null,
          hits: (cur.hits || 0) + 1,
          ts: Date.now(),
          auto: !args.key,
        };
        saveDomain(domain);
      }
    }
  } catch {}
  await autoNoteAbuse(domain).catch(() => null);
}

// ---------- verification ----------
async function settle(timeout = 2500) {
  await state.page.waitForLoadState('networkidle', { timeout }).catch(() => {});
}

async function buildVerify(startTs, beforeUrl, opts = {}, extra = {}) {
  const page = state.page;
  await settle();
  const newErrors = state.console.filter((e) => e.ts >= startTs);
  const newResp = state.responses.filter((r) => r.ts >= startTs);
  const failedResp = newResp.filter((r) => r.status >= 400);
  const verify = {
    urlBefore: beforeUrl,
    urlAfter: page.url(),
    urlChanged: beforeUrl !== page.url(),
    title: await page.title().catch(() => ''),
    newConsoleErrors: newErrors.slice(0, 8),
    failedRequests: failedResp.slice(0, 8).map((r) => `${r.status} ${r.url}`),
    ...extra,
  };
  if (opts.expectText) {
    verify.expectText = opts.expectText;
    verify.expectTextFound = await page
      .getByText(opts.expectText, { exact: false })
      .first()
      .isVisible()
      .catch(() => false);
  }
  if (opts.expectGone) {
    verify.expectGone = opts.expectGone;
    verify.expectGoneConfirmed = !(await page
      .getByText(opts.expectGone, { exact: false })
      .first()
      .isVisible()
      .catch(() => false));
  }
  if (opts.expectUrl) {
    verify.expectUrl = opts.expectUrl;
    try {
      verify.expectUrlMatched = new RegExp(opts.expectUrl).test(page.url());
    } catch {
      verify.expectUrlMatched = page.url().includes(opts.expectUrl);
    }
  }
  if (state.lastDialog && Date.now() - state.lastDialog.ts < 5000) {
    verify.dialog = state.lastDialog;
  }
  return verify;
}

async function withVerify(fn, opts = {}) {
  // Timestamp the action boundary instead of array indices — state.console /
  // state.responses are fixed-size ring buffers, so an index can go stale if many
  // events fire during the action; a ts filter stays correct after the ring wraps.
  const startTs = Date.now();
  const beforeUrl = state.page.url();
  let actionError = null;
  try {
    await fn();
  } catch (e) {
    actionError = e;
  }
  const verify = await buildVerify(startTs, beforeUrl, opts);
  // A post-condition the caller asked for but that did not hold => not ok.
  const failedExpectation =
    (opts.expectText && verify.expectTextFound === false) ||
    (opts.expectGone && verify.expectGoneConfirmed === false) ||
    (opts.expectUrl && verify.expectUrlMatched === false);
  if (actionError) return { ok: false, error: String(actionError?.message || actionError), verify };
  if (failedExpectation) return { ok: false, error: 'post-condition not met', verify };
  return { ok: true, verify };
}

function locatorFor(target) {
  const page = state.page;
  if (target.som) return page.locator(`[data-bp-som="${target.som}"]`);
  if (target.ref) return page.locator(`aria-ref=${target.ref}`);
  if (target.selector) return page.locator(target.selector);
  if (target.text) return page.getByText(target.text, { exact: false }).first();
  if (target.role && target.name)
    return page.getByRole(target.role, { name: target.name }).first();
  throw new Error('no target (need ref | selector | text | role+name)');
}

// click / type with one self-heal pass on a stale ref.
async function actWithHeal(target, run, verifyOpts) {
  const priorMeta = target.ref ? state.lastRefMeta[target.ref] : null;
  let loc = locatorFor(target);
  let r = await withVerify(() => run(loc), verifyOpts);
  const looksStale =
    !r.ok && /timeout|not (visible|found|attached)|detached|no node|strict mode/i.test(r.error || '');
  if (looksStale && priorMeta) {
    await snapshot(); // refresh refs against current DOM
    const newRef = findRefByRoleName(priorMeta.role, priorMeta.name);
    if (newRef) {
      const loc2 = state.page.locator(`aria-ref=${newRef}`);
      const r2 = await withVerify(() => run(loc2), verifyOpts);
      r2.selfHealed = true;
      r2.healedFrom = target.ref;
      r2.healedTo = newRef;
      r2.healedBy = priorMeta;
      return r2;
    }
    r.selfHealAttempted = true;
    r.selfHealResult = 'no matching role+name after re-snapshot';
  }
  return r;
}

// ---------- actions ----------
const actions = {
  async status() {
    return {
      ok: true,
      ready: state.ready,
      mode: state.mode,
      url: state.page ? state.page.url() : null,
      title: state.page ? await state.page.title().catch(() => '') : null,
      tabs: state.context ? state.context.pages().length : 0,
      uptimeSec: Math.round((Date.now() - state.startedAt) / 1000),
      lastSnapshotRefs: Object.keys(state.lastRefMeta).length,
      engine: engineName,
      channel: state.channel || null,
    };
  },

  async goto({ url, expectText }) {
    const r = await withVerify(
      () => state.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }),
      { expectText }
    );
    const abuse = await autoNoteAbuse(domainOf(state.page.url())).catch(() => null);
    if (abuse) r.abuse = abuse;
    return r;
  },

  async snapshot({ full, mode }) {
    if (mode === 'vision') return { ok: true, mode: 'vision', ...(await visionSnapshot()) };
    const s = await snapshot({ full });
    const out = { ok: true, mode: 'a11y', ...s };
    // LEARNING-LOOP FEEDBACK: surface what Kestrel learned about this domain so the
    // driving agent adapts THIS observe→act cycle (pace, notes, prior lessons).
    try {
      const d = domainOf(state.page.url());
      ensureLoaded(d);
      const notes = (state.cache[d]?.notes || []).slice(-3).map((n) => n.note);
      const advice = await brain.getAdvice(d);
      const learned = (advice.learnings || []).map((l) => `[${l.kind}] ${l.note}`).slice(0, 4);
      const memory = {};
      if (state.cache[d]?.pace) memory.pace = state.cache[d].pace;
      if (advice.rules?.length) memory.rules = advice.rules; // synthesized durable rules
      if (notes.length) memory.notes = notes;
      if (learned.length) memory.learned = learned;
      if (advice.procedures?.length) memory.knownProcedures = advice.procedures.length;
      if (advice.track?.runs) memory.track = advice.track;
      if (Object.keys(memory).length) out.memory = memory;
    } catch {}
    // Passive guardrail: surface a CAPTCHA / anti-abuse wall automatically so the
    // driving agent stops and hands off to a human, even if it never calls
    // detect_captcha. Kestrel does not solve these — it reports and steps back.
    try {
      const c = await actions.detect_captcha();
      if (c.captcha) {
        out.botWall = true;
        out.caution = `Anti-abuse / CAPTCHA wall detected (${c.signal}). Stop and hand off to a human — do not attempt to solve or bypass it.`;
      }
    } catch {}
    return out;
  },

  // Explicit pull of what Kestrel knows about a domain/task (the feedback half of
  // the learning loop, for the driving agent to read before acting).
  async advise({ query, domain }) {
    const d = domain || domainOf(state.page.url());
    ensureLoaded(d);
    let advice = {};
    try {
      advice = await brain.getAdvice(d, query);
    } catch {}
    return { ok: true, domain: d, pace: state.cache[d]?.pace || null, notes: (state.cache[d]?.notes || []).map((n) => n.note), ...advice };
  },

  async click(args) {
    // Guardrail: flag consequential/irreversible clicks so a human stays in the loop.
    // Non-blocking by default; hard-block when KES_CONFIRM_CONSEQUENTIAL=1 unless the
    // caller passes confirm=true (i.e. a human approved this specific action).
    const refMeta = args.ref ? state.lastRefMeta[args.ref] : null;
    const consequential = consequentialSignal(args, refMeta);
    if (consequential && process.env.KES_CONFIRM_CONSEQUENTIAL === '1' && !args.confirm) {
      const verify = await buildVerify(Date.now(), state.page.url(), args, {
        actionTaken: false,
        blocked: 'consequential-confirmation',
      });
      return { ok: false, consequential: true, needsConfirm: true,
        verify,
        error: `consequential action blocked (KES_CONFIRM_CONSEQUENTIAL=1) — have a human approve, then re-issue with confirm=true: ${args.text || refMeta?.name || args.selector || args.ref || args.som || ''}`.trim() };
    }
    const d = applyCache(args);
    await human();
    const r = await actWithHeal(args, (loc) => loc.click({ timeout: 8000 }), args);
    recordCache(args, d, r.ok);
    await autoLearn(d, args, r);
    if (args._cacheHit) r.cacheHit = true;
    if (consequential) {
      r.consequential = true;
      r.caution = 'This looked like a consequential/irreversible action (buy/pay/delete/send/submit). Confirm a human intended it.';
    }
    return r;
  },

  async type(args) {
    const { text, submit } = args;
    const d = applyCache(args);
    await human();
    const r = await actWithHeal(
      args,
      async (loc) => {
        await loc.fill('', { timeout: 8000 }).catch(() => {});
        await loc.fill(text, { timeout: 8000 });
        if (submit) await loc.press('Enter');
      },
      args
    );
    recordCache(args, d, r.ok);
    await autoLearn(d, args, r);
    if (args._cacheHit) r.cacheHit = true;
    return r;
  },

  // Learn this site: store a durable selector under `key`, and/or a freeform note.
  async remember({ key, selector, note, role, name, domain }) {
    const d = domain || domainOf(state.page.url());
    ensureLoaded(d);
    if (note) state.cache[d].notes.push({ note, ts: Date.now() });
    if (key && selector)
      state.cache[d].selectors[key] = { selector, role: role || null, name: name || null, hits: 0, ts: Date.now() };
    saveDomain(d);
    return {
      ok: true,
      domain: d,
      selectors: Object.keys(state.cache[d].selectors).length,
      notes: state.cache[d].notes.length,
    };
  },

  async recall({ domain }) {
    const d = domain || domainOf(state.page.url());
    ensureLoaded(d);
    return { ok: true, domain: d, ...state.cache[d] };
  },

  async forget({ key, domain }) {
    const d = domain || domainOf(state.page.url());
    ensureLoaded(d);
    if (key) delete state.cache[d].selectors[key];
    else state.cache[d] = { selectors: {}, notes: [] };
    saveDomain(d);
    return { ok: true, domain: d };
  },

  async fill_form({ fields, expectText }) {
    const results = [];
    for (const f of fields) {
      const r = await actWithHeal(f, (loc) => loc.fill(f.text, { timeout: 8000 }), {});
      results.push({ target: f.ref || f.selector || f.text, ok: r.ok, error: r.error });
    }
    const v = await withVerify(() => Promise.resolve(), { expectText });
    return { ok: results.every((r) => r.ok), fields: results, verify: v.verify };
  },

  async select(args) {
    return actWithHeal(args, (loc) => loc.selectOption(args.value, { timeout: 8000 }), args);
  },

  async press({ keys }) {
    return withVerify(() => state.page.keyboard.press(keys), {});
  },

  async upload_file(args) {
    const paths = String(args.path).split(',').map((p) => p.trim());
    return actWithHeal(args, (loc) => loc.setInputFiles(paths, { timeout: 8000 }), args);
  },

  // Set how JS dialogs (alert/confirm/prompt) are handled going forward, and
  // report the most recent one. Default policy is 'dismiss' (safe).
  async handle_dialog({ accept, text }) {
    state.dialogPolicy = accept ? 'accept' : 'dismiss';
    state.dialogPromptText = text;
    return { ok: true, policy: state.dialogPolicy, promptText: text ?? null, lastDialog: state.lastDialog };
  },

  async downloads() {
    return { ok: true, dir: state.downloadDir, downloads: state.downloads.slice(-20) };
  },

  // Best-effort dismissal of cookie/consent/overlay banners. First tries known
  // consent-framework selectors (OneTrust, Cookiebot, Quantcast/TCF, Osano) in
  // the page AND any iframes, then falls back to label matching.
  async dismiss_overlays() {
    const clicked = [];
    const KNOWN = [
      '#onetrust-accept-btn-handler',
      '#truste-consent-button',
      '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
      'button#onetrust-accept-btn-handler',
      '.qc-cmp2-summary-buttons button[mode="primary"]',
      '.osano-cm-accept-all',
      'button[aria-label="Accept all"]',
      'button[data-testid="cookie-policy-manage-dialog-accept-button"]',
    ];
    // known selectors in the top page + iframes
    for (const frame of [state.page, ...state.page.frames()]) {
      for (const sel of KNOWN) {
        try {
          const loc = frame.locator(sel).first();
          if (await loc.isVisible({ timeout: 400 }).catch(() => false)) {
            await loc.click({ timeout: 3000 }).catch(() => {});
            clicked.push(sel);
            await settle(1200);
            break;
          }
        } catch {}
      }
      if (clicked.length) break;
    }
    // label fallback
    if (!clicked.length) {
      const patterns = [
        /^accept all$/i, /^accept( all)? cookies$/i, /^accept$/i, /^i agree$/i, /^agree$/i,
        /^got it$/i, /^okay$/i, /^ok$/i, /^allow all$/i, /^allow$/i, /^i understand$/i,
        /^continue$/i, /^close$/i, /^dismiss$/i, /^no thanks$/i, /^reject all$/i,
      ];
      for (const re of patterns) {
        for (const role of ['button', 'link']) {
          const loc = state.page.getByRole(role, { name: re }).first();
          if (await loc.isVisible().catch(() => false)) {
            await loc.click({ timeout: 3000 }).catch(() => {});
            clicked.push(re.source);
            await settle(1200);
            break;
          }
        }
        if (clicked.length >= 2) break;
      }
    }
    return { ok: true, dismissed: clicked, url: state.page.url() };
  },

  // Coordinate click — fallback for canvas/visual UIs. Pair with `snapshot
  // mode=vision` (marks carry cx/cy) or computer-use-style coordinates.
  async click_xy({ x, y }) {
    return withVerify(() => state.page.mouse.click(Number(x), Number(y)), {});
  },

  // Fetch a secret from the macOS Keychain (so creds live in Keychain, not env
  // or the repo). e.g. keychain service=mysite account=me@x.com -> { secret }.
  async keychain({ service, account }) {
    if (process.platform !== 'darwin') return { ok: false, error: 'Keychain is macOS-only' };
    try {
      const args = ['find-generic-password', '-w'];
      if (service) args.push('-s', service);
      if (account) args.push('-a', account);
      const out = await sh('security', args);
      return { ok: true, secret: String(out).replace(/\n$/, '') };
    } catch (e) {
      return { ok: false, error: 'not found in Keychain' };
    }
  },

  async scroll({ direction = 'down', to_text, pages = 1 }) {
    if (to_text) {
      return withVerify(
        () => state.page.getByText(to_text, { exact: false }).first().scrollIntoViewIfNeeded({ timeout: 8000 }),
        { expectText: to_text }
      );
    }
    const dy = (direction === 'up' ? -1 : 1) * 800 * pages;
    return withVerify(() => state.page.mouse.wheel(0, dy), {});
  },

  async wait_for({ text, selector, url, networkidle, timeout = 15000 }) {
    try {
      if (text) await state.page.getByText(text, { exact: false }).first().waitFor({ timeout });
      else if (selector) await state.page.locator(selector).first().waitFor({ timeout });
      else if (url) await state.page.waitForURL(url, { timeout });
      else if (networkidle) await state.page.waitForLoadState('networkidle', { timeout });
      else await state.page.waitForTimeout(Math.min(timeout, 3000));
      return { ok: true, url: state.page.url() };
    } catch (e) {
      return { ok: false, error: String(e?.message || e), url: state.page.url() };
    }
  },

  async extract({ query }) {
    // Return cleaned visible text (markdown-ish). `query` is advisory.
    // innerText already excludes <script>/<style>/<noscript> content, so we read it
    // directly rather than mutating the live DOM (removing nodes broke some pages).
    const text = await state.page.evaluate(() =>
      (document.body?.innerText || '').replace(/\n{3,}/g, '\n\n').trim()
    );
    const out = text.length < 16000 ? text : text.slice(0, 16000) + '\n… [truncated]';
    return { ok: true, query: query || null, url: state.page.url(), text: out };
  },

  async screenshot({ path: p, fullPage }) {
    const out = p || path.join(os.tmpdir(), `kestrel-${Date.now()}.png`);
    await state.page.screenshot({ path: out, fullPage: !!fullPage });
    return { ok: true, path: out };
  },

  async tabs() {
    const pages = state.context.pages();
    const list = [];
    for (let i = 0; i < pages.length; i++) {
      list.push({ index: i, url: pages[i].url(), active: pages[i] === state.page });
    }
    return { ok: true, tabs: list };
  },

  async switch_tab({ index }) {
    const pages = state.context.pages();
    if (!pages[index]) return { ok: false, error: `no tab ${index}` };
    await setActivePage(pages[index]);
    await pages[index].bringToFront().catch(() => {});
    return { ok: true, url: pages[index].url() };
  },

  async new_tab({ url }) {
    const p = await state.context.newPage();
    await setActivePage(p);
    if (url) return withVerify(() => p.goto(url, { waitUntil: 'domcontentloaded' }), {});
    return { ok: true, url: p.url() };
  },

  async close_tab({ index }) {
    const pages = state.context.pages();
    const target = index == null ? state.page : pages[index];
    if (!target) return { ok: false, error: 'no such tab' };
    await target.close();
    const rest = state.context.pages();
    if (rest[0]) await setActivePage(rest[0]);
    return { ok: true, remaining: rest.length };
  },

  async back() {
    return withVerify(() => state.page.goBack({ waitUntil: 'domcontentloaded' }), {});
  },
  async forward() {
    return withVerify(() => state.page.goForward({ waitUntil: 'domcontentloaded' }), {});
  },

  async eval({ js }) {
    // Arbitrary in-page JS is a powerful sink (can read page secrets), so it's
    // OFF by default. snapshot/extract/click cover normal use. Opt in explicitly.
    if (process.env.KES_ENABLE_EVAL !== '1') {
      return { ok: false, error: 'eval is disabled — set KES_ENABLE_EVAL=1 to enable arbitrary in-page JS (use snapshot/extract instead where possible)' };
    }
    const value = await state.page.evaluate(js);
    return { ok: true, value };
  },

  // Detect common anti-abuse walls (reCAPTCHA / hCaptcha / Cloudflare Turnstile /
  // generic challenge text). The agent should hand off to a human on a hit.
  async detect_captcha() {
    const found = await state.page.evaluate(() => {
      const sels = [
        'iframe[src*="recaptcha"]', 'iframe[src*="hcaptcha"]', 'iframe[src*="turnstile"]',
        'iframe[title*="captcha" i]', '.g-recaptcha', '#challenge-form', '[data-sitekey]',
      ];
      const hit = sels.find((s) => document.querySelector(s));
      const bodyTxt = (document.body?.innerText || '').toLowerCase();
      const phrase = ['verify you are human', "verify you're human", 'are you a robot', "i'm not a robot", 'complete the captcha', 'checking your browser', 'unusual traffic']
        .find((p) => bodyTxt.includes(p));
      return { hit: hit || null, phrase: phrase || null };
    });
    const captcha = !!(found.hit || found.phrase);
    return { ok: true, captcha, signal: found.hit || found.phrase || null };
  },

  // Generate a 2FA code from a base32 TOTP secret. Pass the secret via env in
  // real use (e.g. secret=$KES_TOTP_SECRET); never hard-code it. Then type the
  // returned code into the 2FA field. `t` (ms) is for testing against vectors.
  async totp({ secret, t }) {
    if (!secret) return { ok: false, error: 'secret required (base32)' };
    return { ok: true, code: totpCode(secret, t ? { t: Number(t) } : {}) };
  },

  // One-shot login: fills user/pass (+ optional TOTP 2FA), submits, verifies.
  // Credentials default to env (KES_USER / KES_PASS / KES_TOTP_SECRET) — never
  // hard-code them. Pass the field selectors for the specific site.
  async login({ userSelector, passSelector, user, pass, submitSelector, totpSecret, totpSelector, expectText }) {
    user = user ?? process.env.KES_USER;
    pass = pass ?? process.env.KES_PASS;
    totpSecret = totpSecret ?? process.env.KES_TOTP_SECRET;
    const did = [];
    try {
      if (userSelector && user != null) {
        await human();
        await state.page.locator(userSelector).fill(String(user), { timeout: 8000 });
        did.push('user');
      }
      if (passSelector && pass != null) {
        await human();
        await state.page.locator(passSelector).fill(String(pass), { timeout: 8000 });
        did.push('pass');
      }
      if (submitSelector) {
        await state.page.locator(submitSelector).click({ timeout: 8000 });
        did.push('submit');
      } else if (passSelector) {
        await state.page.locator(passSelector).press('Enter');
        did.push('submit-enter');
      }
      await settle();
      if (totpSecret && totpSelector) {
        const code = totpCode(totpSecret);
        await state.page.locator(totpSelector).fill(code, { timeout: 8000 });
        await state.page.locator(totpSelector).press('Enter');
        did.push('totp');
        await settle();
      }
    } catch (e) {
      return { ok: false, error: String(e?.message || e), steps: did };
    }
    const v = await withVerify(() => Promise.resolve(), { expectText });
    await autoNoteAbuse(domainOf(state.page.url())).catch(() => null);
    return { ok: v.ok !== false, steps: did, verify: v.verify };
  },

  // ---- OS-level input (macOS): trusted (isTrusted=true) keystrokes/paste for
  // sites that ignore synthetic input. Needs headed mode + the browser frontmost.
  async paste({ text, selector, ref, som, submit, expectText }) {
    if (process.platform !== 'darwin') return { ok: false, error: 'OS paste is macOS-only; use type instead' };
    if (selector || ref || som) await locatorFor({ selector, ref, som }).focus({ timeout: 5000 }).catch(() => {});
    await osActivateBrowser();
    await setClipboard(text);
    await human();
    await osPaste();
    if (submit) {
      await human();
      await osKey('return');
    }
    const r = await withVerify(() => Promise.resolve(), { expectText });
    await autoNoteAbuse(domainOf(state.page.url())).catch(() => null);
    return r;
  },

  async type_human({ text, selector, ref, som, submit, expectText }) {
    if (process.platform !== 'darwin') return { ok: false, error: 'OS keystroke is macOS-only; use type instead' };
    if (selector || ref || som) await locatorFor({ selector, ref, som }).focus({ timeout: 5000 }).catch(() => {});
    await osActivateBrowser();
    await human();
    await osKeystroke(text);
    if (submit) {
      await human();
      await osKey('return');
    }
    return withVerify(() => Promise.resolve(), { expectText });
  },

  async key_human({ keys }) {
    if (process.platform !== 'darwin') return { ok: false, error: 'macOS-only; use press instead' };
    await osActivateBrowser();
    await osKey(keys);
    return { ok: true };
  },

  // Set (or clear) the learned cadence for a domain. `set` = human | slow | fast.
  async pace({ set = 'human', domain }) {
    const d = domain || domainOf(state.page.url());
    ensureLoaded(d);
    state.cache[d].pace = set;
    saveDomain(d);
    return { ok: true, domain: d, pace: set };
  },

  async console_log({ limit = 20 }) {
    return { ok: true, entries: state.console.slice(-limit) };
  },

  // Captured XHR/fetch requests (+ recent responses) — for discovering a site's
  // internal API so you can hit it directly instead of clicking through the UI.
  async network({ filter, limit = 30 }) {
    let reqs = state.requests;
    let resp = state.responses;
    if (filter) {
      reqs = reqs.filter((r) => r.url.includes(filter));
      resp = resp.filter((r) => r.url.includes(filter));
    }
    return { ok: true, requests: reqs.slice(-limit), responses: resp.slice(-limit) };
  },

  // Export the page's cookies (session reuse), or import a cookie array.
  async cookies({ set }) {
    if (set) {
      const arr = typeof set === 'string' ? JSON.parse(set) : set;
      await state.context.addCookies(arr);
      return { ok: true, added: arr.length };
    }
    return { ok: true, cookies: await state.context.cookies() };
  },

  // Save the current page as a PDF (headless Chromium only).
  async pdf({ path: p }) {
    const out = p || path.join(os.tmpdir(), `kestrel-${Date.now()}.pdf`);
    try {
      await state.page.pdf({ path: out, printBackground: true });
      return { ok: true, path: out };
    } catch (e) {
      return { ok: false, error: 'pdf needs headless chromium: ' + String(e?.message || e) };
    }
  },

  // Explicit assertion for verification-driven flows.
  async assert({ text, url, selectorVisible }) {
    const checks = {};
    if (text) checks.text = await state.page.getByText(text, { exact: false }).first().isVisible().catch(() => false);
    if (url) {
      try {
        checks.url = new RegExp(url).test(state.page.url());
      } catch {
        checks.url = state.page.url().includes(url);
      }
    }
    if (selectorVisible) checks.selectorVisible = await state.page.locator(selectorVisible).first().isVisible().catch(() => false);
    const passed = Object.values(checks).every(Boolean) && Object.keys(checks).length > 0;
    return { ok: passed, passed, checks, url: state.page.url() };
  },

  async stop() {
    setTimeout(async () => {
      try {
        await (state.context?.close?.() || state.browser?.close?.());
      } catch {}
      process.exit(0);
    }, 50);
    return { ok: true, stopping: true };
  },
};

// Native-mode action set (macOS, no CDP). Used to route verbs when mode=native.
const nativeActions = makeNativeActions(state);

// Extension-mode bridge: queue a command for the companion extension (which
// long-polls /ext/next) and resolve when it POSTs /ext/result.
function extCall(action, args) {
  return new Promise((resolve) => {
    const id = ++state.ext.seq;
    const cmd = { id, action, args };
    state.ext.pending[id] = resolve;
    const w = state.ext.waiters.shift();
    if (w) w(cmd);
    else state.ext.queue.push(cmd);
    setTimeout(() => {
      if (state.ext.pending[id]) {
        delete state.ext.pending[id];
        resolve({ ok: false, error: 'extension did not respond — is the Kestrel extension loaded and is the target tab active?' });
      }
    }, 20000);
  });
}
const EXT_LOCAL = ['stop', 'totp'];

// ---------- http control plane ----------
const server = http.createServer((req, res) => {
  const json = (code, obj) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(obj));
  };
  const isExt = !!(req.url && req.url.startsWith('/ext/'));

  // The companion extension's service worker (a chrome-extension:// origin) is the
  // ONLY legitimate cross-origin caller, and only on /ext/*. Those routes answer
  // CORS + Chrome's Private Network Access preflight (Chrome 130+ blocks a worker
  // from reaching 127.0.0.1 otherwise). Everything else gets no CORS headers.
  if (isExt) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }
  } else if (req.headers.origin) {
    // The control plane is for local programs (the CLI, your scripts) that never
    // send an Origin header. A browser ALWAYS sends Origin on a cross-origin fetch,
    // so a web page you happen to be visiting cannot drive the daemon (CSRF-style
    // hijack of your browser). Reject anything that carries an Origin.
    return json(403, { ok: false, error: 'cross-origin requests are not allowed on the control plane' });
  }

  // Optional shared-secret auth for shared/multi-user hosts. When KES_TOKEN is set,
  // every control-plane request must carry a matching x-kestrel-token header. The
  // extension bridge (/ext/*) is exempt (localhost long-poll). Off unless KES_TOKEN set.
  if (process.env.KES_TOKEN && !isExt && req.headers['x-kestrel-token'] !== process.env.KES_TOKEN) {
    return json(401, { ok: false, error: 'missing or invalid x-kestrel-token (KES_TOKEN is set on the daemon)' });
  }

  // ---- companion-extension bridge (HTTP long-poll; no extra deps) ----
  if (state.ext && req.url && req.url.startsWith('/ext/')) {
    if (req.method === 'GET' && req.url === '/ext/next') {
      if (!state.ext.connected) console.log('[kestrel] extension connected (first /ext/next)');
      state.ext.connected = true;
      if (state.ext.queue.length) return json(200, state.ext.queue.shift());
      let done = false;
      const w = (cmd) => { if (!done) { done = true; json(200, cmd); } };
      state.ext.waiters.push(w);
      setTimeout(() => {
        if (!done) {
          done = true;
          const i = state.ext.waiters.indexOf(w);
          if (i >= 0) state.ext.waiters.splice(i, 1);
          json(200, { none: true });
        }
      }, 25000);
      return;
    }
    if (req.method === 'POST' && req.url === '/ext/result') {
      let b = '';
      req.on('data', (c) => (b += c));
      req.on('end', () => {
        try {
          const p = JSON.parse(b || '{}');
          // screenshots arrive as a dataUrl (the extension can't write files) —
          // persist to ~/.kestrel/shots and hand back a path instead of base64.
          if (p.result && typeof p.result.dataUrl === 'string' && p.result.dataUrl.startsWith('data:image/')) {
            try {
              const dir = path.join(os.homedir(), '.kestrel', 'shots');
              fs.mkdirSync(dir, { recursive: true });
              const f = path.join(dir, `ext-${Date.now()}.png`);
              fs.writeFileSync(f, Buffer.from(p.result.dataUrl.split(',')[1], 'base64'));
              p.result = { ok: true, path: f };
            } catch (e) {
              p.result = { ok: false, error: 'screenshot save failed: ' + String(e?.message || e) };
            }
          }
          const r = state.ext.pending[p.id];
          if (r) { delete state.ext.pending[p.id]; r(p.result); }
        } catch {}
        json(200, { ok: true });
      });
      return;
    }
    if (req.url === '/ext/hello') { state.ext.connected = true; return json(200, { ok: true }); }
    return json(404, { ok: false, error: 'unknown ext endpoint' });
  }

  if (req.method !== 'POST') {
    res.writeHead(405);
    return res.end('POST only');
  }
  let body = '';
  let aborted = false;
  req.on('data', (c) => {
    if (aborted) return;
    body += c;
    if (body.length > 8_000_000) { // 8MB cap — guard against a runaway/malformed body
      aborted = true;
      json(413, { ok: false, error: 'request body too large' });
      req.destroy();
    }
  });
  req.on('error', () => {});
  req.on('end', async () => {
    if (aborted) return;
    let payload = {};
    try {
      payload = JSON.parse(body || '{}');
    } catch {
      return json(400, { ok: false, error: 'bad json' });
    }
    const { action, args = {} } = payload;

    // Extension mode: status is local; most verbs route to the extension.
    if (state.ext) {
      if (action === 'status')
        return json(200, { ok: true, mode: 'extension', ready: state.ready, connected: state.ext.connected, queued: state.ext.queue.length });
      if (!EXT_LOCAL.includes(action)) {
        try { return json(200, await extCall(action, args)); }
        catch (e) { return json(200, { ok: false, error: String(e?.message || e) }); }
      }
    }

    const fn = state.native ? nativeActions[action] : actions[action];
    if (!fn) return json(state.native || state.ext ? 400 : 404, { ok: false, error: `unsupported action: ${action}` });
    try {
      return json(200, await fn(args));
    } catch (e) {
      return json(200, { ok: false, error: String(e?.message || e), stack: String(e?.stack || '').split('\n').slice(0, 4) });
    }
  });
});

(async () => {
  try {
    await launch();
  } catch (e) {
    console.error('[kestrel] launch failed:', e?.message || e);
    if (state.mode === 'clone' || state.mode === 'live') {
      console.error(
        '[kestrel] clone/live mode needs Chrome on ' +
          CDP +
          '. Start Chrome with --remote-debugging-port=9222 first, or use --mode=fresh.'
      );
    }
    process.exit(1);
  }
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.error(`[kestrel] port ${PORT} is already in use — another daemon is likely running. Use a different port (--port=) or stop it first.`);
      process.exit(1);
    }
    throw e;
  });
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`[kestrel] daemon ready: mode=${state.mode} port=${PORT} url=${state.page ? state.page.url() : '(native — real Chrome)'}`);
  });
})();

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
