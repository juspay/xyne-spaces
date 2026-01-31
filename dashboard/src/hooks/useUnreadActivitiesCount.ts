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

    // Track cancelled reactions (where both added and removed exist)
    const reactionGroups = new Map<string, { added: boolean; removed: boolean }>();

    for (const activity of activities) {
      if (activity.actionSource === 'reaction') {
        const reactionId = activity.actionSourceId;
        const current = reactionGroups.get(reactionId) || { added: false, removed: false };

        if (activity.actorAction === 'added') {
          current.added = true;
        } else if (activity.actorAction === 'removed') {
          current.removed = true;
          current.added = true;
        }

        reactionGroups.set(reactionId, current);
      }
    }

    // Count how many reactions are cancelled (both added and removed)
    let cancelledCount = 0;
    for (const [, group] of reactionGroups) {
      if (group.added && group.removed) {
        cancelledCount += 2; // Both added and removed activities should be excluded
      }
    }

    // Calculate final count
    const validCount =
      activities.filter(activity => {
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
      }).length - cancelledCount;

    // Return count as number
    return validCount;
  }, [activities]);

  return count;
};
