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
    for (const channel of visibleChannels ?? []) {
      if (
        channel.scopeType === ChannelScopeType.DM ||
        channel.scopeType === ChannelScopeType.GROUP_DM
      ) {
        dmChannelIds.add(channel.id);
      }
    }

    // For non-DM channels: count only unread top-level message activities,
    // deduped by (channelId, messageId ?? actionSourceId) so a message with
    // several activities (e.g. a reply plus a mention) still contributes one
    // to the badge, matching what markChannelAsViewed clears in one visit.
    // Ticket/canvas/call activities never touch this badge — they only ever
    // show up in the Activity feed.
    const seenChannelMessageIds = new Set<string>();
    for (const activity of unreadActivities ?? []) {
      if (!activity.channelId) continue;
      if (dmChannelIds.has(activity.channelId)) continue;
      if (activity.actionSource !== 'message') continue;
      if (activity.isThreadActivity === true) continue;
      if (activity.actorAction === 'added') continue;
      if (activity.actorAction === 'added_v2') continue;
      if (activity.actorAction === 'removed') continue;
      const classification = activity.classification ?? ActivityClassification.PENDING;
      if (classification === ActivityClassification.SKIP) continue;

      const messageKey = `${activity.channelId}:${activity.messageId ?? activity.actionSourceId}`;
      if (seenChannelMessageIds.has(messageKey)) continue;
      seenChannelMessageIds.add(messageKey);

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
