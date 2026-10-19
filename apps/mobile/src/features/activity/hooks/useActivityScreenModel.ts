import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useConnectionState } from '@rocicorp/zero/react';
import { ActivityClassification } from '@xyne/shared';
import { logger, Event } from '@/src/utils/logger';

import { useCachedQuery } from '@/src/hooks/useCachedQuery';
import { useZero } from '@/src/hooks/useZero';
import { useAuth } from '@/src/contexts/AuthContext';
import { getBoolean, getString, setBoolean } from '@/src/services/localStorage';
import {
  clearActivitySnapshot,
  persistActivitySnapshot,
  readActivitySnapshot,
  subscribeActivitySnapshotUpdated,
  type ActivityCursor,
  type ActivitySnapshot,
} from '@/src/utils/activitySnapshotCache';
import { queries } from '@/src/zero/queries';
import { useStartupPhase } from '@/src/providers/StartupPhaseProvider';
import { triggerActivitySync } from '@/src/features/activity/sync/activitySyncCoordinator';
import { useActivityLiveQueryGate } from '@/src/features/activity/sync/useActivityLiveQueryGate';
import { reconcileActivityFirstPage } from '@/src/features/activity/sync/activitySyncReconciler';
import { useActivitySyncState } from '@/src/features/activity/sync/useActivitySyncState';
import {
  getClassificationFilter,
  getActivityTypes,
} from '@/src/features/activity/domain/activityFilters';
import {
  ACTIVITY_FIRST_PAGE_SIZE,
  buildUserActivitiesPaginatedV2Query,
} from '@/src/features/activity/domain/activityPaginatedQuery';
import {
  getUnreadActivitySignature,
  getUnreadActivityCounts,
  hasVisibleActivities,
  selectActivitiesForWorkspace,
  selectVisibleActivities,
} from '@/src/features/activity/domain/activitySelectors';
import type { ActivityLike, ActivityTab } from '@/src/features/activity/domain/activityTypes';
import type { ActivityWithRelated } from '@/src/types/activity';
import { buildListSyncPayload } from '@/src/utils/listSyncTelemetry';
import { useForegroundListSyncProbe } from '@/src/hooks/useForegroundListSyncProbe';
import { useListLiveUpdateProbe } from '@/src/hooks/useListLiveUpdateProbe';
import { mutators } from '@/src/zero/mutators';

const PAGE_SIZE = ACTIVITY_FIRST_PAGE_SIZE;

const isSameActivityCursor = (
  current: ActivityCursor | null,
  next: ActivityCursor | null,
): boolean =>
  current === next ||
  (current !== null &&
    next !== null &&
    current.id === next.id &&
    current.updatedAt === next.updatedAt);
const LOTUS_USER_ID_STORAGE_KEY = '@lotus_user_id';
const ACTIVITY_UNREAD_TOGGLE_STORAGE_KEY = 'activity_unread_toggle';

const isRenderableActivity = <TActivity extends { id?: string | null }>(
  activity: TActivity | null | undefined,
): activity is TActivity & { id: string } =>
  activity !== null &&
  activity?.id !== null &&
  typeof activity?.id === 'string' &&
  activity?.id.length > 0;

const compactActivityPage = <TActivity extends { id?: string | null }>(
  activities: readonly (TActivity | null | undefined)[] | null | undefined,
): Array<TActivity & { id: string }> => (activities ?? []).filter(isRenderableActivity);

const mergeActivitiesById = <TActivity extends { id: string }>(
  existing: readonly TActivity[],
  incoming: readonly TActivity[],
): TActivity[] =>
  Array.from(
    new Map(compactActivityPage([...existing, ...incoming]).map(item => [item.id, item])).values(),
  );

const getUnreadActivityIdSet = (
  activities: readonly ActivityLike[] | undefined,
): Set<string> | undefined => {
  if (activities === undefined) {
    return undefined;
  }

  const ids = new Set<string>();
  for (const activity of activities) {
    if (activity.id && !activity.isRead) {
      ids.add(activity.id);
    }
  }
  return ids;
};

type ReconciledUnreadActivities = {
  activities: readonly ActivityLike[];
  liveSignatureAtStart: string;
};

/**
 * Merge two activity lists by `id`, picking the row with the higher `updatedAt`.
 * Prevents a stale Zero page from clobbering MMKV-derived rows that the push
 * prefetch just merged in. Sorts DESC by updatedAt (matches Zero ordering).
 */
const mergeActivitiesByIdLatestWins = <
  TActivity extends { id: string; updatedAt?: number | null; createdAt?: number | null },
>(
  base: readonly TActivity[],
  next: readonly TActivity[],
): TActivity[] => {
  const ts = (a: TActivity): number => (a.updatedAt ?? a.createdAt ?? 0) as number;
  const byId = new Map<string, TActivity>();
  for (const row of base) {
    if (row.id) byId.set(row.id, row);
  }
  for (const row of next) {
    if (!row.id) continue;
    const existing = byId.get(row.id);
    if (!existing || ts(row) >= ts(existing)) {
      byId.set(row.id, row);
    }
  }
  return Array.from(byId.values()).sort((a, b) => ts(b) - ts(a));
};

const getActivityCursor = <
  TActivity extends { id: string; updatedAt?: number | null; createdAt: number },
>(
  activity: TActivity | undefined,
): ActivityCursor | null =>
  activity
    ? {
        id: activity.id,
        updatedAt: activity.updatedAt ?? activity.createdAt,
      }
    : null;

const getLatestActivityTimestamp = <
  TActivity extends { updatedAt?: number | null; createdAt: number },
>(
  activities: readonly TActivity[],
): number =>
  activities.reduce(
    (latest, activity) => Math.max(latest, activity.updatedAt ?? activity.createdAt),
    0,
  );

const getActivityTabCacheKey = (
  currentUserId: string,
  workspaceId: string,
  activeTab: ActivityTab,
): string => `${currentUserId}:${workspaceId}:${activeTab}`;

const shouldPersistActivitySnapshot = (showUnreadOnly: boolean): boolean => !showUnreadOnly;

const readActivitySnapshotForTab = <TActivity extends ActivityLike>(
  currentUserId: string,
  workspaceId: string,
  activeTab: ActivityTab,
): ActivitySnapshot<TActivity> | null => {
  const exactSnapshot = readActivitySnapshot<TActivity>(currentUserId, workspaceId, activeTab);
  if (exactSnapshot || activeTab === 'all') {
    return exactSnapshot;
  }

  const allSnapshot = readActivitySnapshot<TActivity>(currentUserId, workspaceId, 'all');
  if (!allSnapshot) {
    return null;
  }

  return {
    ...allSnapshot,
    nextCursor: null,
    hasMore: true,
  };
};

const getVisiblePersistedSnapshot = <TActivity extends ActivityLike>(
  currentUserId: string,
  workspaceId: string,
  activeTab: ActivityTab,
  showUnreadOnly: boolean,
): ActivitySnapshot<TActivity> | null => {
  if (showUnreadOnly) {
    return null;
  }

  const snapshot = readActivitySnapshotForTab<TActivity>(currentUserId, workspaceId, activeTab);
  if (!snapshot) {
    return null;
  }

  return hasVisibleActivities(snapshot.activities, activeTab, showUnreadOnly) ? snapshot : null;
};

type ActivityDisplayPage = {
  rows: ActivityWithRelated[];
  nextCursor: ActivityCursor | null;
  hasMore: boolean;
  queryRowCount: number;
};

type InitialActivitySyncTelemetryState = {
  key: string;
  startedAtMs: number;
  hadInitialData: boolean;
  cacheRowCount: number;
  initialDataSource: 'none' | 'snapshot_cache';
  logged: boolean;
};

export type ActivityScreenModel = {
  activities: ActivityWithRelated[];
  isLoading: boolean;
  loadMore: () => void;
  hasMore: boolean;
  isLoadingMore: boolean;
  activeTab: ActivityTab;
  setActiveTab: Dispatch<SetStateAction<ActivityTab>>;
  showUnreadOnly: boolean;
  setShowUnreadOnly: Dispatch<SetStateAction<boolean>>;
  activityCounts: Record<ActivityTab, number>;
  markAsRead: () => void;
};

export const useActivityScreenModel = (
  options: { screenReady?: boolean } = {},
): ActivityScreenModel => {
  const zero = useZero();
  const zeroRef = useRef(zero);
  zeroRef.current = zero;
  const zeroConnection = useConnectionState();
  const syncState = useActivitySyncState();
  const { user } = useAuth();
  const { hasQueryCacheHydrated } = useStartupPhase();
  const [cachedUserId] = useState(() => getString(LOTUS_USER_ID_STORAGE_KEY) ?? '');
  const currentUserId = user?.user_id ?? cachedUserId;
  const workspaceId = user?.workspaceId ?? zero.context.workspaceId ?? '';

  const [activeTab, setActiveTab] = useState<ActivityTab>('all');
  const [showUnreadOnly, setShowUnreadOnly] = useState(
    () => getBoolean(ACTIVITY_UNREAD_TOGGLE_STORAGE_KEY) ?? false,
  );

  useEffect(() => {
    setBoolean(ACTIVITY_UNREAD_TOGGLE_STORAGE_KEY, showUnreadOnly);
  }, [showUnreadOnly]);

  useEffect(() => {
    if (options.screenReady) {
      triggerActivitySync('screen_focus');
    }
  }, [options.screenReady]);

  useEffect(() => {
    if (zeroConnection.name === 'connected') {
      triggerActivitySync('live_query_reconnected');
    }
  }, [zeroConnection.name]);

  const persistedSnapshot = useMemo(
    () =>
      getVisiblePersistedSnapshot<ActivityWithRelated>(
        currentUserId,
        workspaceId,
        activeTab,
        showUnreadOnly,
      ),
    [currentUserId, workspaceId, activeTab, showUnreadOnly],
  );

  const liveDataEnabled = useActivityLiveQueryGate({
    name: 'activity',
    screen: 'activity',
    screenReady: options.screenReady ?? true,
    hasInitialData: persistedSnapshot !== null,
    delayMs: 1_000,
    noInitialDataDelayMs: 0,
  });

  const [activities, setActivities] = useState<ActivityWithRelated[]>(
    () => persistedSnapshot?.activities ?? [],
  );
  const activitiesRef = useRef<ActivityWithRelated[]>(persistedSnapshot?.activities ?? []);
  const commitActivities = useCallback((nextActivities: ActivityWithRelated[]): void => {
    activitiesRef.current = nextActivities;
    setActivities(nextActivities);
  }, []);
  const { consumeIfNewer: consumeForegroundSyncIfNewer } = useForegroundListSyncProbe({
    enabled: liveDataEnabled && Boolean(currentUserId && workspaceId),
    identityKey:
      currentUserId && workspaceId
        ? `activity_list:${currentUserId}:${workspaceId}:${activeTab}:${showUnreadOnly}`
        : null,
    getLatestItemAt: () => getLatestActivityTimestamp(activitiesRef.current),
    getRowCount: () => activitiesRef.current.length,
  });
  const activityLiveUpdateIdentityKey =
    currentUserId && workspaceId
      ? `activity_list:${currentUserId}:${workspaceId}:${activeTab}:${showUnreadOnly}`
      : null;
  const { arm: armLiveUpdateProbe, consumeIfNewer: consumeLiveUpdateIfNewer } =
    useListLiveUpdateProbe();

  // Warm-state pickup: when the push-prefetch (NSE on background, JS onMessage
  // on foreground) merges new rows into the MMKV snapshot, re-read and merge
  // into the screen state without waiting for Zero to deliver them.
  useEffect(() => {
    if (!currentUserId || !workspaceId) return;
    const unsubscribe = subscribeActivitySnapshotUpdated(() => {
      const fresh = readActivitySnapshotForTab<ActivityWithRelated>(
        currentUserId,
        workspaceId,
        activeTab,
      );
      if (!fresh || fresh.activities.length === 0) return;
      const visibleFresh = selectVisibleActivities(fresh.activities, activeTab, showUnreadOnly);
      if (visibleFresh.length === 0) return;

      const byId = new Map<string, ActivityWithRelated>();
      for (const row of activitiesRef.current) {
        if (row.id) byId.set(row.id, row);
      }
      let changed = false;
      for (const row of visibleFresh) {
        if (!row.id) continue;
        const existing = byId.get(row.id);
        const existingTs = (existing?.updatedAt as number | undefined) ?? 0;
        const incomingTs = (row.updatedAt as number | undefined) ?? 0;
        if (!existing || incomingTs >= existingTs) {
          byId.set(row.id, row);
          changed = true;
        }
      }
      if (!changed) return;

      const merged = Array.from(byId.values()).sort((a, b) => {
        const aTs = (a.updatedAt as number | undefined) ?? 0;
        const bTs = (b.updatedAt as number | undefined) ?? 0;
        return bTs - aTs;
      });
      commitActivities(merged);
    });
    return unsubscribe;
  }, [currentUserId, workspaceId, activeTab, showUnreadOnly, commitActivities]);
  const [fetchCursor, setFetchCursor] = useState<ActivityCursor | null>(null);
  const [nextCursor, setNextCursor] = useState<ActivityCursor | null>(
    () => persistedSnapshot?.nextCursor ?? null,
  );
  const [hasMore, setHasMore] = useState(() => persistedSnapshot?.hasMore ?? true);
  const [isLoading, setIsLoading] = useState(() => persistedSnapshot === null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const isLoadingMoreRef = useRef(false);
  // Once loadMore has advanced the cursor past page 1, live first-page
  // emissions must not regress nextCursor/hasMore back to page-1 values —
  // that forces the next loadMore to re-crawl already-loaded pages.
  const hasPaginatedRef = useRef(false);
  const [hasSnapshot, setHasSnapshot] = useState(() => persistedSnapshot !== null);
  const [syncedUnreadActivities, setSyncedUnreadActivities] =
    useState<ReconciledUnreadActivities | null>(null);
  const liveUnreadSignatureRef = useRef('');
  const acceptedNonEmptyLiveTabsRef = useRef<Set<string>>(new Set());

  const initialSyncKeyRef = useRef<string | null>(null);
  const initialSyncTelemetryRef = useRef<InitialActivitySyncTelemetryState | null>(null);
  const initialSyncTimeRef = useRef<number | null>(null);

  const currentTypes = useMemo(() => getActivityTypes(activeTab), [activeTab]);
  const classificationFilter = useMemo(() => getClassificationFilter(activeTab), [activeTab]);
  const activityPageQuery = useMemo(
    () =>
      buildUserActivitiesPaginatedV2Query({
        limit: PAGE_SIZE,
        start: fetchCursor,
        types: currentTypes,
        classification: classificationFilter,
        showUnreadOnly,
      }),
    [classificationFilter, currentTypes, fetchCursor, showUnreadOnly],
  );

  const [activitiesPage, activitiesDetails] = useCachedQuery(activityPageQuery, {
    cursorEnabled: fetchCursor !== null,
    ttl: '10m',
    enabled: liveDataEnabled,
  });

  const resolveDisplayPage = useCallback(
    async (
      rawPage: ActivityWithRelated[],
      rawNextCursor: ActivityCursor | null,
      rawHasMore: boolean,
    ): Promise<ActivityDisplayPage> => {
      let rows = selectVisibleActivities(
        selectActivitiesForWorkspace(compactActivityPage(rawPage), workspaceId),
        activeTab,
        showUnreadOnly,
      );
      let nextCursor = rawNextCursor;
      let hasMoreRows = rawHasMore;
      let queryRowCount = rawPage.length;

      while (rows.length === 0 && nextCursor && hasMoreRows) {
        const nextRawPage = compactActivityPage(
          (await zeroRef.current.run(
            buildUserActivitiesPaginatedV2Query({
              limit: PAGE_SIZE,
              start: nextCursor,
              types: currentTypes,
              classification: classificationFilter,
              showUnreadOnly,
            }),
            { type: 'complete' },
          )) ?? [],
        );

        queryRowCount += nextRawPage.length;
        rows = selectVisibleActivities(
          selectActivitiesForWorkspace(nextRawPage, workspaceId),
          activeTab,
          showUnreadOnly,
        );
        nextCursor = getActivityCursor(nextRawPage[nextRawPage.length - 1]);
        hasMoreRows = nextRawPage.length >= PAGE_SIZE;
      }

      return {
        rows,
        nextCursor,
        hasMore: hasMoreRows,
        queryRowCount,
      };
    },
    [activeTab, classificationFilter, currentTypes, showUnreadOnly, workspaceId],
  );

  const logForegroundSyncIfNewer = useCallback(
    (
      nextRows: ActivityWithRelated[],
      queryRowCount: number,
      nextHasMore: boolean,
      dataSource: 'zero_run' | 'zero_subscription' = 'zero_subscription',
    ): boolean => {
      const foregroundProbe = consumeForegroundSyncIfNewer(getLatestActivityTimestamp(nextRows));
      if (!foregroundProbe) {
        return false;
      }

      const completedAtMs = performance.now();
      logger.info(
        Event.LOTUS_LIST_SYNC,
        buildListSyncPayload({
          listType: 'activity_list',
          stage: 'foreground_sync',
          dataSource,
          listStartedAtMs: foregroundProbe.startedAtMs,
          queryStartedAtMs: foregroundProbe.startedAtMs,
          completedAtMs,
          hadInitialData: foregroundProbe.cacheRowCount > 0,
          visibleRowCount: nextRows.length,
          queryRowCount,
          cacheRowCount: foregroundProbe.cacheRowCount,
          hasMore: nextHasMore,
          filterTab: activeTab,
          queryName: 'userActivitiesPaginatedV2',
        }),
      );
      return true;
    },
    [activeTab, consumeForegroundSyncIfNewer],
  );

  const armLiveUpdateBaseline = useCallback(
    (startedAtMs: number, baselineRows: ActivityWithRelated[]): void => {
      if (!activityLiveUpdateIdentityKey) {
        return;
      }

      armLiveUpdateProbe(
        activityLiveUpdateIdentityKey,
        startedAtMs,
        getLatestActivityTimestamp(baselineRows),
        baselineRows.length,
      );
    },
    [activityLiveUpdateIdentityKey, armLiveUpdateProbe],
  );

  const logLiveUpdateIfNewer = useCallback(
    (nextRows: ActivityWithRelated[], queryRowCount: number, nextHasMore: boolean): void => {
      if (!activityLiveUpdateIdentityKey) {
        return;
      }

      const latestItemAt = getLatestActivityTimestamp(nextRows);
      const probe = consumeLiveUpdateIfNewer(activityLiveUpdateIdentityKey, latestItemAt);
      if (!probe) {
        return;
      }

      const completedAtMs = performance.now();
      logger.info(
        Event.LOTUS_LIST_SYNC,
        buildListSyncPayload({
          listType: 'activity_list',
          stage: 'live_update',
          dataSource: 'zero_subscription',
          listStartedAtMs: probe.startedAtMs,
          queryStartedAtMs: probe.startedAtMs,
          completedAtMs,
          hadInitialData: probe.cacheRowCount > 0,
          visibleRowCount: nextRows.length,
          queryRowCount,
          cacheRowCount: probe.cacheRowCount,
          updatedRows: nextRows.filter(
            activity => (activity.updatedAt ?? activity.createdAt) > probe.latestItemAt,
          ).length,
          hasMore: nextHasMore,
          filterTab: activeTab,
          queryName: 'userActivitiesPaginatedV2',
          latestItemAt,
          previousLatestItemAt: probe.latestItemAt,
        }),
      );
    },
    [activeTab, activityLiveUpdateIdentityKey, consumeLiveUpdateIfNewer],
  );

  const activityInitialCacheRowCount = persistedSnapshot
    ? selectVisibleActivities(persistedSnapshot.activities, activeTab, showUnreadOnly).length
    : 0;
  const hasActivityInitialCache = activityInitialCacheRowCount > 0;

  useEffect(() => {
    const syncKey = [
      currentUserId,
      workspaceId,
      activeTab,
      showUnreadOnly ? 'unread' : 'all',
      currentTypes.join(','),
      classificationFilter ?? 'none',
    ].join(':');

    if (!liveDataEnabled || !currentUserId || !workspaceId || fetchCursor !== null) {
      return;
    }
    if (initialSyncKeyRef.current === syncKey) {
      return;
    }

    initialSyncKeyRef.current = syncKey;
    initialSyncTelemetryRef.current = {
      key: syncKey,
      startedAtMs: performance.now(),
      hadInitialData: hasActivityInitialCache,
      cacheRowCount: activityInitialCacheRowCount,
      initialDataSource: hasActivityInitialCache ? 'snapshot_cache' : 'none',
      logged: false,
    };
  }, [
    activeTab,
    activityInitialCacheRowCount,
    classificationFilter,
    currentTypes,
    currentUserId,
    fetchCursor,
    hasActivityInitialCache,
    liveDataEnabled,
    showUnreadOnly,
    workspaceId,
  ]);

  useEffect(() => {
    if (activitiesDetails.type !== 'error') {
      return;
    }

    const syncKey = [
      currentUserId,
      workspaceId,
      activeTab,
      showUnreadOnly ? 'unread' : 'all',
      currentTypes.join(','),
      classificationFilter ?? 'none',
    ].join(':');
    const telemetry = initialSyncTelemetryRef.current;
    if (!telemetry || telemetry.key !== syncKey || telemetry.logged) {
      return;
    }

    telemetry.logged = true;
    const completedAtMs = performance.now();
    logger.warn(
      Event.LOTUS_LIST_SYNC,
      buildListSyncPayload({
        listType: 'activity_list',
        stage: telemetry.hadInitialData ? 'warm_cache' : 'first_time',
        dataSource: 'zero_subscription',
        status: 'error',
        listStartedAtMs: telemetry.startedAtMs,
        queryStartedAtMs: telemetry.startedAtMs,
        completedAtMs,
        hadInitialData: telemetry.hadInitialData,
        visibleRowCount: activitiesRef.current.length,
        queryRowCount: 0,
        cacheRowCount: telemetry.cacheRowCount,
        initialDataSource: telemetry.initialDataSource,
        filterTab: activeTab,
        queryName: 'userActivitiesPaginatedV2',
        error:
          activitiesDetails.error instanceof Error
            ? activitiesDetails.error.message
            : String(activitiesDetails.error),
      }),
    );
    armLiveUpdateBaseline(telemetry.startedAtMs, activitiesRef.current);
  }, [
    activeTab,
    activitiesDetails,
    armLiveUpdateBaseline,
    classificationFilter,
    currentTypes,
    currentUserId,
    showUnreadOnly,
    workspaceId,
  ]);

  const logInitialSyncIfNeeded = useCallback(
    (nextRows: ActivityWithRelated[], queryRowCount: number, nextHasMore: boolean): boolean => {
      const syncKey = [
        currentUserId,
        workspaceId,
        activeTab,
        showUnreadOnly ? 'unread' : 'all',
        currentTypes.join(','),
        classificationFilter ?? 'none',
      ].join(':');
      const telemetry = initialSyncTelemetryRef.current;
      if (!telemetry || telemetry.key !== syncKey || telemetry.logged) {
        return false;
      }

      telemetry.logged = true;
      const completedAtMs = performance.now();
      initialSyncTimeRef.current = completedAtMs;
      logger.info(
        Event.LOTUS_LIST_SYNC,
        buildListSyncPayload({
          listType: 'activity_list',
          stage: telemetry.hadInitialData ? 'warm_cache' : 'first_time',
          dataSource: 'zero_subscription',
          listStartedAtMs: telemetry.startedAtMs,
          queryStartedAtMs: telemetry.startedAtMs,
          completedAtMs,
          hadInitialData: telemetry.hadInitialData,
          visibleRowCount: nextRows.length,
          queryRowCount,
          cacheRowCount: telemetry.cacheRowCount,
          hasMore: nextHasMore,
          initialDataSource: telemetry.initialDataSource,
          filterTab: activeTab,
          queryName: 'userActivitiesPaginatedV2',
        }),
      );
      armLiveUpdateBaseline(telemetry.startedAtMs, nextRows);
      return true;
    },
    [
      activeTab,
      armLiveUpdateBaseline,
      classificationFilter,
      currentTypes,
      currentUserId,
      showUnreadOnly,
      workspaceId,
    ],
  );

  useEffect(() => {
    const snapshot = persistedSnapshot;
    commitActivities(snapshot?.activities ?? []);
    setFetchCursor(null);
    setNextCursor(snapshot?.nextCursor ?? null);
    setHasMore(snapshot?.hasMore ?? true);
    setHasSnapshot(snapshot !== null);
    setIsLoading(snapshot === null);
    setIsLoadingMore(false);
    isLoadingMoreRef.current = false;
    hasPaginatedRef.current = false;
    setSyncedUnreadActivities(null);
  }, [commitActivities, persistedSnapshot]);

  useEffect(() => {
    let cancelled = false;

    if (activitiesDetails.type !== 'complete') {
      return undefined;
    }

    const rawPage = compactActivityPage(activitiesPage);
    const page = selectActivitiesForWorkspace(rawPage, workspaceId);
    const nextPageCursor = getActivityCursor(rawPage[rawPage.length - 1]);
    const nextHasMore = rawPage.length >= PAGE_SIZE;
    const tabCacheKey = getActivityTabCacheKey(currentUserId, workspaceId, activeTab);
    const canVerifyEmptyFirstPage =
      zeroConnection.name === 'connected' &&
      (hasQueryCacheHydrated || acceptedNonEmptyLiveTabsRef.current.has(tabCacheKey));

    if (rawPage.length === 0 || (page.length === 0 && !nextHasMore)) {
      if (fetchCursor === null) {
        setNextCursor(null);

        if (canVerifyEmptyFirstPage) {
          setIsLoading(false);
          commitActivities([]);
          setHasSnapshot(true);
          if (shouldPersistActivitySnapshot(showUnreadOnly)) {
            clearActivitySnapshot(currentUserId, workspaceId, activeTab);
          }
          logInitialSyncIfNeeded([], rawPage.length, false);
        } else {
          setIsLoading(true);
        }
      }
      setIsLoadingMore(false);
      // If pagination has advanced, a spurious empty first-page emission must
      // not kill it; a genuinely emptied dataset ends via loadMore itself.
      if (!hasPaginatedRef.current) {
        setHasMore(false);
      }
      return undefined;
    }

    const displayRows = selectVisibleActivities(page, activeTab, showUnreadOnly);

    if (displayRows.length === 0 && nextHasMore && nextPageCursor) {
      if (fetchCursor === null) {
        setIsLoading(true);
      }

      void resolveDisplayPage(rawPage, nextPageCursor, nextHasMore)
        .then(displayPage => {
          if (cancelled) {
            return;
          }

          if (!hasPaginatedRef.current) {
            setHasMore(displayPage.hasMore);
            setNextCursor(displayPage.nextCursor);
          }
          setIsLoadingMore(false);

          if (fetchCursor === null) {
            if (displayPage.rows.length === 0 && !canVerifyEmptyFirstPage) {
              setIsLoading(true);
              return;
            }

            setIsLoading(false);
            if (displayPage.rows.length > 0) {
              acceptedNonEmptyLiveTabsRef.current.add(tabCacheKey);
            }
            // Merge with current state (which may include MMKV-prefetched rows)
            // — latest updatedAt wins so a stale Zero page can't clobber fresher
            // push-prefetched activities.
            const mergedFirst = mergeActivitiesByIdLatestWins(
              activitiesRef.current,
              displayPage.rows,
            );
            commitActivities(mergedFirst);
            const didLogInitialSync = logInitialSyncIfNeeded(
              mergedFirst,
              displayPage.queryRowCount,
              displayPage.hasMore,
            );
            if (!didLogInitialSync) {
              const didLogForegroundSync = logForegroundSyncIfNewer(
                mergedFirst,
                displayPage.queryRowCount,
                displayPage.hasMore,
              );
              if (!didLogForegroundSync) {
                logLiveUpdateIfNewer(mergedFirst, displayPage.queryRowCount, displayPage.hasMore);
              }
            }
            setHasSnapshot(true);
            if (shouldPersistActivitySnapshot(showUnreadOnly)) {
              persistActivitySnapshot(
                currentUserId,
                workspaceId,
                activeTab,
                mergedFirst,
                displayPage.nextCursor,
                displayPage.hasMore,
              );
            }
            return;
          }

          setIsLoading(false);
          const combined = mergeActivitiesByIdLatestWins(activitiesRef.current, displayPage.rows);
          commitActivities(combined);
        })
        .catch(() => {
          if (!cancelled) {
            setIsLoading(false);
            setIsLoadingMore(false);
          }
        });

      return (): void => {
        cancelled = true;
      };
    }

    if (fetchCursor === null && displayRows.length === 0 && !canVerifyEmptyFirstPage) {
      setIsLoading(true);
      if (!hasPaginatedRef.current) {
        setHasMore(nextHasMore);
        setNextCursor(current =>
          isSameActivityCursor(current, nextPageCursor) ? current : nextPageCursor,
        );
      }
      return undefined;
    }

    setIsLoading(false);
    setIsLoadingMore(false);

    if (fetchCursor === null) {
      if (displayRows.length > 0) {
        acceptedNonEmptyLiveTabsRef.current.add(tabCacheKey);
      }
      // Same protection: merge MMKV-derived state with Zero rows, latest wins.
      const mergedFirst = mergeActivitiesByIdLatestWins(activitiesRef.current, displayRows);
      commitActivities(mergedFirst);
      const didLogInitialSync = logInitialSyncIfNeeded(mergedFirst, rawPage.length, nextHasMore);
      if (!didLogInitialSync) {
        const didLogForegroundSync = logForegroundSyncIfNewer(
          mergedFirst,
          rawPage.length,
          nextHasMore,
        );
        if (!didLogForegroundSync) {
          logLiveUpdateIfNewer(mergedFirst, rawPage.length, nextHasMore);
        }
      }
      if (shouldPersistActivitySnapshot(showUnreadOnly)) {
        persistActivitySnapshot(
          currentUserId,
          workspaceId,
          activeTab,
          mergedFirst,
          nextPageCursor,
          nextHasMore,
        );
      }
      setHasSnapshot(true);
    } else {
      const combined = mergeActivitiesByIdLatestWins(activitiesRef.current, displayRows);
      commitActivities(combined);
    }

    if (!hasPaginatedRef.current) {
      setHasMore(nextHasMore);
      setNextCursor(current =>
        isSameActivityCursor(current, nextPageCursor) ? current : nextPageCursor,
      );
    }

    return undefined;
  }, [
    activitiesPage,
    activitiesDetails.type,
    fetchCursor,
    activeTab,
    commitActivities,
    currentUserId,
    hasQueryCacheHydrated,
    logInitialSyncIfNeeded,
    logForegroundSyncIfNewer,
    logLiveUpdateIfNewer,
    resolveDisplayPage,
    showUnreadOnly,
    workspaceId,
    zeroConnection.name,
  ]);

  useEffect(() => {
    if (
      !currentUserId ||
      !workspaceId ||
      !liveDataEnabled ||
      fetchCursor !== null ||
      syncState.refreshNonce === 0 ||
      (syncState.urgency !== 'immediate' && syncState.urgency !== 'deferred')
    ) {
      return;
    }

    let cancelled = false;

    void reconcileActivityFirstPage({
      zero: zeroRef.current,
      currentUserId,
      workspaceId,
      refreshNonce: syncState.refreshNonce,
      activeTab,
      showUnreadOnly,
      currentTypes,
      classificationFilter,
      pageSize: PAGE_SIZE,
      resolveDisplayPage,
    })
      .then(displayPage => {
        if (cancelled) {
          return;
        }

        const tabCacheKey = getActivityTabCacheKey(currentUserId, workspaceId, activeTab);
        if (!hasPaginatedRef.current) {
          setHasMore(displayPage.hasMore);
          setNextCursor(displayPage.nextCursor);
        }
        setIsLoading(false);
        setIsLoadingMore(false);
        setSyncedUnreadActivities({
          activities: displayPage.unreadActivities,
          liveSignatureAtStart: liveUnreadSignatureRef.current,
        });

        if (displayPage.rows.length > 0) {
          acceptedNonEmptyLiveTabsRef.current.add(tabCacheKey);
        }

        // Same merge protection in the sync-reconciliation path.
        const mergedSync = mergeActivitiesByIdLatestWins(activitiesRef.current, displayPage.rows);
        commitActivities(mergedSync);
        logForegroundSyncIfNewer(
          mergedSync,
          displayPage.queryRowCount,
          displayPage.hasMore,
          'zero_run',
        );
        setHasSnapshot(true);

        if (shouldPersistActivitySnapshot(showUnreadOnly) && mergedSync.length > 0) {
          persistActivitySnapshot(
            currentUserId,
            workspaceId,
            activeTab,
            mergedSync,
            displayPage.nextCursor,
            displayPage.hasMore,
          );
        }
      })
      .catch(() => {
        if (!cancelled) {
          setIsLoading(false);
          setIsLoadingMore(false);
        }
      });

    return (): void => {
      cancelled = true;
    };
  }, [
    activeTab,
    classificationFilter,
    commitActivities,
    currentTypes,
    currentUserId,
    fetchCursor,
    liveDataEnabled,
    logForegroundSyncIfNewer,
    resolveDisplayPage,
    showUnreadOnly,
    syncState.refreshNonce,
    syncState.urgency,
    workspaceId,
  ]);

  const isRefreshingFirstPage = fetchCursor === null && activitiesDetails.type !== 'complete';

  const loadMore = useCallback(() => {
    if (
      !hasMore ||
      isLoadingMore ||
      isLoadingMoreRef.current ||
      isRefreshingFirstPage ||
      !nextCursor
    ) {
      return;
    }
    const cursor = nextCursor;
    const queryStartedAtMs = performance.now();
    isLoadingMoreRef.current = true;
    setIsLoadingMore(true);

    void new Promise<void>(resolve => {
      requestAnimationFrame(() => resolve());
    })
      .then(() =>
        zero.run(
          buildUserActivitiesPaginatedV2Query({
            limit: PAGE_SIZE,
            start: cursor,
            types: currentTypes,
            classification: classificationFilter,
            showUnreadOnly,
          }),
          { type: 'complete' },
        ),
      )
      .then(async page => {
        const rawPage = compactActivityPage(page);
        const displayPage = await resolveDisplayPage(
          rawPage,
          getActivityCursor(rawPage[rawPage.length - 1]),
          rawPage.length >= PAGE_SIZE,
        );
        const previousIds = new Set(activitiesRef.current.map(activity => activity.id));
        const newRows = displayPage.rows.filter(activity => !previousIds.has(activity.id));
        const combined = mergeActivitiesById(activitiesRef.current, displayPage.rows);
        const completedAtMs = performance.now();

        hasPaginatedRef.current = true;
        setHasMore(displayPage.hasMore);
        setNextCursor(displayPage.nextCursor);
        setIsLoading(false);
        setIsLoadingMore(false);
        isLoadingMoreRef.current = false;
        commitActivities(combined);

        if (
          initialSyncTimeRef.current === null ||
          completedAtMs - initialSyncTimeRef.current >= 500
        ) {
          logger.info(
            Event.LOTUS_LIST_SYNC,
            buildListSyncPayload({
              listType: 'activity_list',
              stage: 'load_more',
              dataSource: 'zero_run',
              listStartedAtMs: queryStartedAtMs,
              queryStartedAtMs,
              completedAtMs,
              hadInitialData: true,
              visibleRowCount: combined.length,
              queryRowCount: displayPage.queryRowCount,
              newRows: newRows.length,
              hasMore: displayPage.hasMore,
              filterTab: activeTab,
              queryName: 'userActivitiesPaginatedV2',
            }),
          );
        }
      })
      .catch(error => {
        const completedAtMs = performance.now();
        setIsLoadingMore(false);
        isLoadingMoreRef.current = false;
        logger.warn(
          Event.LOTUS_LIST_SYNC,
          buildListSyncPayload({
            listType: 'activity_list',
            stage: 'load_more',
            dataSource: 'zero_run',
            status: 'error',
            listStartedAtMs: queryStartedAtMs,
            queryStartedAtMs,
            completedAtMs,
            hadInitialData: true,
            visibleRowCount: activitiesRef.current.length,
            queryRowCount: 0,
            filterTab: activeTab,
            queryName: 'userActivitiesPaginatedV2',
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      });
  }, [
    activeTab,
    classificationFilter,
    commitActivities,
    currentTypes,
    hasMore,
    isLoadingMore,
    isRefreshingFirstPage,
    nextCursor,
    resolveDisplayPage,
    showUnreadOnly,
    zero,
  ]);

  const [rawUnreadActivities] = useCachedQuery(queries.userUnreadActivities(), {
    enabled: liveDataEnabled,
  });
  const unreadActivities = useMemo(
    () => selectActivitiesForWorkspace(rawUnreadActivities, workspaceId),
    [rawUnreadActivities, workspaceId],
  );
  const liveUnreadSignature = useMemo(
    () => getUnreadActivitySignature(unreadActivities),
    [unreadActivities],
  );
  liveUnreadSignatureRef.current = liveUnreadSignature;
  const syncedUnreads = syncedUnreadActivities?.activities;

  useEffect(() => {
    if (syncedUnreadActivities === null || unreadActivities === undefined) {
      return;
    }

    const syncedSignature = getUnreadActivitySignature(syncedUnreadActivities.activities);
    if (
      liveUnreadSignature === syncedSignature ||
      liveUnreadSignature !== syncedUnreadActivities.liveSignatureAtStart
    ) {
      setSyncedUnreadActivities(null);
    }
  }, [liveUnreadSignature, syncedUnreadActivities, unreadActivities]);

  const effectiveUnreadActivities = syncedUnreads ?? unreadActivities;

  const activityCounts = useMemo(
    () => getUnreadActivityCounts(effectiveUnreadActivities as readonly ActivityLike[] | undefined),
    [effectiveUnreadActivities],
  );

  const unreadActivityIdSet = useMemo(
    () => getUnreadActivityIdSet(effectiveUnreadActivities),
    [effectiveUnreadActivities],
  );

  const filteredActivities = useMemo(() => {
    const visibleActivities = selectVisibleActivities(activities, activeTab, showUnreadOnly);

    if (!showUnreadOnly || unreadActivityIdSet === undefined) {
      return visibleActivities;
    }

    return visibleActivities.filter(activity => unreadActivityIdSet.has(activity.id));
  }, [activities, activeTab, showUnreadOnly, unreadActivityIdSet]);

  const markAsRead = useCallback(() => {
    const filters: {
      actorAction?: string;
      classification?: ActivityClassification;
    } = {};

    if (activeTab === 'your_mentions') {
      filters.actorAction = 'mentioned_user';
    } else if (activeTab === 'group_mentions') {
      filters.actorAction = 'group_mention';
    } else if (activeTab === 'replies') {
      const timestamp = Date.now();
      void zero.mutate(
        mutators.activities.markAsReadByFilter({ actorAction: 'replied', timestamp }),
      );
      void zero.mutate(
        mutators.activities.markAsReadByFilter({ actorAction: 'replied_v2', timestamp }),
      );
      return;
    } else if (activeTab === 'all') {
      void zero.mutate(mutators.activities.markAsReadByFilter({ timestamp: Date.now() }));
      return;
    } else if (activeTab === 'actionable') {
      filters.classification = ActivityClassification.ACTIONABLE;
    } else if (activeTab === 'fyi') {
      filters.classification = ActivityClassification.FYI;
    }

    void zero.mutate(
      mutators.activities.markAsReadByFilter({
        ...filters,
        timestamp: Date.now(),
      }),
    );
  }, [activeTab, zero]);

  const isInitialLoading =
    (activitiesDetails.type !== 'complete' || isLoading) &&
    !hasSnapshot &&
    !hasVisibleActivities(filteredActivities, activeTab, showUnreadOnly);

  return {
    activities: filteredActivities,
    isLoading: isInitialLoading,
    loadMore,
    hasMore,
    isLoadingMore,
    activeTab,
    setActiveTab,
    showUnreadOnly,
    setShowUnreadOnly,
    activityCounts,
    markAsRead,
  };
};
