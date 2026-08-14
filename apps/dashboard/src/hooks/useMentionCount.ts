import { useSelector } from '@xstate/react';
import { stateMachineActor, UnreadCounts } from '../machines/stateMachine';
import { useMemo } from 'react';
import { ActivityClassification, ChannelScopeType } from '@xyne/shared';

// Slack's red-badge definition: a direct message, an @mention, one of your keywords,
// or a reply to a thread you follow. DMs are handled separately below.
const MENTION_ACTIONS = new Set([
  'mentioned_user',
  'group_mention',
  'keyword_match',
  'replied',
  'replied_v2',
]);

export const useAllMentionCount = (): UnreadCounts => {
  const userChannelStatuses = useSelector(
    stateMachineActor,
    state => state.context.userChannelStatuses,
  );
  const unreadActivities = useSelector(stateMachineActor, state => state.context.unreadActivities);
  const visibleChannels = useSelector(stateMachineActor, state => state.context.visibleChannels);

  return useMemo(() => {
    const counts: UnreadCounts = {};

    const dmChannelIds = new Set<string>();
    for (const channel of visibleChannels ?? []) {
      if (
        channel.scopeType === ChannelScopeType.DM ||
        channel.scopeType === ChannelScopeType.GROUP_DM
      ) {
        dmChannelIds.add(channel.id);
      }
    }

    for (const activity of unreadActivities ?? []) {
      if (!activity.channelId) continue;
      if (dmChannelIds.has(activity.channelId)) continue;
      if (!MENTION_ACTIONS.has(activity.actorAction ?? '')) continue;
      const classification = activity.classification ?? ActivityClassification.PENDING;
      if (classification === ActivityClassification.SKIP) continue;

      counts[activity.channelId] = (counts[activity.channelId] || 0) + 1;
    }

    // A DM is itself a mention — any unread one qualifies.
    for (const status of userChannelStatuses) {
      if (dmChannelIds.has(status.channelId)) {
        counts[status.channelId] = status.unreadCount || 0;
      }
    }

    return counts;
  }, [userChannelStatuses, unreadActivities, visibleChannels]);
};
