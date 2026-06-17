#!/usr/bin/env node
// tsaagan capability benchmark. Runs a task suite autonomously and scores
// success + self-heal rate + steps + time. Plus a deterministic capability
// matrix (self-heal, vision Set-of-Marks, structural verify).
//
// Usage:  GROQ_API_KEY=... node bench.js [tasks=bench/tasks.json] [max=8]
//   (or OPENROUTER_API_KEY=... for open-source models — see lib/llm.js)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runGoal, ensureDaemon, bp } from './agent.js';
import { hasLLM } from './lib/llm.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const argv = {};
for (const item of process.argv.slice(2)) {
  const m = item.match(/^([^=]+)=([\s\S]*)$/);
  if (m) argv[m[1]] = m[2];
}
const PORT = parseInt(process.env.TSG_PORT || '39817', 10);
const tasksFile = argv.tasks || path.join(__dirname, 'bench', 'tasks.json');

if (!hasLLM()) {
  console.error('no LLM key — set GROQ_API_KEY or OPENROUTER_API_KEY (or TSG_LLM_BASE_URL for a custom endpoint)');
  process.exit(1);
}

const tasks = JSON.parse(fs.readFileSync(tasksFile, 'utf8'));
await ensureDaemon({ port: PORT, mode: 'fresh', headless: true });

function passed(task, result, finalUrl) {
  const r = (result || '').toLowerCase();
  if (task.check.text && r.includes(task.check.text.toLowerCase())) return true;
  if (task.check.url && (finalUrl || '').toLowerCase().includes(task.check.url.toLowerCase())) return true;
  return false;
}

console.log('=== TASK SUITE (autonomous) ===');
const rows = [];
for (const task of tasks) {
  await bp(PORT, 'goto', { url: 'about:blank' }).catch(() => {});
  const r = await runGoal({ goal: task.goal, startUrl: task.start_url, max: task.max || 8, port: PORT });
  const status = await bp(PORT, 'status').catch(() => ({}));
  const pass = passed(task, r.result, status.url);
  rows.push({ id: task.id, pass, steps: r.steps, selfHeals: r.selfHeals, ms: r.ms, needsHuman: r.needsHuman, result: (r.result || '').slice(0, 70) });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${task.id.padEnd(20)} steps=${r.steps} heals=${r.selfHeals} ${r.ms}ms  -> ${(r.result || '').slice(0, 60)}`);
}

const passN = rows.filter((r) => r.pass).length;
const totHeals = rows.reduce((a, r) => a + r.selfHeals, 0);
const avgSteps = (rows.reduce((a, r) => a + r.steps, 0) / rows.length).toFixed(1);

console.log('\n=== CAPABILITY MATRIX (deterministic) ===');
const matrix = {};
// self-heal: snapshot, reload to invalidate refs, click stale ref -> should heal
await bp(PORT, 'goto', { url: 'https://example.com' });
const snap = await bp(PORT, 'snapshot', {});
const linkRef = (snap.snapshot.match(/link[^\[]*\[ref=(e\d+)\]/) || [])[1];
await bp(PORT, 'goto', { url: 'https://example.com' }); // invalidate refs
const healR = linkRef ? await bp(PORT, 'click', { ref: linkRef, expectText: 'IANA' }) : { selfHealed: false };
matrix.self_heal = !!healR.selfHealed;
// vision Set-of-Marks
await bp(PORT, 'goto', { url: 'https://news.ycombinator.com' });
const vis = await bp(PORT, 'snapshot', { mode: 'vision' });
matrix.vision_som = (vis.count || 0) > 0;
// structural verify present
const ver = await bp(PORT, 'goto', { url: 'https://example.com', expectText: 'Example' });
matrix.structural_verify = ver.verify && ver.verify.expectTextFound === true;
for (const [k, v] of Object.entries(matrix)) console.log(`${v ? 'PASS' : 'FAIL'}  ${k}`);

console.log('\n=== SCORECARD ===');
console.log(
  JSON.stringify(
    {
      taskSuccessRate: `${passN}/${rows.length} (${Math.round((passN / rows.length) * 100)}%)`,
      avgSteps,
      totalSelfHeals: totHeals,
      capabilityMatrix: matrix,
    },
    null,
    2
  )
);
await bp(PORT, 'stop', {}).catch(() => {});
