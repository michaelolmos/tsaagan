#!/usr/bin/env node
// kestrel standalone agent server. Runs without any Claude Code session —
// hand it goals over HTTP (curl, cron, or another app) and it executes them
// autonomously, persisting each run to the agent journal.
//
// Start:  GROQ_API_KEY=... node server.js [port=39820] [mode=fresh] [headless=true]
//   (or OPENROUTER_API_KEY=... for open-source models — see lib/llm.js)
// Submit: curl -s localhost:39820/goal -d '{"goal":"...","max":16}'
//         curl -s localhost:39820/journal
//         curl -s localhost:39820/health

import http from 'node:http';
import { runGoal, ensureDaemon, recentJournal } from './agent.js';
import { hasLLM } from './lib/llm.js';

const argv = {};
for (const item of process.argv.slice(2)) {
  const m = item.match(/^([^=]+)=([\s\S]*)$/);
  if (m) argv[m[1]] = m[2];
}
const PORT = parseInt(process.env.KES_SERVE_PORT || argv.port || '39820', 10);
const DAEMON_PORT = parseInt(process.env.KES_PORT || argv.daemon_port || '39817', 10);
const MODE = argv.mode || 'fresh';
const HEADLESS = argv.headless !== 'false';

if (!hasLLM()) {
  console.error('no LLM key — set GROQ_API_KEY or OPENROUTER_API_KEY (or KES_LLM_BASE_URL for a custom endpoint)');
  process.exit(1);
}

await ensureDaemon({ port: DAEMON_PORT, mode: MODE, headless: HEADLESS });

let busy = false;
const server = http.createServer((req, res) => {
  const reply = (code, obj) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(obj));
  };
  if (req.method === 'GET' && req.url === '/health') return reply(200, { ok: true, busy, daemonPort: DAEMON_PORT });
  if (req.method === 'GET' && req.url === '/journal') return reply(200, { ok: true, runs: recentJournal(10) });
  if (req.method === 'POST' && req.url === '/goal') {
    let body = '';
    let tooBig = false;
    req.on('data', (c) => {
      if (tooBig) return;
      body += c;
      if (body.length > 2_000_000) { tooBig = true; reply(413, { ok: false, error: 'request body too large' }); req.destroy(); }
    });
    req.on('end', async () => {
      if (tooBig) return;
      let p = {};
      try {
        p = JSON.parse(body || '{}');
      } catch {
        return reply(400, { ok: false, error: 'bad json' });
      }
      if (!p.goal) return reply(400, { ok: false, error: 'goal required' });
      if (busy) return reply(429, { ok: false, error: 'agent busy with another goal' });
      busy = true;
      try {
        const result = await runGoal({
          goal: p.goal,
          max: p.max || 16,
          port: DAEMON_PORT,
          startUrl: p.start_url,
          onLog: (l) => console.log(JSON.stringify(l)),
        });
        reply(200, result);
      } catch (e) {
        reply(500, { ok: false, error: String(e?.message || e) });
      } finally {
        busy = false;
      }
    });
    return;
  }
  reply(404, { ok: false, error: 'use POST /goal, GET /journal, GET /health' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[kestrel] agent server on http://127.0.0.1:${PORT} (daemon :${DAEMON_PORT}, mode=${MODE})`);
});
