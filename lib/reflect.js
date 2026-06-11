// Reflection-synthesis + look-ahead — the higher-order parts of the learning loop.
//   synthesizeDomain(): compress a domain's many raw lessons into a few durable
//     RULES (Generative Agents reflection / A-MEM evolution), stored in the brain.
//   lookaheadPredict(): before an IRREVERSIBLE action, imagine the outcome and
//     judge whether it's the right/safe thing to do (WebDreamer-style), so the agent
//     thinks before it sends/buys/deletes. Brain = any OpenAI-compatible LLM
//     (Groq / OpenRouter / custom — see llm.js); the Anthropic key is never used.

import * as brain from './brain.js';
import { chat, modelFor } from './llm.js';

const groq = (messages, model = modelFor('planner')) => chat(model, messages, { json: true });

// Compress raw lessons for one domain into a few durable, deduped rules.
export async function synthesizeDomain(domain, minLessons = 4) {
  const lessons = brain.rawLearnings(domain, 40);
  if (lessons.length < minLessons) return { ok: false, reason: `only ${lessons.length} lessons (need ${minLessons})` };
  let r;
  try {
    r = await groq([
      {
        role: 'system',
        content:
          'Compress these browser-automation lessons for ONE website into 2–5 DURABLE, actionable rules. Dedupe; keep load-bearing ones (anti-abuse pacing, login quirks, where key elements are). Drop one-off noise. JSON: {"rules":["...", "..."]}. Output ONLY JSON.',
      },
      { role: 'user', content: `DOMAIN: ${domain}\nLESSONS:\n${lessons.map((l) => `- [${l.kind}] ${l.note}`).join('\n')}` },
    ]);
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
  const rules = Array.isArray(r.rules) ? r.rules.slice(0, 5) : [];
  for (const rule of rules) await brain.saveRule(domain, String(rule).slice(0, 300));
  return { ok: true, domain, rules };
}

// Imagine the outcome of an irreversible action before committing to it.
export async function lookaheadPredict(goal, action, context) {
  return groq([
    {
      role: 'system',
      content:
        'You are a look-ahead safety check BEFORE an irreversible browser action (submit/buy/pay/delete/send). Predict the outcome and whether this is the RIGHT, intended, safe action for the goal. Be cautious: if uncertain or it looks wrong/destructive, set safe=false. JSON: {"prediction":"...","safe":true|false,"reason":"..."}. Output ONLY JSON.',
    },
    { role: 'user', content: `GOAL: ${goal}\nABOUT TO DO: ${JSON.stringify(action)}\nPAGE CONTEXT:\n${String(context).slice(0, 1500)}` },
  ]);
}

// heuristic: is this action irreversible / consequential?
export function isIrreversible(action, args, goal) {
  if (args && args.submit) return true;
  const blob = (JSON.stringify(args || {}) + ' ' + (goal || '')).toLowerCase();
  return /\b(buy|purchase|pay|payment|checkout|place order|order now|delete|remove|send|confirm|submit|subscribe|transfer|withdraw)\b/.test(blob);
}
