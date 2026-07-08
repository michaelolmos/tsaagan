# Changelog

All notable changes to Tsaagan. Format loosely follows [Keep a Changelog](https://keepachangelog.com).

## [Unreleased]

### Changed
- **Safety doctrine clarified so the agent doesn't deadlock on routine gates.**
  Age/21+, research-use, cookie, and terms-accept click-throughs are now explicitly
  treated as reversible read-only gates the agent may accept and continue, and the
  dispatching operator is recognized as the authorization channel ("untrusted content"
  means the web page, not the operator's instructions). The hard stop on CAPTCHAs,
  anti-abuse walls, and consequential/irreversible actions is unchanged.

## [1.0.0] — Initial public release

Human-like browser control for AI agents — give your agent reliable hands on the web
for **authorized, productivity automation.**

### Core
- **Perception** — Playwright accessibility-tree snapshots with stable, self-healing
  refs; a vision Set-of-Marks fallback for canvas/visual UIs.
- **Action + verification** — click / type / navigate / select / scroll / wait /
  upload / tabs / dialogs, and every mutating action is checked against **real page
  state** (URL delta, expected text, console errors, failed requests) before moving on.
- **Trusted input** — native (macOS) and companion-extension (any OS) modes deliver
  `isTrusted=true` events for sites that ignore synthetic input.
- **Memory** — inspectable, file-based per-site selector memory + an evolving SQLite
  brain (episodes, lessons, procedures, rules) with semantic recall.
- **Autonomy** — a planner → navigator → **validator** loop (`run` / `serve`) with a
  provider-agnostic brain: Groq, OpenRouter, OpenAI, Google, Anthropic, xAI, or any
  OpenAI-compatible / local endpoint.
- **API layer** — call a site's official API with an OS-keychain-stored key instead of
  driving the UI, when one exists.

### Safety & posture
- Stops and hands off at CAPTCHAs / anti-abuse walls (it does **not** solve them).
- Flags consequential/irreversible actions (buy/pay/delete/send); optional hard gate.
- Secrets in the OS keychain only; control plane is localhost-only with cross-origin
  rejection and an optional shared-secret token; `eval` is disabled by default.
- See [ACCEPTABLE_USE.md](ACCEPTABLE_USE.md) and [SECURITY.md](SECURITY.md).

### Platforms & tests
- macOS / Linux / Windows. Node ≥ 20, ESM, Playwright the only runtime dependency.
- `node --test` suite (TOTP RFC vectors, LLM provider resolution, brain, vault, embed,
  headless integration smoke). CI workflow included.
