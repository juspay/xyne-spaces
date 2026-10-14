import { useMemo } from 'react';
import type { VisibleChannel } from '@/src/machines/stateMachine';
import { useAllVisibleChannels, useUserChannelStatuses } from './useChannels';
import { groupWorkspaceChannels, sortChannelsByRecency } from './useChannelList';
import { getUnreadChannelActivityCounts } from '@/src/features/activity/domain/activitySelectors';
import { useActivityBadgeModel } from '@/src/features/activity/hooks/useActivityBadgeModel';

export type UseStarredChannelsResult = {
  /** Starred channels, most recently active first. */
  starredChannels: VisibleChannel[];
  /** Unread activity counts keyed by channel id, for the same channels. */
  starredUnreadCounts: Map<string, number>;
};

/**
 * The starred slice on its own, for surfaces that need it without the list.
 *
 * `useChannelList` owns the channels screen and, with it, the list-sync
 * telemetry probes — and those probes keep their state in per-instance refs.
 * A second mount of that hook would therefore arm and consume a second probe
 * under the same identity key and double-log every `LOTUS_LIST_SYNC` event, so
 * secondary consumers read the shared queries directly through here instead.
 */
export function useStarredChannels(): UseStarredChannelsResult {
  const visibleChannels = useAllVisibleChannels();
  const userChannelStatuses = useUserChannelStatuses();
  const { unreadActivities } = useActivityBadgeModel();

  const starredChannels = useMemo(
    () =>
      sortChannelsByRecency(groupWorkspaceChannels(visibleChannels, userChannelStatuses).starred),
    [visibleChannels, userChannelStatuses],
  );

  const starredUnreadCounts = useMemo(() => {
    const statusByChannelId = new Map(
      userChannelStatuses.map(status => [status.channelId, status] as const),
    );
    const unreadByChannelId = getUnreadChannelActivityCounts(unreadActivities, statusByChannelId);

    return new Map(
      starredChannels.map(channel => [channel.id, unreadByChannelId.get(channel.id) ?? 0] as const),
    );
  }, [starredChannels, unreadActivities, userChannelStatuses]);

  return { starredChannels, starredUnreadCounts };
}
