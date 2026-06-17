<p align="center">
  <img src="docs/hero.png" alt="Kestrel — human-like browser control for AI agents" width="100%">
</p>

<p align="center">
  <em>Created by Michael Olmos · MIT licensed</em><br><br>
  <img alt="license: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg">
  <img alt="node 20+" src="https://img.shields.io/badge/node-20%2B-3c873a.svg">
  <img alt="MCP server" src="https://img.shields.io/badge/MCP-server-8b5cf6.svg">
  <img alt="engine: Playwright + native" src="https://img.shields.io/badge/engine-Playwright%20%2B%20native-b5532a.svg">
  <img alt="platforms" src="https://img.shields.io/badge/macOS%20%C2%B7%20Linux%20%C2%B7%20Windows-lightgrey.svg">
</p>

# 🦅 Kestrel

> **Kestrel gives your AI agent real hands on the web** — so it can finish the
> browser work you'd otherwise stop and do yourself (log in, click through, fill
> forms, pull data from behind a login), **on the tasks you're authorized to do.**
> (Full [mission](#mission) below.)

**Human-like browser control for AI agents.** Kestrel lets an AI drive a real
browser the way a person does — perceive the page, click, type, navigate, handle
logins, popups, iframes, downloads — and, crucially, **verify that each action
actually worked** before moving on.

> **The mental model: your agent is the brain, Kestrel is the hands.** Whatever AI
> drives it (Claude, a Codex/ChatGPT CLI, Cursor, or any model) supplies intent and
> judgment; Kestrel supplies reliable **perception → action → verification → memory**.
> The agent decides *what*; Kestrel reliably does *how*, and proves it worked.

![Kestrel performing a verified multi-step task](docs/demo.gif)

## Mission

**Kestrel gives your AI agent real hands on the web.** It lets an agent autonomously
do the browser work that today still makes you stop and take over — logging in,
clicking through, filling forms, pulling data from behind a login — and gives that
time back to you.

*One-liner:* Kestrel is the part of your agentic workflow that actually drives the
browser — reliably, like a human, **on the tasks you're authorized to do.**

### The mental model — Kestrel is the hands; your agent is the brain

You can *think* with an agent, *write* with an agent, *code* with an agent — but the
moment the work needs a **browser** ("log in here, click through there, grab this,
submit that"), the agent stalls and *you* become the hands. Kestrel closes that gap.
The brain (Claude, Codex, a small open model, or a person) supplies intent and
judgment; Kestrel supplies reliable **perception → action → verification → memory.**

Three ideas make it click:

1. **It hovers, then strikes.** Like the bird — patient perception, then one exact
   move. It reads the page's accessibility tree, picks the right element, acts, and
   then *proves the action worked* from real page state (URL changed? expected text?
   errors?) instead of clicking and hoping. That verify step is the difference between
   "automation that mostly works" and automation you can trust unattended.
2. **Lightest tool that does the job.** If a site has an API, use the API. If not,
   drive the real browser like a human (trusted input). Only fall back to raw
   automation for the broad middle of the web.
3. **It remembers and improves.** It keeps an inspectable, file-based memory of the
   sites it works — learned selectors, what went wrong last time — so it gets better
   at *your* recurring tasks.

### What it does for the user

- Turns *"every week I log into X, click through, and copy Y"* into *"my agent does it
  and reports back what it verified."*
- Works on **real, logged-in sites** — dashboards, portals, tools with no API — where
  a scraper or `WebFetch` can't go.
- **Keeps you in control:** it stops and hands back at CAPTCHAs, and flags
  consequential, irreversible actions (buy, send, delete). Empowerment, not
  autopilot-into-a-wall.

### What Kestrel deliberately is **not**

Kestrel is **not** a tool for defeating security, solving CAPTCHAs, evading bans, or
doing anything against a site's Terms of Service. It is for builders and creators who
want their agents to **finish the job on work they're already authorized to do** — and
it's honest about its limits rather than overselling. Only automate accounts and
systems **you own or are authorized to access.** When it meets a CAPTCHA or an
anti-abuse wall, it **stops and hands control back to you.** See the
[Acceptable Use Policy](ACCEPTABLE_USE.md) and the
[disclaimer](#responsible-use--disclaimer) — **you are solely responsible for how you
use it.**

## Philosophy — why I built Kestrel

I kept hitting the same wall in my own agentic workflows: you can *reason*, *write*,
and *code* with an agent — but the moment a task needs a **browser** (log in, click
through, pull this, file that), the agent stalls and a human has to take over. That
handoff is where the time goes.

**Kestrel exists to give your AI agents real hands** — so they can autonomously do
that web work and give the time back to you. It's for **builders and creators who want
their agents to actually finish the job**, not just plan it.

And it's built on a clear ethic: **empowerment, not abuse.** Kestrel deliberately does
**not** defeat CAPTCHAs, asks for **human confirmation on consequential actions**,
stores secrets only in your **OS keychain**, keeps everything **local**, and **respects
site Terms of Service**. It exists to extend what *you* can build — not to create risk.
That ethic is encoded in [SOUL.md](SOUL.md) and enforced in [AGENTS.md](AGENTS.md).

> **Use it on tasks you're authorized to do.** Kestrel is for automating *your own*
> accounts and authorized work — not for unauthorized access or circumventing
> security. Please read the [Acceptable Use Policy](ACCEPTABLE_USE.md) and the
> [disclaimer](#responsible-use--disclaimer).

*— Michael Olmos, creator*

## Capability layers — use the lightest one that does the job

![Kestrel capability layers](docs/layers.svg)

1. **API layer** — if a site has an official API, Kestrel calls it directly with a
   key kept in your **Keychain** (fastest and most reliable). The browser layers
   can even set the key up for you. → [docs/API.md](docs/API.md)
2. **Real-browser layer** — `extension` (any OS) / `native` (macOS): drives your real
   Chrome with **trusted input, no debug port** — for sites that ignore synthetic
   input. → [docs/EXTENSION.md](docs/EXTENSION.md)
3. **CDP layer** — Playwright on the real Chrome binary for the broad middle of the web.

Plus an **agent layer** (identity + brain memory) that makes Kestrel a self-improving
agent, not just a tool. → [docs/AGENT.md](docs/AGENT.md)

## Memory that learns (a real loop, not just storage)

![Kestrel's learning loop](docs/learning-loop.svg)

Kestrel doesn't just remember — it **learns from each run and feeds the lesson back**:

- **Reflect:** a successful run is stored as a reusable **procedure**; a failure becomes
  a one-line **lesson** (via an LLM reflection); an anti-abuse wall flips the domain to
  `pace: human`. Accumulated lessons are **synthesized into durable rules**.
- **Feed back:** **every `snapshot` carries a `memory` block** (rules, lessons, pace,
  success track) — so the driving agent (Claude, Codex, or any LLM) adapts *before* it acts.
- **Research-grade recall:** ranked by **relevance (embeddings) × importance × recency**,
  not substring match. Zero-dependency by default; real neural embeddings if
  `KES_EMBED_URL` or `@xenova/transformers` is present.
- **Look-ahead + evaluator gate:** it *imagines the outcome* before irreversible actions,
  and only stores a procedure when success is validator- and structurally-verified.

Memory lives on your machine (`~/.kestrel/brain.db`) — not in a model, not in the cloud.
→ [docs/AGENT.md](docs/AGENT.md)

---

Most browser-agent stacks fail for the same two reasons: they ground actions on
*ephemeral element ids* that break the moment the page changes, and they *trust
the model's guess* that an action succeeded. Kestrel fixes both:

- **Stable, self-healing grounding.** Elements are addressed by accessibility-tree
  refs; if a ref goes stale, Kestrel re-snapshots and re-locates the same element
  by role + name automatically.
- **Structural verification.** After every action Kestrel returns a `verify`
  block built from real page state — URL delta, expected text, new console
  errors, failed network requests — so the agent *knows* whether it worked.

It's three things in one:

1. A **CLI + daemon** you (or a coding agent) drive verb-by-verb.
2. A **library** (`agent.js`) with an autonomous planner→navigator→validator loop.
3. A **standalone server** you hand goals to over HTTP — no agent framework required.

---

## Why Kestrel

| | Kestrel |
|---|---|
| Perception | Accessibility tree (primary) + **vision Set-of-Marks** fallback for canvas/visual UIs |
| Grounding | Stable refs → **self-heal** on staleness. Never raw coordinates, never brittle XPath as primary |
| Verification | **Structural post-conditions every action** (URL / text / console / network) |
| Hard cases | iframes, shadow DOM, popups, cookie banners, file upload/download, multi-tab |
| Memory | **Learns each site** — durable selectors persisted per domain, replayed across sessions |
| Auth | Cloned/real Chrome profile, one-shot `login`, TOTP 2FA (RFC 6238) |
| Trusted input | `isTrusted=true` clicks/keystrokes via native (macOS) / extension modes — for sites that ignore synthetic input |
| Autonomy | Planner → navigator → **validator** loop; runs headless or as an HTTP goal server |

---

## How Kestrel compares

The browser-agent space is crowded — and Kestrel is the new, small project here. It
doesn't try to out-scale [browser-use](https://github.com/browser-use/browser-use) or
out-distribute Microsoft's [playwright-mcp](https://github.com/microsoft/playwright-mcp).
It wins on a different axis: **reliability you can audit.** The one capability every
other tool lacks — structural proof that each action worked — is Kestrel's core.

| Capability | Kestrel | browser-use | stagehand | playwright-mcp | skyvern |
|---|:---:|:---:|:---:|:---:|:---:|
| **Verify-first** (post-condition proof per action) | ✅ core | ❌ | ❌ | ❌ | ⚠️ vision |
| **API-first layer** (skip the browser when a site has an API) | ✅ | ❌ | ❌ | ❌ | ❌ |
| Self-healing stable a11y refs | ✅ | ⚠️ | ⚠️ | ⚠️ | ❌ |
| OS-keychain vault + TOTP/2FA | ✅ | ❌ | ❌ | ❌ | ⚠️ cloud |
| Cross-session site memory (semantic recall) | ✅ | ❌ | ⚠️ | ❌ | ❌ |
| MCP server | ✅ | ❌ | ✅ | ✅ | ❌ |
| Trusted input, no CDP debug port (native + MV3) | ✅ | ❌ | ❌ | ❌ | ❌ |
| Vision fallback (Set-of-Marks) | ✅ | ✅ | ✅ | ❌ | ✅ |
| Local / offline capable | ✅ | ✅ | ❌ | ✅ | ❌ |
| Model-agnostic (bring your own LLM) | ✅ | ✅ | ✅ | ✅ | ⚠️ |
| Language | Node.js | Python | TypeScript | TypeScript | Python |
| License | MIT | MIT | MIT | Apache-2.0 | AGPL-3.0 |
| Published WebVoyager score | ⚠️ in progress | ✅ ~89% | ⚠️ | ❌ | ✅ ~86% |
| GitHub stars (Jun 2026) | early | ~99k | ~23k | ~34k | ~22k |
| Cloud / hosted option | ❌ self-host | ⚠️ | ❌ Browserbase | ❌ | ✅ |

✅ supported · ⚠️ partial/workaround · ❌ not supported

> **Honest notes.** Kestrel is young — fewer stars, no Python client yet, no hosted
> option, and its benchmark number is still being run (published scores across tools
> use different WebVoyager task subsets and aren't directly comparable). What it
> uniquely offers: proof-of-success on every action, an API-first fast path, a local
> credential vault, and trusted-input modes that need no debug port.

---

## How it works — tool, skill, or agent?

![Kestrel architecture](docs/architecture.svg)

Kestrel is **one engine you can drive several ways**:

- **The tool** — a CLI (`kestrel.js`) talking to a background **daemon** that holds a
  single persistent Playwright page. This is the engine; everything else wraps it.
- **As a skill** — a short instruction file that teaches your AI *how* to drive the
  tool (the observe → act → verify loop). "Use the Kestrel skill" → the AI reads it
  and drives Kestrel step by step. (A ready-made skill for Claude Code is included.)
- **As an agent** — a dispatchable worker that bundles the skill + the tool, so you
  can hand it a goal and it runs the loop on its own.
- **As an MCP server or SDK** — `kestrel mcp` exposes the verify-first verbs to Claude
  Desktop / Claude Code / Cursor, and the **JS + Python SDKs** call the same daemon
  directly. (See [Use it from Claude/Cursor (MCP)](#use-it-from-claude-desktop-claude-code-or-cursor-mcp)
  and [Use it from your own code](#use-it-from-your-own-code-js--python-sdk) above.)

**Who is the "brain"?** Whatever drives it:

| You drive it with… | Brain | API key needed |
|---|---|---|
| Claude Code (the skill/agent) | your Claude session | none — your Claude plan |
| Codex / ChatGPT CLI, Cursor, etc. | that tool's model | that tool's |
| `kestrel run` / `kestrel serve` (autonomous) | **any** OpenAI-compatible LLM — Groq · OpenRouter · OpenAI · Google Gemini · Anthropic · xAI Grok · local | a key for your chosen provider |

Kestrel itself makes **no LLM calls** when an agent drives it — it's pure
perception + action + verification. Only the autonomous tiers call an LLM, and that
LLM is **your choice**: Groq (default, fast), **OpenRouter** for open-source models
(Llama, Qwen, DeepSeek, Mistral), the enterprise vendors — **OpenAI, Google Gemini,
Anthropic, xAI Grok** (each via its OpenAI-compatible endpoint) — or any
OpenAI-compatible endpoint (Together, vLLM, **Ollama** for fully local) via
`KES_LLM_BASE_URL`. Pick one with `KES_LLM_PROVIDER=groq|openrouter|openai|google|anthropic|xai`.
See [docs/AGENT.md](docs/AGENT.md#brain-provider).

## Use it with any coding agent

Kestrel is just a terminal program, so any agent that can run shell commands can
drive it. Tell your agent something like:

> "Use Kestrel (`node kestrel.js`) to log into example.com and download my invoices.
> Snapshot, act on refs, and check the `verify` block after each step."

It will run `kestrel start`, `kestrel snapshot`, `kestrel click ref=…`, read the
JSON results, and proceed. For Claude Code, the bundled skill/agent make this
automatic.

---

## Install

```bash
git clone https://github.com/michaelolmos/kestrel.git && cd kestrel
npm install
npx playwright install chromium chromium-headless-shell
```

## Quick start (drive it yourself)

```bash
node kestrel.js start                    # launch browser (fresh isolated profile)
node kestrel.js goto url=https://example.com expectText="Example"
node kestrel.js snapshot                 # accessibility tree with [ref=eN]
node kestrel.js click ref=e6 expectText="IANA"
node kestrel.js type ref=e3 text="hello" submit=true
node kestrel.js stop
```

Add an alias: `alias kestrel="node $PWD/kestrel.js"`.

## Use it from Claude Desktop, Claude Code, or Cursor (MCP)

Kestrel ships a built-in **MCP server**, so any [Model Context Protocol](https://modelcontextprotocol.io)
host can drive the browser directly. Unlike other browser MCP servers, **every mutating
tool returns Kestrel's `verify` block** (URL changed? console errors? expected text?) —
proof the action worked, in the same response, with no extra snapshot round-trip.

**Claude Code:**

```bash
claude mcp add kestrel -- node /path/to/kestrel/kestrel.js mcp
# or, if you've installed the `kestrel` bin globally:  claude mcp add kestrel -- kestrel mcp
```

**Claude Desktop** (`claude_desktop_config.json`) or **Cursor** (`~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "kestrel": { "command": "node", "args": ["/path/to/kestrel/kestrel.js", "mcp"] }
  }
}
```

The server **auto-starts a headless daemon** on first use. It exposes 21 verify-first
tools — `kestrel_navigate`, `kestrel_snapshot`, `kestrel_click`, `kestrel_fill_form`,
`kestrel_extract`, `kestrel_network` (discover a site's own data API), and more.
Set `KESTREL_HEADLESS=0` to watch it work, or `KES_TOKEN` to lock the control plane on
shared machines. See [docs/PROTOCOL.md](docs/PROTOCOL.md).

## Use it from your own code (JS & Python SDK)

Prefer calling Kestrel programmatically? Both clients return a `verify` block on
**every** call — data *and* proof, together (the thing other tools make you assert yourself).

**JavaScript / TypeScript** (`sdk/`, zero dependencies):

```js
import { createKestrel } from 'kestrel/sdk';   // or '/path/to/kestrel/sdk/index.mjs'

const k = await createKestrel();                // auto-starts a headless daemon
await k.goto('https://example.com', { expectText: 'Example Domain' });
const r = await k.extract('the page heading');
console.log(r.data, r.verify);                  // data + { urlChanged, expectTextFound, newConsoleErrors, ... }
await k.stop();
```

**Python** (`pip install kestrel-browser`, zero dependencies):

```python
from kestrel_browser import Kestrel

k = Kestrel()                                   # auto-starts a headless daemon
k.goto("https://example.com", expect_text="Example Domain")
r = k.extract("the page heading")
print(r.data, r.verify)
k.stop()
```

The Python client needs the Node daemon reachable — set `KESTREL_JS=/path/to/kestrel.js`
or put the `kestrel` binary on PATH. See [clients/python/](clients/python/).

## Autonomous mode

```bash
export GROQ_API_KEY=...                   # the autonomous brain (fast default)

# …or any other provider — name it and supply that provider's key:
export OPENROUTER_API_KEY=...   KES_LLM_PROVIDER=openrouter   # open-source models
export OPENAI_API_KEY=...       KES_LLM_PROVIDER=openai       # GPT-4o / o-series
export GEMINI_API_KEY=...       KES_LLM_PROVIDER=google       # Gemini
export ANTHROPIC_API_KEY=...    KES_LLM_PROVIDER=anthropic    # Claude
export XAI_API_KEY=...          KES_LLM_PROVIDER=xai          # Grok
export KES_LLM_BASE_URL=http://localhost:11434/v1/chat/completions  # Ollama, fully local

node kestrel.js run goal="go to news.ycombinator.com and report the #1 story title"
node kestrel.js journal                   # what it has done before (persistent memory)
```

Per-role model overrides work with any provider: `KES_PLANNER_MODEL`,
`KES_NAV_MODEL`, `KES_VALIDATOR_MODEL` (e.g. point the planner at a stronger model
for reasoning while a fast model handles navigation).

## Standalone server (no agent framework)

```bash
node kestrel.js serve port=39820
curl -s localhost:39820/goal -d '{"goal":"...","max":16}'
```

## Benchmark

```bash
node kestrel.js bench          # autonomous task suite + deterministic capability matrix
```

Latest run (Groq brain, 4-task suite):

| Metric | Result |
|---|---|
| Task success | 3/4 (75%) |
| **Self-heal** (recover from stale refs) | ✅ pass |
| **Vision Set-of-Marks** | ✅ pass |
| **Structural verify** (post-conditions) | ✅ pass |

A directly-comparable WebVoyager score is in progress — see
[bench/METHODOLOGY.md](bench/METHODOLOGY.md) for exactly how it will be run and
reported honestly (homepage-start, no post-hoc judge overrides, published task set).

---

## Command reference

| Command | Description |
|---|---|
| `start [mode=fresh\|clone\|live] [headless=true] [port=]` | launch / attach a browser |
| `status` · `stop` | state · shut down |
| `snapshot [full=true]` · `snapshot mode=vision` | a11y tree with refs · numbered visual overlay |
| `goto url=.. [expectText=..]` | navigate + verify |
| `click ref=eN\|som=N\|selector=..\|text=.. [key=..] [expectText=..] [expectGone=..] [expectUrl=..]` | click + verify + self-heal |
| `type ref=eN text=".." [key=..] [submit=true] [expectText=..]` | clear + type |
| `select` · `press keys=".." [expectText=..]` · `scroll [direction=\|to_text=]` · `wait_for [..]` | interaction |
| `upload_file ref=\|selector= path=a,b` · `handle_dialog accept=true` · `dismiss_overlays` · `downloads` | hard cases |
| `extract [query=..]` · `screenshot [path=] [fullPage=true]` | read page |
| `tabs` · `switch_tab index=N` · `new_tab url=..` · `close_tab` · `back` · `forward` | tabs / history |
| `remember key=.. selector=.. [note=..]` · `recall` · `forget` | learn a site (per-domain memory) |
| `login userSelector=.. passSelector=.. [submitSelector=..] [totpSelector=.. totpSecret=..]` | one-shot login + 2FA |
| `totp secret=$KES_TOTP_SECRET` · `detect_captcha` | 2FA code · detect a CAPTCHA/anti-abuse wall → hand off to a human |
| `paste text=".." [ref=\|selector=] [submit=true]` · `type_human` · `key_human keys="return"` | **OS-level input (macOS)** — trusted (`isTrusted=true`) keystrokes/paste for sites that ignore synthetic input |
| `pace set=human\|slow\|fast` · `click_xy x= y=` · `keychain service= account=` | cadence governor · coordinate click · macOS Keychain secret |
| `record_start name=..` · `record_stop [path=..]` · `replay path=..` · `report [format=json\|md]` | record/replay verified sequences · export audit reports |
| `doctor` · `protocol` | local diagnostics · JSON Schema / TypeScript action protocol paths |
| `run goal=".." [max=16]` · `serve [port=]` · `journal [n=]` · `bench` | autonomy |
| `network [filter=] [limit=]` | captured XHR/fetch + responses (discover a site's internal API) |
| `cookies [set=<json>]` | export / import cookies (session reuse) |
| `pdf [path=]` · `assert [text=] [url=] [selectorVisible=]` | save page PDF · explicit verification check |
| `eval js=".."` · `console_log [limit=]` | escape hatch · debugging |

Start flags also include `proxy=http://user:pass@host:port` (e.g. a corporate proxy), `channel=chrome\|chromium`, `pace=fast\|slow\|human` (politeness), `timezone=`.

### Layer & agent commands

| Command | Description |
|---|---|
| `vault set service=.. secret=.. [account=..]` · `vault get/list/delete` | Keychain-encrypted key store (secrets never hit disk) |
| `api service=.. path=/.. [method=] [body=]` · `api detect=<url>` · `api providers` | call an official API with a stored key (Layer 1) |
| `ext-setup [profile=fresh\|clone] [browser=chrome]` | **zero-step extension mode**: launches Chrome for Testing with the companion extension auto-loaded + starts `mode=extension`. (`browser=chrome` targets your branded Chrome instead — needs a one-time manual load, since Chrome 137+ blocks `--load-extension`.) |
| `brain` · `brain recall query=..` · `brain advise domain=..` · `brain synthesize domain=..` | evolving SQLite memory: stats · semantic recall · what-it-knows · compress lessons→rules |
| `advise [domain=..] [query=..]` | what Kestrel learned about a site (also auto-surfaced in every `snapshot.memory`) |
| `journal [n=]` | recent autonomous-run history |

### Record, Replay, And Reports

```bash
kestrel record_start name=weekly-report
kestrel goto url=https://example.com expectText="Example"
kestrel click ref=e6 expectText="IANA"
kestrel record_stop                         # writes ~/.kestrel/records/*.json
kestrel replay path=/Users/me/.kestrel/records/...
kestrel report format=md                    # writes ~/.kestrel/reports/*.md
```

Recording captures successful actions with structural `verify` evidence and stores
stable role/name targets when a step was originally addressed by an a11y `ref`, so
replays are less tied to one transient browser snapshot. Reports summarize actions,
failures, verification blocks, failed requests, and human-handoff moments for audit
or debugging.

### Diagnostics And Protocol

```bash
kestrel doctor                              # local install/config health check
kestrel protocol                            # paths to protocol/actions.schema.json + protocol/kestrel.d.ts
```

`doctor` does not start a browser; it checks local prerequisites, extension files,
vault backend availability, daemon reachability, and shared-host token posture.

### Grounding priority
`ref` (from a fresh snapshot) → `selector` (stable CSS) → `text` → `som` (vision). Never coordinates.

### Modes
- **fresh** (default) — isolated real Chrome (`channel: chrome`) with its own profile. CDP.
- **clone** / **live** — connect over CDP to a Chrome started with `--remote-debugging-port=9222`.
- **native** (macOS) — real Chrome, **no CDP** (AppleScript + OS-level input). For sites that ignore synthetic input. See "Reliability" above.
- **extension** (any OS) — Chrome via a companion extension (`chrome.debugger` Input → **isTrusted=true, viewport coords, no debug port, no coordinate math**). One command (`ext-setup`), zero manual steps; E2E-verified — a page-side listener reads `event.isTrusted === true`. The most reliable mode on sites that ignore synthetic input. See [docs/EXTENSION.md](docs/EXTENSION.md).

### Environment
**Brain (autonomous mode, pick one):** a provider key — `GROQ_API_KEY` ·
`OPENROUTER_API_KEY` · `OPENAI_API_KEY` · `GEMINI_API_KEY`/`GOOGLE_API_KEY` ·
`ANTHROPIC_API_KEY` · `XAI_API_KEY`/`GROK_API_KEY` — or `KES_LLM_BASE_URL`
(+ `KES_LLM_API_KEY`) for any OpenAI-compatible endpoint · `KES_LLM_PROVIDER=groq|openrouter|openai|google|anthropic|xai`
to name one · model overrides `KES_PLANNER_MODEL` / `KES_NAV_MODEL` / `KES_VALIDATOR_MODEL`
(legacy `GROQ_*_MODEL` still honored).
**Other:** `KES_USER` / `KES_PASS` / `KES_TOTP_SECRET` (login) · `KES_PORT` (daemon port) ·
`KES_EMBED_URL` (optional embedding endpoint for semantic recall). State lives in `~/.kestrel/`.

---

## Architecture

```
kestrel.js  ── thin CLI ──▶  daemon.js  (one persistent Playwright page; HTTP control plane)
                                  │   perceive · ground · act · VERIFY · self-heal
agent.js   ── planner→navigator→validator loop (LLM-agnostic via lib/llm.js) + task memory
run.js     ── one-shot autonomous run        server.js ── standalone HTTP goal server
bench.js   ── capability benchmark
```

The daemon holds a single long-lived page so accessibility-tree refs stay valid
across discrete CLI calls, and verification/self-heal run server-side with full
page state.

---

## Input modes — and why trusted input matters

Kestrel has three ways to drive the browser. The reason for more than one is purely
**correctness**: a DOM event has an `isTrusted` flag that's `true` only for genuine
user input, and some well-built sites ignore synthetic clicks/keystrokes for their own
integrity — so your *authorized* automation silently does nothing. Native and extension
modes deliver `isTrusted=true` input so your agent's actions actually take effect.

**CDP mode (default)** — Playwright driving Chrome. Fast, full-featured, parallel,
works on the **vast majority of the web** (dashboards, SaaS, internal tools). Uses the
real Chrome binary. Input here is `isTrusted=false`, so the rare strict site ignores
it — that's what the other two modes are for.

**Native mode (macOS)** — `kestrel start mode=native`. Drives your **real Chrome with
no debug port**: perception via AppleScript, input via real OS-level mouse/keyboard
(`cliclick`) → `isTrusted=true`. Trade-offs: macOS-only · slower · single front window
· coordinate/vision grounding. Needs `brew install cliclick` + Chrome ▸ View ▸
Developer ▸ "Allow JavaScript from Apple Events".

**Extension mode (any OS)** — `kestrel ext-setup`. A companion extension delivers
`isTrusted=true` clicks at viewport coordinates via `chrome.debugger` — the cleanest
trusted-input path. See [docs/EXTENSION.md](docs/EXTENSION.md).

```bash
brew install cliclick                       # one-time
kestrel start mode=native                   # drives your real, frontmost Chrome
kestrel snapshot                            # AppleScript perception (elements + screen coords)
kestrel click i=5                           # real OS-level trusted click
kestrel paste text="..." submit=true        # clipboard + real ⌘V + Return
```

## Self-learning & memory

Kestrel keeps a small, local memory under `~/.kestrel/`:

- **Per-site memory** (`memory/<domain>.json`) — working selectors and notes.
  Kestrel **auto-captures** a selector when an action succeeds (no manual step),
  and you can also teach it explicitly with `remember` / `recall` / `forget`.
- **Auto-learned lessons** — if a site shows an anti-abuse / CAPTCHA / "unusual
  activity" wall, Kestrel **automatically** writes a note to that domain and flips
  it to `pace: "human"` so future runs slow down and prefer OS-level input.
- **Task journal** (`agent/journal.jsonl`) — every autonomous run is recorded;
  `kestrel journal` shows recent history. `agent/learnings.json` holds distilled notes.

This is deliberately a **narrow, transparent, file-based** memory you can read and
edit — not an opaque self-rewriting agent. The reasoning/"intelligence" still lives
in whatever AI drives it.

---

## Security & limitations (read this)

### Responsible use & disclaimer

Kestrel is a **productivity tool** — it lets your AI agent act like *you* in a
browser, on the tasks and accounts you're authorized to use, so you can hand off the
repetitive parts of your own workflow. It is **not** for defeating security, solving
CAPTCHAs, evading bans, scraping at abusive volume, or anything against a site's Terms
of Service. When Kestrel meets a CAPTCHA or an anti-abuse wall, it **stops and hands
control back to you**. Keep your use authorized, attributed, and within each site's
terms.

> **Disclaimer.** Kestrel is provided "as is", without warranty (see [LICENSE](LICENSE)).
> **You are solely responsible** for how you use it and for complying with all
> applicable laws and the terms of every site you operate. Only automate accounts and
> systems **you own or are authorized to access.** The author is **not liable** for
> misuse. Read the [Acceptable Use Policy](ACCEPTABLE_USE.md) before you start.

Kestrel drives a **real browser with real permissions**. Be deliberate:

- **It can take real actions** (send, buy, delete) when pointed at a logged-in
  profile. Default to the isolated `fresh` profile; require human confirmation for
  consequential/irreversible steps.
- **Prompt injection is real.** Web pages are untrusted and may try to hijack the
  driving model. Treat page content as data; don't follow on-page instructions.
- **Terms of Service & anti-abuse.** Automating sites can violate their ToS and trip
  anti-bot defenses — which can **rate-limit, flag, or ban your real account**. Use
  responsibly, on sites/accounts you're permitted to automate. Kestrel detects abuse
  walls and hands off to a human; it does **not** solve CAPTCHAs.
- **Human-like ≠ invisible.** Behaving like a real user improves reliability, but
  sophisticated systems can still tell it's automation. It is not a way around bans,
  and it's not meant to be — keep your use authorized and within each site's terms.
- **Autonomous mode sends page text to your chosen LLM provider** (Groq / OpenRouter /
  custom — a third party unless you self-host). The agent-driven mode keeps page
  content within your own AI session.
- **`eval` runs arbitrary JS** in the page, and a cloned profile holds real cookies
  on disk. Handle both with care. **Never commit credentials** — use env or Keychain.
- **OS-level input (`paste`/`type_human`) is macOS-only** and needs a headed,
  frontmost browser.

Kestrel is provided as-is under the MIT license, with no warranty. You are
responsible for how you use it.

## Documentation

| Doc | What's in it |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Deep dive: daemon, perception, grounding, verify, self-heal, memory, engines, native mode |
| [docs/RELIABILITY.md](docs/RELIABILITY.md) | Input modes and why trusted input matters for reliable, correct automation |
| [docs/EXTENSION.md](docs/EXTENSION.md) | Extension mode: trusted, cross-platform, no-coordinate-math browser control |
| [docs/API.md](docs/API.md) | API layer: Keychain vault + authenticated calls + browser-bootstrapped key setup |
| [docs/AGENT.md](docs/AGENT.md) | Agent layer: SOUL/AGENTS/HEARTBEAT identity + SQLite brain memory & evolution |
| [docs/PROTOCOL.md](docs/PROTOCOL.md) | JSON action protocol, schema, and TypeScript declarations |
| [docs/RECIPES.md](docs/RECIPES.md) | Copy-paste recipes: login + 2FA, dashboards, API discovery, sites that reject naive automation |
| [docs/BUILD_JOURNAL.md](docs/BUILD_JOURNAL.md) | How Kestrel was built — the research, decisions, and every feature wave |
| [ROADMAP.md](ROADMAP.md) | What's next |
| [CHANGELOG.md](CHANGELOG.md) · [CONTRIBUTING.md](CONTRIBUTING.md) · [SECURITY.md](SECURITY.md) | Versions · how to contribute · security policy |

## Credits

Created by **Michael Olmos**. Contributions welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT — see [LICENSE](LICENSE).
