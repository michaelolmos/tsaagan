import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setKey, getKey, deleteKey, listKeys } from '../lib/vault.js';

// Round-trips a secret through the OS-native vault. macOS uses the Keychain; the
// test is skipped elsewhere to keep CI green without libsecret/DPAPI installed.
// Uses a unique service name and cleans up so it never touches real keys.
const RUN = process.platform === 'darwin';
const SERVICE = 'tsaagan-selftest-' + process.pid;
const ACCOUNT = 'ci';
const SECRET = "s3cr3t with spaces, $pecial & 'quotes'"; // exercise shell-sensitive chars

test('vault set → get → delete round-trip (macOS)', { skip: !RUN }, async () => {
  try {
    await setKey(SERVICE, ACCOUNT, SECRET);
    assert.equal(await getKey(SERVICE, ACCOUNT), SECRET, 'secret round-trips intact');
    assert.ok(listKeys()[SERVICE]?.includes(ACCOUNT), 'index records the service/account (names only)');
    await deleteKey(SERVICE, ACCOUNT);
    assert.equal(await getKey(SERVICE, ACCOUNT), null, 'secret is gone after delete');
  } finally {
    await deleteKey(SERVICE, ACCOUNT).catch(() => {}); // belt-and-suspenders cleanup
  }
});
