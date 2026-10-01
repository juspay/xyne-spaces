import { useSelector } from '@xstate/react';
import { stateMachineActor, UnreadCounts } from '../machines/stateMachine';
import { useMemo } from 'react';
import { ActivityClassification, ChannelScopeType } from '@xyne/shared';
import { countDmShelfMentionRows, isDmShelfScopeType, isBellCountedActivity } from '@xyne/shared';

export const useAllUnreadCount = (): UnreadCounts => {
  const userChannelStatuses = useSelector(
    stateMachineActor,
    state => state.context.userChannelStatuses,
  );

  const unreadActivities = useSelector(stateMachineActor, state => state.context.unreadActivities);

  const visibleChannels = useSelector(stateMachineActor, state => state.context.visibleChannels);

  return useMemo(() => {
    const counts: UnreadCounts = {};

    // Build DM channel set from visible channels
    const dmChannelIds = new Set<string>();
    const groupDmChannelIds = new Set<string>();
    // All channels visible to this user — closed/deleted channels are already
    // filtered out server-side by userVisibleChannelsV3 (isClosed/isDeleted),
    // so an activity whose channel is missing from this set is in a channel
    // closed for this user and must not count (parity with the server's
    // per-user closed-pair post-filter).
    const visibleChannelIds = new Set<string>();
    for (const channel of visibleChannels ?? []) {
      visibleChannelIds.add(channel.id);
      if (isDmShelfScopeType(channel.scopeType)) {
        dmChannelIds.add(channel.id);
        if (channel.scopeType === ChannelScopeType.GROUP_DM) {
          groupDmChannelIds.add(channel.id);
        }
      }
    }

    // Per-channel unread top-level GROUP_DM mention rows — the bell counts
    // them ("mention wins the bucket"), so the dm shelf subtracts them from
    // the channel's unreadCount below, floored at 0.
    const mentionRowsByChannel = countDmShelfMentionRows(
      unreadActivities ?? [],
      dmChannelIds,
      channelId => groupDmChannelIds.has(channelId),
    );

    // For non-DM channels: derive count from unread activities grouped by channelId
    // Thread activities are excluded — only channel-level activities count for channel badges
    for (const activity of unreadActivities ?? []) {
      if (!activity.channelId) continue;
      if (dmChannelIds.has(activity.channelId)) continue;
      if (!visibleChannelIds.has(activity.channelId)) continue;
      if (activity.isThreadActivity === true) continue;
      if (activity.actionSource === 'call' && activity.actorAction === 'missed_call') continue;
      const classification = activity.classification ?? ActivityClassification.PENDING;
      if (classification === ActivityClassification.SKIP) continue;
      if (!isBellCountedActivity(activity, EMPTY_CLOSED_SET)) continue;

      counts[activity.channelId] = (counts[activity.channelId] || 0) + 1;
    }

    // DM/GROUP_DM channels: channelUserStatus.unreadCount minus that
    // channel's unread top-level mention rows (GROUP_DM only), floored at 0.
    for (const status of userChannelStatuses) {
      if (dmChannelIds.has(status.channelId)) {
        const mentionRows = mentionRowsByChannel.get(status.channelId) ?? 0;
        counts[status.channelId] = Math.max(0, (status.unreadCount || 0) - mentionRows);
      }
    }

    return counts;
  }, [userChannelStatuses, unreadActivities, visibleChannels]);
};

// Closed channels are already excluded via the visibleChannelIds check above;
// this predicate parameter stays for callers that track closed sets explicitly.
const EMPTY_CLOSED_SET: ReadonlySet<string> = new Set();
