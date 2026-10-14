import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  resolveTopIndex,
  findNearestMatchingIndex,
} from '@/src/components/chat/date-pill/date-pill.utils';

describe('resolveTopIndex', () => {
  it('returns null when the list is empty', () => {
    assert.equal(resolveTopIndex(0, 0, 0), null);
    assert.equal(resolveTopIndex(3, 5, -1), null);
  });

  it('prefers a valid start index', () => {
    assert.equal(resolveTopIndex(2, 4, 10), 2);
    assert.equal(resolveTopIndex(0, 9, 10), 0);
  });

  it('falls back to end when start is out of range', () => {
    assert.equal(resolveTopIndex(-1, 4, 10), 4);
    assert.equal(resolveTopIndex(10, 7, 10), 7);
  });

  it('falls back to 0 when neither start nor end is valid', () => {
    assert.equal(resolveTopIndex(-1, -1, 10), 0);
    assert.equal(resolveTopIndex(10, 20, 10), 0);
  });

  it('rejects non-integer indices', () => {
    // 2.5 is not an integer -> skip start; 4 is valid -> use end.
    assert.equal(resolveTopIndex(2.5, 4, 10), 4);
    // both non-integer -> fall through to 0.
    assert.equal(resolveTopIndex(2.5, 3.5, 10), 0);
    assert.equal(resolveTopIndex(Number.NaN, Number.NaN, 10), 0);
  });

  it('treats an index equal to total as out of range', () => {
    // start === total is invalid (strict <), end within range used instead.
    assert.equal(resolveTopIndex(5, 4, 5), 4);
    // start === total, end === total -> both invalid -> 0.
    assert.equal(resolveTopIndex(5, 5, 5), 0);
  });
});

describe('findNearestMatchingIndex', () => {
  const items: string[] = ['a', 'b', 'c', 'd', 'e'];

  it('finds a match at the starting index', () => {
    assert.equal(
      findNearestMatchingIndex(items, 2, x => x === 'c'),
      2,
    );
  });

  it('searches forward before searching backward', () => {
    // From index 1, both "a" (backward) and "d" (forward) exist; forward wins.
    const idx = findNearestMatchingIndex(items, 1, x => x === 'a' || x === 'd');
    assert.equal(idx, 3);
  });

  it('searches backward when nothing matches forward', () => {
    assert.equal(
      findNearestMatchingIndex(items, 3, x => x === 'a'),
      0,
    );
  });

  it('returns -1 when nothing matches', () => {
    assert.equal(
      findNearestMatchingIndex(items, 0, x => x === 'z'),
      -1,
    );
  });

  it('handles an empty list', () => {
    assert.equal(
      findNearestMatchingIndex([], 0, () => true),
      -1,
    );
  });

  it('handles a fromIndex beyond the end by scanning backward', () => {
    assert.equal(
      findNearestMatchingIndex(items, 99, x => x === 'e'),
      4,
    );
  });

  it('skips falsy entries without calling the matcher on them', () => {
    const sparse: (string | undefined)[] = ['a', undefined, 'b'];
    let calls = 0;
    const idx = findNearestMatchingIndex(sparse, 0, x => {
      calls += 1;
      return x === 'b';
    });
    assert.equal(idx, 2);
    // Matcher runs for 'a' and 'b' only, never for the undefined hole.
    assert.equal(calls, 2);
  });
});
