import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ActivityClassification,
  ChannelFilterMode,
  ChannelSortOrder,
  NotificationLevel,
  type ChannelUserStatus,
} from '@xyne/shared';
import type { VisibleChannel } from '@/src/machines/stateMachine';
import {
  ACTIVE_WINDOW_MS,
  applyChannelGroupPreference,
  getGroupMentionChannelIds,
} from '@/src/components/chat/channel-list/channel-group-preferences';
import { buildGroupedChannelRows } from '@/src/components/chat/channel-list/section-utils';

const now = ACTIVE_WINDOW_MS * 2;
const channel = (id: string, activity = now, name = id): VisibleChannel =>
  ({ id, name, channelStats: { lastActivityAt: activity } }) as VisibleChannel;
const statuses = new Map<string, ChannelUserStatus>([
  ['message', { unreadCount: 1, lastViewedAt: now } as ChannelUserStatus],
  ['activity', { unreadCount: 0, lastViewedAt: 1 } as ChannelUserStatus],
  ['read', { unreadCount: 0, lastViewedAt: now } as ChannelUserStatus],
  [
    'muted',
    { unreadCount: 1, desktopNotificationLevel: NotificationLevel.NONE } as ChannelUserStatus,
  ],
]);
const context = {
  statuses,
  unreadCounts: new Map([
    ['message', 1],
    ['muted', 1],
  ]),
  mentionedChannelIds: new Set(['message']),
  now,
};
const apply = (
  channels: VisibleChannel[],
  filterMode = ChannelFilterMode.ALL,
  sortOrder: ChannelSortOrder | null = null,
) => applyChannelGroupPreference(channels, { filterMode, sortOrder }, context).map(c => c.id);

describe('channel group preferences', () => {
  it('uses an inclusive 30-day cutoff even for unread channels', () => {
    assert.deepEqual(
      apply(
        [
          channel('boundary', now - ACTIVE_WINDOW_MS),
          channel('message', now - ACTIVE_WINDOW_MS - 1),
        ],
        ChannelFilterMode.ACTIVE,
      ),
      ['boundary'],
    );
  });
  it('includes unreads and unviewed activity, but filters mentions independently', () => {
    const channels = [
      channel('read'),
      channel('message'),
      channel('activity'),
      channel('never-viewed'),
    ];
    assert.deepEqual(apply(channels, ChannelFilterMode.UNREADS), [
      'message',
      'activity',
      'never-viewed',
    ]);
    assert.deepEqual(apply(channels, ChannelFilterMode.MENTIONS), ['message']);
  });
  it('sorts message unreads before newer activity and read channels', () => {
    assert.deepEqual(
      apply(
        [channel('read'), channel('activity'), channel('message', 2)],
        ChannelFilterMode.ALL,
        ChannelSortOrder.UNREAD,
      ),
      ['message', 'activity', 'read'],
    );
  });
  it('recency does not lift older unreads and manual order remains intact', () => {
    const channels = [channel('message', 2), channel('read', 3)];
    assert.deepEqual(apply(channels, ChannelFilterMode.ALL, ChannelSortOrder.RECENCY), [
      'read',
      'message',
    ]);
    assert.deepEqual(apply(channels), ['message', 'read']);
  });
  it('alphabetical sorting places bold rows first and respects muting', () => {
    assert.deepEqual(
      apply(
        [channel('read', now, 'A'), channel('message', now, 'Z'), channel('muted', now, 'B')],
        ChannelFilterMode.ALL,
        ChannelSortOrder.ALPHABETICAL,
      ),
      ['message', 'read', 'muted'],
    );
  });
  it('retains headers and full counts when every displayed channel is filtered out', () => {
    const rows = buildGroupedChannelRows({
      starred: [],
      sectioned: [],
      unsectioned: [channel('message')],
      unreadCounts: context.unreadCounts,
      isStarredCollapsed: false,
      isChannelsCollapsed: false,
      displayChannels: () => [],
      toChannelRow: () => {
        throw new Error('No channel should render');
      },
    });
    assert.equal(rows.length, 1);
    const header = rows[0];
    assert.equal(header?.kind, 'section-header');
    if (header?.kind === 'section-header') {
      assert.equal(header.channelCount, 1);
      assert.equal(header.unreadCount, 1);
    }
  });
});

describe('desktop section mention semantics', () => {
  it('includes keywords and thread replies without requiring channel-level unreads', () => {
    const ids = getGroupMentionChannelIds([
      { channelId: 'direct', actorAction: 'mentioned_user' },
      { channelId: 'group', actorAction: 'group_mention' },
      { channelId: 'keyword', actorAction: 'keyword_match' },
      { channelId: 'reply', actorAction: 'replied', isThreadActivity: true },
      { channelId: 'reply-v2', actorAction: 'replied_v2', isThreadActivity: true },
      { channelId: 'read', actorAction: 'mentioned_user', isRead: true },
      {
        channelId: 'skip',
        actorAction: 'mentioned_user',
        classification: ActivityClassification.SKIP,
      },
      { channelId: 'reaction', actorAction: 'reacted' },
      { actorAction: 'mentioned_user' },
    ]);
    assert.deepEqual([...ids], ['direct', 'group', 'keyword', 'reply', 'reply-v2']);
    assert.deepEqual(
      applyChannelGroupPreference(
        [channel('reply')],
        { filterMode: ChannelFilterMode.MENTIONS, sortOrder: null },
        { ...context, mentionedChannelIds: ids },
      ).map(item => item.id),
      ['reply'],
    );
  });
  it('handles missing activity and alphabetical ties without mutating the input', () => {
    const channels = [channel('b', 0, 'alpha'), channel('a', 0, 'Alpha')];
    assert.deepEqual(apply(channels, ChannelFilterMode.ACTIVE), []);
    assert.deepEqual(apply(channels, ChannelFilterMode.UNREADS), []);
    assert.deepEqual(apply(channels, ChannelFilterMode.ALL, ChannelSortOrder.ALPHABETICAL), [
      'a',
      'b',
    ]);
    assert.deepEqual(
      channels.map(item => item.id),
      ['b', 'a'],
    );
  });
});
