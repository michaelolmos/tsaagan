import { test } from 'node:test';
import assert from 'node:assert/strict';
import { likeEsc } from '../lib/brain.js';

// LIKE-wildcard escaping: a domain/query containing % or _ must not turn into a
// wildcard that matches unrelated rows (e.g. "a%z.com" matching "amazon.com").
test('likeEsc escapes % and _ and backslash', () => {
  assert.equal(likeEsc('amazon.com'), '%amazon.com%'); // plain domains untouched
  assert.equal(likeEsc('a%z.com'), '%a\\%z.com%'); // % is neutralized
  assert.equal(likeEsc('a_b'), '%a\\_b%'); // _ is neutralized
  assert.equal(likeEsc('a\\b'), '%a\\\\b%'); // literal backslash escaped first
  assert.equal(likeEsc(''), '%%'); // empty stays a match-all (intentional)
  assert.equal(likeEsc(null), '%%');
});

test('likeEsc neutralizes a wildcard-bearing domain so it cannot match a sibling', () => {
  // The escaped pattern for "a%z.com" must contain the escape sequence, so SQLite
  // (with ESCAPE '\') treats % as a literal — it can no longer match "amazon.com".
  const pattern = likeEsc('a%z.com');
  assert.ok(pattern.includes('\\%'), 'escaped % present');
  assert.ok(!pattern.includes('a%z'), 'raw a%z wildcard removed');
});
