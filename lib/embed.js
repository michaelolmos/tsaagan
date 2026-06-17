// Text embeddings for semantic recall. Tiered so it works with zero dependencies
// by default, but uses real neural embeddings when available:
//   1. TSG_EMBED_URL  — POST {text} → {embedding:[...]} (wire any embedding endpoint
//      or any embeddings service here).
//   2. @xenova/transformers (optional dep) — local MiniLM 384-dim, fully offline.
//   3. fallback — dependency-free feature-hashed bag-of-words with a web-action
//      SYNONYM map (so "log in" ≈ "sign in"), 256-dim. Better than substring LIKE.
// Stored vectors must come from the SAME tier across a DB; don't switch mid-use.

const DIM = 256;
const EMBED_URL = process.env.TSG_EMBED_URL;

// Common web-action paraphrases so the lexical tier still matches synonyms.
const SYN = {
  login: ['log', 'in', 'sign', 'signin', 'logon', 'authenticate'],
  buy: ['purchase', 'checkout', 'order', 'pay', 'payment', 'cart'],
  submit: ['send', 'confirm', 'continue', 'save', 'apply'],
  search: ['find', 'query', 'lookup', 'look'],
  delete: ['remove', 'trash', 'discard', 'clear'],
  download: ['save', 'export'],
  upload: ['attach', 'import', 'file'],
  cancel: ['dismiss', 'close', 'back', 'reject'],
  captcha: ['robot', 'human', 'verify', 'challenge', 'unusual'],
};
function tokens(t) {
  return String(t).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
}
function expand(toks) {
  const out = new Set(toks);
  const joined = toks.join(' ');
  for (const k of Object.keys(SYN)) {
    if (toks.includes(k) || SYN[k].some((s) => joined.includes(s))) {
      out.add(k);
      SYN[k].forEach((s) => out.add(s));
    }
  }
  return [...out];
}
function fnv(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function lexicalVec(text) {
  const v = new Array(DIM).fill(0);
  for (const tk of expand(tokens(text))) v[fnv(tk) % DIM] += 1;
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return v.map((x) => x / n);
}

let neuralMode = null; // 'url' | 'xenova' | null
let xenovaPipe = null;
let xenovaFailed = false;

export async function embed(text) {
  if (EMBED_URL) {
    try {
      const r = await fetch(EMBED_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: String(text) }) });
      const j = await r.json();
      const vec = j.embedding || j.vector || j.data?.[0]?.embedding;
      if (Array.isArray(vec) && vec.length) {
        neuralMode = 'url';
        return vec;
      }
    } catch {}
  }
  if (!xenovaFailed) {
    try {
      if (!xenovaPipe) {
        const { pipeline } = await import('@xenova/transformers');
        xenovaPipe = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
      }
      const out = await xenovaPipe(String(text), { pooling: 'mean', normalize: true });
      neuralMode = 'xenova';
      return Array.from(out.data);
    } catch {
      xenovaFailed = true; // module not installed — stop retrying
    }
  }
  return lexicalVec(text);
}

export function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d ? dot / d : 0;
}

export const embedMode = () => neuralMode || 'lexical';
