import { useSelector } from '@xstate/react';
import { Channel, ChannelScopeType } from '@xyne/shared';
import {
  stateMachineActor,
  UnreadCounts,
  UserChannelStatus,
  VisibleChannel,
} from '@/src/machines/appStateMachine';
import { useMemo } from 'react';
import { getChannelNameUsersMap } from '@/src/utils/channel-utils';

const EMPTY_USER_CHANNEL_STATUSES: UserChannelStatus[] = [];

// ─── Re-exports from shared ───────────────────────────────────────────────────

export {
  searchChannels,
  useAllChannels,
  useAllVisibleChannels,
  useChannel,
  useChannelByName,
  useChannelSearch,
  useBrowsableChannels,
  useMigratedChannels,
  useEmailChannels,
  useChannelsByProjectId,
  useUserChannelStatuses,
  useGetChannelUserStatus,
  useGetChannelConversations,
  getChannelConversationsSnapshot,
  useGetLatestConversation,
  useVisibleChannel,
} from '@xyne/shared/hooks';

// ─── Local hooks/utils (not yet in shared) ────────────────────────────────────

/**
 * Hook to retrieve all unread counts for all channels from the app state machine.
 *
 * @returns Object with channel IDs as keys and unread counts as values
 */
export const useAllUnreadCount = (enabled = true): UnreadCounts => {
  const userChannelStatuses = useSelector(stateMachineActor, state =>
    enabled ? state.context.userChannelStatuses : EMPTY_USER_CHANNEL_STATUSES,
  );

  return useMemo(() => {
    const counts: UnreadCounts = {};
    userChannelStatuses.forEach(status => {
      counts[status.channelId] = status.unreadCount || 0;
    });
    return counts;
  }, [userChannelStatuses]);
};

/**
 * Returns the display name for a channel.
 * - DEFAULT: channel name
 * - DM: name of the other participant (excluding current user)
 * - GROUP_DM: comma-separated names of other participants (excluding current user)
 */
export const useChannelDisplayName = (
  channel: Channel | null | undefined,
  currentUserId: string,
): string => {
  const users = useSelector(stateMachineActor, state => state.context.users);

  return useMemo(() => {
    if (!channel) return 'Unknown';

    if (channel.scopeType === ChannelScopeType.DEFAULT) return channel.name;

    const usersById = getChannelNameUsersMap(users);

    if (channel.scopeType === ChannelScopeType.DM) {
      const participantIds = parseDMParticipantIds(channel);
      const otherUserId = participantIds.find(id => id !== currentUserId);

      if (!otherUserId && participantIds.length === 1 && participantIds[0] === currentUserId) {
        return `${usersById.get(currentUserId)?.name ?? 'You'} (you)`;
      }

      if (!otherUserId) return 'Unknown User';

      return usersById.get(otherUserId)?.name ?? 'Unknown User';
    }

    if (channel.scopeType === ChannelScopeType.GROUP_DM) {
      const participantIds = parseDMParticipantIds(channel);
      const otherIds = participantIds.filter(id => id !== currentUserId);
      const names = otherIds
        .map(id => usersById.get(id)?.name)
        .filter((n): n is string => Boolean(n));
      return names.length > 0 ? names.join(', ') : 'Group Chat';
    }

    return channel.name;
  }, [channel, currentUserId, users]);
};

/**
 * Non-hook version of channel display name resolution.
 */
export const getChannelDisplayName = (
  channel: { name: string; scopeType: string },
  currentUserId: string,
  users: ReadonlyArray<{ id: string; name?: string }>,
): string => {
  if (channel.scopeType === ChannelScopeType.DEFAULT) return channel.name;

  const usersById = getChannelNameUsersMap(users);

  if (channel.scopeType === ChannelScopeType.DM) {
    const participantIds = parseDMParticipantIds(channel);
    const otherUserId = participantIds.find(id => id !== currentUserId);

    if (!otherUserId && participantIds.length === 1 && participantIds[0] === currentUserId) {
      return `${usersById.get(currentUserId)?.name ?? 'You'} (you)`;
    }

    if (!otherUserId) return 'Unknown User';

    return usersById.get(otherUserId)?.name ?? 'Unknown User';
  }

  if (channel.scopeType === ChannelScopeType.GROUP_DM) {
    const participantIds = parseDMParticipantIds(channel);
    const otherIds = participantIds.filter(id => id !== currentUserId);
    const names = otherIds
      .map(id => usersById.get(id)?.name)
      .filter((n): n is string => Boolean(n));
    return names.length > 0 ? names.join(', ') : 'Group Chat';
  }

  return channel.name;
};

export const getDmAvatarUser = (
  channel: { name: string; scopeType: string },
  currentUserId: string,
  users: ReadonlyArray<{ id: string; name?: string; picture?: string | null }>,
): { name: string; picture: string } => {
  if (channel.scopeType !== ChannelScopeType.DM) {
    return { name: '', picture: '' };
  }

  const participantIds = parseDMParticipantIds(channel);
  const isSelfDm = participantIds.length === 1 && participantIds[0] === currentUserId;
  const otherUserId = participantIds.find(id => id !== currentUserId) ?? null;
  const targetId = isSelfDm ? currentUserId : otherUserId;
  if (!targetId) {
    return { name: '', picture: '' };
  }

  const user = users.find(entry => entry.id === targetId);
  return { name: user?.name ?? '', picture: user?.picture ?? '' };
};

/**
 * Parse participant user IDs from a DM or Group DM channel name.
 * Channel.name format: "userId1,userId2,userId3" (comma-separated, sorted).
 */
const parseDMParticipantIds = (channel: { name: string; scopeType: string }): string[] => {
  if (
    channel.scopeType !== ChannelScopeType.DM &&
    channel.scopeType !== ChannelScopeType.GROUP_DM
  ) {
    return [];
  }
  return channel.name
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
};

/**
 * Hook to retrieve a specific channel by its ID from the app state machine.
 *
 * @param channelId - The unique identifier of the channel to retrieve
 * @returns The channel object if found, undefined otherwise
 */
export const useChannelById = (channelId: string): Channel | undefined => {
  const fromAll = useSelector(
    stateMachineActor,
    state => state.context.allChannels.find(c => c.id === channelId),
    (a, b) =>
      a?.id === b?.id &&
      a?.name === b?.name &&
      a?.scopeType === b?.scopeType &&
      a?.visibility === b?.visibility &&
      a?.description === b?.description &&
      a?.createdAt === b?.createdAt,
  );
  const fromVisible = useSelector(
    stateMachineActor,
    state => state.context.visibleChannels.find(c => c.id === channelId),
    (a, b) =>
      a?.id === b?.id &&
      a?.name === b?.name &&
      a?.scopeType === b?.scopeType &&
      a?.visibility === b?.visibility &&
      a?.description === b?.description &&
      a?.createdAt === b?.createdAt,
  );
  return fromAll ?? fromVisible;
};

/**
 * Hook to retrieve a specific visible channel by its ID (includes channelStats).
 *
 * @param channelId - The unique identifier of the channel to retrieve
 * @returns The visible channel object if found, undefined otherwise
 */
export const useVisibleChannelById = (channelId: string): VisibleChannel | undefined => {
  return useSelector(
    stateMachineActor,
    state => state.context.visibleChannels.find(c => c.id === channelId),
    (a, b) => {
      if (!a || !b) return a === b;
      return (
        a.id === b.id &&
        a.name === b.name &&
        a.scopeType === b.scopeType &&
        a.visibility === b.visibility &&
        a.channelStats?.lastActivityAt === b.channelStats?.lastActivityAt &&
        a.channelStats?.participantCount === b.channelStats?.participantCount &&
        a.channelStats?.addUserPolicy === b.channelStats?.addUserPolicy
      );
    },
  );
};
