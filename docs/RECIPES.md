# Recipes

Copy-paste patterns. `tsaagan` = `node tsaagan.js` (add an alias). Every command
prints JSON; read the `verify` block to confirm each step worked.

## The core loop

```bash
tsaagan start
tsaagan goto url=https://example.com expectText="Example"
tsaagan snapshot                         # → elements with [ref=eN]
tsaagan click ref=e6 expectText="Welcome"
tsaagan stop
```

## Search a site and read the result

```bash
tsaagan goto url=https://www.wikipedia.org
tsaagan type selector="#searchInput" text="Alan Turing" submit=true expectText="Turing"
tsaagan extract                          # cleaned page text
```

## Log in with username + password + 2FA

Keep secrets in env or Keychain — never in the repo or a command you commit.

```bash
export TSG_USER="me@example.com" TSG_PASS="…" TSG_TOTP_SECRET="BASE32SECRET"
tsaagan goto url=https://app.example.com/login
tsaagan login userSelector="#email" passSelector="#password" \
              submitSelector="button[type=submit]" \
              totpSelector="#otp" expectText="Dashboard"
# or pull a secret from the macOS Keychain:
tsaagan keychain service=app.example.com account=me@example.com   # → { secret }
```

## Authenticated dashboard with no public API

```bash
# Start your real Chrome with a debug port (you stay logged in), then:
tsaagan start mode=clone
tsaagan goto url=https://dash.example.com
tsaagan snapshot
tsaagan click ref=e12 expectText="Settings"
```

## Discover and reuse a site's internal API

```bash
tsaagan goto url=https://app.example.com/reports
tsaagan network filter=/api/            # see the XHR/fetch calls the UI makes
tsaagan eval js="fetch('/api/v1/reports',{credentials:'include'}).then(r=>r.text())"
```

## Teach Tsaagan a site once (it also auto-learns)

```bash
tsaagan remember key=search selector="#searchInput" note="main search box"
# next session, same domain — no selector needed:
tsaagan type key=search text="hello" submit=true     # → cacheHit:true
tsaagan recall                                        # what it knows about this domain
```

## Canvas / visual UI (no accessibility tree)

```bash
tsaagan snapshot mode=vision             # numbered overlay + screenshot + marks
tsaagan click som=42 expectText="Open"   # click element #42
# or pure coordinates:
tsaagan click_xy x=640 y=320
```

## A site that ignores synthetic input

Some well-built sites only act on **trusted** input (`isTrusted=true`) and quietly
ignore synthetic clicks/keystrokes — so your *authorized* automation silently does
nothing. Native/extension mode fixes that with real OS-level input. (This is about
reliability on your own/authorized accounts — not about getting past a security gate;
if you hit a CAPTCHA or anti-abuse wall, stop and hand off.)

```bash
brew install cliclick                     # one-time (macOS)
tsaagan start mode=native                 # real Chrome, no CDP
tsaagan snapshot                          # AppleScript perception (i= indices + coords)
tsaagan paste text="some text" submit=true   # real ⌘V + Return (isTrusted)
tsaagan pace set=human                    # polite, human cadence for this domain
```

## Files: upload & download

```bash
tsaagan upload_file selector="input[type=file]" path=/Users/me/a.png,/Users/me/b.png
tsaagan click ref=e9                       # triggers a download
tsaagan downloads                          # → saved file paths in ~/.tsaagan/downloads
tsaagan pdf path=/tmp/report.pdf           # save the page as PDF (headless)
```

## Multi-tab, dialogs, cookie banners

```bash
tsaagan dismiss_overlays                   # accept/close cookie + consent banners
tsaagan handle_dialog accept=true          # auto-accept JS confirm/alert/prompt
tsaagan new_tab url=https://example.org
tsaagan tabs                               # list; switch_tab index=1
```

## Fully autonomous (Groq brain, no agent framework)

```bash
export GROQ_API_KEY=…
tsaagan run goal="go to news.ycombinator.com and report the #1 story title"
# or run it as a standalone server and POST goals:
tsaagan serve port=39820
curl -s localhost:39820/goal -H 'content-type: application/json' -d '{"goal":"…","max":16}'
```

## Verify like you mean it

```bash
tsaagan click ref=e3 expectText="Saved"    # action self-verifies
tsaagan assert text="Saved" url="/success" # explicit pass/fail check
tsaagan console_log                        # recent console errors (debugging)
```

## Record, replay, and audit a verified workflow

```bash
tsaagan record_start name=weekly-report
tsaagan goto url=https://example.com expectText="Example"
tsaagan click ref=e6 expectText="IANA"
tsaagan record_stop                         # returns { path, steps }
tsaagan replay path=/Users/me/.tsaagan/records/...
tsaagan report format=md                    # returns { path, summary }
```

Only successful actions with structural verification evidence are captured for
replay. The report is an audit trail: actions, failures, URL changes, failed
requests, and hand-off/caution signals.
