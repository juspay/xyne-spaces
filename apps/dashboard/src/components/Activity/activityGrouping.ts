import type { ActivityWithRelated } from '../../types/activity';

export interface ActivityGroup {
  type: 'group';
  activities: ActivityWithRelated[];
}

export type ActivityFeedItem = { type: 'single'; activity: ActivityWithRelated } | ActivityGroup;

const TICKET_ACTIVITY_PREFIX = 'ticket_';
const GROUP_WINDOW_MS = 30 * 1000; // 30 seconds

/**
 * Counts activities per bucket the way the feed renders them: each bucket is
 * filtered, then grouped, then counted, so a set of ticket activities that
 * renders as one grouped card contributes 1 — not N — to its badge.
 *
 * Deliberately reuses `groupActivities` rather than reimplementing the
 * grouping rule: a second copy of that rule is exactly how badges drifted
 * from the feed in the first place. This mirrors the render path, which also
 * filters before grouping (see ActivityListView).
 *
 * `activities` must be sorted the same way the rendered feed is (newest
 * first) for "consecutive" to mean the same thing in both places.
 */
export function countGroupedActivities<K extends string>(
  activities: readonly ActivityWithRelated[],
  buckets: Record<K, (activity: ActivityWithRelated) => boolean>,
): Record<K, number> {
  const counts = {} as Record<K, number>;
  for (const key of Object.keys(buckets) as K[]) {
    counts[key] = groupActivities(activities.filter(buckets[key])).length;
  }
  return counts;
}

/**
 * Group consecutive ticket-related activities from the same actor on the same ticket
 * within a 30-second window.
 *
 * Rules:
 * - Only groups activities whose actorAction starts with 'ticket_'
 * - Same actorId + same ticketId required
 * - Time gap between consecutive activities must be ≤ 30s
 * - Any non-ticket activity or different actor/ticket breaks the group
 */
export function groupActivities(activities: ActivityWithRelated[]): ActivityFeedItem[] {
  if (activities.length === 0) return [];

  const result: ActivityFeedItem[] = [];
  let currentGroup: ActivityWithRelated[] = [];

  function flushGroup(): void {
    if (currentGroup.length === 0) return;

    if (currentGroup.length === 1) {
      result.push({ type: 'single', activity: currentGroup[0]! });
    } else {
      result.push({ type: 'group', activities: [...currentGroup] });
    }
    currentGroup = [];
  }

  function canJoinGroup(group: ActivityWithRelated[], candidate: ActivityWithRelated): boolean {
    if (group.length === 0) return false;

    const last = group[group.length - 1]!;

    // Must be a ticket activity
    if (!candidate.actorAction?.startsWith(TICKET_ACTIVITY_PREFIX)) return false;
    if (!last.actorAction?.startsWith(TICKET_ACTIVITY_PREFIX)) return false;

    // Same actor
    if (candidate.actorId !== last.actorId) return false;

    // Same ticket
    if (candidate.ticketId !== last.ticketId) return false;

    // Within time window
    const lastTime = last.updatedAt ?? last.createdAt ?? 0;
    const candidateTime = candidate.updatedAt ?? candidate.createdAt ?? 0;
    if (Math.abs(candidateTime - lastTime) > GROUP_WINDOW_MS) return false;

    return true;
  }

  for (const activity of activities) {
    if (canJoinGroup(currentGroup, activity)) {
      currentGroup.push(activity);
    } else {
      flushGroup();
      currentGroup.push(activity);
    }
  }

  flushGroup();
  return result;
}
