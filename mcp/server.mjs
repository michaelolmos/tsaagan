// Kestrel MCP server — exposes Kestrel's verify-first browser control to any
// MCP host (Claude Desktop, Claude Code, Cursor, ...) over stdio.
//
// Transport: newline-delimited JSON-RPC 2.0 on stdin/stdout (the MCP stdio
// transport). stdout carries ONLY protocol messages; all logging goes to stderr.
// Zero new dependencies — hand-rolled to preserve Kestrel's single-dependency
// (Playwright) footprint.
//
// Run: `kestrel mcp`  (or `node mcp/server.mjs`)

import fs from 'node:fs';
import os from 'node:os';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { TOOL_BY_NAME, toolList } from './tools.mjs';
import { call, ensureDaemon } from './daemon-client.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROTOCOL_VERSION = '2025-06-18';

let VERSION = '1.0.0';
try {
  VERSION = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version || VERSION;
} catch {}

function log(...a) {
  process.stderr.write(`[kestrel-mcp] ${a.join(' ')}\n`);
}

function write(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function reply(id, result) {
  write({ jsonrpc: '2.0', id, result });
}

function replyError(id, code, message, data) {
  write({ jsonrpc: '2.0', id, error: { code, message, ...(data ? { data } : {}) } });
}

/** Run one MCP tool: ensure a daemon, forward { action, args }, wrap the result. */
async function callTool(name, args = {}) {
  const tool = TOOL_BY_NAME[name];
  if (!tool) return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };

  const ready = await ensureDaemon();
  if (!ready.ok) return { content: [{ type: 'text', text: `Kestrel daemon unavailable: ${ready.error}` }], isError: true };

  // Screenshots: have the daemon write a PNG, then return it as MCP image content.
  if (tool.screenshot) {
    const outPath = path.join(os.tmpdir(), `kestrel-shot-${Date.now()}.png`);
    const r = await call('screenshot', { ...args, path: outPath });
    if (r?.ok === false) return { content: [{ type: 'text', text: jsonText(r) }], isError: true };
    const file = r?.path || outPath;
    try {
      const data = fs.readFileSync(file).toString('base64');
      try { fs.unlinkSync(file); } catch {}
      return { content: [{ type: 'image', data, mimeType: 'image/png' }] };
    } catch (e) {
      return { content: [{ type: 'text', text: `screenshot saved to ${file} but could not be read: ${String(e?.message || e)}` }], isError: true };
    }
  }

  const result = await call(tool.action, args);
  const isError = result?.ok === false;
  return { content: [{ type: 'text', text: jsonText(result) }], structuredContent: result, isError };
}

function jsonText(o) {
  try { return JSON.stringify(o, null, 2); } catch { return String(o); }
}

async function handle(msg) {
  const { id, method, params } = msg;
  const isNotification = id === undefined || id === null;

  switch (method) {
    case 'initialize':
      reply(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'kestrel', version: VERSION },
        instructions:
          'Kestrel drives a real browser with verify-first reliability. Read the page with kestrel_snapshot ' +
          '(accessibility tree + stable refs), act with kestrel_click/type/fill_form, and trust the verify block ' +
          'each mutating tool returns as proof the action worked. Use kestrel_network to discover a site\'s own ' +
          'data API. Only automate sites you are authorized to use.',
      });
      return;

    case 'notifications/initialized':
    case 'initialized':
      return; // notification — no response

    case 'ping':
      if (!isNotification) reply(id, {});
      return;

    case 'tools/list':
      reply(id, { tools: toolList() });
      return;

    case 'tools/call': {
      const name = params?.name;
      const args = params?.arguments || {};
      if (!name) return replyError(id, -32602, 'tools/call requires a tool name');
      try {
        const result = await callTool(name, args);
        reply(id, result);
      } catch (e) {
        log('tool error:', String(e?.stack || e));
        reply(id, { content: [{ type: 'text', text: `Tool ${name} threw: ${String(e?.message || e)}` }], isError: true });
      }
      return;
    }

    default:
      if (!isNotification) replyError(id, -32601, `Method not found: ${method}`);
      return;
  }
}

export function start() {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      log('parse error on line:', trimmed.slice(0, 120));
      return; // cannot reply without an id
    }
    // Fire-and-forget; responses are ordered by the host via id, not by us.
    handle(msg).catch((e) => log('handler error:', String(e?.stack || e)));
  });
  rl.on('close', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));
  process.on('SIGINT', () => process.exit(0));
  log(`ready (v${VERSION}, ${toolList().length} tools, protocol ${PROTOCOL_VERSION})`);
}

// Allow direct execution: `node mcp/server.mjs`
if (import.meta.url === `file://${process.argv[1]}`) start();
