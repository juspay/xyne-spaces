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
 * direct_message rows. ERROR/PENDING count. DM-shelf unreads live in
 * channelUserStatus counts, not here.
 *
 * Closed-channel parity with the server: the server post-filters activities
 * whose channel_user_status row is isClosed OR isDeleted for this user. The
 * client's synced statuses come from userVisibleChannelsV3, which already
 * filters both flags — so closed/deleted channels simply do not appear in
 * visibleChannels, and an unread activity whose channel is absent from that
 * set (and is not a null-channelId ticket row) is in a closed/deleted
 * channel for this user and must not count.
 *
 * @returns count - Number of unread activities
 */
export const useUnreadActivitiesCount = (): number => {
  const unreadActivities = useSelector(stateMachineActor, state => state.context.unreadActivities);
  const visibleChannels = useSelector(stateMachineActor, state => state.context.visibleChannels);

  return useMemo(() => {
    if (!unreadActivities || unreadActivities.length === 0) {
      return 0;
    }

    // Channels visible to this user (neither isClosed nor isDeleted for them).
    const visibleChannelIds = new Set<string>();
    for (const channel of visibleChannels ?? []) {
      visibleChannelIds.add(channel.id);
    }

    return unreadActivities.filter(
      activity =>
        (activity.channelId === null || visibleChannelIds.has(activity.channelId)) &&
        isBellCountedActivity(activity, EMPTY_CLOSED_SET),
    ).length;
  }, [unreadActivities, visibleChannels]);
};

// Closed channels are already excluded via the visibleChannelIds check above;
// this predicate parameter stays for callers that track closed sets explicitly.
const EMPTY_CLOSED_SET: ReadonlySet<string> = new Set();
