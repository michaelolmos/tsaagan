// Wake frozen tabs before attaching over CDP.
//
// Chrome's Memory Saver freezes background tabs. A frozen tab never answers CDP,
// and Playwright's connectOverCDP waits for every page, so one frozen tab (even a
// blank New Tab) hangs the attach until it times out. Seen on Chrome 150-156
// (2026-10-31: 45 s timeout -> 213 ms after waking the one frozen tab).
//
// Probe each page target; activate the ones that do not answer (activation thaws
// them), then re-activate the tab that was in front so the user's view is unchanged.

const probe = (wsUrl, timeoutMs) =>
  new Promise((resolve) => {
    let ws;
    const done = (ok) => {
      clearTimeout(timer);
      try { ws?.close(); } catch {}
      resolve(ok);
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    try {
      ws = new WebSocket(wsUrl);
    } catch {
      return done(false);
    }
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: '1' } }));
    ws.onmessage = () => done(true);
    ws.onerror = () => done(false);
  });

export async function wakeFrozenTabs(cdpHttp, { timeoutMs = 1500 } = {}) {
  const base = cdpHttp.replace(/\/$/, '');
  const pages = (await (await fetch(`${base}/json/list`)).json()).filter((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  const answers = await Promise.all(pages.map((t) => probe(t.webSocketDebuggerUrl, timeoutMs)));
  const frozen = pages.filter((_, i) => !answers[i]);
  for (const t of frozen) await fetch(`${base}/json/activate/${t.id}`).catch(() => {});
  // /json/list puts the most recently focused page first.
  if (frozen.length && pages[0] && frozen[0] !== pages[0]) await fetch(`${base}/json/activate/${pages[0].id}`).catch(() => {});
  return { checked: pages.length, woken: frozen.map((t) => t.url) };
}
