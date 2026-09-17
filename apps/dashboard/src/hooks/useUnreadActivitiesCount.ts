import { useMemo } from 'react';
import { useSelector } from '@xstate/react';
import { isBellCountedActivity } from '@xyne/shared';
import { stateMachineActor } from '../machines/stateMachine';

/**
 * Hook to get unread activities count (bell shelf) with cancelled reactions
 * filtered out. Reads from state machine (populated by DeferredLoader).
 *
 * Matches the server's bellCount exactly — the shared
 * {@link isBellCountedActivity} predicate (BELL_COUNT_RULES in
 * @xyne/shared): excludes added_v2/removed, missed_call, SKIP, legacy
 * direct_message rows, and unread activities in channels closed for this
 * user. ERROR/PENDING count. DM-shelf unreads live in channelUserStatus
 * counts, not here.
 *
 * @returns count - Number of unread activities
 */
export const useUnreadActivitiesCount = (): number => {
  const unreadActivities = useSelector(stateMachineActor, state => state.context.unreadActivities);
  const userChannelStatuses = useSelector(
    stateMachineActor,
    state => state.context.userChannelStatuses,
  );

  return useMemo(() => {
    if (!unreadActivities || unreadActivities.length === 0) {
      return 0;
    }

    // Channels closed for this user (isClosed is per-user on
    // channel_user_status) do not count in any shelf.
    const closedChannelIds = new Set<string>();
    for (const status of userChannelStatuses) {
      if (status.isClosed) closedChannelIds.add(status.channelId);
    }

    return unreadActivities.filter(activity => isBellCountedActivity(activity, closedChannelIds))
      .length;
  }, [unreadActivities, userChannelStatuses]);
};
