import { ActivityClassification } from '@xyne/shared';

/**
 * The minimal shape needed to decide whether an activity is visible in the
 * Activity tab's "All" view. Both the paginated feed rows and the
 * `userUnreadActivities` rows satisfy it.
 */
export type ActivityVisibilityFields = {
  actorAction: string;
  actionSource: string;
  classification?: ActivityClassification | null;
};

/**
 * Single source of truth for "does this activity show up under Activity → All".
 * Used by the All tab filter, the All tab unread count and the sidebar
 * Activity badge, so those numbers can never drift apart.
 *
 * Reactions (`added_v2`) are intentionally included: cancelled reactions are
 * already deleted server-side (see reactions-handler onDelete), so every
 * `added_v2` row is a live reaction.
 */
export const isAllVisibleActivity = (activity: ActivityVisibilityFields): boolean => {
  const classification = activity.classification ?? ActivityClassification.PENDING;
  if (activity.actionSource === 'call' && activity.actorAction === 'missed_call') {
    return false;
  }

  if (classification === ActivityClassification.SKIP) return false;
  if (activity.actorAction === 'direct_message') {
    return (
      classification === ActivityClassification.ACTIONABLE ||
      classification === ActivityClassification.FYI
    );
  }
  return true;
};
