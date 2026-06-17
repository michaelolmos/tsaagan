// Integration smoke test: spawn the daemon (fresh/headless) and exercise the
// core loop against example.com — goto + verify, snapshot refs, click-by-ref,
// and self-heal on a forced stale ref. Requires a Chromium/Chrome to be
// installed (npx playwright install chromium). Run: node --test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 39851; // dedicated test port
const URL = `http://127.0.0.1:${PORT}/`;
let daemon;

const bp = async (action, args = {}) =>
  (await fetch(URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, args }) })).json();
const alive = async () => {
  try {
    return (await bp('status')).ready !== undefined;
  } catch {
    return false;
  }
};

before(async () => {
  daemon = spawn('node', [path.join(ROOT, 'daemon.js'), `--port=${PORT}`, '--headless=true'], {
    stdio: 'ignore',
    env: { ...process.env, KES_CONFIRM_CONSEQUENTIAL: '1' },
  });
  // Wait up to ~60s — Chromium cold-start on a loaded CI runner can exceed 20s.
  for (let i = 0; i < 120 && !(await alive()); i++) await new Promise((r) => setTimeout(r, 500));
  assert.ok(await alive(), 'daemon should become ready');
});

after(async () => {
  try { await bp('stop'); } catch {}
  try { daemon?.kill(); } catch {}
});

test('goto returns a structural verify block', async () => {
  const r = await bp('goto', { url: 'https://example.com', expectText: 'Example' });
  assert.equal(r.ok, true);
  assert.equal(r.verify.urlChanged, true);
  assert.equal(r.verify.expectTextFound, true);
});

test('snapshot returns stable [ref=eN] grounding', async () => {
  const r = await bp('snapshot', {});
  assert.equal(r.ok, true);
  assert.ok(r.refs > 0, 'should find interactive refs');
  assert.match(r.snapshot, /\[ref=e\d+\]/);
});

test('click-by-ref navigates and self-heals a stale ref', async () => {
  await bp('goto', { url: 'https://example.com' });
  const snap = await bp('snapshot', {});
  const ref = (snap.snapshot.match(/link "Learn more" \[ref=(e\d+)\]/) || [])[1];
  assert.ok(ref, 'should find the Learn more link ref');
  await bp('goto', { url: 'https://example.com' }); // invalidate refs without re-snapshotting
  const r = await bp('click', { ref, expectText: 'IANA' });
  assert.equal(r.ok, true);
  assert.equal(r.selfHealed, true, 'stale ref should self-heal');
});

test('blocked consequential click still returns verification evidence', async () => {
  const html = '<button onclick="location.hash = \'submitted\'">Submit payment</button>';
  await bp('goto', { url: `data:text/html,${encodeURIComponent(html)}` });
  const r = await bp('click', { text: 'Submit payment' });
  assert.equal(r.ok, false);
  assert.equal(r.consequential, true);
  assert.equal(r.needsConfirm, true);
  assert.equal(r.verify.actionTaken, false);
  assert.equal(r.verify.urlChanged, false);
  assert.ok(!r.verify.urlAfter.endsWith('#submitted'), 'blocked click should not trigger the button handler');
});

test('consequential click is blocked when target is addressed by ref', async () => {
  const html = '<button onclick="location.hash = \'deleted\'">Delete account</button>';
  await bp('goto', { url: `data:text/html,${encodeURIComponent(html)}` });
  const snap = await bp('snapshot', {});
  const ref = (snap.snapshot.match(/button "Delete account" \[ref=(e\d+)\]/) || [])[1];
  assert.ok(ref, 'should find the Delete account button ref');
  const r = await bp('click', { ref });
  assert.equal(r.ok, false);
  assert.equal(r.consequential, true);
  assert.equal(r.needsConfirm, true);
  assert.equal(r.verify.actionTaken, false);
  assert.equal(r.verify.urlChanged, false);
  assert.ok(!r.verify.urlAfter.endsWith('#deleted'), 'blocked ref click should not trigger the button handler');
});

test('type submits a form and verifies the resulting text', async () => {
  const html = `
    <form onsubmit="event.preventDefault(); document.querySelector('#out').textContent = 'Submitted: ' + document.querySelector('#q').value;">
      <label>Query <input id="q" name="q"></label>
      <button type="submit">Search</button>
    </form>
    <p id="out"></p>
  `;
  await bp('goto', { url: `data:text/html,${encodeURIComponent(html)}` });
  const r = await bp('type', { selector: '#q', text: 'kestrel', submit: true, expectText: 'Submitted: kestrel' });
  assert.equal(r.ok, true);
  assert.equal(r.verify.expectTextFound, true);
});

test('press verifies post-conditions after keyboard actions', async () => {
  const html = `
    <form onsubmit="event.preventDefault(); document.querySelector('#out').textContent = 'Pressed: ' + document.querySelector('#q').value;">
      <label>Query <input id="q" name="q"></label>
    </form>
    <p id="out"></p>
  `;
  await bp('goto', { url: `data:text/html,${encodeURIComponent(html)}` });
  await bp('type', { selector: '#q', text: 'kestrel' });
  const r = await bp('press', { keys: 'Enter', expectText: 'Pressed: kestrel' });
  assert.equal(r.ok, true);
  assert.equal(r.verify.expectTextFound, true);
});

test('fill_form fails when its expected post-condition is missing', async () => {
  const html = `
    <label>First <input id="first"></label>
    <label>Last <input id="last"></label>
    <p id="out"></p>
  `;
  await bp('goto', { url: `data:text/html,${encodeURIComponent(html)}` });
  const r = await bp('fill_form', {
    fields: [
      { selector: '#first', text: 'Ada' },
      { selector: '#last', text: 'Lovelace' },
    ],
    expectText: 'Saved',
  });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'post-condition not met');
  assert.equal(r.verify.expectTextFound, false);
  assert.equal(r.fields.every((field) => field.ok), true);
});

test('fill_form reports a top-level error when a field fails', async () => {
  const html = '<label>First <input id="first"></label>';
  await bp('goto', { url: `data:text/html,${encodeURIComponent(html)}` });
  const r = await bp('fill_form', {
    fields: [
      { selector: '#first', text: 'Ada' },
      { selector: '#missing', text: 'Lovelace' },
    ],
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /field failed/i);
  assert.equal(r.fields[0].ok, true);
  assert.equal(r.fields[1].ok, false);
});

test("snapshot flags verify-you're-human walls for handoff", async () => {
  const html = '<main><h1>Please verify you\'re human to continue</h1></main>';
  await bp('goto', { url: `data:text/html,${encodeURIComponent(html)}` });
  const r = await bp('snapshot', {});
  assert.equal(r.ok, true);
  assert.equal(r.botWall, true);
  assert.match(r.caution, /hand off to a human/i);
});

test('snapshot flags unusual-traffic walls for handoff', async () => {
  const html = '<main><h1>We detected unusual traffic from your network</h1></main>';
  await bp('goto', { url: `data:text/html,${encodeURIComponent(html)}` });
  const r = await bp('snapshot', {});
  assert.equal(r.ok, true);
  assert.equal(r.botWall, true);
  assert.match(r.caution, /hand off to a human/i);
});

test('vision Set-of-Marks returns numbered marks with coordinates', async () => {
  await bp('goto', { url: 'https://example.com' });
  const r = await bp('snapshot', { mode: 'vision' });
  assert.equal(r.ok, true);
  assert.ok(r.count > 0);
  const first = Object.values(r.marks)[0];
  assert.ok(typeof first.cx === 'number' && typeof first.cy === 'number');
});
