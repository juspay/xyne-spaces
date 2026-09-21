import { useMemo } from 'react';
import { useSelector } from '@xstate/react';
import { isDmShelfScopeType } from '@xyne/shared';
import { stateMachineActor } from '../machines/stateMachine';

/**
 * True when any unread `added_v2` (reaction) rows exist in non-DM channels —
 * renders the bell rail's reaction dot (only when the bell's numeric badge is
 * 0). Reactions are never counted numerically anywhere; cleared on view.
 */
export const useHasUnreadBellReactions = (): boolean => {
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
        !dmChannelIds.has(activity.channelId) &&
        activity.actorAction === 'added_v2',
    );
  }, [unreadActivities, visibleChannels]);
};
