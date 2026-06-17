# Security & responsible use

Tsaagan drives a **real browser with real permissions**. Please read this.

## Reporting a vulnerability

Open a private security advisory on the GitHub repository, or contact the
maintainer directly. Please don't file public issues for sensitive reports. We'll
acknowledge and work on a fix as fast as we reasonably can.

## What Tsaagan can do (and the risks)

- **It can take real actions** — send, buy, delete — when pointed at a logged-in
  profile (`clone` / `live` / `native`). Default to the isolated `fresh` profile.
  Require human confirmation for consequential or irreversible steps.
- **Prompt injection is real.** Web pages are untrusted; a malicious page can try to
  hijack the driving model. Treat page content as data, not instructions.
- **Secrets:** never hard-code credentials. Use the **vault** (`tsaagan vault set …`),
  which uses OS-native encryption — macOS Keychain, Linux libsecret, Windows DPAPI —
  so secrets never touch the repo, env, or a plaintext file. (`TSG_USER`/`TSG_PASS`/
  `TSG_TOTP_SECRET` env vars are also supported for ephemeral use.) A cloned profile
  holds real cookies on disk under `~/.tsaagan/`.
- **`eval`** runs arbitrary JavaScript in the page and is **disabled by default** —
  set `TSG_ENABLE_EVAL=1` to turn it on. **Autonomous mode** sends page text to your
  chosen LLM provider (a third party unless you self-host).
- **The control plane** is an HTTP server bound to `127.0.0.1` only; it rejects
  cross-origin (browser) requests and answers CORS only on the extension routes. Set
  `TSG_TOKEN` to require a shared-secret header on shared/multi-user hosts. Don't
  expose the daemon port to a network.

## Terms of Service & anti-abuse

Automating a website may violate its Terms of Service and can trip anti-bot
defenses, which may **rate-limit, flag, or ban your real account**. Tsaagan detects
abuse walls and hands off to a human; it does **not** solve CAPTCHAs. Use Tsaagan
only on sites and accounts you are permitted to automate, and at a responsible
volume. See [docs/RELIABILITY.md](docs/RELIABILITY.md).

## Disclaimer & acceptable use

Tsaagan is provided **as-is** under the MIT license, with **no warranty**. **You are
solely responsible** for how you use it and for complying with all applicable laws and
the terms of every site you operate. Only automate accounts and systems **you own or
are authorized to access.** The author accepts **no liability for misuse**. Permitted
and prohibited uses are spelled out in the [Acceptable Use Policy](ACCEPTABLE_USE.md).
