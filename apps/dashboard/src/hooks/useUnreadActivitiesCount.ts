import { useMemo } from 'react';
import { useSelector } from '@xstate/react';
import { isVisibleUnreadActivity } from '@xyne/shared';
import { stateMachineActor } from '../machines/stateMachine';

/**
 * Hook to get the unread activities count shown on the left-rail bell badge.
 * Reads from state machine (populated by DeferredLoader) and counts only
 * activities that are user-facing notifications.
 *
 * Uses the shared `isVisibleUnreadActivity` predicate so this badge always
 * matches the Activity 'All' tab count/feed (single source of truth).
 *
 * @returns count - Number of unread notification activities
 */
export const useUnreadActivitiesCount = (): number => {
  const unreadActivities = useSelector(stateMachineActor, state => state.context.unreadActivities);

  return useMemo(() => {
    if (!unreadActivities || unreadActivities.length === 0) {
      return 0;
    }

    return unreadActivities.filter(isVisibleUnreadActivity).length;
  }, [unreadActivities]);
};
