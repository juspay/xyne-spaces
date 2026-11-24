import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  replyCountLabel,
  stripRepliers,
  stripTime,
} from '@/src/features/conversation/model/thread-strip';

describe('replyCountLabel', () => {
  it('pluralises', () => {
    assert.equal(replyCountLabel(1), '1 reply');
    assert.equal(replyCountLabel(0), '0 replies');
    assert.equal(replyCountLabel(12), '12 replies');
  });
});

describe('stripRepliers', () => {
  it('keeps the most recent people, oldest of them first', () => {
    assert.deepEqual(stripRepliers(['a', 'b', 'c', 'd'], 3), ['b', 'c', 'd']);
  });

  it('shows each person once, at their latest reply', () => {
    assert.deepEqual(stripRepliers(['a', 'b', 'a', 'c'], 3), ['b', 'a', 'c']);
  });

  it('returns fewer than max when there are fewer people', () => {
    assert.deepEqual(stripRepliers(['a', 'a'], 3), ['a']);
    assert.deepEqual(stripRepliers([], 3), []);
  });
});

describe('stripTime', () => {
  const NOW = 1_800_000_000_000;

  it('shows the time the thread last moved', () => {
    assert.equal(stripTime(NOW - 10 * 60_000, NOW), '10m ago');
  });

  it('is empty without a time', () => {
    assert.equal(stripTime(undefined, NOW), '');
  });
});
