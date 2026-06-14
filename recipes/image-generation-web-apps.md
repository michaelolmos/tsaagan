# Recipe — Drive a browser image generator (Google Flow / Nano Banana Pro, ImageFX, etc.)

> Added 2026-06-14 from the wear2am t-shirt pipeline. Kestrel use-case: batch-generate
> design/product images from a creative **web app that has no usable public API** (or
> whose web-only model is better than any API), by driving the real logged-in browser
> like a human.

## Why Kestrel for this
The best image models are often locked inside a web app behind a Google login and a
dynamic, canvas-heavy UI — **Google Flow (Nano Banana Pro / Imagen)**, ImageFX,
Midjourney web. `WebFetch`/HTTP can't touch them. This is exactly Kestrel's lane:
observe → act → verify → self-heal against a real UI, in the user's real session.

## The flow (observe → act → verify, looped per prompt)
1. **Use the user's REAL Chrome profile** (already logged into Google). Drive *that*
   instance — do **not** spawn a separate headless / `--remote-debugging-port` Chrome
   for this; it detaches from the logged-in session and (worse) can tear down the
   user's actual browser. Isolate by profile/PID; one window.
2. Navigate to the app, type the prompt into the prompt field.
3. Set count + aspect ratio. For multi-image / "x2" generation, make sure any
   **"Agent mode" / experimental toggle is OFF** — it changes the generate behavior
   and silently breaks batch runs.
4. **Trigger generate carefully:** focus the Create button, then send a *trusted*
   `Return`. Do **not** re-activate or refocus the window between focusing and the
   keypress — a reactivate resets the trusted-input state and the `Return` no-ops.
5. **Verify structurally, not by sleep:** wait until N new result tiles have actually
   rendered (count the image nodes), then proceed. Fixed sleeps flake.
6. **Capture the rendered pixels** (screen-grab the result region). Do **not** rely on
   `<img>` blob/transient URLs — they expire and aren't downloadable later.
7. Loop the next prompt with a **cooldown** between generations.

## Gotchas (hard-won)
- **Never `pkill -f "Google Chrome"`** and never run a headless Chrome that can kill
  the user's real browser. Isolate by a unique profile/flag/PID.
- **Cooldowns / human pacing matter** — Google's anti-abuse will throttle or block a
  fast, robotic cadence. Space requests; randomize slightly; back off on challenges.
- **Agent-mode OFF** for batch.
- **Trusted Return without reactivate** (see step 4).
- **Drafts / transient URLs expire** — grab pixels at generation time.

## When NOT to use the browser (prefer an API)
If a clean API exists *and* its quality is good enough, use it — it's faster, headless,
and side-steps anti-abuse entirely. The wear2am pipeline started by driving Google Flow
in the browser, then switched to **Replicate `recraft-ai/recraft-v3`** (API) for full
autonomy once that quality was acceptable. Reach for browser-driving when the *best*
model is web-only (Nano Banana Pro / Imagen via Flow, ImageFX) or login-gated with no API.

Decision rule: **API if it exists and is good enough → browser-drive only for web-locked
models.** Either way the downstream steps (knockout to transparent, place on product,
mock up) are identical.

## Reference implementation
See `~/Developer/tshirt-brand/printify-pipeline/` — `generate-*.py` (the Replicate/API
path that replaced browser-driving) and `SCREENPRINT_STANDARD.md`. The browser-driving
method above is the technique that preceded it and remains the fallback for web-only models.
