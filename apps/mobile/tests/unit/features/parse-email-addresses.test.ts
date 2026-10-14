import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  asStringArray,
  normalizeEmailAddress,
  displayNameFromAddress,
} from '@/src/features/xyne-desks/detail/utils/parse-email-addresses';

describe('asStringArray', () => {
  it('keeps only non-empty strings from an array and trims nothing but drops blanks', () => {
    assert.deepEqual(asStringArray(['a', ' ', 'b ', 2, null]), ['a', 'b ']);
  });

  it('wraps a single non-blank string into a trimmed one-element array', () => {
    assert.deepEqual(asStringArray('  solo  '), ['solo']);
  });

  it('returns an empty array for a blank string', () => {
    assert.deepEqual(asStringArray('   '), []);
  });

  it('returns an empty array for non-string, non-array inputs', () => {
    assert.deepEqual(asStringArray(42), []);
    assert.deepEqual(asStringArray(undefined), []);
    assert.deepEqual(asStringArray(null), []);
    assert.deepEqual(asStringArray({ a: 1 }), []);
  });
});

describe('normalizeEmailAddress', () => {
  it('extracts and lowercases the address inside angle brackets', () => {
    assert.equal(normalizeEmailAddress('Alice <ALICE@Example.com>'), 'alice@example.com');
  });

  it('trims and lowercases a bare address', () => {
    assert.equal(normalizeEmailAddress('  BOB@Example.COM  '), 'bob@example.com');
  });

  it('returns the lowercased input when there are no angle brackets', () => {
    assert.equal(normalizeEmailAddress('no-brackets'), 'no-brackets');
  });
});

describe('displayNameFromAddress', () => {
  it('returns the quoted display name before an angle-bracket address', () => {
    assert.equal(displayNameFromAddress('"Alice Smith" <alice@x.com>'), 'Alice Smith');
  });

  it('strips single quotes around the display name', () => {
    assert.equal(displayNameFromAddress("'Quoted Name' <q@x.com>"), 'Quoted Name');
  });

  it('returns the unquoted display name when present', () => {
    assert.equal(displayNameFromAddress('Bob <bob@x.com>'), 'Bob');
  });

  it('falls back to the local part of a bare address', () => {
    assert.equal(displayNameFromAddress('carol@x.com'), 'carol');
  });

  it('strips angle brackets and uses the local part when only an address is given', () => {
    assert.equal(displayNameFromAddress('<dave@x.com>'), 'dave');
  });
});
