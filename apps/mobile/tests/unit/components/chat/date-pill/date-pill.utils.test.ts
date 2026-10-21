import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  findNearestMatchingIndex,
  resolveTopIndex,
} from '@/src/components/chat/date-pill/date-pill.utils';

describe('date-pill / resolveTopIndex', () => {
  it('returns null when there are no items', () => {
    assert.equal(resolveTopIndex(0, 0, 0), null);
    assert.equal(resolveTopIndex(2, 3, -1), null);
  });

  it('prefers a valid start index', () => {
    assert.equal(resolveTopIndex(2, 5, 10), 2);
  });

  it('falls back to a valid end index when start is out of range', () => {
    assert.equal(resolveTopIndex(-1, 4, 10), 4);
    assert.equal(resolveTopIndex(20, 7, 10), 7);
  });

  it('falls back to 0 when neither index is usable', () => {
    assert.equal(resolveTopIndex(-1, -1, 10), 0);
    assert.equal(resolveTopIndex(1.5, 99, 10), 0);
  });
});

describe('date-pill / findNearestMatchingIndex', () => {
  const items = ['a', 'b', 'c', 'd', 'e'];

  it('finds a forward match starting at fromIndex', () => {
    assert.equal(
      findNearestMatchingIndex(items, 1, item => item === 'd'),
      3,
    );
  });

  it('scans backwards when no forward match exists', () => {
    assert.equal(
      findNearestMatchingIndex(items, 3, item => item === 'a'),
      0,
    );
  });

  it('returns -1 when nothing matches', () => {
    assert.equal(
      findNearestMatchingIndex(items, 0, item => item === 'z'),
      -1,
    );
  });

  it('skips falsy items safely', () => {
    const sparse = ['', 'x', ''] as const;
    assert.equal(
      findNearestMatchingIndex(sparse, 0, item => item.length === 0),
      -1,
    );
    assert.equal(
      findNearestMatchingIndex(sparse, 0, item => item === 'x'),
      1,
    );
  });
});
