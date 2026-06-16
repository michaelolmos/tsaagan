// MCP server protocol-layer tests. These exercise the JSON-RPC handshake and the
// tool catalog over stdio WITHOUT launching a browser (no tools/call), so they
// are fast and CI-safe. End-to-end browser coverage lives in the smoke suite.

import { test } from 'node:test';
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Spawn the MCP server, send JSON-RPC requests, resolve a map of id → response. */
function session(requests, { timeoutMs = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    const srv = spawn('node', ['mcp/server.mjs'], { cwd: ROOT, stdio: ['pipe', 'pipe', 'ignore'] });
    const want = new Set(requests.filter((r) => r.id != null).map((r) => r.id));
    const got = new Map();
    let buf = '';
    const done = (err) => {
      clearTimeout(timer);
      try { srv.kill(); } catch {}
      err ? reject(err) : resolve(got);
    };
    const timer = setTimeout(() => done(new Error(`timed out; got ids ${[...got.keys()]}`)), timeoutMs);
    srv.on('error', done);
    srv.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id != null) got.set(msg.id, msg);
        if (want.size && [...want].every((id) => got.has(id))) return done();
      }
    });
    for (const r of requests) srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...r }) + '\n');
  });
}

test('initialize returns protocol version and server info', async () => {
  const r = await session([{ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {} } }]);
  const res = r.get(1).result;
  assert.equal(res.protocolVersion, '2025-06-18');
  assert.equal(res.serverInfo.name, 'kestrel');
  assert.ok(res.capabilities.tools, 'declares tools capability');
});

test('tools/list returns the verify-first tool catalog', async () => {
  const r = await session([
    { id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {} } },
    { id: 2, method: 'tools/list' },
  ]);
  const tools = r.get(2).result.tools;
  assert.ok(Array.isArray(tools) && tools.length >= 20, `expected 20+ tools, got ${tools.length}`);
  const names = tools.map((t) => t.name);
  for (const must of ['kestrel_navigate', 'kestrel_snapshot', 'kestrel_click', 'kestrel_fill_form', 'kestrel_network']) {
    assert.ok(names.includes(must), `missing tool ${must}`);
  }
  // Every tool must be self-describing for the host.
  for (const t of tools) {
    assert.ok(t.name && t.description && t.inputSchema, `tool ${t.name} incomplete`);
    assert.equal(t.inputSchema.type, 'object');
  }
  // Mutating tools are flagged destructive so hosts can gate/confirm them.
  const click = tools.find((t) => t.name === 'kestrel_click');
  assert.equal(click.annotations.destructiveHint, true);
  // Read-only tools are flagged so hosts can parallelize them.
  const snap = tools.find((t) => t.name === 'kestrel_snapshot');
  assert.equal(snap.annotations.readOnlyHint, true);
});

test('unknown method returns a JSON-RPC error', async () => {
  const r = await session([
    { id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {} } },
    { id: 2, method: 'no/such/method' },
  ]);
  assert.ok(r.get(2).error, 'expected an error object');
  assert.equal(r.get(2).error.code, -32601);
});
