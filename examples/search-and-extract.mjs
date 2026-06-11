#!/usr/bin/env node
// Example: drive Kestrel's daemon directly from Node to do a real multi-step
// task — search Wikipedia and read the result — with structural verification.
//
//   npm install && npx playwright install chromium
//   node examples/search-and-extract.mjs

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 39817;
const URL = `http://127.0.0.1:${PORT}/`;

const bp = async (action, args = {}) =>
  (await fetch(URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, args }) })).json();
const alive = async () => {
  try { return (await bp('status')).ready !== undefined; } catch { return false; }
};

// start the daemon if needed
if (!(await alive())) {
  spawn('node', [path.join(ROOT, 'daemon.js'), `--port=${PORT}`, '--headless=true'], { detached: true, stdio: 'ignore' }).unref();
  for (let i = 0; i < 40 && !(await alive()); i++) await new Promise((r) => setTimeout(r, 300));
}

await bp('goto', { url: 'https://www.wikipedia.org' });
const typed = await bp('type', { selector: '#searchInput', text: 'Kestrel', submit: true, expectText: 'kestrel' });
console.log('search verified:', typed.verify?.expectTextFound, '->', typed.verify?.urlAfter);

const text = await bp('extract', {});
console.log('first 200 chars of article:\n', (text.text || '').slice(0, 200));

await bp('stop');
