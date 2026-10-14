import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  asStringArray,
  normalizeEmailAddress,
  displayNameFromAddress,
} from '@/src/features/xyne-desks/detail/utils/parse-email-addresses';

describe('asStringArray', () => {
  it('keeps only non-blank strings from an array and drops non-strings', () => {
    assert.deepEqual(asStringArray(['a@x.com', '', '   ', 'b@y.com', 3, null, undefined, {}]), [
      'a@x.com',
      'b@y.com',
    ]);
  });

  it('preserves the original (untrimmed) string when it has non-space content', () => {
    assert.deepEqual(asStringArray(['  keep  ']), ['  keep  ']);
  });

  it('wraps a single non-blank string into a trimmed one-element array', () => {
    assert.deepEqual(asStringArray('  solo@x.com  '), ['solo@x.com']);
  });

  it('returns an empty array for blank or non-string inputs', () => {
    assert.deepEqual(asStringArray(''), []);
    assert.deepEqual(asStringArray('   '), []);
    assert.deepEqual(asStringArray(null), []);
    assert.deepEqual(asStringArray(undefined), []);
    assert.deepEqual(asStringArray(42), []);
    assert.deepEqual(asStringArray({ a: 1 }), []);
  });
});

describe('normalizeEmailAddress', () => {
  it('extracts the address inside angle brackets and lowercases it', () => {
    assert.equal(normalizeEmailAddress('John Doe <John@Example.COM>'), 'john@example.com');
  });

  it('lowercases and trims a bare address', () => {
    assert.equal(normalizeEmailAddress('  Foo@Bar.com  '), 'foo@bar.com');
  });

  it('handles an angle-only value', () => {
    assert.equal(normalizeEmailAddress('<X@Y.com>'), 'x@y.com');
  });
});

describe('displayNameFromAddress', () => {
  it('returns the display name portion before the angle brackets', () => {
    assert.equal(displayNameFromAddress('Jane <jane@x.com>'), 'Jane');
  });

  it('strips surrounding quotes from a quoted display name', () => {
    assert.equal(displayNameFromAddress('"John Doe" <john@x.com>'), 'John Doe');
    assert.equal(displayNameFromAddress("'Support Team' <s@x.com>"), 'Support Team');
  });

  it('falls back to the local part of a bare address', () => {
    assert.equal(displayNameFromAddress('bob@x.com'), 'bob');
  });

  it('handles an angle-only address by using its local part', () => {
    assert.equal(displayNameFromAddress('<solo@x.com>'), 'solo');
  });

  it('returns the whole token when there is no @', () => {
    assert.equal(displayNameFromAddress('noatsign'), 'noatsign');
  });

  it('returns an empty string for empty input', () => {
    assert.equal(displayNameFromAddress(''), '');
  });
});
