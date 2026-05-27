import { useSelector } from '@xstate/react';
import { stateMachineActor, UnreadCounts } from '../machines/stateMachine';
import { useMemo } from 'react';
import { ActivityClassification, ChannelScopeType } from '@xyne/shared';

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
    for (const channel of visibleChannels) {
      if (
        channel.scopeType === ChannelScopeType.DM ||
        channel.scopeType === ChannelScopeType.GROUP_DM
      ) {
        dmChannelIds.add(channel.id);
      }
    }

    // For non-DM channels: derive count from unread activities grouped by channelId
    // Thread activities are excluded — only channel-level activities count for channel badges
    for (const activity of unreadActivities) {
      if (!activity.channelId) continue;
      if (dmChannelIds.has(activity.channelId)) continue;
      if (activity.isThreadActivity === true) continue;
      if (activity.actorAction === 'removed') continue;
      if (activity.actionSource === 'call' && activity.actorAction === 'missed_call') continue;
      const classification = activity.classification ?? ActivityClassification.PENDING;
      if (classification === ActivityClassification.SKIP) continue;

      counts[activity.channelId] = (counts[activity.channelId] || 0) + 1;
    }

    // DM/GROUP_DM channels: use channelUserStatus.unreadCount
    for (const status of userChannelStatuses) {
      if (dmChannelIds.has(status.channelId)) {
        counts[status.channelId] = status.unreadCount || 0;
      }
    }

    return counts;
  }, [userChannelStatuses, unreadActivities, visibleChannels]);
};
