# Benchmark methodology

Tsaagan reports benchmarks the way it does everything else: honestly, and with proof.
The browser-agent field has a credibility problem — "everyone claims ~90% on
WebVoyager," on different (often quietly patched) task subsets, sometimes with manual
correction of the judge's output. A high number is not the goal here. A *reproducible,
self-critical* number is.

## What `node tsaagan.js bench` runs today

Two parts:

1. **Autonomous task suite** (`bench/tasks.json`) — a small set of real-web goals run
   end-to-end through the planner→navigator→validator loop, scored pass/fail against an
   explicit `check` (expected text or final URL).
2. **Deterministic capability matrix** — three signature capabilities verified directly,
   independent of any LLM:
   - **self-heal** — snapshot a page, invalidate its refs (reload), click a now-stale
     ref, and confirm Tsaagan recovers it.
   - **vision Set-of-Marks** — confirm the visual grounding fallback produces marks.
   - **structural verify** — confirm a navigation returns a `verify` block with
     `expectTextFound === true`.

### Latest result (Groq brain)

| Metric | Result |
|---|---|
| Task success | 3/4 (75%) |
| self_heal | ✅ pass |
| vision_som | ✅ pass |
| structural_verify | ✅ pass |

The one task miss (`iana-followlink`) reached the correct IANA page but failed a strict
text-match in the check — a task-definition nit, not a navigation failure. We report the
raw number anyway rather than "correcting" it; that's the point.

## Planned: a comparable WebVoyager number (fast-follow)

To produce a number people can line up against browser-use (~89%) / skyvern (~86%),
we will publish a **WebVoyager** result under a locked, least-gameable protocol:

- **Task set:** a curated, *published* slice of [WebVoyager](https://github.com/MinorJerry/WebVoyager)
  (start with 50 tasks; expand to the full ~590 patched set later). Every excluded or
  date-patched task is listed — no silent edits.
- **Start condition:** each task starts from the target site's **homepage** (no
  Google-search shortcut), mirroring Online-Mind2Web's anti-gaming rule.
- **Judge:** the original paper's GPT-4V judge prompt, temperature 0, **no manual
  override** of judge verdicts.
- **Report:** pass rate `(passed/total)`, the agent model, the judge model, the exact
  task list, the patch list, and the API cost. Plus a **verified-pass** sub-score —
  tasks whose success Tsaagan's own post-conditions independently confirmed. No other
  agent publishes that, and it's exactly what verify-first makes possible.
- **Comparability caveat:** stated up front — scores across tools use different
  WebVoyager subsets and are **not** directly comparable.

Status: **harness scaffolding in place; full run pending.** The README comparison table
marks Tsaagan's published score as "in progress" until this lands.

## Reproducing

```bash
GROQ_API_KEY=...  node tsaagan.js bench               # default suite + capability matrix
GROQ_API_KEY=...  node bench.js tasks=bench/your.json # custom task set
```

Any OpenAI-compatible provider works as the brain (see the README "Autonomous mode").
