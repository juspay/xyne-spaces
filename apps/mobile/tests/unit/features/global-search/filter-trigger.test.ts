import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  detectFilterTrigger,
  toFreeText,
  stripActiveTrigger,
} from '@/src/features/global-search/utils/filter-trigger';

describe('detectFilterTrigger', () => {
  it('returns null when there is no operator', () => {
    assert.equal(detectFilterTrigger('hello world'), null);
  });

  it('detects a from: trigger and strips a leading @', () => {
    assert.deepEqual(detectFilterTrigger('from: alice'), {
      kind: 'from',
      query: 'alice',
      startIndex: 0,
      inMode: 'all',
    });
    assert.deepEqual(detectFilterTrigger('from:@bob'), {
      kind: 'from',
      query: 'bob',
      startIndex: 0,
      inMode: 'all',
    });
  });

  it('detects an in: trigger with @ / # compound modifiers', () => {
    assert.deepEqual(detectFilterTrigger('in: general'), {
      kind: 'in',
      query: 'general',
      startIndex: 0,
      inMode: 'all',
    });
    assert.deepEqual(detectFilterTrigger('in: #eng'), {
      kind: 'in',
      query: 'eng',
      startIndex: 0,
      inMode: 'channels',
    });
    assert.deepEqual(detectFilterTrigger('in: @carol'), {
      kind: 'in',
      query: 'carol',
      startIndex: 0,
      inMode: 'dms',
    });
  });

  it('prefers the rightmost operator', () => {
    assert.equal(detectFilterTrigger('in:x from:y')?.kind, 'from');
    assert.equal(detectFilterTrigger('from:a in:b')?.kind, 'in');
    assert.equal(detectFilterTrigger('from:a in:b')?.query, 'b');
  });
});

describe('toFreeText', () => {
  it('returns the trimmed query when no operator is present', () => {
    assert.equal(toFreeText('  hello world  '), 'hello world');
  });

  it('returns only the text before the operator', () => {
    assert.equal(toFreeText('find me from:alice'), 'find me');
    assert.equal(toFreeText('in:general'), '');
  });
});

describe('stripActiveTrigger', () => {
  it('removes the incomplete operator segment and trailing whitespace', () => {
    assert.equal(stripActiveTrigger('hello from:al'), 'hello');
  });

  it('leaves the query unchanged when there is no operator', () => {
    assert.equal(stripActiveTrigger('hello'), 'hello');
  });
});
