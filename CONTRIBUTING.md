# Contributing to Kestrel

Thanks for your interest! Kestrel is small, dependency-light, and meant to stay
readable. Contributions of all sizes are welcome.

## Setup

```bash
git clone <your-fork> kestrel && cd kestrel
npm install
npx playwright install chromium chromium-headless-shell
npm test
```

## Project layout

| File | Role |
|---|---|
| `daemon.js` | The engine: persistent Playwright page + all CDP-mode verbs |
| `native.js` | CDP-free driver (AppleScript / OS-level input), cross-platform input |
| `kestrel.js` | Thin CLI client |
| `agent.js` | Autonomous planner→navigator→validator loop + task memory |
| `run.js` / `server.js` | One-shot run / standalone HTTP goal server |
| `bench.js` · `test/` | Benchmark · tests |
| `lib/` | `totp.js` · `vault.js` (OS-native secrets) · `api.js`+`providers.json` · `brain.js` (SQLite memory) · `embed.js` · `reflect.js` · `llm.js` (Groq/OpenRouter/custom brain) |
| `extension/` | MV3 companion (trusted input via `chrome.debugger`) |
| `docs/` | Architecture, reliability, recipes, API, agent, extension, build journal, diagrams |

## Guidelines

- **Keep it dependency-light.** The only runtime dep is `playwright`. Prefer Node built-ins.
- **Match the style.** Plain modern ESM JS, small focused functions, comments that
  explain *why*.
- **Every new verb** should return JSON with `ok` and, for mutating actions, a
  `verify` block.
- **Add a test** for pure logic (see `test/totp.test.mjs`) and, where practical, the
  headless smoke (`test/smoke.test.mjs`).
- **Be honest in docs.** State the limits plainly — no overselling.
- **Stay on-mission.** Kestrel is for authorized, productivity automation. Don't add
  features whose purpose is to circumvent security, CAPTCHAs, or anti-abuse controls
  (see [ACCEPTABLE_USE.md](ACCEPTABLE_USE.md)).

## Good first contributions

See [ROADMAP.md](ROADMAP.md). High-value: validating Native mode on Linux/Windows,
and record/replay.

## Running checks

```bash
npm test                 # unit + headless integration
node kestrel.js bench    # capability benchmark (needs GROQ_API_KEY for task suite)
```

## PRs

Keep changes focused; describe what you changed and how you verified it. The PR
template will prompt you. By contributing you agree your work is MIT-licensed.

## Responsible use

Kestrel automates a real browser. Don't contribute features whose primary purpose is
to violate site Terms of Service, defeat CAPTCHAs at scale, or target accounts you
don't control. See [SECURITY.md](SECURITY.md).
