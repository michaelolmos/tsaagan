// Kestrel's brain — evolving, queryable memory (SQLite via node:sqlite, JSONL
// fallback). Episodic task history + learnings + reusable procedures + synthesized
// domain rules. Retrieval is research-grade: relevance (embedding cosine) ×
// importance × recency (Generative Agents-style), not substring matching.
// Per-site SELECTORS still live in ~/.kestrel/memory/*.json (human-editable).

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { embed, cosine } from './embed.js';

const DIR = path.join(os.homedir(), '.kestrel');
fs.mkdirSync(DIR, { recursive: true });
const DB_PATH = path.join(DIR, 'brain.db');
const JL_PATH = path.join(DIR, 'brain.jsonl');

let db = null;
try {
  const { DatabaseSync } = await import('node:sqlite');
  db = new DatabaseSync(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS episodes (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, domain TEXT, mode TEXT, goal TEXT, ok INTEGER, steps INTEGER, ms INTEGER, result TEXT);
    CREATE TABLE IF NOT EXISTS learnings (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, domain TEXT, kind TEXT, note TEXT);
    CREATE TABLE IF NOT EXISTS procedures (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, domain TEXT, task TEXT, steps TEXT, ok INTEGER);
    CREATE TABLE IF NOT EXISTS rules (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, domain TEXT, rule TEXT, embedding TEXT);
    CREATE INDEX IF NOT EXISTS idx_ep_domain ON episodes(domain);
    CREATE INDEX IF NOT EXISTS idx_ln_domain ON learnings(domain);
    CREATE INDEX IF NOT EXISTS idx_pr_domain ON procedures(domain);
    CREATE INDEX IF NOT EXISTS idx_ru_domain ON rules(domain);
  `);
  // additive migrations (no-op if the column already exists)
  for (const sql of [
    'ALTER TABLE learnings ADD COLUMN embedding TEXT',
    'ALTER TABLE learnings ADD COLUMN importance INTEGER DEFAULT 5',
    'ALTER TABLE procedures ADD COLUMN embedding TEXT',
  ]) {
    try {
      db.exec(sql);
    } catch {}
  }
} catch {
  db = null;
}

const jlAppend = (r) => {
  try {
    fs.appendFileSync(JL_PATH, JSON.stringify(r) + '\n');
  } catch {}
};
const jlRead = () => {
  try {
    return fs.readFileSync(JL_PATH, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
};
const parseVec = (s) => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};
const recency = (ts) => Math.exp(-Math.max(0, Date.now() - ts) / (1000 * 60 * 60 * 72)); // ~3-day decay
const IMPORTANCE = { 'anti-abuse': 9, failure: 7, rule: 8, success: 5, note: 3 };

export const backend = () => (db ? 'sqlite' : 'jsonl');

export function recordEpisode(e) {
  const ts = Date.now();
  if (db)
    db.prepare('INSERT INTO episodes (ts,domain,mode,goal,ok,steps,ms,result) VALUES (?,?,?,?,?,?,?,?)').run(
      ts, e.domain || '', e.mode || '', e.goal || '', e.ok ? 1 : 0, e.steps || 0, e.ms || 0, String(e.result || '').slice(0, 2000)
    );
  else jlAppend({ type: 'episode', ts, ...e });
}

export async function learn(domain, note, kind = 'note') {
  const ts = Date.now();
  const importance = IMPORTANCE[kind] || 5;
  const v = JSON.stringify(await embed(note));
  if (db) db.prepare('INSERT INTO learnings (ts,domain,kind,note,embedding,importance) VALUES (?,?,?,?,?,?)').run(ts, domain || '', kind, note, v, importance);
  else jlAppend({ type: 'learning', ts, domain, kind, note, embedding: JSON.parse(v), importance });
}

export async function recordProcedure(domain, task, steps, ok = true) {
  const ts = Date.now();
  const v = JSON.stringify(await embed(task));
  const s = JSON.stringify(steps || []).slice(0, 4000);
  if (db) db.prepare('INSERT INTO procedures (ts,domain,task,steps,ok,embedding) VALUES (?,?,?,?,?,?)').run(ts, domain || '', task || '', s, ok ? 1 : 0, v);
  else jlAppend({ type: 'procedure', ts, domain, task, steps, ok, embedding: JSON.parse(v) });
}

// A synthesized, durable "domain rule" (reflection-synthesis output).
export async function saveRule(domain, rule) {
  const ts = Date.now();
  const v = JSON.stringify(await embed(rule));
  if (db) db.prepare('INSERT INTO rules (ts,domain,rule,embedding) VALUES (?,?,?,?)').run(ts, domain || '', rule, v);
  else jlAppend({ type: 'rule', ts, domain, rule, embedding: JSON.parse(v) });
}

// rank rows by relevance (cosine) × importance × recency (Generative Agents-style)
function rank(rows, qv, getText, getImp) {
  return rows
    .map((r) => {
      const rel = qv && r._v ? cosine(qv, r._v) : 0;
      const imp = (getImp ? getImp(r) : 5) / 10;
      const rec = recency(r.ts || 0);
      const score = qv ? 0.5 * rel + 0.3 * imp + 0.2 * rec : 0.6 * imp + 0.4 * rec;
      return { r, score };
    })
    .sort((a, b) => b.score - a.score)
    .map((x) => x.r);
}

// Escape LIKE wildcards so a domain/query containing % or _ can't silently match
// unrelated rows (e.g. "a%z.com" matching "amazon.com"). Pairs with ESCAPE '\' below.
export const likeEsc = (s) => `%${String(s || '').replace(/[\\%_]/g, '\\$&')}%`;

export async function getAdvice(domain, query, limit = 5) {
  const qv = query ? await embed(query) : null;
  const d = likeEsc(domain);
  let learnRows, procRows, ruleRows, track;
  if (db) {
    learnRows = db.prepare(`SELECT ts,kind,note,embedding,importance FROM learnings WHERE domain LIKE ? ESCAPE '\\' ORDER BY ts DESC LIMIT 60`).all(d);
    procRows = db.prepare(`SELECT ts,task,steps,embedding FROM procedures WHERE domain LIKE ? ESCAPE '\\' AND ok=1 ORDER BY ts DESC LIMIT 30`).all(d);
    ruleRows = db.prepare(`SELECT ts,rule,embedding FROM rules WHERE domain LIKE ? ESCAPE '\\' ORDER BY ts DESC LIMIT 30`).all(d);
    const o = db.prepare(`SELECT COALESCE(SUM(ok),0) ok, COUNT(*) n FROM episodes WHERE domain LIKE ? ESCAPE '\\'`).get(d);
    track = { runs: o.n, successes: o.ok };
  } else {
    const all = jlRead();
    const md = (r) => String(r.domain || '').includes(domain || '');
    learnRows = all.filter((r) => r.type === 'learning' && md(r)).map((r) => ({ ...r, embedding: JSON.stringify(r.embedding) }));
    procRows = all.filter((r) => r.type === 'procedure' && md(r) && r.ok).map((r) => ({ ...r, steps: JSON.stringify(r.steps), embedding: JSON.stringify(r.embedding) }));
    ruleRows = all.filter((r) => r.type === 'rule' && md(r)).map((r) => ({ ...r, embedding: JSON.stringify(r.embedding) }));
    track = { runs: all.filter((r) => r.type === 'episode' && md(r)).length, successes: all.filter((r) => r.type === 'episode' && md(r) && r.ok).length };
  }
  const attach = (rows) => rows.map((r) => ({ ...r, _v: parseVec(r.embedding) }));
  const learnings = rank(attach(learnRows), qv, (r) => r.note, (r) => r.importance || 5).slice(0, limit).map((r) => ({ kind: r.kind, note: r.note }));
  const procedures = rank(attach(procRows), qv, (r) => r.task).slice(0, 3).map((r) => ({ task: r.task, steps: parseVec(r.steps) }));
  const rules = rank(attach(ruleRows), qv).slice(0, 5).map((r) => r.rule);
  return { domain, rules, learnings, procedures, track, embedMode: (await import('./embed.js')).embedMode() };
}

export async function recall(query, limit = 10) {
  const adv = await getAdvice('', query, limit);
  let episodes;
  if (db) {
    const q = likeEsc(query);
    episodes = db.prepare(`SELECT ts,domain,mode,goal,ok,result FROM episodes WHERE goal LIKE ? ESCAPE '\\' OR result LIKE ? ESCAPE '\\' OR domain LIKE ? ESCAPE '\\' ORDER BY ts DESC LIMIT ?`).all(q, q, q, limit);
  } else {
    const all = jlRead();
    const m = (s) => String(s || '').toLowerCase().includes(String(query).toLowerCase());
    episodes = all.filter((r) => r.type === 'episode' && (m(r.goal) || m(r.result) || m(r.domain))).slice(-limit);
  }
  return { episodes, learnings: adv.learnings, procedures: adv.procedures, rules: adv.rules };
}

// raw lessons for a domain (used by reflection-synthesis)
export function rawLearnings(domain, limit = 40) {
  if (db) return db.prepare(`SELECT note,kind FROM learnings WHERE domain LIKE ? ESCAPE '\\' ORDER BY ts DESC LIMIT ?`).all(likeEsc(domain), limit);
  return jlRead().filter((r) => r.type === 'learning' && String(r.domain || '').includes(domain)).slice(-limit).map((r) => ({ note: r.note, kind: r.kind }));
}

export function stats() {
  if (db) {
    const e = db.prepare('SELECT COUNT(*) c, COALESCE(SUM(ok),0) ok FROM episodes').get();
    const l = db.prepare('SELECT COUNT(*) c FROM learnings').get();
    const p = db.prepare('SELECT COUNT(*) c FROM procedures').get();
    const r = db.prepare('SELECT COUNT(*) c FROM rules').get();
    return { backend: 'sqlite', path: DB_PATH, episodes: e.c, successes: e.ok, learnings: l.c, procedures: p.c, rules: r.c };
  }
  const all = jlRead();
  return { backend: 'jsonl', path: JL_PATH, episodes: all.filter((r) => r.type === 'episode').length, learnings: all.filter((r) => r.type === 'learning').length };
}
