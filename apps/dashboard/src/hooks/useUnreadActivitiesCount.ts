import { useMemo } from 'react';
import { useSelector } from '@xstate/react';
import { ActivityClassification } from '@xyne/shared';
import { stateMachineActor } from '../machines/stateMachine';
import { groupActivities } from '../components/Activity/activityGrouping';
import type { ActivityWithRelated } from '../types/activity';

/**
 * Hook to get unread activities count with cancelled reactions filtered out
 * Reads from state machine (populated by DeferredLoader)
 *
 * Grouped ticket activities (same actor, same ticket, within the 30s grouping
 * window) count once here to match the single card they render as in the
 * Activity feed.
 *
 * @returns count - Number of unread activities
 */
export const useUnreadActivitiesCount = (): number => {
  const unreadActivities = useSelector(stateMachineActor, state => state.context.unreadActivities);

  return useMemo(() => {
    if (!unreadActivities || unreadActivities.length === 0) {
      return 0;
    }

    // Filter then group then count — the same order the Activity feed renders
    // in, so a run of ticket activities shown as one grouped card counts once.
    // The cast is safe: grouping and this predicate only touch fields present
    // on both the state-machine row and the fetched-feed shape.
    const visible = (unreadActivities as unknown as ActivityWithRelated[]).filter(activity => {
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
    });

    return groupActivities(visible).length;
  }, [unreadActivities]);
};
