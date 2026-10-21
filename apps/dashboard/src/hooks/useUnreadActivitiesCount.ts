import { useMemo } from 'react';
import { useSelector } from '@xstate/react';
import { stateMachineActor } from '../machines/stateMachine';
import { isAllVisibleActivity } from '../utils/activityVisibility';

/**
 * Unread activity count for the sidebar Activity badge.
 * Uses the same predicate as the Activity tab's "All" view so both numbers match.
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

    return unreadActivities.filter(isAllVisibleActivity).length;
  }, [unreadActivities]);
};
