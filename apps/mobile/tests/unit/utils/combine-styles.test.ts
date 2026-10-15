import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { combineStyles } from '@/src/utils/combine-styles';

describe('combineStyles', () => {
  it('returns the same object reference it was given', () => {
    const styles = { root: { flex: 1 }, item: { padding: 8 } };
    assert.equal(combineStyles(styles), styles);
  });

  it('preserves every key and value', () => {
    const styles = { a: { color: 'red' }, b: { color: 'blue' } };
    assert.deepEqual(combineStyles(styles), { a: { color: 'red' }, b: { color: 'blue' } });
  });

  it('handles an empty style map', () => {
    assert.deepEqual(combineStyles({}), {});
  });
});
