# Tsaagan upgrade plan — October 2026

**Written:** 2026-10-16 · **Work session:** Saturday 2026-10-17, morning
**Tickets:** epic `omi-b7npf` in the OMI-dev beads database (`bd show omi-b7npf`)

## Why now

Every major assistant now controls the computer, and users expect it. Tsaagan
was built to be the reliable way to drive a browser, and its core idea still
holds: prove each action worked from real page state instead of trusting a
guess. But the foundation has slipped, and the field has moved past
browser-only.

## Where Tsaagan stands (audit, 2026-10-16)

| Area | Finding |
|---|---|
| Logged-in Chrome | **Broken since Chrome 150 (July).** `connectOverCDP` rejects with "Browser context management is not supported"; on 151 the handshake times out. Every logged-in mission now launches a second full Chrome from `~/.tsaagan/chrome-clone` (2.3 GB). The Chrome for Testing extension path crashes on the 151 profile. |
| Code activity | Last commit 2026-08-16. `feature/screencast` (live viewport, takeover, `cdp` verb) is pushed but not on `main`. A 90s attach-timeout patch in `daemon.js`/`tsaagan.js` has sat uncommitted since 2026-08-19. |
| Evidence it works | 31 recorded uses, but only 3 journal runs and 3 brain episodes. Missions driven by Claude subagents write nothing, so there is no success rate. |
| Reach | Chrome only. No Finder, file pickers, System Settings, Xcode, or other apps. One browser and one page at a time; parallel missions collide on `:9222`. |
| Tests | 39 unit/smoke cases. Nothing drives a live Chrome, which is why the Chrome 150/151 breaks went unnoticed. |
| Docs | Skill and agent docs point at `/Users/mo/...` (wrong user). About 8 verbs are undocumented (`fill_form`, `assert`, `cookies`, `pdf`, `record_*`, `doctor`, `mcp`, `network`, `replay`). The clone-mode section describes the broken path as the standard one. |
| Disk | `~/.tsaagan` is 2.9 GB, with 20+ leftover `profile-*` directories. |

## What the field does now (October 2026)

- **Claude (Cowork / Claude Code, March 2026)** and **OpenAI Codex (April 2026)** control any macOS app, in the background, with per-app permission. Codex keeps working while the Mac is locked.
- **Routing order wins:** connector/API first, then a command, then the browser, then screen control as the last resort (Anthropic's published order).
- **Expected safety baseline:** approve-each-step or auto-approve behind an action classifier; hard blocks on purchases, trades, account creation and permanent deletes; an activity log; stop at any time. Prompt injection from page content is a live threat (a zero-click exploit hit a Chrome agent extension this year).
- **Benchmarks:** OSWorld-Verified is saturated (top scores above the human baseline). Use OSWorld 2.0 or our own task set. Vendor web-agent scores are marketing.

## Strategy

Do not build a whole-desktop agent; Anthropic and OpenAI already ship one.
Make Tsaagan **OMI's hands**: the layer that picks the cheapest reliable tool for
each job, drives the browser better than anyone because every step is verified
and every site is remembered, and hands desktop work to Claude Code's computer
use with the same safety rails and log.

## Tasks (in order)

| # | Bead | Task | Done when |
|---|---|---|---|
| 1 | `omi-b7npf.1` | Land `feature/screencast` on `main`; commit the 90s attach-timeout patch | `main` has both, pushed, smoke tests pass |
| 2 | `omi-b7npf.8` | **Attach to the real logged-in Chrome without a second copy** (Chrome 150/151) | A logged-in GitHub page: snapshot, click, verify, with no second Chrome process |
| 3 | `omi-b7npf.2` | Live-Chrome regression test, nightly launchd job with heartbeat | Seen red once, then green |
| 4 | `omi-b7npf.3` | Log every mission automatically (goal, steps, ok, failure reason) | This week's missions show with a success rate |
| 5 | `omi-b7npf.4` | Fix the docs (paths, verbs, auth section, private verbs, ROADMAP) | Copy-paste commands in the skill run as written |
| 6 | `omi-b7npf.6` | Router: connector/API, then browser, then screen | A job with an API never opens a browser |
| 7 | `omi-b7npf.9` | Spike: desktop apps via Claude Code computer use (adopt, not build) | Written verdict plus one working handoff |
| 8 | `omi-b7npf.10` | Safety rails: approval tiers, hard blocks, activity log, stop | Each rail seen firing on a test mission |
| 9 | `omi-b7npf.7` | Background and parallel missions (own window/profile each) | Two missions run at once while Mike works |
| 10 | `omi-b7npf.5` | Prune `~/.tsaagan` leftovers; auto-clean temp profiles | Under 0.5 GB, stays there |
| 11 | `omi-b7npf.11` | Retire the duplicate BrowserPilot tool into Tsaagan | One browser tool in OMI |

Saturday's realistic scope is tasks 1 to 5: the foundation. Everything after
that sits on a tool that can attach to Chrome.

## Approach notes for task 2

Three candidate paths, try in this order:

1. **Per-page-target CDP websocket.** Proven on 2026-09-14 when Playwright's
   browser-level attach timed out on a 67-target Chrome: open a websocket to the
   one page target from `/json/list` and drive it directly. Wrap this as a
   Tsaagan transport so the verbs work on top of it.
2. **Native mode as the default for logged-in work.** Already works on the
   user's real Chrome (AppleScript perception plus OS-level trusted input).
   Gaps: no a11y refs, slower.
3. **Companion extension in the daily Chrome** (one-time manual load). Trusted
   input, no debug port, no second Chrome.

Starting the daily Chrome with a debug port needs a separate user-data-dir
since Chrome 136, which is what forces the second copy today. Measure memory
before and after.
