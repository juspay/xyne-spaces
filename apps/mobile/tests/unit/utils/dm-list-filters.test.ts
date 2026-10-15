import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ChannelScopeType } from '@xyne/shared';

import { filterDmListItems, mergeStarredDmChannels } from '@/src/utils/dm-list-filters';
import type { DmChannel } from '@/src/hooks/useDmsPaginatedMessagesV2';
import type { StarredDmEntry } from '@/src/hooks/useStarredDms';
import type { DmListItemData } from '@/src/types/dm-list-item';

const item = (id: string, overrides: Partial<DmListItemData> = {}): DmListItemData => ({
  id,
  title: id,
  participantUserIds: [],
  scopeType: ChannelScopeType.DM,
  lastMessage: { variant: 'text', text: id },
  timestampLabel: '',
  ...overrides,
});

describe('filterDmListItems', () => {
  it('adds a starred DM that is outside the recent activity page', () => {
    const recentChannel = {
      id: 'recent',
      conversations: [],
    } as unknown as DmChannel;
    const oldStarredChannel = {
      id: 'old-starred',
      conversations: [],
    } as unknown as StarredDmEntry['channel'];

    const merged = mergeStarredDmChannels(
      [recentChannel],
      [{ channel: oldStarredChannel } as unknown as StarredDmEntry],
    );

    assert.deepEqual(
      merged.map(channel => channel.id),
      ['recent', 'old-starred'],
    );
    assert.equal(merged[0], recentChannel);
  });

  it('returns starred DMs independently of the activity page', () => {
    const items = [
      item('recent-unstarred'),
      item('old-starred', { isStarred: true, lastActivityAtMs: 1 }),
    ];

    assert.deepEqual(
      filterDmListItems(items, 'starred').map(row => row.id),
      ['old-starred'],
    );
  });

  it('keeps the existing unread and group filters unchanged', () => {
    const items = [
      item('unread-dm', { unreadCount: 1 }),
      item('read-group', { scopeType: ChannelScopeType.GROUP_DM }),
    ];

    assert.deepEqual(
      filterDmListItems(items, 'unread').map(row => row.id),
      ['unread-dm'],
    );
    assert.deepEqual(
      filterDmListItems(items, 'groups').map(row => row.id),
      ['read-group'],
    );
  });
});
