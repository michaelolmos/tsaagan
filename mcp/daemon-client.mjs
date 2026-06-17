// Thin bridge from the MCP server to the Tsaagan daemon's localhost control
// plane. The daemon already does all the work (perceive → act → verify); this
// just speaks its { action, args } protocol over HTTP and, if no daemon is
// running, starts one.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DAEMON = path.join(__dirname, '..', 'daemon.js');

const PORT = parseInt(process.env.TSG_PORT || '39817', 10);
const BASE = `http://127.0.0.1:${PORT}`;
const AUTH = process.env.TSG_TOKEN ? { 'x-tsaagan-token': process.env.TSG_TOKEN } : {};
const AUTOSTART = process.env.TSAAGAN_MCP_AUTOSTART !== '0';
const MODE = process.env.TSAAGAN_MODE || 'fresh';
const HEADLESS = process.env.TSAAGAN_HEADLESS !== '0'; // headless by default for MCP use
const CALL_TIMEOUT_MS = parseInt(process.env.TSAAGAN_MCP_TIMEOUT || '60000', 10);

/** Log to stderr only — stdout is the JSON-RPC channel and must stay clean. */
function log(...a) {
  process.stderr.write(`[tsaagan-mcp] ${a.join(' ')}\n`);
}

/** POST one { action, args } to the daemon and return its parsed JSON result. */
export async function call(action, args = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CALL_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...AUTH },
      body: JSON.stringify({ action, args }),
      signal: ctrl.signal,
    });
    return await res.json();
  } catch (e) {
    if (e?.name === 'AbortError') return { ok: false, error: `daemon call timed out after ${CALL_TIMEOUT_MS}ms (action=${action})` };
    return { ok: false, error: `daemon call failed: ${String(e?.message || e)}` };
  } finally {
    clearTimeout(timer);
  }
}

/** Is a daemon answering on the control-plane port? */
export async function alive() {
  try {
    const res = await fetch(`${BASE}/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...AUTH },
      body: JSON.stringify({ action: 'status', args: {} }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Ensure a daemon is running. If one is already up, reuse it. Otherwise — unless
 * TSAAGAN_MCP_AUTOSTART=0 — spawn a detached headless daemon and wait for it to
 * become ready. Returns { ok, started?, error? }.
 */
let ensuring = null;
export function ensureDaemon() {
  if (ensuring) return ensuring;
  ensuring = (async () => {
    if (await alive()) return { ok: true, started: false };
    if (!AUTOSTART) return { ok: false, error: `no Tsaagan daemon on ${BASE} and autostart is disabled (TSAAGAN_MCP_AUTOSTART=0). Run: tsaagan start` };
    if (!fs.existsSync(DAEMON)) return { ok: false, error: `daemon not found at ${DAEMON}` };

    log(`starting daemon on ${BASE} (mode=${MODE} headless=${HEADLESS})`);
    const logDir = path.join(os.homedir(), '.tsaagan');
    fs.mkdirSync(logDir, { recursive: true });
    const out = fs.openSync(path.join(logDir, 'daemon.log'), 'a');
    const dArgs = [DAEMON, `--port=${PORT}`, `--mode=${MODE}`];
    if (HEADLESS) dArgs.push('--headless=true');
    const child = spawn('node', dArgs, { detached: true, stdio: ['ignore', out, out] });
    child.unref();

    for (let i = 0; i < 50; i++) {
      await new Promise((r) => setTimeout(r, 300));
      if (await alive()) return { ok: true, started: true };
    }
    return { ok: false, error: 'daemon did not become ready in time; see ~/.tsaagan/daemon.log' };
  })();
  // allow a later retry if this attempt failed
  ensuring.then((r) => { if (!r.ok) ensuring = null; }).catch(() => { ensuring = null; });
  return ensuring;
}

export const config = { PORT, BASE, MODE, HEADLESS, AUTOSTART };
