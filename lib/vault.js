// Secure secret vault — keys are stored with OS-native encryption, never in the
// repo / env / plaintext. A small index file records WHICH services have keys
// (names only, never the secret) so `vault list` works.
//   macOS   — Keychain (`security`)
//   Linux   — libsecret (`secret-tool`; install: apt install libsecret-tools)
//   Windows — DPAPI (PowerShell ProtectedData, per-user encrypted file)

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const PLATFORM = process.platform;
const DIR = path.join(os.homedir(), '.tsaagan');
const VAULT_DIR = path.join(DIR, 'vault'); // Windows DPAPI ciphertext files live here
fs.mkdirSync(DIR, { recursive: true });
const INDEX = path.join(DIR, 'vault-index.json'); // {service: [accounts]} — NO secrets
const NS = 'tsaagan:';

function sh(cmd, args, input, env) {
  return new Promise((resolve, reject) => {
    const opts = { timeout: 15000 };
    if (env) opts.env = { ...process.env, ...env };
    const p = execFile(cmd, args, opts, (err, stdout) => (err ? reject(err) : resolve(stdout)));
    if (input != null) {
      p.stdin.write(input);
      p.stdin.end();
    }
  });
}
// The vault file path is passed via $env:TSG_VF (never string-interpolated into the
// script) so a homedir containing a quote/apostrophe can't break the PS literal.
const ps = (script, input, env) => sh('powershell', ['-NoProfile', '-Command', script], input, env);
const readIndex = () => {
  try {
    return JSON.parse(fs.readFileSync(INDEX, 'utf8'));
  } catch {
    return {};
  }
};
const writeIndex = (idx) => {
  try {
    fs.writeFileSync(INDEX, JSON.stringify(idx, null, 2));
  } catch {}
};
const winFile = (service, account) =>
  path.join(VAULT_DIR, `${(service + '__' + account).replace(/[^a-z0-9._-]/gi, '_')}.b64`);

export async function setKey(service, account, secret) {
  if (!service || !secret) throw new Error('service and secret required');
  const acct = account || 'default';
  if (PLATFORM === 'darwin') {
    // `security` prompts for the password when -w is given with no value, reading it
    // from stdin (enter + retype), so the secret never appears in argv / `ps` on a
    // shared machine. The prompt is line-based and can't carry an embedded newline,
    // so for the (rare) multi-line secret we fall back to the argv -w path — briefly
    // visible to `ps`, but the only way to store it faithfully via this CLI.
    const args = ['add-generic-password', '-U', '-s', NS + service, '-a', acct, '-w'];
    if (String(secret).includes('\n')) await sh('security', [...args, String(secret)]);
    else await sh('security', args, String(secret) + '\n' + String(secret) + '\n');
  } else if (PLATFORM === 'linux') {
    await sh('secret-tool', ['store', '--label=' + NS + service, 'service', NS + service, 'account', acct], String(secret));
  } else if (PLATFORM === 'win32') {
    fs.mkdirSync(VAULT_DIR, { recursive: true });
    const f = winFile(service, acct);
    await ps(
      `Add-Type -AssemblyName System.Security; $s=[Console]::In.ReadToEnd(); $b=[Text.Encoding]::UTF8.GetBytes($s); $e=[Security.Cryptography.ProtectedData]::Protect($b,$null,'CurrentUser'); [IO.File]::WriteAllText($env:TSG_VF,[Convert]::ToBase64String($e))`,
      String(secret),
      { TSG_VF: f }
    );
  } else throw new Error('unsupported platform for vault: ' + PLATFORM);
  const idx = readIndex();
  idx[service] = Array.from(new Set([...(idx[service] || []), acct]));
  writeIndex(idx);
  return { ok: true, service, account: acct, backend: PLATFORM === 'darwin' ? 'keychain' : PLATFORM === 'linux' ? 'libsecret' : 'dpapi' };
}

export async function getKey(service, account) {
  const acct = account || 'default';
  try {
    if (PLATFORM === 'darwin')
      return (await sh('security', ['find-generic-password', '-s', NS + service, '-a', acct, '-w'])).replace(/\n$/, '');
    if (PLATFORM === 'linux')
      return (await sh('secret-tool', ['lookup', 'service', NS + service, 'account', acct])).replace(/\n$/, '') || null;
    if (PLATFORM === 'win32') {
      const f = winFile(service, acct);
      if (!fs.existsSync(f)) return null;
      return (
        await ps(
          `Add-Type -AssemblyName System.Security; $e=[Convert]::FromBase64String([IO.File]::ReadAllText($env:TSG_VF)); $b=[Security.Cryptography.ProtectedData]::Unprotect($e,$null,'CurrentUser'); [Console]::Out.Write([Text.Encoding]::UTF8.GetString($b))`,
          null,
          { TSG_VF: f }
        )
      ).trim();
    }
  } catch {
    return null;
  }
  return null;
}

export async function deleteKey(service, account) {
  const acct = account || 'default';
  try {
    if (PLATFORM === 'darwin') await sh('security', ['delete-generic-password', '-s', NS + service, '-a', acct]);
    else if (PLATFORM === 'linux') await sh('secret-tool', ['clear', 'service', NS + service, 'account', acct]);
    else if (PLATFORM === 'win32') fs.rmSync(winFile(service, acct), { force: true });
  } catch {}
  const idx = readIndex();
  if (idx[service]) {
    idx[service] = idx[service].filter((a) => a !== acct);
    if (!idx[service].length) delete idx[service];
    writeIndex(idx);
  }
  return { ok: true };
}

export function listKeys() {
  return readIndex();
}
