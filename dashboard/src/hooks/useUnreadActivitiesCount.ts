import { useMemo } from 'react';
import { useSelector } from '@xstate/react';
import { ActivityClassification } from '@xyne/shared';
import { stateMachineActor } from '../machines/stateMachine';

/**
 * Hook to get unread activities count with cancelled reactions filtered out
 * Reads from state machine (populated by DeferredLoader)
 *
 * @returns count - Number of unread activities
 */
export const useUnreadActivitiesCount = (): number => {
  const unreadActivities = useSelector(stateMachineActor, state => state.context.unreadActivities);

  return useMemo(() => {
    if (!unreadActivities || unreadActivities.length === 0) {
      return 0;
    }

    return unreadActivities.filter(activity => {
      if (activity.actorAction === 'added_v2') return false;
      if (activity.actorAction === 'removed') return false;
      if (activity.actionSource === 'call' && activity.actorAction === 'missed_call') return false;
      const classification = activity.classification ?? ActivityClassification.PENDING;
      if (classification === ActivityClassification.SKIP) return false;
      if (activity.actorAction === 'direct_message') {
        return (
          classification === ActivityClassification.ACTIONABLE ||
          classification === ActivityClassification.FYI
        );
      }
      return true;
    }).length;
  }, [unreadActivities]);
};
