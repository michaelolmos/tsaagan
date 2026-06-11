// Unit tests for the TOTP implementation against RFC 6238 official vectors.
// Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { totpCode, base32Decode } from '../lib/totp.js';

// RFC 6238 Appendix B uses the SHA-1 seed = ASCII "12345678901234567890",
// whose base32 is GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ. 8-digit codes truncate to 6.
const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

test('base32Decode round-trips the RFC seed to ASCII digits', () => {
  assert.equal(base32Decode(SECRET).toString('utf8'), '12345678901234567890');
});

test('TOTP matches RFC 6238 vector at T=59s (94287082 -> 287082)', () => {
  assert.equal(totpCode(SECRET, { t: 59_000 }), '287082');
});

test('TOTP matches RFC 6238 vector at T=1111111109s (07081804 -> 081804)', () => {
  assert.equal(totpCode(SECRET, { t: 1_111_111_109_000 }), '081804');
});

test('TOTP is stable within the same 30s window and changes across windows', () => {
  assert.equal(totpCode(SECRET, { t: 1000 }), totpCode(SECRET, { t: 25_000 }));
  assert.notEqual(totpCode(SECRET, { t: 1000 }), totpCode(SECRET, { t: 60_000 }));
});

test('TOTP output is always 6 digits', () => {
  assert.match(totpCode(SECRET, { t: 0 }), /^\d{6}$/);
});
