# HEARTBEAT.md — Kestrel running on its own

A heartbeat turns Kestrel from a tool you call into an agent that *acts on a
cadence*. **Opt-in by design** (autonomy + cost + safety), off unless you start it.

## What a heartbeat does, each tick

1. **Wake** on a schedule (cron / `kestrel serve` + an external trigger / a loop).
2. **Recall** relevant memory — `brain.recall(<task/site>)` + `recall` for the domain
   (learned selectors, prior episodes, anti-abuse lessons).
3. **Choose the lightest layer** for the job (API → real-browser → CDP — see
   [AGENTS.md](AGENTS.md)).
4. **Act** through the observe→act→verify loop.
5. **Record** the episode + any new learning to the brain (so the next tick is smarter).
6. **Escalate, don't push.** On a CAPTCHA / login wall / consequential decision,
   stop and notify the human instead of forcing it.

## Running it

- **One-shot / unattended:** `kestrel run goal="…"` (Groq brain).
- **Server:** `kestrel serve` → POST goals over HTTP (cron, another app, your agent).
- **In Claude Code / your CLI:** dispatch the loop yourself on whatever schedule your
  harness provides; Kestrel supplies the hands + memory.

## Heartbeat rules

- **Be polite and rate-considerate** (`pace set=human`) — avoid bursts; back off if a
  site signals it wants you to slow down.
- **Bounded:** cap steps per tick (`max=`), and stop after K consecutive no-progress ticks.
- **Confirm consequential actions** unless the task pre-authorized them.
- **Leave a trail:** every tick lands in the brain + `journal` for review.

A heartbeat should make the user's life easier while they sleep — never create risk
they didn't sign up for.
