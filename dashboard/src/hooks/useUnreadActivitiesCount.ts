import { useMemo } from 'react';
import { ActivityClassification } from '@xyne/shared';
import { queries } from '../zero/queries';
import { useCachedQuery } from './useCachedQuery';

/**
 * Hook to get unread activities count with cancelled reactions filtered out
 * Cancelled reactions = where both "added" and "removed" exist for same reactionId
 *
 * @returns count - Number of unread activities
 */
export const useUnreadActivitiesCount = (): number => {
  const [activities] = useCachedQuery(queries.userUnreadActivities());

  const count = useMemo(() => {
    if (!activities || activities.length === 0) {
      return 0;
    }

    const validCount = activities.filter(activity => {
      if (activity.actorAction === 'removed') {
        return false;
      }
      if (activity.actionSource === 'call' && activity.actorAction === 'missed_call') {
        return false;
      }
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

    // Return count as number
    return validCount;
  }, [activities]);

  return count;
};
