# kestrel-browser (Python client)

A thin, **dependency-free** Python client for [Kestrel](https://github.com/michaelolmos/kestrel) —
verify-first, human-like browser control for AI agents. Every call returns the data
**and** a `verify` block proving the action worked.

```bash
pip install kestrel-browser
```

You also need the Kestrel daemon (the Node.js install). The client finds it via
`daemon_cmd=`, the `$KESTREL_JS` env var (path to `kestrel.js`), or a `kestrel`
binary on your PATH.

```python
from kestrel_browser import Kestrel

k = Kestrel()                              # auto-starts a headless daemon
k.goto("https://example.com", expect_text="Example Domain")

r = k.extract("the page heading")
print(r.data)            # extracted data
print(r.verify)          # {'urlChanged': ..., 'newConsoleErrors': [], 'expectTextFound': True}
print(r.ok, r.cached, r.latency_ms)

k.stop()                                   # shut the daemon down
```

### Why verify-first?

`browser-use`, `stagehand`, and `playwright-mcp` return data or raise — you write your
own assertions to know an action landed. Kestrel returns proof on every call:

```python
res = k.click(text="Sign in", expect_text="Dashboard")
assert res.ok and res.verify["expectTextFound"], "login did not land"
```

### API

Perception: `status`, `snapshot(full=False)`, `extract(query)`, `console_log()`, `network()`, `recall(domain)`
Navigation: `goto(url, expect_text=)`, `back()`, `scroll()`, `wait_for(...)`
Action (verify-first): `click(...)`, `type(text, ...)`, `fill_form(fields, ...)`, `select(...)`, `press(keys, ...)`, `assert_state(...)`, `screenshot(...)`
Tabs: `tabs()`, `switch_tab(i)`, `new_tab(url)`, `close_tab(i)`
Lifecycle: `stop()`

Only automate sites you own or are authorized to use. See the main repo's
[Acceptable Use Policy](https://github.com/michaelolmos/kestrel/blob/main/ACCEPTABLE_USE.md).
