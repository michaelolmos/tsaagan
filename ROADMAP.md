# Roadmap

Kestrel is functional and used. These are the next worthwhile directions —
contributions welcome.

## Recently shipped (v0.5–0.11)
- Native (CDP-free, macOS) + hardened CDP + **extension mode** (trusted input, viewport
  coords, no debug port, cross-platform — E2E-verified, zero-step `ext-setup`).
- **API layer** (cross-platform vault: Keychain / libsecret / DPAPI + `api` caller + provider registry).
- **Agent layer** (SOUL/AGENTS/HEARTBEAT) + **SQLite brain** (episodes + learnings + rules).
- **Closed learning loop** + **semantic recall** (embeddings: relevance × importance × recency),
  reflection-synthesis, look-ahead before irreversible actions, evaluator gate.
- Self-learning (auto-capture selectors + auto-learn pacing), window-pinning.
- Initial record/replay for verified sequences, local run reports, `doctor`
  diagnostics, and protocol schema/types.

## Near-term
- **Validate native + extension modes on Linux & Windows.** The `xdotool` (Linux) and
  PowerShell SendInput (Windows) input paths are written but untested; macOS is
  validated. Confirm trusted-input + screenshot perception on the other platforms.
- **API auto-setup flows** — per-provider "browse → create key → store" recipes.
- **Native-mode perception beyond AppleScript.** On Linux/Windows there is no
  AppleScript DOM read; today those rely on screenshot + vision + `click_xy`. A
  cross-platform CDP-free read (e.g. a tiny content-script bridge, or accessibility
  APIs) would restore richer grounding.
- **Record & replay hardening** — broader replay fixtures, extension/native parity,
  and richer target stabilization for dynamic apps.

## Medium-term
- **Record & replay evolution.** Parameterized replays, data extraction outputs,
  and replay diff reports.
- **A real grounding model fallback.** A small GUI-grounding model for the vision
  path (UGround/OS-Atlas style) to improve coordinate accuracy on canvas UIs.
- **Natural-motion input.** Mouse-path curves + dwell-time variance for native mode,
  so interaction reads as human and stays reliable on strict sites.

## Longer-term
- **Parallel sessions / pooling** for CDP mode.
- **Pluggable CAPTCHA hand-off hooks** (human-in-the-loop by default — never an auto-solver).
- **First-class TypeScript types** for the action protocol.

## Explicit non-goals
- Pretending to defeat strict anti-bot systems at volume. We tell the truth about
  limits (see [RELIABILITY.md](docs/RELIABILITY.md)).
- Auto-solving CAPTCHAs. Default is human hand-off.
- Driving sites you're not permitted to automate. Respect Terms of Service.
