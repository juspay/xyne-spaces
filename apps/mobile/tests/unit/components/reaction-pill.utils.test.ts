import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  groupReactionsForPill,
  totalReactionCount,
  type RawReaction,
} from '@/src/components/chat/message/reactions/reaction-pill.utils';

const reaction = (emojiName: string, createdAt: number, id: string): RawReaction => ({
  emojiName,
  createdAt,
  reactionId: id,
  messageId: 'm1',
  userId: `u-${id}`,
});

describe('groupReactionsForPill', () => {
  it('returns no groups for an empty list', () => {
    assert.deepEqual(groupReactionsForPill([]), []);
  });

  it('aggregates one group per emoji with a running count', () => {
    const groups = groupReactionsForPill([reaction('👍', 100, 'a'), reaction('👍', 200, 'b')]);
    assert.equal(groups.length, 1);
    const [group] = groups;
    assert.ok(group);
    assert.equal(group.emojiName, '👍');
    assert.equal(group.count, 2);
  });

  it('tracks the earliest timestamp within a group', () => {
    const groups = groupReactionsForPill([
      reaction('👍', 300, 'a'),
      reaction('👍', 50, 'b'),
      reaction('👍', 150, 'c'),
    ]);
    const [group] = groups;
    assert.ok(group);
    assert.equal(group.earliestTimestamp, 50);
  });

  it('orders groups by earliest reaction (first-reacted emoji first)', () => {
    const groups = groupReactionsForPill([
      reaction('👍', 300, 'a'),
      reaction('❤️', 100, 'b'),
      reaction('👍', 50, 'c'),
    ]);
    assert.deepEqual(
      groups.map(g => g.emojiName),
      ['👍', '❤️'],
    );
    assert.deepEqual(
      groups.map(g => g.count),
      [2, 1],
    );
  });

  it('does not mutate or reorder the input array', () => {
    const input = [reaction('👍', 300, 'a'), reaction('❤️', 100, 'b')];
    const order = input.map(r => r.reactionId);
    groupReactionsForPill(input);
    assert.deepEqual(
      input.map(r => r.reactionId),
      order,
    );
  });
});

describe('totalReactionCount', () => {
  it('counts every raw reaction regardless of emoji', () => {
    assert.equal(totalReactionCount([]), 0);
    assert.equal(
      totalReactionCount([reaction('👍', 1, 'a'), reaction('👍', 2, 'b'), reaction('❤️', 3, 'c')]),
      3,
    );
  });
});
