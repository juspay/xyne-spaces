import type { ActivityLike, ActivityTab } from '@/src/features/activity/domain/activityTypes';
import { selectActivitiesForWorkspace } from '@/src/features/activity/domain/activitySelectors';
import { getJson, lotusStorage, setJson } from '@/src/services/localStorage';

const ACTIVITY_SNAPSHOT_CACHE_VERSION = 1;
const ACTIVITY_SNAPSHOT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type ActivityCursor = {
  id: string;
  updatedAt: number;
};

export type ActivitySnapshot<TActivity extends ActivityLike = ActivityLike> = {
  version: typeof ACTIVITY_SNAPSHOT_CACHE_VERSION;
  activities: TActivity[];
  nextCursor: ActivityCursor | null;
  hasMore: boolean;
  savedAt: number;
};

const activitySnapshotCacheKey = (
  currentUserId: string,
  workspaceId: string,
  activeTab: ActivityTab,
): string =>
  `@lotus_activity_rows:${currentUserId}:${workspaceId}:${activeTab}:v${ACTIVITY_SNAPSHOT_CACHE_VERSION}`;

export const readActivitySnapshot = <TActivity extends ActivityLike = ActivityLike>(
  currentUserId: string,
  workspaceId: string,
  activeTab: ActivityTab,
): ActivitySnapshot<TActivity> | null => {
  if (!currentUserId || !workspaceId) {
    return null;
  }

  const snapshot = getJson<ActivitySnapshot<TActivity>>(
    activitySnapshotCacheKey(currentUserId, workspaceId, activeTab),
  );
  if (!snapshot || snapshot.version !== ACTIVITY_SNAPSHOT_CACHE_VERSION) {
    return null;
  }

  const workspaceActivities = selectActivitiesForWorkspace(snapshot.activities, workspaceId);
  if (workspaceActivities.length === 0 || typeof snapshot.savedAt !== 'number') {
    return null;
  }

  if (Date.now() - snapshot.savedAt > ACTIVITY_SNAPSHOT_MAX_AGE_MS) {
    return null;
  }

  return { ...snapshot, activities: workspaceActivities };
};

export const persistActivitySnapshot = <TActivity extends ActivityLike = ActivityLike>(
  currentUserId: string,
  workspaceId: string,
  activeTab: ActivityTab,
  activities: TActivity[],
  nextCursor: ActivityCursor | null,
  hasMore: boolean,
  options: { allowEmptyOverwrite?: boolean } = {},
): void => {
  if (!currentUserId || !workspaceId) {
    return;
  }

  const workspaceActivities = selectActivitiesForWorkspace(activities, workspaceId);
  if (workspaceActivities.length === 0 && options.allowEmptyOverwrite !== true) {
    return;
  }

  setJson(activitySnapshotCacheKey(currentUserId, workspaceId, activeTab), {
    version: ACTIVITY_SNAPSHOT_CACHE_VERSION,
    activities: workspaceActivities,
    nextCursor,
    hasMore,
    savedAt: Date.now(),
  } satisfies ActivitySnapshot<TActivity>);
};

export const clearActivitySnapshot = (
  currentUserId: string,
  workspaceId: string,
  activeTab: ActivityTab,
): void => {
  if (!currentUserId || !workspaceId) {
    return;
  }

  lotusStorage.remove(activitySnapshotCacheKey(currentUserId, workspaceId, activeTab));
};

// ---------------------------------------------------------------------------
// Snapshot-update notification (mirror of subscribeNotificationCacheUpdated in
// notificationCache.ts). The push-prefetch path writes MMKV from a different
// React render scope (or from the iOS NSE, which the main app picks up on
// foreground); subscribers re-read MMKV and merge into screen state.
// ---------------------------------------------------------------------------
const activitySnapshotListeners = new Set<() => void>();

export function subscribeActivitySnapshotUpdated(listener: () => void): () => void {
  activitySnapshotListeners.add(listener);
  return () => {
    activitySnapshotListeners.delete(listener);
  };
}

export function notifyActivitySnapshotUpdated(): void {
  activitySnapshotListeners.forEach(listener => listener());
}

/**
 * Watermark used by the push-prefetch path: the most recent `updatedAt` we already have cached
 * (across the "all" tab snapshot). Returns 0 when the snapshot is empty / missing — backend
 * then returns the latest N rows.
 */
export const deriveActivitiesWatermark = (currentUserId: string, workspaceId: string): number => {
  if (!currentUserId || !workspaceId) return 0;
  const snapshot = readActivitySnapshot(currentUserId, workspaceId, 'all');
  if (!snapshot) return 0;

  let max = 0;
  for (const row of snapshot.activities) {
    const ts = typeof row.updatedAt === 'number' ? row.updatedAt : 0;
    if (ts > max) max = ts;
  }
  return max;
};

/**
 * Merge prefetched activity rows into the "all" tab snapshot. Last-write-wins by `updatedAt`,
 * keyed by activity `id`. Sets `hasMore` when the oldest incoming row is newer than the
 * snapshot's prior max — meaning there's an unfilled gap between cached and incoming.
 *
 * `incoming` is the raw shape returned by the fallback executor for `userActivitiesPaginatedV2`.
 * No-op when incoming is empty or no rows have an id.
 */
export const mergeActivitiesIntoSnapshot = <TActivity extends ActivityLike = ActivityLike>(
  currentUserId: string,
  workspaceId: string,
  incoming: TActivity[],
): void => {
  if (!currentUserId || !workspaceId || !Array.isArray(incoming) || incoming.length === 0) return;

  const workspaceIncoming = selectActivitiesForWorkspace(incoming, workspaceId);
  if (workspaceIncoming.length === 0) return;

  const priorSnapshot = readActivitySnapshot<TActivity>(currentUserId, workspaceId, 'all');
  const priorMax = priorSnapshot
    ? priorSnapshot.activities.reduce((m, r) => {
        const ts = typeof r.updatedAt === 'number' ? r.updatedAt : 0;
        return ts > m ? ts : m;
      }, 0)
    : 0;

  const byId = new Map<string, TActivity>();
  for (const row of priorSnapshot?.activities ?? []) {
    if (typeof row.id === 'string' && row.id.length > 0) {
      byId.set(row.id, row);
    }
  }

  let oldestIncoming = Number.POSITIVE_INFINITY;
  for (const row of workspaceIncoming) {
    if (typeof row.id !== 'string' || row.id.length === 0) continue;
    const incomingTs = typeof row.updatedAt === 'number' ? row.updatedAt : 0;
    if (incomingTs < oldestIncoming) oldestIncoming = incomingTs;
    const existing = byId.get(row.id);
    const existingTs = existing && typeof existing.updatedAt === 'number' ? existing.updatedAt : 0;
    if (!existing || incomingTs >= existingTs) {
      byId.set(row.id, row);
    }
  }

  // Sort descending by updatedAt (matches userActivitiesPaginatedV2 ordering)
  const merged = Array.from(byId.values()).sort((a, b) => {
    const aTs = typeof a.updatedAt === 'number' ? a.updatedAt : 0;
    const bTs = typeof b.updatedAt === 'number' ? b.updatedAt : 0;
    return bTs - aTs;
  });

  const hasGap =
    oldestIncoming !== Number.POSITIVE_INFINITY && oldestIncoming > priorMax && priorMax > 0;
  const nextHasMore = hasGap || (priorSnapshot?.hasMore ?? false);

  persistActivitySnapshot<TActivity>(
    currentUserId,
    workspaceId,
    'all',
    merged,
    priorSnapshot?.nextCursor ?? null,
    nextHasMore,
  );

  // Wake mounted subscribers (e.g. activity screen) so warm-state pushes pick up
  // the merged rows without waiting for Zero. Cold start uses readActivitySnapshot
  // directly on mount and doesn't need this signal.
  notifyActivitySnapshotUpdated();
};
