# Architecture

Kestrel is a small set of cooperating pieces. This doc explains how each works
and why it's designed that way.

![architecture](architecture.svg)

## The shape

```
kestrel.js   thin CLI ─ POSTs {action,args} over HTTP ─▶  daemon.js
                                                            │  one persistent
                                                            │  browser session
agent.js     planner → navigator → validator loop (Groq) + task memory
run.js       one-shot autonomous run        server.js   standalone HTTP goal server
bench.js     capability benchmark           native.js   CDP-free macOS/Linux/Win driver
lib/         totp.js (RFC 6238) · vault.js (OS-native secrets) · api.js + providers.json
             (Layer-1 API caller) · brain.js (SQLite memory) · embed.js (tiered
             embeddings) · reflect.js (lesson synthesis + look-ahead) · llm.js
             (provider-agnostic brain: Groq / OpenRouter / custom)
extension/   MV3 companion (chrome.debugger trusted input) ◀─ daemon /ext/* long-poll
```

The CLI is intentionally dumb: it serializes `{action, args}` to JSON, POSTs to
the daemon on `127.0.0.1:<port>`, and prints the JSON reply. All intelligence is
either in the daemon (mechanics) or in whatever AI is calling the CLI (decisions).

## Why a persistent daemon

Accessibility-tree refs (`[ref=e5]`) are only meaningful **within the Playwright
session that produced the snapshot**. If every CLI call spawned a new browser,
refs would never survive between `snapshot` and `click`. So the daemon holds **one
long-lived page** and the CLI makes many short calls against it. This also lets
verification and self-heal run server-side with full page state (console, network).

## Perception

Two representations, picked per task:

1. **Accessibility tree** (default) — `page._snapshotForAI()` returns a compact
   YAML tree where every interactive element carries a stable `[ref=eN]`. This is
   cheap, semantic, and survives visual redesigns. It's the same mechanism
   Playwright's own MCP uses, and it pierces iframes and shadow DOM natively.
2. **Vision Set-of-Marks** (`snapshot mode=vision`) — for canvas / custom-rendered
   UIs where the a11y tree is empty. Kestrel injects a numbered overlay on every
   visible interactive element, screenshots it, and returns a `label → {role,name,
   cx,cy}` map. The model then acts by mark number or coordinate.

## Grounding (and why it self-heals)

The model never sees coordinates or selectors — it picks a `ref`. At action time
the daemon resolves `aria-ref=eN` to a live locator. The dead-ends Kestrel avoids:

- **integer indices** (break on any DOM mutation),
- **model-written CSS/XPath** (break on redesign),
- **raw coordinates from a general VLM** (hallucinate, break on DPI/layout).

**Self-heal:** before acting, the daemon remembers each ref's `{role, name}`. If a
click fails because the ref went stale (navigation, re-render), it re-snapshots,
finds the element with the same role+name, retries once, and reports
`selfHealed: true`. This is the single biggest reliability win over other harnesses.

## Verification (the core differentiator)

Every mutating action returns a `verify` block built from **real page state**, not
the model's guess:

```json
{ "urlChanged": true, "urlAfter": "...", "expectTextFound": true,
  "newConsoleErrors": [], "failedRequests": [] }
```

The caller (you, or the autonomous validator) reads this to *know* whether the
action worked. `expectText` / `expectGone` / `expectUrl` turn an action into a
self-checking step; a failed expectation flips `ok` to false.

## Memory & self-learning

Per-domain files at `~/.kestrel/memory/<domain>.json` hold learned selectors and
notes. Learning happens **automatically**:

- A successful action with a durable selector is auto-recorded (no `remember` call).
- Hitting an anti-abuse / CAPTCHA / "unusual activity" wall auto-writes a lesson
  and flips the domain to `pace: "human"` so future runs slow down.

The autonomous loop also writes a task `journal.jsonl` and distilled `learnings.json`.
It's a deliberately narrow, file-based, **inspectable** memory — not an opaque
self-rewriting agent.

## Engine

CDP mode uses Playwright, launching the **real Chrome binary** (`channel: chrome`)
with its own persistent profile and falling back to bundled chromium if Chrome
isn't present. Native mode needs no Playwright at all.

## Native mode (no CDP)

See [RELIABILITY.md](RELIABILITY.md). `native.js` drives the user's real Chrome with
**no debug port** — perception via AppleScript `execute javascript` (macOS),
input via real OS-level mouse/keyboard (`cliclick`/`xdotool`/SendInput) so DOM
events are `isTrusted=true`. The daemon routes verbs to `native.js` when
`mode=native`; Playwright is never launched in that mode.

## The autonomous loop (agent.js)

`planner` (decompose the goal) → `navigator` (pick one action per step from the
snapshot) → `validator` (re-check the goal before accepting a `done`). Models are
tiered via `GROQ_PLANNER_MODEL` / `GROQ_NAV_MODEL` / `GROQ_VALIDATOR_MODEL`. A
repeat-guard prevents loops; CAPTCHA detection triggers a human hand-off.

## Control protocol

`POST http://127.0.0.1:<port>/` with `{"action": "...", "args": {...}}`. Any
language can drive Kestrel — the `kestrel` CLI is just one client; `server.js`
exposes a higher-level `POST /goal`.
