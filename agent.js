// kestrel autonomous agent core — shared by run.js (one-shot) and
// server.js (standalone, server-resident). Implements a planner→navigator→
// validator loop with model tiering, CAPTCHA handoff, and persistent task
// memory. Brain = any OpenAI-compatible LLM (Groq / OpenRouter open-source /
// custom — see lib/llm.js). The Anthropic key is never used here.
//
// Persistence (so the agent has memory of its own work across runs):
//   ~/.kestrel/agent/journal.jsonl   one line per completed goal
//   ~/.kestrel/agent/learnings.json  durable, hand-or-self-curated notes

import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as brain from './lib/brain.js';
import * as reflect from './lib/reflect.js';
import { chat, modelFor } from './lib/llm.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AGENT_DIR = path.join(os.homedir(), '.kestrel', 'agent');
fs.mkdirSync(AGENT_DIR, { recursive: true });
const JOURNAL = path.join(AGENT_DIR, 'journal.jsonl');
const LEARNINGS = path.join(AGENT_DIR, 'learnings.json');

const PLANNER_MODEL = modelFor('planner');
const NAV_MODEL = modelFor('nav');
const VALIDATOR_MODEL = modelFor('validator');

export function loadLearnings() {
  try {
    return JSON.parse(fs.readFileSync(LEARNINGS, 'utf8'));
  } catch {
    return { notes: [] };
  }
}
export function addLearning(note) {
  const l = loadLearnings();
  l.notes.push({ note, ts: Date.now() });
  fs.writeFileSync(LEARNINGS, JSON.stringify(l, null, 2));
}
export function recentJournal(n = 5) {
  try {
    return fs
      .readFileSync(JOURNAL, 'utf8')
      .trim()
      .split('\n')
      .slice(-n)
      .map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}
function journal(entry) {
  try {
    fs.appendFileSync(JOURNAL, JSON.stringify(entry) + '\n');
  } catch {}
}

// ---- daemon plumbing ----
export function bpUrl(port) {
  return `http://127.0.0.1:${port}/`;
}
export async function bp(port, action, args = {}) {
  const res = await fetch(bpUrl(port), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, args }),
  });
  return res.json();
}
export async function alive(port) {
  try {
    return (await bp(port, 'status')).ready !== undefined;
  } catch {
    return false;
  }
}
export async function ensureDaemon({ port, mode = 'fresh', headless = true }) {
  if (await alive(port)) return;
  fs.mkdirSync(path.join(os.homedir(), '.kestrel'), { recursive: true });
  const log = fs.openSync(path.join(os.homedir(), '.kestrel', 'daemon.log'), 'a');
  const d = [path.join(__dirname, 'daemon.js'), `--port=${port}`, `--mode=${mode}`];
  if (headless) d.push('--headless=true');
  const child = spawn('node', d, { detached: true, stdio: ['ignore', log, log] });
  child.unref();
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 300));
    if (await alive(port)) return;
  }
  throw new Error('daemon did not start');
}

// ---- LLM brain (provider-agnostic: Groq / OpenRouter / custom — see lib/llm.js) ----
const groq = (model, messages, json = true) => chat(model, messages, { json });

const NAV_SYS = `You are Kestrel's navigator, driving a real browser one step at a time toward a GOAL, following a PLAN.
You get the GOAL, the PLAN, the current page's accessibility snapshot (elements have stable [ref=eN]), the latest extracted page text, and your action history WITH verification results.

Respond with ONE action as a single JSON object:
- "thought": one sentence.
- "action": "goto"|"click"|"type"|"scroll"|"wait_for"|"dismiss_overlays"|"extract"|"done".
- goto: "url". click: "ref"|"selector"|"text" (+ optional "expectText"). type: "ref"|"selector","text"(+optional "submit":true,"expectText"). scroll: "direction"|"to_text". wait_for: "text"|"selector"|"networkidle":true. done: "result" (the answer/outcome).

Rules:
- Use refs from the MOST RECENT snapshot. Set expectText when you expect a specific result.
- If the answer to the GOAL is already visible in the snapshot or LATEST PAGE TEXT, respond {"action":"done","result":"<answer>"} immediately.
- NEVER repeat the same action twice in a row. Read verify results and adapt.
- Use dismiss_overlays for cookie/consent banners.
Output ONLY the JSON object.`;

const PLANNER_SYS = `You are Kestrel's planner. Given a GOAL (and optional prior learnings), output a concise ordered plan to accomplish it in a web browser. JSON: {"plan":["step 1","step 2", ...]} with 2-6 steps. Output ONLY JSON.`;

const VALIDATOR_SYS = `You are Kestrel's validator. Given the GOAL, the proposed final RESULT, the current URL, and the latest page text, decide whether the GOAL is genuinely satisfied. Be strict but fair. JSON: {"satisfied":true|false,"reason":"...","missing":"..."}. Output ONLY JSON.`;

function actionArgs(d) {
  const a = {};
  for (const k of ['url', 'ref', 'selector', 'text', 'submit', 'direction', 'to_text', 'expectText', 'networkidle'])
    if (d[k] !== undefined) a[k] = d[k];
  return a;
}

// Run one goal to completion. Returns {ok, result, plan, trajectory, needsHuman}.
export async function runGoal({ goal, max = 16, port = 39817, startUrl, onLog = () => {} }) {
  const t0 = Date.now();
  if (startUrl) await bp(port, 'goto', { url: startUrl });

  // PLAN
  let plan = [];
  try {
    const learn = loadLearnings().notes.slice(-5).map((n) => n.note);
    const p = await groq(PLANNER_MODEL, [
      { role: 'system', content: PLANNER_SYS },
      { role: 'user', content: `GOAL: ${goal}\nPRIOR LEARNINGS: ${learn.join(' | ') || '(none)'}` },
    ]);
    plan = Array.isArray(p.plan) ? p.plan : [];
  } catch (e) {
    onLog({ planner_error: String(e?.message || e) });
  }
  onLog({ plan });

  const trajectory = [];
  let lastSig = null;
  let repeat = 0;
  let lastExtract = '';
  let result = null;
  let needsHuman = false;

  for (let step = 1; step <= max; step++) {
    // CAPTCHA gate — hand off to a human rather than fail or fake it.
    const cap = await bp(port, 'detect_captcha').catch(() => ({ captcha: false }));
    if (cap.captcha) {
      needsHuman = true;
      result = `CAPTCHA / anti-abuse wall encountered (${cap.signal}). Human handoff required.`;
      onLog({ step, captcha: cap.signal });
      break;
    }

    const snap = await bp(port, 'snapshot', {});
    const snapText = (snap.snapshot || '').slice(0, 6000);
    const histText = trajectory
      .map((h, i) => `${i + 1}. ${h.action} ${JSON.stringify(h.args)} -> ok=${h.ok} ${h.verify ? 'v=' + JSON.stringify(h.verify).slice(0, 180) : ''}`)
      .join('\n');

    const messages = [
      { role: 'system', content: NAV_SYS },
      {
        role: 'user',
        content: `GOAL: ${goal}\nPLAN: ${plan.map((s, i) => `${i + 1}) ${s}`).join('  ')}\n\nCURRENT URL: ${snap.url}\n${snap.memory ? 'WHAT KESTREL LEARNED HERE BEFORE (adapt to this): ' + JSON.stringify(snap.memory) + '\n' : ''}SNAPSHOT:\n${snapText}\n\n${lastExtract ? 'LATEST PAGE TEXT:\n' + lastExtract.slice(0, 1800) + '\n\n' : ''}HISTORY:\n${histText || '(none)'}\n\nNext single action? JSON only.`,
      },
    ];
    if (repeat >= 1)
      messages.push({ role: 'system', content: 'You are repeating yourself. If the answer is visible, respond done now; else choose a DIFFERENT action.' });

    let decision;
    try {
      decision = await groq(NAV_MODEL, messages);
    } catch (e) {
      onLog({ step, nav_error: String(e?.message || e) });
      break;
    }
    onLog({ step, thought: decision.thought, action: decision.action, args: actionArgs(decision) });

    const sig = JSON.stringify({ a: decision.action, ...actionArgs(decision) });
    repeat = sig === lastSig ? repeat + 1 : 0;
    lastSig = sig;
    if (repeat >= 2) {
      result = decision.result || `Halted (repeat). Context: ${(lastExtract || snapText).slice(0, 400)}`;
      onLog({ step, halted: 'repeat-guard' });
      break;
    }

    if (decision.action === 'done') {
      // VALIDATE before accepting.
      const proposed = decision.result || '(no result text)';
      let verdict = { satisfied: true, reason: 'no validator' };
      try {
        verdict = await groq(VALIDATOR_MODEL, [
          { role: 'system', content: VALIDATOR_SYS },
          { role: 'user', content: `GOAL: ${goal}\nPROPOSED RESULT: ${proposed}\nCURRENT URL: ${snap.url}\nLATEST PAGE TEXT: ${(lastExtract || snapText).slice(0, 1500)}` },
        ]);
      } catch (e) {
        onLog({ step, validator_error: String(e?.message || e) });
      }
      onLog({ step, validate: verdict });
      if (verdict.satisfied) {
        result = proposed;
        break;
      }
      // not satisfied: push feedback into history and keep going
      trajectory.push({ action: 'validate', args: {}, ok: false, verify: { rejected: verdict.reason, missing: verdict.missing } });
      continue;
    }

    const a = actionArgs(decision);
    // WebDreamer-style look-ahead: imagine the outcome before an irreversible action.
    if (reflect.isIrreversible(decision.action, a, goal)) {
      try {
        const pred = await reflect.lookaheadPredict(goal, { action: decision.action, ...a }, snapText);
        onLog({ step, lookahead: pred });
        if (pred && pred.safe === false) {
          trajectory.push({ action: 'lookahead-block', args: a, ok: false, verify: { blocked: pred.reason } });
          continue; // don't commit; let the navigator reconsider
        }
      } catch {}
    }
    const r = await bp(port, decision.action, a);
    const entry = { action: decision.action, args: a, ok: r.ok, verify: r.verify || null, selfHealed: r.selfHealed || false };
    if (decision.action === 'extract') lastExtract = r.text || '';
    trajectory.push(entry);
    onLog({ step, ok: r.ok, verify: r.verify || null, selfHealed: r.selfHealed || false });
  }

  const out = {
    ok: !!result && !needsHuman,
    needsHuman,
    goal,
    plan,
    result: result || '(max steps reached without a validated result)',
    steps: trajectory.length,
    selfHeals: trajectory.filter((t) => t.selfHealed).length,
    ms: Date.now() - t0,
  };
  journal({ ts: t0, ...out, trajectory });

  // ---- THE LEARNING LOOP: reflect on this run and store reusable knowledge ----
  let domain = '';
  try {
    domain = new URL(startUrl || trajectory.filter((t) => t.verify?.urlAfter).pop()?.verify?.urlAfter || '').hostname;
  } catch {}
  try {
    brain.recordEpisode({ domain, mode: 'autonomous', goal, ok: out.ok, steps: out.steps, ms: out.ms, result: out.result });
    // Evaluator gate: only trust a "success" that the validator AND structural
    // verification confirmed — so we never store a procedure off a false positive.
    const verified = trajectory.some((t) => t.verify && (t.verify.expectTextFound || t.verify.urlChanged));
    if (out.ok) {
      const steps = trajectory
        .filter((t) => t.ok && t.action !== 'validate' && t.action !== 'lookahead-block')
        .map((t) => ({ a: t.action, ...t.args }));
      if (steps.length && verified) await brain.recordProcedure(domain, goal, steps, true);
      await brain.learn(domain, `✓ "${String(goal).slice(0, 80)}" succeeded in ${out.steps} steps.`, 'success');
    } else if (needsHuman) {
      await brain.learn(domain, `✗ "${String(goal).slice(0, 80)}" hit a CAPTCHA / anti-abuse wall — slow to human pace, or hand off to a human.`, 'anti-abuse');
      await reflect.synthesizeDomain(domain).catch(() => {});
    } else {
      // failure → reflect (one LLM call) into a concise, reusable lesson, then synthesize
      let lesson = `✗ "${String(goal).slice(0, 80)}" did not complete in ${out.steps} steps.`;
      try {
        const hist = trajectory.map((h) => `${h.action} ${JSON.stringify(h.args)} -> ok=${h.ok}`).join('\n').slice(0, 1500);
        const rr = await groq(VALIDATOR_MODEL, [
          { role: 'system', content: 'You are reflecting on a failed browser-automation run to produce ONE concise, reusable lesson for next time (what went wrong + what to try). JSON: {"lesson":"..."}. Output ONLY JSON.' },
          { role: 'user', content: `GOAL: ${goal}\nDOMAIN: ${domain}\nWHAT HAPPENED:\n${hist}\nRESULT: ${out.result}` },
        ]);
        if (rr.lesson) lesson = `✗ ${String(rr.lesson).slice(0, 240)}`;
      } catch {}
      await brain.learn(domain, lesson, 'failure');
      await reflect.synthesizeDomain(domain).catch(() => {});
    }
  } catch {}
  return { ...out, trajectory };
}
