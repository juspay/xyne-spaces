import { useMemo } from 'react';
import { ChannelScopeType } from '@xyne/shared';
import { formatChannelTimestamp, searchChannels } from '@xyne/shared/utils';

import { useAllChannels, useUserChannelStatuses } from '@/src/hooks/useChannels';
import { searchUsers, useUsers } from '@/src/hooks/useUsers';
import type { DmListItemData, DmListParticipantIdentity } from '@/src/types/dm-list-item';
import { getChannelDisplayName, getDmAvatarUserIds, isDMChannel } from '@/src/utils/channel-utils';
import { getActiveUserStatusEmoji, isUserDeactivated } from '@/src/utils/statusUtils';

const DM_SEARCH_LIMIT = 30;
const USER_SEARCH_LIMIT = 25;

type DirectoryUser = ReturnType<typeof useUsers>[number];

export type DmDirectorySearchRow =
  | { kind: 'channel'; id: string; channelId: string; item: DmListItemData; isClosed: boolean }
  | { kind: 'user'; id: string; user: DirectoryUser; item: DmListItemData };

const toIdentity = (user: DirectoryUser): DmListParticipantIdentity => {
  const identity: DmListParticipantIdentity = { id: user.id };
  if (user.name?.trim()) identity.name = user.name;
  if (user.displayName?.trim()) identity.displayName = user.displayName;
  if (user.picture !== undefined) identity.picture = user.picture;
  return identity;
};

export function useDmDirectorySearch(
  query: string,
  currentUserId: string,
  localItems: readonly DmListItemData[],
): { rows: DmDirectorySearchRow[]; hasNoSearchResults: boolean } {
  const allChannels = useAllChannels();
  const users = useUsers();
  const statuses = useUserChannelStatuses();
  const normalizedQuery = query.trim();

  return useMemo(() => {
    if (!normalizedQuery || !currentUserId) {
      return { rows: [], hasNoSearchResults: false };
    }

    const usersById = new Map(users.map(user => [user.id, user]));
    const statusByChannelId = new Map(statuses.map(status => [status.channelId, status]));
    const localItemByChannelId = new Map(localItems.map(item => [item.id, item]));

    const dmChannels = allChannels.filter(
      channel => isDMChannel(channel.scopeType) && statusByChannelId.has(channel.id),
    );

    const searchableDmChannels = dmChannels.map(channel => ({
      name: getChannelDisplayName(channel, currentUserId, usersById),
      channel,
    }));

    const channelRows: DmDirectorySearchRow[] = searchChannels(
      searchableDmChannels,
      normalizedQuery,
      DM_SEARCH_LIMIT,
    ).map(({ channel, name }) => {
      const status = statusByChannelId.get(channel.id);
      const localItem = status?.isClosed ? undefined : localItemByChannelId.get(channel.id);
      const participantUserIds = getDmAvatarUserIds(channel, currentUserId);
      const participantIdentities = participantUserIds
        .map(id => usersById.get(id))
        .filter((user): user is DirectoryUser => Boolean(user))
        .map(toIdentity);
      const statusUserId =
        channel.scopeType === ChannelScopeType.DM ? participantUserIds[0] : undefined;
      const statusEmoji = statusUserId
        ? getActiveUserStatusEmoji(usersById.get(statusUserId))
        : undefined;

      const item: DmListItemData = localItem ?? {
        id: channel.id,
        title: name,
        participantUserIds,
        ...(participantIdentities.length > 0 ? { participantIdentities } : {}),
        scopeType: channel.scopeType as ChannelScopeType.DM | ChannelScopeType.GROUP_DM,
        lastMessage: {
          variant: 'text',
          text: status?.isClosed ? 'Archived direct message' : 'Direct message',
        },
        timestampLabel:
          channel.lastActivityAt > 0 ? formatChannelTimestamp(channel.lastActivityAt) : '',
        ...(status && status.unreadCount > 0 ? { unreadCount: status.unreadCount } : {}),
        ...(status?.lastViewedAt !== undefined ? { lastViewedAt: status.lastViewedAt } : {}),
        ...(status?.lastViewedConversationId
          ? { lastViewedConversationId: status.lastViewedConversationId }
          : {}),
        isStarred: status?.isStarred ?? false,
        lastActivityAtMs: channel.lastActivityAt,
        ...(statusEmoji ? { statusEmoji } : {}),
      };

      return {
        kind: 'channel',
        id: `channel:${channel.id}`,
        channelId: channel.id,
        item,
        isClosed: status?.isClosed ?? false,
      };
    });

    const existingOneToOneUserIds = new Set<string>();
    for (const channel of dmChannels) {
      if (channel.scopeType !== ChannelScopeType.DM) continue;
      for (const id of getDmAvatarUserIds(channel, currentUserId)) {
        existingOneToOneUserIds.add(id);
      }
    }

    const remaining = Math.max(DM_SEARCH_LIMIT - channelRows.length, 0);
    const userRows: DmDirectorySearchRow[] = searchUsers(users, normalizedQuery, USER_SEARCH_LIMIT)
      .filter(user => user.id !== currentUserId)
      .filter(user => !existingOneToOneUserIds.has(user.id))
      .filter(user => !isUserDeactivated(user))
      .slice(0, remaining)
      .map(user => {
        const statusEmoji = getActiveUserStatusEmoji(user);

        return {
          kind: 'user',
          id: `user:${user.id}`,
          user,
          item: {
            id: `user:${user.id}`,
            title: user.displayName || user.name || user.email,
            participantUserIds: [user.id],
            participantIdentities: [toIdentity(user)],
            scopeType: ChannelScopeType.DM,
            lastMessage: { variant: 'text', text: 'Start a conversation' },
            timestampLabel: '',
            ...(statusEmoji ? { statusEmoji } : {}),
          },
        };
      });

    const rows = [...channelRows, ...userRows];
    return { rows, hasNoSearchResults: rows.length === 0 };
  }, [allChannels, currentUserId, localItems, normalizedQuery, statuses, users]);
}
