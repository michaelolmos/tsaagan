# Security & responsible use

Kestrel drives a **real browser with real permissions**. Please read this.

## Reporting a vulnerability

Open a private security advisory on the GitHub repository, or contact the
maintainer directly. Please don't file public issues for sensitive reports. We'll
acknowledge and work on a fix as fast as we reasonably can.

## What Kestrel can do (and the risks)

- **It can take real actions** — send, buy, delete — when pointed at a logged-in
  profile (`clone` / `live` / `native`). Default to the isolated `fresh` profile.
  Require human confirmation for consequential or irreversible steps.
- **Prompt injection is real.** Web pages are untrusted; a malicious page can try to
  hijack the driving model. Treat page content as data, not instructions.
- **Secrets:** never hard-code credentials. Use the **vault** (`kestrel vault set …`),
  which uses OS-native encryption — macOS Keychain, Linux libsecret, Windows DPAPI —
  so secrets never touch the repo, env, or a plaintext file. (`KES_USER`/`KES_PASS`/
  `KES_TOTP_SECRET` env vars are also supported for ephemeral use.) A cloned profile
  holds real cookies on disk under `~/.kestrel/`.
- **`eval`** runs arbitrary JavaScript in the page and is **disabled by default** —
  set `KES_ENABLE_EVAL=1` to turn it on. **Autonomous mode** sends page text to your
  chosen LLM provider (a third party unless you self-host).
- **The control plane** is an HTTP server bound to `127.0.0.1` only; it rejects
  cross-origin (browser) requests and answers CORS only on the extension routes. Set
  `KES_TOKEN` to require a shared-secret header on shared/multi-user hosts. Don't
  expose the daemon port to a network.

## Terms of Service & anti-abuse

Automating a website may violate its Terms of Service and can trip anti-bot
defenses, which may **rate-limit, flag, or ban your real account**. Kestrel detects
abuse walls and hands off to a human; it does **not** solve CAPTCHAs. Use Kestrel
only on sites and accounts you are permitted to automate, and at a responsible
volume. See [docs/RELIABILITY.md](docs/RELIABILITY.md).

## Disclaimer & acceptable use

Kestrel is provided **as-is** under the MIT license, with **no warranty**. **You are
solely responsible** for how you use it and for complying with all applicable laws and
the terms of every site you operate. Only automate accounts and systems **you own or
are authorized to access.** The author accepts **no liability for misuse**. Permitted
and prohibited uses are spelled out in the [Acceptable Use Policy](ACCEPTABLE_USE.md).
