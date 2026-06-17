# API layer — skip the browser when a site has an API

The fastest and most reliable way to do a web task is often **not a browser at
all** — it's the site's official API. Tsaagan's API layer lets your agent prefer
that path, with keys stored securely and even **set up for you by the browser
layers**.

## Secure key vault (OS-native: Keychain / libsecret / DPAPI)

Keys live in your **OS-native secret store** — macOS Keychain, Linux libsecret, or
Windows DPAPI — OS-encrypted, unreadable without your login, never in the repo, never
in env, never a plaintext file. A small index file records *which* services have keys
(names only, never the secret).

```bash
tsaagan vault set service=openai secret="sk-…"        # stored in Keychain
tsaagan vault set service=github account=work secret="ghp_…"
tsaagan vault list                                     # { openai:[default], github:[work] } — names only
tsaagan vault get service=openai                       # prints the secret (your explicit request)
tsaagan vault delete service=openai
```

## Authenticated calls

```bash
tsaagan api providers                                  # known services
tsaagan api detect=https://api.openai.com/v1/models    # is there a known API for this host?
tsaagan api service=openai path=/models                # GET with the stored key + provider defaults
tsaagan api service=github path=/user
tsaagan api service=stripe path=/customers method=GET
tsaagan api url=https://any.api/endpoint service=openai method=POST body='{"x":1}'
```

The provider registry (`lib/providers.json`) knows each service's base URL + auth
header format (Bearer / x-api-key / extra headers). Add your own by editing it.

## Browser-bootstrapped key setup (the elegant part)

The browser layer **bootstraps** the API layer. When Tsaagan lands on a site that
offers an API, the agent can:

1. `tsaagan api detect=<current url>` → find the key-creation URL.
2. Drive the browser to that page (you're already logged in), create a key, and read
   it off the page.
3. `tsaagan vault set service=<x> secret=<the key>` → stored in Keychain.
4. Tell you: *"this site has an API — I set it up; future tasks will use it directly."*

From then on, that task runs through the API (Layer 1) instead of the UI.

## Security model

- Secrets: **OS-native vault only** (Keychain / libsecret / DPAPI). The `api` caller
  reads a key at call-time and never logs it. `vault get` prints a secret only because
  you explicitly asked.
- No third party sees your keys; calls go straight from your machine to the provider.
- **Cross-platform, OS-native encryption:** macOS **Keychain** (`security`), Linux
  **libsecret** (`secret-tool`; `apt install libsecret-tools`), Windows **DPAPI**
  (per-user encrypted file via PowerShell). Same `vault` commands everywhere.

## Why this is the safest layer

No browser, no UI to drive, no scraping — just your own credentials calling an
official API you're entitled to use. Faster and more robust. Prefer it whenever it exists.
