import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  groupReactionsForPill,
  totalReactionCount,
  type RawReaction,
  type PillEmojiGroup,
} from '@/src/components/chat/message/reactions/reaction-pill.utils';

function reaction(overrides: Partial<RawReaction> = {}): RawReaction {
  return {
    createdAt: 1,
    emojiName: 'thumbsup',
    messageId: 'm1',
    reactionId: 'r1',
    userId: 'u1',
    ...overrides,
  };
}

function firstGroup(groups: PillEmojiGroup[]): PillEmojiGroup {
  const [group] = groups;
  assert.ok(group, 'expected at least one group');
  return group;
}

describe('groupReactionsForPill', () => {
  it('returns an empty array for no reactions', () => {
    assert.deepEqual(groupReactionsForPill([]), []);
  });

  it('aggregates a single emoji into one group with the correct count', () => {
    const groups = groupReactionsForPill([
      reaction({ emojiName: 'heart', createdAt: 10, userId: 'a' }),
      reaction({ emojiName: 'heart', createdAt: 20, userId: 'b' }),
      reaction({ emojiName: 'heart', createdAt: 30, userId: 'c' }),
    ]);
    assert.equal(groups.length, 1);
    assert.deepEqual(firstGroup(groups), {
      emojiName: 'heart',
      count: 3,
      earliestTimestamp: 10,
    });
  });

  it('tracks the earliest timestamp regardless of input order', () => {
    const groups = groupReactionsForPill([
      reaction({ emojiName: 'heart', createdAt: 50 }),
      reaction({ emojiName: 'heart', createdAt: 5 }),
      reaction({ emojiName: 'heart', createdAt: 40 }),
    ]);
    const group = firstGroup(groups);
    assert.equal(group.earliestTimestamp, 5);
    assert.equal(group.count, 3);
  });

  it('separates distinct emojis into distinct groups', () => {
    const groups = groupReactionsForPill([
      reaction({ emojiName: 'heart', createdAt: 10 }),
      reaction({ emojiName: 'laugh', createdAt: 20 }),
      reaction({ emojiName: 'heart', createdAt: 30 }),
    ]);
    assert.equal(groups.length, 2);
    const byName = new Map(groups.map(g => [g.emojiName, g.count]));
    assert.equal(byName.get('heart'), 2);
    assert.equal(byName.get('laugh'), 1);
  });

  it('orders groups by earliest timestamp ascending', () => {
    const groups = groupReactionsForPill([
      reaction({ emojiName: 'late', createdAt: 100 }),
      reaction({ emojiName: 'early', createdAt: 1 }),
      reaction({ emojiName: 'mid', createdAt: 50 }),
    ]);
    assert.deepEqual(
      groups.map(g => g.emojiName),
      ['early', 'mid', 'late'],
    );
  });

  it('does not mutate the input array', () => {
    const input = [
      reaction({ emojiName: 'heart', createdAt: 10 }),
      reaction({ emojiName: 'heart', createdAt: 5 }),
    ];
    const snapshot = input.map(r => ({ ...r }));
    groupReactionsForPill(input);
    assert.deepEqual(input, snapshot);
  });
});

describe('totalReactionCount', () => {
  it('returns 0 for no reactions', () => {
    assert.equal(totalReactionCount([]), 0);
  });

  it('counts every raw reaction, not distinct emojis', () => {
    const reactions = [
      reaction({ emojiName: 'heart' }),
      reaction({ emojiName: 'heart' }),
      reaction({ emojiName: 'laugh' }),
    ];
    assert.equal(totalReactionCount(reactions), 3);
  });
});
