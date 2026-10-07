import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  hasExactSearchQuotes,
  isExactSearchQuery,
  toSearchQuery,
  unwrapExactSearchQuery,
  wrapExactSearchQuery,
} from '@/src/features/global-search/utils/exact-search';

describe('exact search helpers', () => {
  it('detects wrapping quotes', () => {
    assert.equal(hasExactSearchQuotes('"payment failed"'), true);
    assert.equal(hasExactSearchQuotes('payment failed'), false);
    assert.equal(hasExactSearchQuotes('""'), true);
  });

  it('requires non-empty inner text for an exact query', () => {
    assert.equal(isExactSearchQuery('"payment failed"'), true);
    assert.equal(isExactSearchQuery('""'), false);
    assert.equal(isExactSearchQuery('"   "'), false);
  });

  it('unwraps and wraps phrase queries', () => {
    assert.equal(unwrapExactSearchQuery('"payment failed"'), 'payment failed');
    assert.equal(unwrapExactSearchQuery('payment failed'), 'payment failed');
    assert.equal(wrapExactSearchQuery('payment failed'), '"payment failed"');
    assert.equal(wrapExactSearchQuery('"payment failed"'), '"payment failed"');
    assert.equal(wrapExactSearchQuery(''), '');
  });

  it('folds the mode flag into q only when exact is on', () => {
    assert.equal(toSearchQuery('payment failed', true), '"payment failed"');
    assert.equal(toSearchQuery('payment failed', false), 'payment failed');
    assert.equal(toSearchQuery('"payment failed"', false), '"payment failed"');
  });
});
