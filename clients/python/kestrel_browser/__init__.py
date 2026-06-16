"""Kestrel — verify-first, human-like browser control for AI agents (Python client).

A thin, dependency-free client that talks to the Kestrel daemon's localhost
control plane. Every call returns a ``KestrelResult`` pairing the data with the
``verify`` block — proof the action actually worked, not just that it was sent.

    from kestrel_browser import Kestrel

    k = Kestrel()                       # auto-starts a headless daemon
    k.goto("https://example.com", expect_text="Example Domain")
    r = k.extract("the page heading")
    print(r.data, r.verify)             # data + proof, together
    k.stop()

The daemon is the Node.js Kestrel install. The client finds it via, in order:
``daemon_cmd=``, ``$KESTREL_JS`` (path to kestrel.js), or a ``kestrel`` binary on
PATH. Pure standard library — no third-party dependencies.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

__version__ = "1.0.0"
__all__ = ["Kestrel", "KestrelResult"]

_INTERNAL = {"ok", "error", "verify", "cacheHit", "_cacheHit"}


@dataclass
class KestrelResult:
    """Result of one Kestrel action: the data plus proof it worked."""

    ok: bool
    data: Dict[str, Any]
    verify: Optional[Dict[str, Any]]  # urlChanged / consoleErrors / failedRequests / expectTextFound
    cached: bool
    latency_ms: int
    error: Optional[str] = None


class Kestrel:
    def __init__(
        self,
        port: Optional[int] = None,
        auto_start: bool = True,
        mode: str = "fresh",
        headless: bool = True,
        timeout: float = 60.0,
        token: Optional[str] = None,
        daemon_cmd: Optional[List[str]] = None,
    ) -> None:
        self.port = int(port or os.environ.get("KES_PORT", 39817))
        self.base = f"http://127.0.0.1:{self.port}/"
        self.auto_start = auto_start
        self.mode = mode
        self.headless = headless
        self.timeout = timeout
        self.token = token or os.environ.get("KES_TOKEN")
        self.daemon_cmd = daemon_cmd
        self._ensured = False

    # ── transport ────────────────────────────────────────────────────────
    def _post(self, action: str, args: Optional[dict] = None) -> dict:
        body = json.dumps({"action": action, "args": args or {}}).encode()
        headers = {"content-type": "application/json"}
        if self.token:
            headers["x-kestrel-token"] = self.token
        req = urllib.request.Request(self.base, data=body, headers=headers, method="POST")
        with urllib.request.urlopen(req, timeout=self.timeout) as resp:
            return json.loads(resp.read().decode())

    def alive(self) -> bool:
        try:
            self._post("status")
            return True
        except Exception:
            return False

    def _start_cmd(self) -> List[str]:
        if self.daemon_cmd:
            base = list(self.daemon_cmd)
        elif os.environ.get("KESTREL_JS"):
            base = ["node", os.environ["KESTREL_JS"]]
        elif shutil.which("kestrel"):
            base = ["kestrel"]
        else:
            raise RuntimeError(
                "cannot locate Kestrel to start a daemon — set KESTREL_JS=/path/to/kestrel.js, "
                "pass daemon_cmd=[...], or install the `kestrel` CLI on PATH"
            )
        cmd = base + ["start", f"port={self.port}", f"mode={self.mode}"]
        if self.headless:
            cmd.append("headless=true")
        return cmd

    def ready(self) -> None:
        """Ensure a daemon is reachable, auto-starting one if allowed. Idempotent."""
        if self._ensured:
            return
        if self.alive():
            self._ensured = True
            return
        if not self.auto_start:
            raise RuntimeError(f"no Kestrel daemon on {self.base} (auto_start is off)")
        subprocess.Popen(self._start_cmd(), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(50):
            time.sleep(0.3)
            if self.alive():
                self._ensured = True
                return
        raise RuntimeError("daemon did not become ready; see ~/.kestrel/daemon.log")

    def raw(self, action: str, args: Optional[dict] = None) -> KestrelResult:
        """Send one {action, args} and wrap the response as a KestrelResult."""
        self.ready()
        t0 = time.time()
        try:
            res = self._post(action, args)
        except Exception as e:  # noqa: BLE001 — surface any transport error in the result
            return KestrelResult(False, {}, None, False, int((time.time() - t0) * 1000), str(e))
        data = {k: v for k, v in res.items() if k not in _INTERNAL}
        return KestrelResult(
            ok=res.get("ok") is not False,
            data=data,
            verify=res.get("verify"),
            cached=bool(res.get("cacheHit") or res.get("_cacheHit")),
            latency_ms=int((time.time() - t0) * 1000),
            error=res.get("error"),
        )

    # ── perception ───────────────────────────────────────────────────────
    def status(self) -> KestrelResult:
        return self.raw("status")

    def snapshot(self, full: bool = False) -> KestrelResult:
        return self.raw("snapshot", {"full": full} if full else {})

    def extract(self, query: str) -> KestrelResult:
        return self.raw("extract", {"query": query})

    def console_log(self, limit: int = 20) -> KestrelResult:
        return self.raw("console_log", {"limit": limit})

    def network(self, filter: Optional[str] = None, limit: int = 30) -> KestrelResult:
        args: Dict[str, Any] = {"limit": limit}
        if filter:
            args["filter"] = filter
        return self.raw("network", args)

    def recall(self, domain: str) -> KestrelResult:
        return self.raw("recall", {"domain": domain})

    # ── navigation ───────────────────────────────────────────────────────
    def goto(self, url: str, expect_text: Optional[str] = None) -> KestrelResult:
        args: Dict[str, Any] = {"url": url}
        if expect_text:
            args["expectText"] = expect_text
        return self.raw("goto", args)

    def back(self) -> KestrelResult:
        return self.raw("back")

    def scroll(self, direction: str = "down", to_text: Optional[str] = None) -> KestrelResult:
        args: Dict[str, Any] = {"direction": direction}
        if to_text:
            args["to_text"] = to_text
        return self.raw("scroll", args)

    def wait_for(
        self,
        text: Optional[str] = None,
        selector: Optional[str] = None,
        url: Optional[str] = None,
        networkidle: bool = False,
        timeout: int = 15000,
    ) -> KestrelResult:
        args: Dict[str, Any] = {"timeout": timeout}
        if text:
            args["text"] = text
        if selector:
            args["selector"] = selector
        if url:
            args["url"] = url
        if networkidle:
            args["networkidle"] = True
        return self.raw("wait_for", args)

    # ── action (verify-first) ────────────────────────────────────────────
    def click(
        self,
        ref: Optional[str] = None,
        selector: Optional[str] = None,
        text: Optional[str] = None,
        expect_text: Optional[str] = None,
        expect_gone: Optional[str] = None,
    ) -> KestrelResult:
        args: Dict[str, Any] = {}
        if ref:
            args["ref"] = ref
        if selector:
            args["selector"] = selector
        if text:
            args["text"] = text
        if expect_text:
            args["expectText"] = expect_text
        if expect_gone:
            args["expectGone"] = expect_gone
        return self.raw("click", args)

    def type(
        self,
        text: str,
        ref: Optional[str] = None,
        selector: Optional[str] = None,
        submit: bool = False,
        expect_text: Optional[str] = None,
    ) -> KestrelResult:
        args: Dict[str, Any] = {"text": text}
        if ref:
            args["ref"] = ref
        if selector:
            args["selector"] = selector
        if submit:
            args["submit"] = True
        if expect_text:
            args["expectText"] = expect_text
        return self.raw("type", args)

    def fill_form(
        self, fields: List[Dict[str, Any]], submit: bool = False, expect_text: Optional[str] = None
    ) -> KestrelResult:
        args: Dict[str, Any] = {"fields": fields}
        if submit:
            args["submit"] = True
        if expect_text:
            args["expectText"] = expect_text
        return self.raw("fill_form", args)

    def select(
        self,
        ref: Optional[str] = None,
        selector: Optional[str] = None,
        value: Optional[str] = None,
        label: Optional[str] = None,
    ) -> KestrelResult:
        args: Dict[str, Any] = {}
        if ref:
            args["ref"] = ref
        if selector:
            args["selector"] = selector
        if value is not None:
            args["value"] = value
        if label is not None:
            args["label"] = label
        return self.raw("select", args)

    def press(self, keys: str, expect_text: Optional[str] = None) -> KestrelResult:
        args: Dict[str, Any] = {"keys": keys}
        if expect_text:
            args["expectText"] = expect_text
        return self.raw("press", args)

    def assert_state(
        self,
        text: Optional[str] = None,
        url: Optional[str] = None,
        selector_visible: Optional[str] = None,
    ) -> KestrelResult:
        args: Dict[str, Any] = {}
        if text:
            args["text"] = text
        if url:
            args["url"] = url
        if selector_visible:
            args["selectorVisible"] = selector_visible
        return self.raw("assert", args)

    def screenshot(self, path: Optional[str] = None, full_page: bool = False) -> KestrelResult:
        args: Dict[str, Any] = {}
        if path:
            args["path"] = path
        if full_page:
            args["fullPage"] = True
        return self.raw("screenshot", args)

    # ── tabs ─────────────────────────────────────────────────────────────
    def tabs(self) -> KestrelResult:
        return self.raw("tabs")

    def switch_tab(self, index: int) -> KestrelResult:
        return self.raw("switch_tab", {"index": index})

    def new_tab(self, url: Optional[str] = None) -> KestrelResult:
        return self.raw("new_tab", {"url": url} if url else {})

    def close_tab(self, index: Optional[int] = None) -> KestrelResult:
        return self.raw("close_tab", {} if index is None else {"index": index})

    # ── lifecycle ────────────────────────────────────────────────────────
    def stop(self) -> KestrelResult:
        """Shut down the daemon (kills the browser). Use only if you own this daemon."""
        return self.raw("stop")
