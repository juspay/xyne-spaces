import { ActivityClassification } from '../zero/types';

/**
 * Minimal structural shape needed to decide whether an unread activity is a
 * user-facing notification. Both the state-machine `UnreadActivity` and the
 * dashboard `ActivityWithRelated` row types satisfy this (each provides
 * `actorAction: string`, `actionSource: string`, `classification: ActivityClassification`).
 */
export interface UnreadActivityVisibilityInput {
  actorAction?: string | null;
  actionSource?: string | null;
  classification?: ActivityClassification | null;
}

/**
 * Single source of truth for "does this unread activity count as a notification
 * and appear in the Activity 'All' feed?".
 *
 * Historically this rule was duplicated in two places that drifted apart:
 *   - the left-rail bell badge (`useUnreadActivitiesCount`), and
 *   - the Activity 'All' tab filter/count (`isAllVisibleActivity`).
 * The bell excluded reaction events (`added_v2` / `removed`); the 'All' tab did
 * not — so the two badges disagreed by exactly the number of unread reactions.
 *
 * The exclusion of reactions is the intended behavior and matches the backend:
 * reactions are currently emitted with `actorAction: 'added_v2'`, and the
 * backend unread-count query already filters `actorAction != 'added_v2'`
 * (see apps/backend/src/zero/utils/unreadCountUtlis.ts). Reactions remain
 * visible in the dedicated Reactions tab.
 *
 * Keep this the ONLY place that encodes the rule so the surfaces cannot drift
 * again.
 */
export const isVisibleUnreadActivity = (
  activity: UnreadActivityVisibilityInput,
): boolean => {
  // Reaction add (current event `added_v2`) and reaction removal are not
  // notifications. The bell badge, the per-channel/dock count, and the backend
  // unread-count query all exclude them.
  if (activity.actorAction === 'added_v2') return false;
  if (activity.actorAction === 'removed') return false;

  // Missed calls surface via the Calls badge, not the activity feed.
  if (activity.actionSource === 'call' && activity.actorAction === 'missed_call') {
    return false;
  }

  const classification = activity.classification ?? ActivityClassification.PENDING;
  if (classification === ActivityClassification.SKIP) return false;

  // Direct messages only notify when classified actionable / FYI.
  if (activity.actorAction === 'direct_message') {
    return (
      classification === ActivityClassification.ACTIONABLE ||
      classification === ActivityClassification.FYI
    );
  }

  return true;
};
