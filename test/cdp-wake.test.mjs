// Memory Saver freezes background tabs; a frozen tab never answers CDP and hangs
// connectOverCDP (Chrome 150+). wakeFrozenTabs must find the silent tab, activate it,
// and put the front tab back. A real headless Chrome supplies the answering tab; a
// socket that accepts and never replies stands in for the frozen one (CDP's own
// Page.setWebLifecycleState freeze still answers, so it cannot reproduce this).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { wakeFrozenTabs } from '../lib/cdp-wake.js';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 39853;
let chrome, profile, silent, fake, activated = [], list = [];

before(async () => {
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tsaagan-wake-'));
  chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
  let live;
  for (let i = 0; i < 50 && !live; i++) {
    try { live = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page'); } catch {}
    if (!live) await new Promise((r) => setTimeout(r, 200));
  }
  silent = net.createServer(() => {}).listen(0, '127.0.0.1');
  await new Promise((r) => silent.once('listening', r));
  list = [
    { id: 'front', type: 'page', url: 'https://front.example/', webSocketDebuggerUrl: live.webSocketDebuggerUrl },
    { id: 'frozen', type: 'page', url: 'chrome://newtab/', webSocketDebuggerUrl: `ws://127.0.0.1:${silent.address().port}/devtools/page/frozen` },
    { id: 'sw', type: 'service_worker', url: 'chrome-extension://x/sw.js', webSocketDebuggerUrl: `ws://127.0.0.1:${silent.address().port}/sw` },
  ];
  fake = http.createServer((req, res) => {
    if (req.url === '/json/list') return res.end(JSON.stringify(list));
    const m = req.url.match(/^\/json\/activate\/(.+)$/);
    if (m) activated.push(m[1]);
    res.end('Target activated');
  }).listen(0, '127.0.0.1');
  await new Promise((r) => fake.once('listening', r));
});

after(() => {
  silent?.close(); fake?.close();
  try { process.kill(chrome.pid); } catch {}
  // Chrome writes to the profile while it exits; remove it once the process is gone.
  return new Promise((r) => chrome.once('exit', () => { fs.rmSync(profile, { recursive: true, force: true }); r(); }));
});

test('wakes the silent tab only, then puts the front tab back', { skip: !fs.existsSync(CHROME) }, async () => {
  const t0 = Date.now();
  const wake = await wakeFrozenTabs(`http://127.0.0.1:${fake.address().port}`, { timeoutMs: 800 });
  assert.equal(wake.checked, 2, 'only page targets are probed');
  assert.deepEqual(wake.woken, ['chrome://newtab/']);
  assert.deepEqual(activated, ['frozen', 'front']);
  assert.ok(Date.now() - t0 < 3000, 'probes run in parallel');
});

test('nothing is activated when every tab answers', { skip: !fs.existsSync(CHROME) }, async () => {
  activated = [];
  list = list.filter((t) => t.id === 'front');
  const wake = await wakeFrozenTabs(`http://127.0.0.1:${fake.address().port}`);
  assert.deepEqual(wake.woken, []);
  assert.deepEqual(activated, []);
});
