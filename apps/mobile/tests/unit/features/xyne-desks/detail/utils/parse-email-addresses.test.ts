import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  asStringArray,
  displayNameFromAddress,
  normalizeEmailAddress,
} from '@/src/features/xyne-desks/detail/utils/parse-email-addresses';

describe('parse-email-addresses / asStringArray', () => {
  it('keeps only non-empty strings from an array', () => {
    assert.deepEqual(asStringArray(['a', '', '  ', 'b', 3, null]), ['a', 'b']);
  });

  it('wraps a single trimmed string', () => {
    assert.deepEqual(asStringArray('  solo@x.com '), ['solo@x.com']);
  });

  it('returns an empty array for unusable values', () => {
    assert.deepEqual(asStringArray(''), []);
    assert.deepEqual(asStringArray('   '), []);
    assert.deepEqual(asStringArray(null), []);
    assert.deepEqual(asStringArray(undefined), []);
    assert.deepEqual(asStringArray(42), []);
  });
});

describe('parse-email-addresses / normalizeEmailAddress', () => {
  it('extracts the address from angle brackets and lowercases it', () => {
    assert.equal(normalizeEmailAddress('Jane Doe <Jane.Doe@X.COM>'), 'jane.doe@x.com');
  });

  it('lowercases and trims a bare address', () => {
    assert.equal(normalizeEmailAddress('  USER@Example.COM '), 'user@example.com');
  });
});

describe('parse-email-addresses / displayNameFromAddress', () => {
  it('returns the display name from a "Name <addr>" pair', () => {
    assert.equal(displayNameFromAddress('Jane Doe <jane@x.com>'), 'Jane Doe');
  });

  it('strips surrounding quotes from the display name', () => {
    assert.equal(displayNameFromAddress('"Jane Doe" <jane@x.com>'), 'Jane Doe');
  });

  it('derives the local part when there is no display name', () => {
    assert.equal(displayNameFromAddress('jane@x.com'), 'jane');
    assert.equal(displayNameFromAddress('<jane@x.com>'), 'jane');
  });
});
