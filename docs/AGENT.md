# Agent layer — Kestrel as a thinking agent

Kestrel's core is a **tool** (the brain that drives it lives elsewhere). The agent
layer adds the pieces that make it a coherent, self-improving agent — identity,
doctrine, a heartbeat, and an evolving memory — without compromising the clean tool.

## Identity & doctrine files

- **[SOUL.md](../SOUL.md)** — what Kestrel is and why it exists (the intent), plus its
  operating principles. Load this to know its values.
- **[AGENTS.md](../AGENTS.md)** — how any model should drive it: the loop, which layer
  to pick (API → real-browser → CDP), grounding priority, and the safety doctrine.
- **[HEARTBEAT.md](../HEARTBEAT.md)** — how it runs autonomously on a cadence (opt-in).

These are plain Markdown so any harness (Claude Code, Codex, Cursor) can load them as
context — `AGENTS.md` in particular is an emerging cross-tool standard.

## Memory — how it's stored

Kestrel keeps **two complementary stores**, both local and inspectable:

| Store | Where | What | Format |
|---|---|---|---|
| **Site memory** | `~/.kestrel/memory/<domain>.json` | learned selectors, notes, per-domain `pace` | JSON (human-editable) |
| **The brain** | `~/.kestrel/brain.db` | episodic task history + learnings (for recall/evolution) | **SQLite** (built-in `node:sqlite`; falls back to `brain.jsonl`) |

So: memory is **contained in Kestrel on your machine** — not inside a model, not in
the cloud. Site selectors are flat JSON you can edit by hand; the longer-term
"how have I done things, what have I learned" lives in a SQLite brain that supports
real queries (and, later, embeddings for semantic recall).

```bash
kestrel brain                       # stats (backend, episodes, learnings)
kestrel brain recall query="login"  # past runs + learnings matching a query
```

## The learning loop (it learns from mistakes, and feeds it back)

This is a **closed** loop, not just storage — three parts:

1. **Capture** — every autonomous run is recorded as an episode (goal, mode, ok,
   steps, result); successful actions with durable selectors are auto-remembered.
2. **Reflect** — at the end of a run Kestrel turns the outcome into reusable knowledge:
   - **success** → the proven step-sequence is stored as a **procedure** ("how I did
     this task on this site") + a success note.
   - **failure** → a one-line **LLM reflection** ("what went wrong + what to try")
     is stored as a `failure` lesson.
   - **anti-abuse / CAPTCHA** → a lesson + the domain flips to `pace: human`.
3. **Feed back** — and this is the part that makes it *learning*: the lessons are
   surfaced **before the next action**:
   - **every `snapshot` carries a `memory` block** for the current domain (pace,
     prior lessons, known-procedure count, success track) — so the driving agent
     (Claude, Codex, or any LLM) adapts this observe→act cycle automatically.
   - the autonomous navigator injects that memory into its prompt each step.
   - explicit pull: `kestrel advise` (daemon) / `kestrel brain advise domain=…`.

So the lessons don't just sit in a database — they **change the next attempt**, and
they flow back to whatever brain is driving Kestrel.

### Retrieval, synthesis & look-ahead (research-grade)

- **Relevance ranking, not substring match.** Recall ranks memories by
  **relevance (embedding cosine) × importance × recency** (Generative Agents-style),
  so "how do I log in" surfaces a "click the Sign in button" lesson. Embeddings are
  zero-dependency by default (synonym-aware lexical), and upgrade to real neural
  vectors if `KES_EMBED_URL` (any embedding endpoint, e.g. a local sentence-transformer) or `@xenova/transformers`
  is available. Importance is weighted (anti-abuse/CAPTCHA > one-off notes).
- **Reflection-synthesis.** When lessons accumulate, Kestrel compresses them into a
  few durable **domain rules** (`kestrel brain synthesize domain=…`, also automatic
  after failures). Those rules are what `snapshot.memory.rules` surfaces — signal, not noise.
- **Look-ahead before irreversible actions.** Before a submit/buy/pay/delete/send, the
  autonomous loop *imagines the outcome* (WebDreamer-style) and skips it if it looks
  wrong — pairs with the human-confirm safety doctrine.
- **Evaluator gate.** A run only stores a reusable *procedure* when the validator AND
  structural verification confirm success — so false positives never poison the skill memory.

This is the same shape capable agents use (flat memory for fast facts + a SQL brain
for evolution), scoped to the browser.

## Brain provider

The autonomous tiers (`run` / `serve` / `bench`) call an LLM through one provider-
agnostic, OpenAI-compatible client (`lib/llm.js`). Pick whichever you like:

Every option speaks the OpenAI `/chat/completions` format. Enterprise models with a
non-OpenAI native API (Anthropic, Gemini) are reached through each vendor's
**OpenAI-compatible endpoint**, so they work with no extra code.

| Provider | `KES_LLM_PROVIDER` | Key | Default model |
|---|---|---|---|
| **Groq** (fast, default) | `groq` | `GROQ_API_KEY` | `openai/gpt-oss-120b`, `llama-3.3-70b-versatile` (nav) |
| **OpenRouter** (open-source + a gateway to every model) | `openrouter` | `OPENROUTER_API_KEY` | `meta-llama/llama-3.3-70b-instruct` |
| **OpenAI** | `openai` | `OPENAI_API_KEY` | `gpt-4o`, `gpt-4o-mini` (nav) |
| **Google Gemini** | `google` / `gemini` | `GEMINI_API_KEY` or `GOOGLE_API_KEY` | `gemini-flash-latest` |
| **Anthropic Claude** | `anthropic` | `ANTHROPIC_API_KEY` | `claude-3-5-sonnet-latest`, `claude-3-5-haiku-latest` (nav) |
| **xAI Grok** | `xai` / `grok` | `XAI_API_KEY` or `GROK_API_KEY` | `grok-2-latest` |
| **Custom** (Together / vLLM / Ollama / LM Studio) | — | `KES_LLM_BASE_URL` (+ `KES_LLM_API_KEY`) | set `KES_*_MODEL` |

- **Auto-select** (no `KES_LLM_PROVIDER`) is limited to Groq/OpenRouter so a stray
  enterprise key in your environment never silently changes which brain runs — to use
  OpenAI/Google/Anthropic/xAI, **name it** with `KES_LLM_PROVIDER`. When both Groq and
  OpenRouter keys exist, Groq wins (back-compat).
- Per-role overrides (any provider): `KES_PLANNER_MODEL`, `KES_NAV_MODEL`,
  `KES_VALIDATOR_MODEL`. Legacy `GROQ_*_MODEL` names still honored. E.g. via OpenRouter
  point the planner at `anthropic/claude-3.7-sonnet` or `deepseek/deepseek-chat`.
- Output is parsed leniently (handles ```json fences / providers that ignore
  `response_format`).
- Your Anthropic/Claude key is used **only** if you explicitly select `anthropic`.

## Tool vs agent — use either

You can use Kestrel purely as a tool (drive the verbs yourself) and ignore this layer
entirely. Or lean on the agent layer for autonomy + memory. The core stays the same.
