// Unit tests for semantic embeddings (the default zero-dep lexical tier).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { embed, cosine, embedMode } from '../lib/embed.js';

test('embed returns a non-empty numeric vector', async () => {
  const v = await embed('log in to your account');
  assert.ok(Array.isArray(v) && v.length > 0);
  assert.equal(typeof v[0], 'number');
});

test('paraphrases are closer than unrelated text', async () => {
  const login = await embed('log in to your account');
  const signin = await embed('sign in to the website');
  const del = await embed('permanently delete all files');
  const near = cosine(login, signin);
  const far = cosine(login, del);
  assert.ok(near > far, `expected login~signin (${near.toFixed(2)}) > login~delete (${far.toFixed(2)})`);
  assert.ok(near > 0.4, `expected meaningful paraphrase similarity, got ${near.toFixed(2)}`);
});

test('cosine is 1 for identical vectors and 0 for length mismatch', async () => {
  const v = await embed('checkout and pay');
  assert.ok(Math.abs(cosine(v, v) - 1) < 1e-9);
  assert.equal(cosine([1, 2, 3], [1, 2]), 0);
});

test('embedMode reports a tier', () => {
  assert.ok(['lexical', 'url', 'xenova'].includes(embedMode()));
});
