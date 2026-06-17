// Tsaagan SDK — an ergonomic, verify-first programmatic API over the Tsaagan
// daemon. Every call returns a TsaaganResult that pairs the data with the
// `verify` block (proof the action worked) — the thing stagehand/browser-use/
// playwright-mcp make you assert yourself.
//
//   import { createTsaagan } from 'tsaagan/sdk';
//   const k = await createTsaagan();
//   await k.goto('https://example.com', { expectText: 'Example Domain' });
//   const r = await k.extract('the page heading');
//   console.log(r.data, r.verify);   // data + proof, together
//   await k.stop();
//
// Zero dependencies — speaks the daemon's { action, args } HTTP protocol directly.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DAEMON = path.join(__dirname, '..', 'daemon.js');

/**
 * @typedef {Object} VerifyBlock
 * @property {string} [urlBefore]
 * @property {string} [urlAfter]
 * @property {boolean} [urlChanged]
 * @property {string[]} [newConsoleErrors]
 * @property {string[]} [failedRequests]
 * @property {boolean} [expectTextFound]
 */

/**
 * @template T
 * @typedef {Object} TsaaganResult
 * @property {boolean} ok
 * @property {T} data            Result payload (snapshot text, extracted data, status fields, ...).
 * @property {VerifyBlock|null} verify  Proof-of-effect for mutating actions (null for pure reads).
 * @property {boolean} cached    True if the daemon served this from a learned selector.
 * @property {number} latencyMs
 * @property {string} [error]
 */

const INTERNAL = new Set(['ok', 'error', 'verify', 'cacheHit', '_cacheHit']);

export class Tsaagan {
  /**
   * @param {Object} [opts]
   * @param {number} [opts.port=39817]      Daemon control-plane port.
   * @param {boolean} [opts.autoStart=true] Start a daemon if none is running.
   * @param {string} [opts.mode='fresh']    Daemon mode when auto-starting.
   * @param {boolean} [opts.headless=true]  Run the auto-started daemon headless.
   * @param {number} [opts.timeoutMs=60000] Per-call timeout.
   * @param {string} [opts.token]           x-tsaagan-token (or TSG_TOKEN env).
   */
  constructor(opts = {}) {
    this.port = opts.port || parseInt(process.env.TSG_PORT || '39817', 10);
    this.base = `http://127.0.0.1:${this.port}`;
    this.autoStart = opts.autoStart !== false;
    this.mode = opts.mode || 'fresh';
    this.headless = opts.headless !== false;
    this.timeoutMs = opts.timeoutMs || 60000;
    const token = opts.token || process.env.TSG_TOKEN;
    this.auth = token ? { 'x-tsaagan-token': token } : {};
    this._ensured = null;
  }

  // ── core transport ──────────────────────────────────────────────────────

  /** @returns {Promise<boolean>} */
  async alive() {
    try {
      const r = await fetch(`${this.base}/`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...this.auth },
        body: JSON.stringify({ action: 'status', args: {} }),
      });
      return r.ok;
    } catch {
      return false;
    }
  }

  /** Ensure a daemon is reachable, auto-starting one if allowed. Idempotent. */
  async ready() {
    if (this._ensured) return this._ensured;
    this._ensured = (async () => {
      if (await this.alive()) return true;
      if (!this.autoStart) throw new Error(`no Tsaagan daemon on ${this.base} (autoStart is off)`);
      if (!fs.existsSync(DAEMON)) throw new Error(`daemon not found at ${DAEMON}`);
      const logDir = path.join(os.homedir(), '.tsaagan');
      fs.mkdirSync(logDir, { recursive: true });
      const out = fs.openSync(path.join(logDir, 'daemon.log'), 'a');
      const dArgs = [DAEMON, `--port=${this.port}`, `--mode=${this.mode}`];
      if (this.headless) dArgs.push('--headless=true');
      spawn('node', dArgs, { detached: true, stdio: ['ignore', out, out] }).unref();
      for (let i = 0; i < 50; i++) {
        await new Promise((r) => setTimeout(r, 300));
        if (await this.alive()) return true;
      }
      throw new Error('daemon did not become ready; see ~/.tsaagan/daemon.log');
    })();
    return this._ensured;
  }

  /**
   * Send one { action, args } and wrap the response as a TsaaganResult.
   * @returns {Promise<TsaaganResult<any>>}
   */
  async raw(action, args = {}) {
    await this.ready();
    const t0 = Date.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    let result;
    try {
      const res = await fetch(`${this.base}/`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...this.auth },
        body: JSON.stringify({ action, args }),
        signal: ctrl.signal,
      });
      result = await res.json();
    } catch (e) {
      const msg = e?.name === 'AbortError' ? `timed out after ${this.timeoutMs}ms` : String(e?.message || e);
      return { ok: false, data: {}, verify: null, cached: false, latencyMs: Date.now() - t0, error: msg };
    } finally {
      clearTimeout(timer);
    }
    const data = {};
    for (const [k, v] of Object.entries(result)) if (!INTERNAL.has(k)) data[k] = v;
    return {
      ok: result.ok !== false,
      data,
      verify: result.verify || null,
      cached: !!(result.cacheHit || result._cacheHit),
      latencyMs: Date.now() - t0,
      ...(result.error ? { error: result.error } : {}),
    };
  }

  // ── perception ──────────────────────────────────────────────────────────

  /** Daemon + page status. */
  status() { return this.raw('status'); }

  /** Accessibility-tree snapshot with stable refs. @param {{full?:boolean}} [o] */
  snapshot(o = {}) { return this.raw('snapshot', o); }

  /** Extract structured data via a natural-language query (a11y tree). */
  extract(query) { return this.raw('extract', typeof query === 'string' ? { query } : query); }

  /** Recent console messages. */
  consoleLog(o = {}) { return this.raw('console_log', o); }

  /** Recent network requests — discover a site's own data API. */
  network(o = {}) { return this.raw('network', o); }

  /** Recall learned site memory for a domain. */
  recall(domain) { return this.raw('recall', { domain }); }

  // ── navigation ──────────────────────────────────────────────────────────

  /** Navigate to a URL. @param {string} url @param {{expectText?:string}} [o] */
  goto(url, o = {}) { return this.raw('goto', { url, ...o }); }

  back() { return this.raw('back'); }

  /** @param {{direction?:'down'|'up',to_text?:string}} [o] */
  scroll(o = {}) { return this.raw('scroll', o); }

  /** Wait for a condition. @param {{text?:string,selector?:string,url?:string,networkidle?:boolean,timeout?:number}} o */
  waitFor(o = {}) { return this.raw('wait_for', o); }

  // ── action (verify-first) ───────────────────────────────────────────────

  /** Click by ref/selector/text. @param {{ref?:string,selector?:string,text?:string,expectText?:string,expectGone?:string}} o */
  click(o = {}) { return this.raw('click', o); }

  /** Type into an element. @param {{ref?:string,selector?:string,text:string,submit?:boolean,expectText?:string}} o */
  type(o = {}) { return this.raw('type', o); }

  /** Fill multiple fields, optionally submit. @param {Array<object>} fields @param {{submit?:boolean,expectText?:string}} [o] */
  fillForm(fields, o = {}) { return this.raw('fill_form', { fields, ...o }); }

  /** Select a dropdown option. @param {{ref?:string,selector?:string,value?:string,label?:string}} o */
  select(o = {}) { return this.raw('select', o); }

  /** Press a key/chord. @param {string} keys @param {{expectText?:string}} [o] */
  press(keys, o = {}) { return this.raw('press', { keys, ...o }); }

  /** Assert page state without acting — explicit proof check. @param {{text?:string,url?:string,selectorVisible?:string}} o */
  assert(o = {}) { return this.raw('assert', o); }

  /** Screenshot to a file (vision fallback). @param {{path?:string,fullPage?:boolean}} [o] */
  screenshot(o = {}) { return this.raw('screenshot', o); }

  // ── tabs ────────────────────────────────────────────────────────────────

  tabs() { return this.raw('tabs'); }
  switchTab(index) { return this.raw('switch_tab', { index }); }
  newTab(url) { return this.raw('new_tab', url ? { url } : {}); }
  closeTab(index) { return this.raw('close_tab', index == null ? {} : { index }); }

  // ── lifecycle ───────────────────────────────────────────────────────────

  /** Shut down the daemon (kills the browser). Use only if you own this daemon. */
  stop() { return this.raw('stop'); }

  /** No-op: the SDK holds no sockets. Does NOT stop the daemon — call stop() for that. */
  async close() {}
}

/** Construct a Tsaagan client and ensure the daemon is ready. */
export async function createTsaagan(opts = {}) {
  const k = new Tsaagan(opts);
  await k.ready();
  return k;
}

export default Tsaagan;
