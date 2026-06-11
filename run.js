#!/usr/bin/env node
// One-shot autonomous run. Delegates to the shared agent core (planner →
// navigator → validator loop, with CAPTCHA handoff + persistent task memory).
//
// Usage (set ONE brain key):
//   GROQ_API_KEY=...        node run.js goal="..." [max=16] [mode=fresh|clone] ...
//   OPENROUTER_API_KEY=...  node run.js goal="..."   # open-source models via OpenRouter
//
// For high-stakes work, drive the kestrel verbs yourself (Claude) via the
// Kestrel skill — you're the sharper navigator. This is for unattended runs.

import { runGoal, ensureDaemon } from './agent.js';
import { hasLLM } from './lib/llm.js';

const rest = process.argv.slice(2);
const args = {};
for (const item of rest) {
  const m = item.match(/^([^=]+)=([\s\S]*)$/);
  if (m) args[m[1]] = m[2];
}
const GOAL = args.goal;
const MAX = parseInt(args.max || '16', 10);
const PORT = parseInt(process.env.KES_PORT || args.port || '39817', 10);

if (!GOAL) {
  console.error('need goal="..."');
  process.exit(1);
}
if (!hasLLM()) {
  console.error('no LLM key — set GROQ_API_KEY or OPENROUTER_API_KEY (or KES_LLM_BASE_URL for a custom endpoint)');
  process.exit(1);
}

await ensureDaemon({
  port: PORT,
  mode: args.mode || 'fresh',
  headless: args.headless !== 'false',
});

const res = await runGoal({
  goal: GOAL,
  max: MAX,
  port: PORT,
  startUrl: args.start_url,
  onLog: (l) => console.log(JSON.stringify(l)),
});

console.log('\n=== RESULT ===');
console.log(res.result);
console.log(
  JSON.stringify(
    { ok: res.ok, needsHuman: res.needsHuman, steps: res.steps, selfHeals: res.selfHeals, plan: res.plan, ms: res.ms },
    null,
    2
  )
);
