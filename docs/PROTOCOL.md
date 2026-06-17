# Action Protocol

Tsaagan's daemon control plane accepts a JSON envelope:

```json
{ "action": "click", "args": { "ref": "e5", "expectText": "Saved" } }
```

The public protocol artifacts live in:

- `protocol/actions.schema.json` — JSON Schema for action envelopes and common
  response shapes.
- `protocol/tsaagan.d.ts` — TypeScript declarations for common args and verified
  responses.

The CLI can print their absolute paths:

```bash
tsaagan protocol
```

Mutating browser actions should return:

```json
{
  "ok": true,
  "verify": {
    "urlBefore": "https://example.com/form",
    "urlAfter": "https://example.com/saved",
    "urlChanged": true,
    "newConsoleErrors": [],
    "failedRequests": []
  }
}
```

When a requested post-condition fails, `ok` is `false`, `error` explains the
failure, and the `verify` block still reports what the browser actually did.
