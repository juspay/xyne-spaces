import { useMemo } from 'react';
import { useAllVisibleChannels, useUserChannelStatuses } from './useChannels';
import { useUsers } from './useUsers';
import { useAuth } from '@/src/contexts/AuthContext';
import { getChannelDisplayName, isDMChannel } from '@/src/utils/channel-utils';
import { sortChannelsByRecency } from './useChannelList';
import type { VisibleChannel } from '@/src/machines/stateMachine';

export type StarredDmEntry = {
  channelId: string;
  title: string;
  unreadCount: number;
  lastViewedAt?: number;
  lastViewedConversationId?: string;
  channel: VisibleChannel;
};

const EMPTY_STARRED_DMS: StarredDmEntry[] = [];
const EMPTY_USERS_BY_ID = new Map<string, ReturnType<typeof useUsers>[number]>();

/**
 * Starred DMs, freshest first, sourced from the same channels queries the
 * channels tab already runs — cheap read, no extra subscription machinery.
 *
 * @param enabled pass false when the caller is not on the Starred tab. The
 * hooks still run (they must), but the two derivations short-circuit — and the
 * stable empty array keeps this out of consumers' memo dependencies.
 */
export function useStarredDms(enabled = true): StarredDmEntry[] {
  const { user } = useAuth();
  const currentUserId = user?.user_id ?? '';
  const visibleChannels = useAllVisibleChannels();
  const userChannelStatuses = useUserChannelStatuses();
  const users = useUsers();

  const usersById = useMemo(() => {
    if (!enabled) return EMPTY_USERS_BY_ID;
    return new Map(users.map(u => [u.id, u] as const));
  }, [enabled, users]);

  return useMemo(() => {
    if (!enabled) return EMPTY_STARRED_DMS;

    const statusByChannelId = new Map(userChannelStatuses.map(s => [s.channelId, s] as const));

    const starred: VisibleChannel[] = [];
    for (const channel of visibleChannels) {
      if (!isDMChannel(channel.scopeType)) continue;
      const status = statusByChannelId.get(channel.id);
      if (!status?.isStarred) continue;
      starred.push(channel);
    }

    return sortChannelsByRecency(starred).map(channel => {
      const status = statusByChannelId.get(channel.id);
      return {
        channelId: channel.id,
        title: getChannelDisplayName(channel, currentUserId, usersById),
        unreadCount: status?.unreadCount ?? 0,
        ...(status?.lastViewedAt !== undefined ? { lastViewedAt: status.lastViewedAt } : {}),
        ...(status?.lastViewedConversationId
          ? { lastViewedConversationId: status.lastViewedConversationId }
          : {}),
        channel,
      };
    });
  }, [enabled, visibleChannels, userChannelStatuses, usersById, currentUserId]);
}
