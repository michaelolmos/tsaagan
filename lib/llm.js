// Unified LLM client for Tsaagan's autonomous brain (planner / navigator /
// validator / reflection). Provider-agnostic over any OpenAI-compatible chat API.
//
// Pick a provider with TSG_LLM_PROVIDER (or just supply one provider's key):
//   groq        GROQ_API_KEY                      fast, cheap (default)
//   openrouter  OPENROUTER_API_KEY                open-source models (Llama/Qwen/DeepSeek/…)
//                                                 + a gateway to every enterprise model
//   openai      OPENAI_API_KEY                    GPT-4o / o-series (native)
//   google      GEMINI_API_KEY | GOOGLE_API_KEY   Gemini (via Google's OpenAI-compat endpoint)
//   anthropic   ANTHROPIC_API_KEY                 Claude (via Anthropic's OpenAI-compat endpoint)
//   xai         XAI_API_KEY | GROK_API_KEY        Grok (native OpenAI-compatible)
//   custom      TSG_LLM_BASE_URL (+ TSG_LLM_API_KEY)  Together / vLLM / Ollama / LM Studio / …
//
// Every option speaks the OpenAI /chat/completions format. Enterprise models with a
// non-OpenAI native API (Anthropic /v1/messages, Gemini generateContent) are reached
// through each vendor's OpenAI-compatible endpoint, or through OpenRouter.
//
// Model per role resolves: TSG_<ROLE>_MODEL → GROQ_<ROLE>_MODEL (back-compat) → the
// provider default. Roles: planner | nav | validator.
//
// The user's Anthropic/Claude key is never used unless they explicitly select the
// anthropic provider — when Claude drives the verbs directly (the skill), no
// autonomous LLM is involved at all.

const PROVIDERS = {
  groq: {
    url: 'https://api.groq.com/openai/v1/chat/completions',
    keys: ['GROQ_API_KEY'],
    headers: {},
    models: { planner: 'openai/gpt-oss-120b', nav: 'llama-3.3-70b-versatile', validator: 'openai/gpt-oss-120b' },
  },
  openrouter: {
    url: 'https://openrouter.ai/api/v1/chat/completions',
    keys: ['OPENROUTER_API_KEY'],
    headers: { 'HTTP-Referer': 'https://github.com/michaelolmos/tsaagan', 'X-Title': 'Tsaagan' },
    // Open-source default; for enterprise models pick a slug like anthropic/claude-3.7-sonnet,
    // openai/gpt-4o, google/gemini-2.0-flash via TSG_*_MODEL.
    models: { planner: 'meta-llama/llama-3.3-70b-instruct', nav: 'meta-llama/llama-3.3-70b-instruct', validator: 'meta-llama/llama-3.3-70b-instruct' },
  },
  openai: {
    url: 'https://api.openai.com/v1/chat/completions',
    keys: ['OPENAI_API_KEY'],
    headers: {},
    models: { planner: 'gpt-4o', nav: 'gpt-4o-mini', validator: 'gpt-4o' },
  },
  google: {
    // Gemini via Google's OpenAI-compatible endpoint.
    url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    keys: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
    headers: {},
    // "-latest" aliases track the current model so the default never goes stale.
    models: { planner: 'gemini-flash-latest', nav: 'gemini-flash-latest', validator: 'gemini-flash-latest' },
  },
  anthropic: {
    // Claude via Anthropic's OpenAI-compatible endpoint (accepts Authorization: Bearer).
    url: 'https://api.anthropic.com/v1/chat/completions',
    keys: ['ANTHROPIC_API_KEY'],
    headers: {},
    models: { planner: 'claude-3-5-sonnet-latest', nav: 'claude-3-5-haiku-latest', validator: 'claude-3-5-sonnet-latest' },
  },
  xai: {
    url: 'https://api.x.ai/v1/chat/completions',
    keys: ['XAI_API_KEY', 'GROK_API_KEY'],
    headers: {},
    models: { planner: 'grok-2-latest', nav: 'grok-2-latest', validator: 'grok-2-latest' },
  },
};
const ALIAS = { gemini: 'google', grok: 'xai' };
const firstKey = (names) => { for (const n of names) if (process.env[n]) return process.env[n]; return ''; };

// Resolve which provider/endpoint/key to use, from the environment.
export function info() {
  if (process.env.TSG_LLM_BASE_URL) {
    return {
      provider: 'custom',
      url: process.env.TSG_LLM_BASE_URL,
      key: process.env.TSG_LLM_API_KEY || process.env.OPENROUTER_API_KEY || process.env.GROQ_API_KEY || '',
      headers: {},
      models: PROVIDERS.openrouter.models,
    };
  }
  let name = (process.env.TSG_LLM_PROVIDER || '').toLowerCase();
  name = ALIAS[name] || name;
  if (name && PROVIDERS[name]) {
    const p = PROVIDERS[name];
    return { provider: name, url: p.url, key: firstKey(p.keys) || process.env.TSG_LLM_API_KEY || '', headers: p.headers, models: p.models };
  }
  // Auto (no explicit provider): limit to groq/openrouter so a stray enterprise key
  // in the environment never silently changes which brain runs. To use OpenAI /
  // Google / Anthropic / xAI, name it via TSG_LLM_PROVIDER.
  const mk = (n) => ({ provider: n, url: PROVIDERS[n].url, key: firstKey(PROVIDERS[n].keys), headers: PROVIDERS[n].headers, models: PROVIDERS[n].models });
  if (process.env.OPENROUTER_API_KEY && !process.env.GROQ_API_KEY) return mk('openrouter');
  if (process.env.GROQ_API_KEY) return mk('groq');
  if (process.env.OPENROUTER_API_KEY) return mk('openrouter');
  return { provider: 'none', url: null, key: '', headers: {}, models: PROVIDERS.groq.models };
}

// True when a usable brain is configured (a key, or a keyless custom endpoint like Ollama).
export const hasLLM = () => { const r = info(); return r.provider === 'custom' || !!r.key; };

// Model for a role, honoring overrides then the provider default.
export function modelFor(role) {
  const R = role.toUpperCase();
  const r = info();
  return process.env[`TSG_${R}_MODEL`] || process.env[`GROQ_${R}_MODEL`] || (r.models || PROVIDERS.openrouter.models)[role];
}

// Parse JSON leniently — some OpenAI-compatible providers wrap output in ```json
// fences or ignore response_format, so strict JSON.parse alone is brittle.
function parseJSON(text) {
  try { return JSON.parse(text); } catch {}
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) { try { return JSON.parse(fenced[1].trim()); } catch {} }
  const i = text.indexOf('{'), j = text.lastIndexOf('}');
  if (i >= 0 && j > i) { try { return JSON.parse(text.slice(i, j + 1)); } catch {} }
  throw new Error('could not parse JSON from model output: ' + String(text).slice(0, 160));
}

// One OpenAI-compatible chat completion. Returns parsed JSON (json:true, default)
// or the raw string. Throws a clear, provider-named error on failure.
export async function chat(model, messages, { json = true, temperature = 0.2 } = {}) {
  const p = info();
  if (!p.key && p.provider !== 'custom') {
    throw new Error('no LLM API key — set GROQ_API_KEY / OPENROUTER_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY / ANTHROPIC_API_KEY / XAI_API_KEY (and TSG_LLM_PROVIDER for the enterprise ones), or TSG_LLM_BASE_URL for a custom endpoint.');
  }
  const res = await fetch(p.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(p.key ? { authorization: `Bearer ${p.key}` } : {}), ...p.headers },
    body: JSON.stringify({ model, messages, temperature, ...(json ? { response_format: { type: 'json_object' } } : {}) }),
  });
  const j = await res.json();
  if (!j.choices?.[0]) throw new Error(`${p.provider} ${model}: ${JSON.stringify(j).slice(0, 300)}`);
  const content = j.choices[0].message.content;
  return json ? parseJSON(content) : content;
}
