# Extension mode — trusted, cross-platform, no coordinate math

`mode=extension` drives your **real, logged-in Chrome** through a tiny companion
extension that uses `chrome.debugger`'s Input domain. Why it's the most robust mode:

- **Trusted input** — `Input.dispatchMouseEvent` / `Input.dispatchKeyEvent` produce
  `isTrusted=true` DOM events (confirmed by Chromium engineers + a working PoC).
- **Viewport coordinates** — clicks use CSS pixels *inside the page* (from
  `getBoundingClientRect`), so there is **no screen / multi-monitor / HiDPI math**.
  This is the clean fix for the coordinate skew that breaks OS-level clicking on
  scaled or multi-display setups.
- **No debug port, real Chrome** — your actual profile and cookies; clicks are
  delivered as genuine `isTrusted=true` events, so well-built sites that ignore
  synthetic input actually register your authorized actions.
- **Cross-platform** — any desktop Chrome (macOS / Linux / Windows).

## Setup — zero manual steps (the default)

```bash
node kestrel.js ext-setup        # → { connected: true } in ~10s
```

`ext-setup` starts the daemon in extension mode and launches **Chrome for Testing**
(from the Playwright cache) with the extension auto-loaded via `--load-extension`.
No Developer-mode toggle, no file picker, no clicks.

> **Why Chrome for Testing?** Branded Google Chrome **137+ silently ignores
> `--load-extension`** (2025 anti-malware change), so auto-loading is impossible
> there. Chrome for Testing keeps developer flags by design — that's what it's for.
> Add `profile=clone` to copy your logged-in profile into it.

### Running on your daily branded Chrome instead

If you specifically want the extension inside your **real, daily Chrome** (your live
logged-in session), it's a one-time manual load:

```bash
node kestrel.js ext-setup browser=chrome
```

1. Open `chrome://extensions`, enable **Developer mode** (top-right).
2. **Load unpacked** → highlight this repo's `extension/` **folder from its parent
   directory** (don't navigate inside it — the Select button greys out).
3. It connects within seconds: `kestrel status` → `connected: true`.

### Localhost transport requirements (already handled)

- The daemon answers Chrome's **Private Network Access** preflight
  (`Access-Control-Allow-Private-Network: true` + CORS) — without this, Chrome 130+
  silently blocks the extension's fetch to `127.0.0.1`.
- The extension uses a **`chrome.alarms` keepalive** so the MV3 service worker can't
  go dormant and drop the long-poll.

If you run the daemon on another port, edit `DAEMON` in `extension/background.js`.

## Use

```bash
kestrel status                        # → { mode: 'extension', connected: true }
kestrel goto url=https://example.com
kestrel snapshot                      # interactive elements + stable refs (data-kref)
kestrel click ref=5                   # trusted click at viewport coords
kestrel type ref=3 text="hello@x.com" submit=true
kestrel press keys="Meta+Enter"       # trusted key combo
kestrel scroll direction=down         # or to_text="pricing" (re-snapshot after)
kestrel wait_for text="Welcome"       # or url=… / selector=… [timeout=15000]
kestrel screenshot                    # saved to ~/.kestrel/shots/, returns the path
kestrel tabs | new_tab url=… | switch_tab index=1 | close_tab index=1
kestrel back | forward | extract | eval js="location.href"
kestrel stop
```

Whatever **tab is active** in the frontmost window of the Kestrel-launched browser
is the one Kestrel drives.

> **Ref format differs by mode.** Extension mode uses integer `ref=N` (from each
> snapshot's `data-kref` index). CDP mode uses string `ref=eN` (from the
> accessibility tree's `aria-ref`). Always take refs from the most recent snapshot.

## Verified end-to-end (2026-06-09)

The full proof ran with zero human steps: `ext-setup` → auto-connect →
`goto example.com` → `snapshot` → trusted `click` by ref → page's own capture
listener read **`event.isTrusted === true`** → second click navigated to
`iana.org/help/example-domains` → `screenshot` → `back`. Tabs lifecycle, `press`,
`scroll`, and `wait_for` all exercised in the same run.

## Notes & limits (honest)

- Chrome shows a **"Kestrel Companion started debugging this browser"** banner while
  the debugger is attached. The extension attaches/detaches **per action**, so it
  flashes briefly rather than staying up. (You can suppress it by launching Chrome
  with `--silent-debugger-extension-api`, but that requires relaunching Chrome.)
- While Kestrel holds the debugger on a tab, you can't have DevTools open on that
  same tab.
- `eval` runs in the page's MAIN world and is subject to the page's CSP — it may be
  blocked on strict sites (e.g. Gmail). `snapshot` / `click` / `type` / `extract`
  don't depend on it.
- Transport is HTTP long-poll on `127.0.0.1` — nothing leaves your machine.
- MV3 service workers can be evicted when idle; the poll loop keeps it alive during
  use and auto-reconnects.

## When to use which mode

| Mode | Driver | Best for |
|---|---|---|
| `fresh` / `clone` / `live` | Playwright/CDP | most of the web; fast, parallel, full a11y refs |
| `native` (macOS) | AppleScript + OS input | sites that ignore synthetic input, single window |
| **`extension`** | companion ext + chrome.debugger | **reliable trusted clicks on strict sites, any platform, no coordinate math** |
