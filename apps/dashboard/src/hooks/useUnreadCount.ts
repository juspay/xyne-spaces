import { useSelector } from '@xstate/react';
import { stateMachineActor, UnreadCounts } from '../machines/stateMachine';
import { useMemo } from 'react';
import { ActivityClassification, ChannelScopeType } from '@xyne/shared';
import { useHostToPointerChannelId } from './useHostChannelId';

export const useAllUnreadCount = (): UnreadCounts => {
  const userChannelStatuses = useSelector(
    stateMachineActor,
    state => state.context.userChannelStatuses,
  );

  const unreadActivities = useSelector(stateMachineActor, state => state.context.unreadActivities);

  const visibleChannels = useSelector(stateMachineActor, state => state.context.visibleChannels);

  // Slack-Connect: a guest's activities/status are stamped with the connect HOST channelId, but the
  // sidebar renders their local POINTER channel. This resolver maps host→pointer so unread lands on the
  // row the guest actually sees. No-op for normal channels and for the host viewer (they hold no pointer).
  const hostToPointer = useHostToPointerChannelId();

  return useMemo(() => {
    const counts: UnreadCounts = {};

    // Build DM channel set from visible channels
    const dmChannelIds = new Set<string>();
    for (const channel of visibleChannels ?? []) {
      if (
        channel.scopeType === ChannelScopeType.DM ||
        channel.scopeType === ChannelScopeType.GROUP_DM
      ) {
        dmChannelIds.add(channel.id);
      }
    }

    // For non-DM channels: derive count from unread activities grouped by channelId
    // Thread activities are excluded — only channel-level activities count for channel badges
    for (const activity of unreadActivities ?? []) {
      if (!activity.channelId) continue;
      // Connect guests: fold the host-stamped activity onto the pointer id the sidebar renders.
      const channelKey = hostToPointer(activity.channelId);
      if (dmChannelIds.has(channelKey)) continue;
      if (activity.isThreadActivity === true) continue;
      if (activity.actorAction === 'added_v2') continue;
      if (activity.actorAction === 'removed') continue;
      if (activity.actionSource === 'call' && activity.actorAction === 'missed_call') continue;
      const classification = activity.classification ?? ActivityClassification.PENDING;
      if (classification === ActivityClassification.SKIP) continue;

      counts[channelKey] = (counts[channelKey] || 0) + 1;
    }

    // DM/GROUP_DM channels: use channelUserStatus.unreadCount
    for (const status of userChannelStatuses) {
      const channelKey = hostToPointer(status.channelId);
      if (dmChannelIds.has(channelKey)) {
        counts[channelKey] = status.unreadCount || 0;
      }
    }

    return counts;
  }, [userChannelStatuses, unreadActivities, visibleChannels, hostToPointer]);
};
