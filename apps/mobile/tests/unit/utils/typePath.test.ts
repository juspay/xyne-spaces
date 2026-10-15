import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getByPath, setByPath } from '@/src/utils/typePath';

describe('getByPath', () => {
  it('reads a top-level key', () => {
    assert.deepEqual(getByPath({ a: { b: 1 } }, 'a'), { b: 1 });
  });

  it('reads a nested key via dot path', () => {
    assert.equal(getByPath({ a: { b: 1 } }, 'a.b'), 1);
  });

  it('returns undefined for a missing nested key', () => {
    assert.equal(getByPath({ a: { b: 1 } } as { a: { b: number; c?: number } }, 'a.c'), undefined);
  });

  it('returns undefined when descending through a non-object', () => {
    assert.equal(getByPath({ a: 1 } as unknown as { a: { b: number } }, 'a.b'), undefined);
  });

  it('returns undefined when descending through null', () => {
    assert.equal(getByPath({ a: null } as unknown as { a: { b: number } }, 'a.b'), undefined);
  });
});

describe('setByPath', () => {
  it('sets a top-level key immutably', () => {
    const original = { a: 1 };
    const result = setByPath(original, 'b', 2);
    assert.deepEqual(result, { a: 1, b: 2 });
    assert.deepEqual(original, { a: 1 });
    assert.notEqual(result, original);
  });

  it('sets a nested key without mutating the source', () => {
    const original = { a: { b: 1 } };
    const result = setByPath(original, 'a.c', 2);
    assert.deepEqual(result, { a: { b: 1, c: 2 } });
    assert.deepEqual(original, { a: { b: 1 } });
    assert.notEqual(result.a, original.a);
  });

  it('creates missing intermediate objects', () => {
    assert.deepEqual(setByPath({}, 'a.b', 1), { a: { b: 1 } });
  });

  it('returns the same object reference for an empty path', () => {
    const original = { a: 1 };
    assert.equal(setByPath(original, '', 9), original);
  });
});
