import type { ActivityWithRelated } from '../../types/activity';

export interface ActivityGroup {
  type: 'group';
  activities: ActivityWithRelated[];
}

export type ActivityFeedItem = { type: 'single'; activity: ActivityWithRelated } | ActivityGroup;

const TICKET_ACTIVITY_PREFIX = 'ticket_';
const GROUP_WINDOW_MS = 30 * 1000; // 30 seconds

/** Minimal shape the grouping/counting rule needs — satisfied by both
 * `ActivityWithRelated` (the fetched feed) and `UnreadActivity` (the state
 * machine's lighter unread-activities row), so counters can share this logic
 * without re-fetching or re-shaping data. */
export interface ActivityGroupable {
  id: string;
  actorAction: string;
  actorId: string;
  ticketId?: string | null;
  updatedAt?: number | null;
  createdAt?: number | null;
}

function isTicketGroupCandidate(activity: ActivityGroupable): boolean {
  return typeof activity.actorAction === 'string' && activity.actorAction.startsWith(TICKET_ACTIVITY_PREFIX);
}

function canExtendGroup(tail: ActivityGroupable, candidate: ActivityGroupable): boolean {
  if (!isTicketGroupCandidate(tail) || !isTicketGroupCandidate(candidate)) return false;
  if (tail.actorId !== candidate.actorId) return false;
  if (tail.ticketId !== candidate.ticketId) return false;

  const tailTime = tail.updatedAt ?? tail.createdAt ?? 0;
  const candidateTime = candidate.updatedAt ?? candidate.createdAt ?? 0;
  return Math.abs(candidateTime - tailTime) <= GROUP_WINDOW_MS;
}

/**
 * Counts activities per bucket in a single O(activities × buckets) pass,
 * collapsing consecutive same-actor/same-ticket ticket_* activities within
 * the 30s grouping window into one count per bucket — the same rule
 * `groupActivities` uses for rendering, so tab/sidebar badges match what the
 * grouped feed actually shows. `activities` must be pre-sorted the same way
 * the rendered feed is (newest-first) for "consecutive" to mean the same
 * thing in both places.
 */
export function countGroupedActivities<T extends ActivityGroupable>(
  activities: readonly T[],
  buckets: Record<string, (activity: T) => boolean>,
): Record<string, number> {
  const bucketKeys = Object.keys(buckets);
  const counts: Record<string, number> = {};
  const tails: Record<string, T | undefined> = {};
  for (const key of bucketKeys) {
    counts[key] = 0;
  }

  for (const activity of activities) {
    for (const key of bucketKeys) {
      if (!buckets[key]!(activity)) continue;

      const tail = tails[key];
      if (tail && canExtendGroup(tail, activity)) {
        tails[key] = activity;
        continue;
      }

      counts[key]++;
      tails[key] = activity;
    }
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
