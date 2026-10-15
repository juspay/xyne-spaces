import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ChannelScopeType, ChannelType, type ChannelUserStatus } from '@xyne/shared';
import type { VisibleChannel } from '@xyne/shared/hooks';

import { groupChannelsByScope, isDMChannel, sortByActivity } from '@/src/utils/chatDirectory';

const channel = (overrides: Partial<VisibleChannel> = {}): VisibleChannel =>
  ({
    id: 'c1',
    type: ChannelType.DEFAULT,
    scopeType: ChannelScopeType.DEFAULT,
    channelStats: { lastActivityAt: 0 },
    ...overrides,
  }) as unknown as VisibleChannel;

const status = (overrides: Partial<ChannelUserStatus> & { channelId: string }): ChannelUserStatus =>
  ({ isClosed: false, isStarred: false, ...overrides }) as unknown as ChannelUserStatus;

describe('isDMChannel', () => {
  it('is true for DM and GROUP_DM scopes', () => {
    assert.equal(isDMChannel(ChannelScopeType.DM), true);
    assert.equal(isDMChannel(ChannelScopeType.GROUP_DM), true);
  });

  it('is false for non-DM scopes', () => {
    assert.equal(isDMChannel(ChannelScopeType.DEFAULT), false);
    assert.equal(isDMChannel(ChannelScopeType.TICKET), false);
  });
});

describe('groupChannelsByScope', () => {
  it('routes DEFAULT scope to channels and DM/GROUP_DM to directMessages', () => {
    const data = [
      channel({ id: 'pub', scopeType: ChannelScopeType.DEFAULT }),
      channel({ id: 'dm', scopeType: ChannelScopeType.DM }),
      channel({ id: 'gdm', scopeType: ChannelScopeType.GROUP_DM }),
    ];
    const grouped = groupChannelsByScope(data, []);
    assert.deepEqual(
      grouped.channels.map(c => c.id),
      ['pub'],
    );
    assert.deepEqual(grouped.directMessages.map(c => c.id).sort(), ['dm', 'gdm']);
    assert.deepEqual(grouped.starred, []);
  });

  it('excludes EMAIL channels entirely', () => {
    const grouped = groupChannelsByScope(
      [channel({ id: 'mail', type: ChannelType.EMAIL, scopeType: ChannelScopeType.DEFAULT })],
      [],
    );
    assert.deepEqual(grouped.channels, []);
    assert.deepEqual(grouped.directMessages, []);
    assert.deepEqual(grouped.starred, []);
  });

  it('excludes closed DMs but keeps closed non-DM channels', () => {
    const data = [
      channel({ id: 'dm', scopeType: ChannelScopeType.DM }),
      channel({ id: 'pub', scopeType: ChannelScopeType.DEFAULT }),
    ];
    const statuses = [
      status({ channelId: 'dm', isClosed: true }),
      status({ channelId: 'pub', isClosed: true }),
    ];
    const grouped = groupChannelsByScope(data, statuses);
    assert.deepEqual(grouped.directMessages, []);
    assert.deepEqual(
      grouped.channels.map(c => c.id),
      ['pub'],
    );
  });

  it('routes starred channels to the starred section regardless of scope', () => {
    const data = [
      channel({ id: 'pub', scopeType: ChannelScopeType.DEFAULT }),
      channel({ id: 'dm', scopeType: ChannelScopeType.DM }),
    ];
    const statuses = [
      status({ channelId: 'pub', isStarred: true }),
      status({ channelId: 'dm', isStarred: true }),
    ];
    const grouped = groupChannelsByScope(data, statuses);
    assert.deepEqual(grouped.starred.map(c => c.id).sort(), ['dm', 'pub']);
    assert.deepEqual(grouped.channels, []);
    assert.deepEqual(grouped.directMessages, []);
  });

  it('drops a closed DM even when it is also starred (closed check wins)', () => {
    const data = [channel({ id: 'dm', scopeType: ChannelScopeType.DM })];
    const statuses = [status({ channelId: 'dm', isClosed: true, isStarred: true })];
    const grouped = groupChannelsByScope(data, statuses);
    assert.deepEqual(grouped.starred, []);
    assert.deepEqual(grouped.directMessages, []);
  });
});

describe('sortByActivity', () => {
  it('sorts by lastActivityAt descending without mutating the input', () => {
    const input = [
      channel({
        id: 'old',
        channelStats: { lastActivityAt: 1000 } as VisibleChannel['channelStats'],
      }),
      channel({
        id: 'new',
        channelStats: { lastActivityAt: 5000 } as VisibleChannel['channelStats'],
      }),
      channel({
        id: 'mid',
        channelStats: { lastActivityAt: 3000 } as VisibleChannel['channelStats'],
      }),
    ];
    const sorted = sortByActivity(input);
    assert.deepEqual(
      sorted.map(c => c.id),
      ['new', 'mid', 'old'],
    );
    // original array order is preserved (pure, returns a copy)
    assert.deepEqual(
      input.map(c => c.id),
      ['old', 'new', 'mid'],
    );
  });

  it('treats a missing lastActivityAt as epoch 0 (sorted last)', () => {
    const input = [
      channel({ id: 'none', channelStats: undefined as VisibleChannel['channelStats'] }),
      channel({
        id: 'has',
        channelStats: { lastActivityAt: 10 } as VisibleChannel['channelStats'],
      }),
    ];
    const sorted = sortByActivity(input);
    assert.deepEqual(
      sorted.map(c => c.id),
      ['has', 'none'],
    );
  });
});
