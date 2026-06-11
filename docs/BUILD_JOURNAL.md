# Build journal

How Kestrel came to be — the research, the decisions, and every feature wave.
Written so a newcomer (or future maintainer) understands not just *what* exists
but *why*.

## 0. The frustration that started it

The goal: let an AI control a browser the way a human does — reliably, on real
sites — instead of the brittle, half-working browser tooling most agents ship.

## 1. Research first

Before writing code we surveyed the field:

- **Top OSS agentic browsers** (browser-use, Stagehand, Skyvern, Playwright-MCP,
  Nanobrowser, nodriver, BrowserOS, UI-TARS, …) — their perception, grounding, and
  reliability approaches.
- **The literature** (WebArena, Mind2Web, SeeAct, WebVoyager, Set-of-Marks,
  UGround, AgentOccam, UI-TARS) — what actually moves success rates.

**The convergence:** the whole field agrees on accessibility-tree perception +
**stable, self-healing grounding** (not integer indices, not raw coordinates) +
the part almost everyone skips — **structural verification** of each action. Those
two gaps (ephemeral refs, no verification) are exactly what make most browser
agents "feel limited."

## 2. The MVP

A persistent **daemon** holding one Playwright page (so accessibility refs survive
across CLI calls) + a thin CLI. Core loop: observe → think → act → **verify** →
self-heal. Validated live: `goto`, `snapshot` (stable refs), `click`, `type`+submit,
and **self-heal on a forced stale ref**.

The key technical find: Playwright's `page._snapshotForAI()` returns a ref-annotated
a11y tree and `aria-ref=eN` resolves it — giving stable grounding + iframe/shadow
piercing for free. So the only thing we had to invent was the verify + self-heal
layer.

## 3. The "full version" — feature waves

- **A — hard cases:** `upload_file`, `handle_dialog`, downloads, `dismiss_overlays`,
  `expectUrl`.
- **B — vision Set-of-Marks:** numbered overlay + `click som=N` for canvas/visual UIs.
- **C — site memory:** per-domain learned selectors, persisted, replayed by `key`
  across sessions.
- **D — TOTP 2FA:** RFC 6238, pure crypto, verified against the official vectors.
- **E — autonomous loop:** planner → navigator → validator (Groq brain) + a
  standalone HTTP goal server.

## 4. Naming & open-sourcing

Renamed from the working title to **Kestrel** — a falcon known for its precise,
self-correcting hunting dive. Extracted into a standalone MIT repo.

## 5. The correctness lesson: trusted input

Real-world testing surfaced a concrete reliability problem: on some well-built sites,
synthetic clicks/keystrokes (`isTrusted=false`) are **silently ignored** — the form
never submits. The fix isn't about hiding; it's about delivering *genuine* input:

- **CDP mode** (default) — Playwright on the real Chrome binary. Fast, parallel, and
  enough for the vast majority of the web (dashboards, SaaS, internal tools).
- **Native mode** — real Chrome, no debug port: AppleScript perception + real OS-level
  input → `isTrusted=true`. The reliable path on sites that ignore synthetic input.
- **Extension mode** — a companion extension delivers `isTrusted=true` clicks at
  viewport coordinates, cross-platform. See [RELIABILITY.md](RELIABILITY.md).

We also fixed a real gap: **self-learning fires automatically** — Kestrel auto-captures
working selectors and, when a site shows an anti-abuse/CAPTCHA wall, records a lesson
and slows the pace (and the doctrine is to hand off to a human, never push through).

> Scope note: the strictest sites (large search/AI platforms) block automation
> outright and also score behavior/account risk. Kestrel doesn't try to get past that
> — automating a site that forbids it can violate its terms. Stay authorized.

## 6. Power & polish

- Cross-platform native input (macOS validated; Linux `xdotool` / Windows SendInput
  written, marked untested).
- More verbs: `network` (API discovery), `cookies` (session export), `pdf`,
  `assert`, `--proxy`, `click_xy`, `keychain`, pace governor.
- Tests (`node --test`): TOTP unit tests vs RFC vectors + a headless integration
  smoke (goto/snapshot/click/self-heal/vision). Benchmark: `kestrel bench`.
- Docs, diagrams (SVG), a demo GIF, and this journal.

## 7. The coordinate reckoning → extension mode

A live native-mode test (reading + replying to a real Gmail) exposed the next wall:
on a fractionally-scaled Retina (devicePixelRatio 2.5) with a second monitor at a
negative-X origin, OS-level *coordinate* clicks don't land — CSS-pixel→screen-point
mapping is skewed — and multiple windows desync AppleScript "front window" from the
clicked window. (Reading worked fine; the email was sent via a trusted ⌘+Enter
keystroke and a URL-driven compose — keyboard/URL paths need no coordinates.)

Three research agents (macOS coordinate spaces; trusted-input methods; arXiv GUI
grounding) converged on the fix: a **companion Chrome extension using
`chrome.debugger` Input** — `isTrusted=true` events at **viewport coordinates**, on
the user's real Chrome with no debug port. This eliminates screen-coordinate math
entirely, is cross-platform, and runs as ordinary Chrome (we never enable the CDP
`Runtime` domain). Shipped as `mode=extension`. We also
added window-pinning to native mode and an honest "use extension mode" note for
scaled displays.

## Design principles that held throughout

1. **The brain decides; Kestrel is the hands.** No LLM calls when an agent drives it.
2. **Verify, don't trust.** Structural post-conditions over self-report.
3. **Stable grounding that self-heals.** Never indices, never raw coordinates as primary.
4. **Be honest about limits.** Especially detection — no overselling.
5. **Inspectable memory.** Plain files you can read and edit.
