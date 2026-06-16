// Layer 1 — call official APIs directly with a Keychain-stored key, instead of
// driving the UI. Faster and more reliable, with no anti-bot friction. The browser
// layers bootstrap this layer (Kestrel can browse a site's developer settings,
// create a key, and `vault set` it — then everything after uses the API).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getKey } from './vault.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PROVIDERS = JSON.parse(fs.readFileSync(path.join(__dirname, 'providers.json'), 'utf8'));

// Make an authenticated request. `service` selects the stored key + provider
// defaults; `path` is appended to the provider base, or pass an absolute `url`.
export async function apiCall({ service, account, method = 'GET', url, path: p, body, headers = {} }) {
  const prov = PROVIDERS[service] || {};
  const key = await getKey(service, account);
  if (!key) return { ok: false, error: `no key stored for "${service}" — run: kestrel vault set service=${service} secret=…` };

  const full = url || (prov.base || '') + (p || '');
  if (!full) return { ok: false, error: 'need url= or a known service with a base + path=' };

  const h = { 'content-type': 'application/json', ...(prov.extraHeaders || {}), ...headers };
  if (prov.authHeader) h[prov.authHeader] = (prov.authScheme ? prov.authScheme + ' ' : '') + key;

  let res, text;
  try {
    res = await fetch(full, {
      method,
      headers: h,
      body: body != null ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
    });
    text = await res.text();
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch {}
  return { ok: res.ok, status: res.status, url: full, json, text: json ? undefined : text.slice(0, 4000) };
}

// Does a site likely offer an API we know about? (registry lookup by host)
export function detectApi(urlOrHost) {
  let host = String(urlOrHost || '');
  try {
    host = new URL(urlOrHost).hostname;
  } catch {}
  for (const [name, p] of Object.entries(PROVIDERS)) {
    const base = p.base || p.keyUrl || '';
    if (host && (base.includes(host.replace(/^www\./, '')) || host.includes(name))) {
      return { found: true, service: name, keyUrl: p.keyUrl, docs: p.docs };
    }
  }
  return { found: false };
}
