# Recipes

Copy-paste patterns. `kestrel` = `node kestrel.js` (add an alias). Every command
prints JSON; read the `verify` block to confirm each step worked.

## The core loop

```bash
kestrel start
kestrel goto url=https://example.com expectText="Example"
kestrel snapshot                         # → elements with [ref=eN]
kestrel click ref=e6 expectText="Welcome"
kestrel stop
```

## Search a site and read the result

```bash
kestrel goto url=https://www.wikipedia.org
kestrel type selector="#searchInput" text="Alan Turing" submit=true expectText="Turing"
kestrel extract                          # cleaned page text
```

## Log in with username + password + 2FA

Keep secrets in env or Keychain — never in the repo or a command you commit.

```bash
export KES_USER="me@example.com" KES_PASS="…" KES_TOTP_SECRET="BASE32SECRET"
kestrel goto url=https://app.example.com/login
kestrel login userSelector="#email" passSelector="#password" \
              submitSelector="button[type=submit]" \
              totpSelector="#otp" expectText="Dashboard"
# or pull a secret from the macOS Keychain:
kestrel keychain service=app.example.com account=me@example.com   # → { secret }
```

## Authenticated dashboard with no public API

```bash
# Start your real Chrome with a debug port (you stay logged in), then:
kestrel start mode=clone
kestrel goto url=https://dash.example.com
kestrel snapshot
kestrel click ref=e12 expectText="Settings"
```

## Discover and reuse a site's internal API

```bash
kestrel goto url=https://app.example.com/reports
kestrel network filter=/api/            # see the XHR/fetch calls the UI makes
kestrel eval js="fetch('/api/v1/reports',{credentials:'include'}).then(r=>r.text())"
```

## Teach Kestrel a site once (it also auto-learns)

```bash
kestrel remember key=search selector="#searchInput" note="main search box"
# next session, same domain — no selector needed:
kestrel type key=search text="hello" submit=true     # → cacheHit:true
kestrel recall                                        # what it knows about this domain
```

## Canvas / visual UI (no accessibility tree)

```bash
kestrel snapshot mode=vision             # numbered overlay + screenshot + marks
kestrel click som=42 expectText="Open"   # click element #42
# or pure coordinates:
kestrel click_xy x=640 y=320
```

## A site that ignores synthetic input

Some well-built sites only act on **trusted** input (`isTrusted=true`) and quietly
ignore synthetic clicks/keystrokes — so your *authorized* automation silently does
nothing. Native/extension mode fixes that with real OS-level input. (This is about
reliability on your own/authorized accounts — not about getting past a security gate;
if you hit a CAPTCHA or anti-abuse wall, stop and hand off.)

```bash
brew install cliclick                     # one-time (macOS)
kestrel start mode=native                 # real Chrome, no CDP
kestrel snapshot                          # AppleScript perception (i= indices + coords)
kestrel paste text="some text" submit=true   # real ⌘V + Return (isTrusted)
kestrel pace set=human                    # polite, human cadence for this domain
```

## Files: upload & download

```bash
kestrel upload_file selector="input[type=file]" path=/Users/me/a.png,/Users/me/b.png
kestrel click ref=e9                       # triggers a download
kestrel downloads                          # → saved file paths in ~/.kestrel/downloads
kestrel pdf path=/tmp/report.pdf           # save the page as PDF (headless)
```

## Multi-tab, dialogs, cookie banners

```bash
kestrel dismiss_overlays                   # accept/close cookie + consent banners
kestrel handle_dialog accept=true          # auto-accept JS confirm/alert/prompt
kestrel new_tab url=https://example.org
kestrel tabs                               # list; switch_tab index=1
```

## Fully autonomous (Groq brain, no agent framework)

```bash
export GROQ_API_KEY=…
kestrel run goal="go to news.ycombinator.com and report the #1 story title"
# or run it as a standalone server and POST goals:
kestrel serve port=39820
curl -s localhost:39820/goal -d '{"goal":"…","max":16}'
```

## Verify like you mean it

```bash
kestrel click ref=e3 expectText="Saved"    # action self-verifies
kestrel assert text="Saved" url="/success" # explicit pass/fail check
kestrel console_log                        # recent console errors (debugging)
```

## Record, replay, and audit a verified workflow

```bash
kestrel record_start name=weekly-report
kestrel goto url=https://example.com expectText="Example"
kestrel click ref=e6 expectText="IANA"
kestrel record_stop                         # returns { path, steps }
kestrel replay path=/Users/me/.kestrel/records/...
kestrel report format=md                    # returns { path, summary }
```

Only successful actions with structural verification evidence are captured for
replay. The report is an audit trail: actions, failures, URL changes, failed
requests, and hand-off/caution signals.
