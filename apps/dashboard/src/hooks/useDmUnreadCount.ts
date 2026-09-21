import { useMemo } from 'react';
import { useSelector } from '@xstate/react';
import { ChannelScopeType, countDmShelfMentionRows, isDmShelfScopeType } from '@xyne/shared';
import { stateMachineActor } from '../machines/stateMachine';

/**
 * Zero-synced DM rail badge: Σ over visible DM/GROUP_DM channels of
 * max(0, channelUserStatus.unreadCount − unreadTopLevelMentionRows(channelId)),
 * where mention rows are unread activities with actorAction in
 * (mentioned_user, group_mention), actionSource = 'message',
 * isThreadActivity = false, in a GROUP_DM channel.
 *
 * Derived from the same state as `useAllUnreadCount`'s DM entries (same
 * inputs, same subtraction), so rail = Σ list badges by construction.
 * Mentions count in the bell instead ("mention wins the bucket").
 */
export const useDmUnreadCount = (): number => {
  const userChannelStatuses = useSelector(
    stateMachineActor,
    state => state.context.userChannelStatuses,
  );
  const unreadActivities = useSelector(stateMachineActor, state => state.context.unreadActivities);
  const visibleChannels = useSelector(stateMachineActor, state => state.context.visibleChannels);

  return useMemo(() => {
    // Visible DM/GROUP_DM channels only — closed/deleted channels are not in
    // visibleChannels (userVisibleChannelsV3 filters isClosed/isDeleted).
    const dmChannelIds = new Set<string>();
    const groupDmChannelIds = new Set<string>();
    for (const channel of visibleChannels ?? []) {
      if (isDmShelfScopeType(channel.scopeType)) {
        dmChannelIds.add(channel.id);
        if (channel.scopeType === ChannelScopeType.GROUP_DM) {
          groupDmChannelIds.add(channel.id);
        }
      }
    }

    const mentionRowsByChannel = countDmShelfMentionRows(
      unreadActivities ?? [],
      dmChannelIds,
      channelId => groupDmChannelIds.has(channelId),
    );

    let total = 0;
    for (const status of userChannelStatuses) {
      if (!dmChannelIds.has(status.channelId)) continue;
      const mentionRows = mentionRowsByChannel.get(status.channelId) ?? 0;
      total += Math.max(0, (status.unreadCount || 0) - mentionRows);
    }
    return total;
  }, [userChannelStatuses, unreadActivities, visibleChannels]);
};

/**
 * True when any visible DM/GROUP_DM channel has unread `added_v2` reaction
 * rows — renders the DM rail's reaction dot (only when the numeric badge is 0).
 * Cleared on view like the numeric badge.
 */
export const useHasUnreadDmReactions = (): boolean => {
  const unreadActivities = useSelector(stateMachineActor, state => state.context.unreadActivities);
  const visibleChannels = useSelector(stateMachineActor, state => state.context.visibleChannels);

  return useMemo(() => {
    const dmChannelIds = new Set<string>();
    for (const channel of visibleChannels ?? []) {
      if (isDmShelfScopeType(channel.scopeType)) {
        dmChannelIds.add(channel.id);
      }
    }
    return (unreadActivities ?? []).some(
      activity =>
        activity.channelId !== null &&
        dmChannelIds.has(activity.channelId) &&
        activity.actorAction === 'added_v2',
    );
  }, [unreadActivities, visibleChannels]);
};
