import { test } from 'node:test';
import assert from 'node:assert/strict';
import { info, modelFor, hasLLM } from '../lib/llm.js';

// info()/modelFor() read process.env live, so we can drive them by mutating env.
// Save/restore the keys we touch so tests don't leak into each other.
const KEYS = ['GROQ_API_KEY', 'OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'ANTHROPIC_API_KEY', 'XAI_API_KEY', 'GROK_API_KEY', 'TSG_LLM_PROVIDER', 'TSG_LLM_BASE_URL', 'TSG_LLM_API_KEY', 'TSG_NAV_MODEL', 'TSG_PLANNER_MODEL', 'GROQ_NAV_MODEL'];
function clear() { for (const k of KEYS) delete process.env[k]; }

test('Groq is the default provider when GROQ_API_KEY is set', () => {
  clear();
  process.env.GROQ_API_KEY = 'gk_test';
  assert.equal(info().provider, 'groq');
  assert.equal(modelFor('nav'), 'llama-3.3-70b-versatile');
  assert.ok(hasLLM());
  clear();
});

test('OpenRouter is used when it is the only key present', () => {
  clear();
  process.env.OPENROUTER_API_KEY = 'or_test';
  assert.equal(info().provider, 'openrouter');
  assert.equal(info().url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(modelFor('planner'), 'meta-llama/llama-3.3-70b-instruct');
  clear();
});

test('TSG_LLM_PROVIDER=openrouter forces OpenRouter even if GROQ key is set', () => {
  clear();
  process.env.GROQ_API_KEY = 'gk_test';
  process.env.OPENROUTER_API_KEY = 'or_test';
  process.env.TSG_LLM_PROVIDER = 'openrouter';
  assert.equal(info().provider, 'openrouter');
  clear();
});

test('both keys, no explicit provider → Groq (back-compat)', () => {
  clear();
  process.env.GROQ_API_KEY = 'gk_test';
  process.env.OPENROUTER_API_KEY = 'or_test';
  assert.equal(info().provider, 'groq');
  clear();
});

test('TSG_<ROLE>_MODEL overrides the provider default', () => {
  clear();
  process.env.OPENROUTER_API_KEY = 'or_test';
  process.env.TSG_NAV_MODEL = 'qwen/qwen-2.5-72b-instruct';
  assert.equal(modelFor('nav'), 'qwen/qwen-2.5-72b-instruct');
  clear();
});

test('TSG_LLM_BASE_URL selects a custom OpenAI-compatible endpoint', () => {
  clear();
  process.env.TSG_LLM_BASE_URL = 'http://localhost:11434/v1/chat/completions';
  assert.equal(info().provider, 'custom');
  assert.equal(info().url, 'http://localhost:11434/v1/chat/completions');
  clear();
});

test('enterprise providers are first-class when named', () => {
  clear();
  process.env.OPENAI_API_KEY = 'sk_test';
  process.env.TSG_LLM_PROVIDER = 'openai';
  assert.equal(info().provider, 'openai');
  assert.equal(info().url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(modelFor('nav'), 'gpt-4o-mini');

  process.env.TSG_LLM_PROVIDER = 'gemini'; // alias → google
  process.env.GOOGLE_API_KEY = 'g_test';
  assert.equal(info().provider, 'google');
  assert.ok(info().url.includes('generativelanguage.googleapis.com'));

  process.env.TSG_LLM_PROVIDER = 'grok'; // alias → xai
  process.env.XAI_API_KEY = 'xai_test';
  assert.equal(info().provider, 'xai');
  clear();
});

test('an enterprise key alone does NOT auto-activate (must be named)', () => {
  clear();
  process.env.OPENAI_API_KEY = 'sk_test'; // present, but no TSG_LLM_PROVIDER, no groq/openrouter
  assert.equal(info().provider, 'none'); // won't silently hijack the brain
  assert.equal(hasLLM(), false);
  clear();
});

test('hasLLM is false with no keys', () => {
  clear();
  assert.equal(hasLLM(), false);
});
