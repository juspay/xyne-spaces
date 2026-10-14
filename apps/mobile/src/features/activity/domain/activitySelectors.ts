import { ActivityClassification } from '@xyne/shared';

import type { ActivityCounts, ActivityLike, ActivityTab } from './activityTypes';
import { EMPTY_ACTIVITY_COUNTS } from './activityTypes';
import { matchesActivityTab } from './activityFilters';

export const selectActivitiesForWorkspace = <T extends ActivityLike>(
  activities: readonly (T | null | undefined)[] | null | undefined,
  workspaceId: string,
): T[] => {
  if (!workspaceId) {
    return [];
  }

  return (activities ?? []).filter(
    (activity): activity is T =>
      activity !== null &&
      activity !== undefined &&
      (activity.workspaceId === null ||
        activity.workspaceId === undefined ||
        activity.workspaceId === workspaceId),
  );
};

export const selectVisibleActivities = <T extends ActivityLike>(
  activities: readonly T[],
  activeTab: ActivityTab,
  showUnreadOnly: boolean,
): T[] => {
  if (activities.length === 0) {
    return [];
  }

  return activities.filter(activity => {
    if (!activity?.id) {
      return false;
    }

    const matchesTab = matchesActivityTab(activity, activeTab);
    const matchesReadState = showUnreadOnly ? !activity.isRead : true;
    return matchesTab && matchesReadState;
  });
};

export const hasVisibleActivities = <T extends ActivityLike>(
  activities: readonly T[],
  activeTab: ActivityTab,
  showUnreadOnly: boolean,
): boolean => selectVisibleActivities(activities, activeTab, showUnreadOnly).length > 0;

export const getUnreadActivityCounts = (
  activities: readonly (ActivityLike | null | undefined)[] | undefined,
): ActivityCounts => {
  if (!activities?.length) {
    return { ...EMPTY_ACTIVITY_COUNTS };
  }

  const counts: ActivityCounts = { ...EMPTY_ACTIVITY_COUNTS };
  const tabs = Object.keys(counts) as ActivityTab[];

  activities.forEach(activity => {
    if (!activity || activity.isRead) {
      return;
    }

    tabs.forEach(tab => {
      if (matchesActivityTab(activity, tab)) {
        counts[tab] += 1;
      }
    });
  });

  return counts;
};

export const selectActivityBadgeCount = (
  activities: readonly (ActivityLike | null | undefined)[] | undefined,
): number => getUnreadActivityCounts(activities).all;

/**
 * Fingerprint the fields that affect activity visibility and unread badges.
 * IDs alone are insufficient because Zero can update an existing row in place
 * when it is read, reclassified, or moved between channel/thread scopes.
 */
export const getUnreadActivitySignature = (
  activities: readonly (ActivityLike | null | undefined)[] | undefined,
): string =>
  (activities ?? [])
    .filter((activity): activity is ActivityLike => Boolean(activity?.id))
    .map(activity =>
      JSON.stringify([
        activity.id,
        activity.updatedAt ?? 0,
        activity.isRead ?? false,
        activity.classification ?? ActivityClassification.PENDING,
        activity.actorAction ?? '',
        activity.actionSource ?? '',
        activity.channelId ?? '',
        activity.isThreadActivity ?? false,
        activity.ticketId ?? '',
      ]),
    )
    .sort()
    .join('|');

/**
 * Match desktop channel-directory semantics: channel badges represent unread,
 * channel-level activities. DM badges continue to use channel status counts.
 */
export const getUnreadChannelActivityCounts = (
  activities: readonly (ActivityLike | null | undefined)[] | undefined,
  readStateByChannelId?: ReadonlyMap<string, { lastViewedAt?: number | null }>,
): ReadonlyMap<string, number> => {
  const counts = new Map<string, number>();

  for (const activity of activities ?? []) {
    if (!activity?.channelId) continue;
    const lastViewedAt = readStateByChannelId?.get(activity.channelId)?.lastViewedAt;
    if (!isUnreadChannelActivity(activity, lastViewedAt)) continue;

    counts.set(activity.channelId, (counts.get(activity.channelId) ?? 0) + 1);
  }

  return counts;
};

export const isUnreadChannelActivity = (
  activity: ActivityLike | null | undefined,
  lastViewedAt?: number | null,
): activity is ActivityLike & { channelId: string } => {
  if (!activity?.channelId || activity.isRead || activity.isThreadActivity === true) return false;
  if (activity.actorAction === 'added_v2' || activity.actorAction === 'removed') return false;
  if (activity.actionSource === 'call' && activity.actorAction === 'missed_call') return false;

  const classification = activity.classification ?? ActivityClassification.PENDING;
  if (classification === ActivityClassification.SKIP) return false;

  const activityCreatedAt = activity.createdAt ?? activity.updatedAt;
  return !lastViewedAt || !activityCreatedAt || activityCreatedAt > lastViewedAt;
};
