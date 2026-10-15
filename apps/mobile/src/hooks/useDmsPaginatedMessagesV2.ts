import { useState, useEffect, useCallback, useMemo, useRef, useLayoutEffect } from 'react';
import { QueryResultType } from '@rocicorp/zero';
import { useSelector } from '@xstate/react';
import { stateMachineActor } from '@xyne/shared/machines';
import { ChannelScopeType } from '@xyne/shared';
import { useFallbackQuery } from '@xyne/shared/hooks';
import { useZero } from '@/src/hooks/useZero';
import { useCachedQuery } from '@/src/hooks/useCachedQuery';
import { queries } from '@/src/zero/queries';
import { logger, Event } from '@/src/utils/logger';
import { buildListSyncPayload } from '@/src/utils/listSyncTelemetry';
import { useForegroundListSyncProbe } from '@/src/hooks/useForegroundListSyncProbe';
import { useListLiveUpdateProbe } from './useListLiveUpdateProbe';

type DmStatsPageResult = QueryResultType<typeof queries.dmChannelsLatestMessagesPaginated>;

type DmChannel = NonNullable<DmStatsPageResult[number]['channel']> & {
  channelStats: { lastActivityAt: number; participantCount: number } | undefined;
};

type DmConversation = NonNullable<
  NonNullable<DmStatsPageResult[number]['channel']>['conversations']
>[number];

const PAGE_SIZE = 20;
const INITIAL_SYNC_TIMEOUT_MS = 15000;
type DmListTelemetryFilterTab = 'all' | 'unread' | 'groups';
type DmUnreadCounts = Readonly<Record<string, number | undefined>>;
type DmListQuerySource = 'cache' | 'fresh';

interface UseDmsPaginatedMessagesOptions {
  selectedChannelId?: string | undefined;
  currentUserId?: string | undefined;
  workspaceId?: string | null | undefined;
  liveDataEnabled?: boolean;
  filterTab?: DmListTelemetryFilterTab;
  unreadCounts?: DmUnreadCounts;
}

interface UseDmsPaginatedMessagesReturn {
  messagesMap: Map<string, DmConversation>;
  channels: DmChannel[];
  hasMore: boolean;
  loadMore: () => void;
  isLoading: boolean;
  isLoadingMore: boolean;
  isLiveReady: boolean;
  hadQueryCache: boolean;
  initialSyncStatus: 'idle' | 'running' | 'complete' | 'error';
}

const sortDesc = (rows: DmStatsPageResult): DmStatsPageResult =>
  [...rows].sort(
    (a, b) => b.lastActivityAt - a.lastActivityAt || b.channelId.localeCompare(a.channelId),
  );

const getLatestActivityAt = (rows: DmStatsPageResult): number =>
  rows.reduce((latest, row) => Math.max(latest, row.lastActivityAt), 0);

const areDmRowsEquivalent = (a: DmStatsPageResult, b: DmStatsPageResult): boolean => {
  if (a.length !== b.length) {
    return false;
  }

  return a.every((row, index) => {
    const other = b[index];
    const conversation = row.channel?.conversations?.[0];
    const otherConversation = other?.channel?.conversations?.[0];
    return (
      other &&
      row.channelId === other.channelId &&
      row.lastActivityAt === other.lastActivityAt &&
      row.participantCount === other.participantCount &&
      row.channel?.id === other.channel?.id &&
      row.channel?.name === other.channel?.name &&
      conversation?.conversationId === otherConversation?.conversationId &&
      conversation?.initialMessageId === otherConversation?.initialMessageId &&
      conversation?.lastActivityAt === otherConversation?.lastActivityAt
    );
  });
};

const getDmWorkspaceKey = (workspaceId: string | null | undefined): string => workspaceId ?? '';

const getDmQueryCacheKey = (
  userId: string,
  schemaVersion: string,
  workspaceId: string | null | undefined,
): string => `${userId}:${schemaVersion}:${getDmWorkspaceKey(workspaceId)}`;

const filterDmRowsForWorkspace = (
  rows: DmStatsPageResult | undefined,
  workspaceId: string | null | undefined,
): DmStatsPageResult => {
  if (!rows || !workspaceId) {
    return [];
  }
  return rows.filter(row => row.channel?.workspaceId === workspaceId);
};

type InitialSyncTelemetryState = {
  key: string;
  startedAtMs: number;
  hadInitialData: boolean;
  initialCacheRowCount: number;
  initialDataSource: 'none' | 'query_cache';
  logged: boolean;
};

const getVisibleDmTelemetryRowCount = (
  rows: DmStatsPageResult,
  filterTab: DmListTelemetryFilterTab,
  unreadCounts: DmUnreadCounts,
  userChannelStatuses: ReadonlyArray<{ channelId: string; isClosed?: boolean }>,
): number => {
  const statusByChannelId = new Map(userChannelStatuses.map(status => [status.channelId, status]));
  const hasVisibilityState = statusByChannelId.size > 0;
  let count = 0;

  for (const row of rows) {
    const channel = row.channel;
    if (!channel) {
      continue;
    }

    const channelStatus = statusByChannelId.get(channel.id);
    if (hasVisibilityState && (!channelStatus || channelStatus.isClosed)) {
      continue;
    }

    if (filterTab === 'groups' && channel.scopeType !== ChannelScopeType.GROUP_DM) {
      continue;
    }

    if (filterTab === 'unread' && (unreadCounts[channel.id] ?? 0) <= 0) {
      continue;
    }

    count += 1;
  }

  return count;
};

export function useDmsPaginatedMessages(
  options: UseDmsPaginatedMessagesOptions = {},
): UseDmsPaginatedMessagesReturn {
  const {
    selectedChannelId,
    currentUserId,
    workspaceId,
    liveDataEnabled = true,
    filterTab = 'all',
    unreadCounts = {},
  } = options;
  const zero = useZero();
  const schemaVersion = zero.schemaVersion;
  const hadInitialQueryCacheRef = useRef<boolean>(false);
  const [serverVerifiedPageKey, setServerVerifiedPageKey] = useState<string | null>(null);

  const userChannelStatuses = useSelector(
    stateMachineActor,
    state => state.context.userChannelStatuses,
  );
  const telemetryContextRef = useRef({ filterTab, unreadCounts, userChannelStatuses });
  telemetryContextRef.current = { filterTab, unreadCounts, userChannelStatuses };

  const initialQueryCacheKey =
    currentUserId && schemaVersion && workspaceId
      ? getDmQueryCacheKey(currentUserId, schemaVersion, workspaceId)
      : null;

  const [rows, setRows] = useState<DmStatsPageResult>([]);
  const didHydrateRowsFromQueryCacheRef = useRef(false);
  const queryCacheKeyRef = useRef<string | null>(initialQueryCacheKey);
  const rowsRef = useRef<DmStatsPageResult>(rows);
  const commitRows = useCallback((next: DmStatsPageResult) => {
    rowsRef.current = next;
    setRows(next);
  }, []);
  const getVisibleRowCount = useCallback((nextRows: DmStatsPageResult): number => {
    const context = telemetryContextRef.current;
    return getVisibleDmTelemetryRowCount(
      nextRows,
      context.filterTab,
      context.unreadCounts,
      context.userChannelStatuses,
    );
  }, []);
  const getTelemetryFilterTab = useCallback(
    (): DmListTelemetryFilterTab => telemetryContextRef.current.filterTab,
    [],
  );
  const { consumeIfNewer: consumeForegroundSyncIfNewer } = useForegroundListSyncProbe({
    enabled: liveDataEnabled && Boolean(currentUserId && schemaVersion && workspaceId),
    identityKey:
      currentUserId && schemaVersion && workspaceId
        ? `dm_list:${getDmQueryCacheKey(currentUserId, schemaVersion, workspaceId)}`
        : null,
    getLatestItemAt: () => getLatestActivityAt(rowsRef.current),
    getRowCount: () => getVisibleRowCount(rowsRef.current),
  });
  useLayoutEffect(() => {
    if (!currentUserId || !schemaVersion || !workspaceId) {
      queryCacheKeyRef.current = null;
      hadInitialQueryCacheRef.current = false;
      didHydrateRowsFromQueryCacheRef.current = false;
      if (rowsRef.current.length > 0) {
        commitRows([]);
      }
      return;
    }

    const hydrationKey = getDmQueryCacheKey(currentUserId, schemaVersion, workspaceId);
    const didKeyChange =
      queryCacheKeyRef.current !== null && queryCacheKeyRef.current !== hydrationKey;
    if (didKeyChange) {
      hadInitialQueryCacheRef.current = false;
      didHydrateRowsFromQueryCacheRef.current = false;
      if (rowsRef.current.length > 0) {
        commitRows([]);
      }
    }

    queryCacheKeyRef.current = hydrationKey;
  }, [commitRows, currentUserId, schemaVersion, workspaceId]);

  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  // loadMore resolves asynchronously and its `finally` decides whether to run a
  // queued round. The closure's `hasMore` would be stale by then, so every
  // write goes through commitHasMore and the ref is the async-safe read.
  const hasMoreRef = useRef(true);
  const commitHasMore = useCallback((next: boolean): void => {
    hasMoreRef.current = next;
    setHasMore(next);
  }, []);
  // At most one pending request. A fire that lands mid-fetch is remembered
  // instead of dropped, which is what made the per-frame onScroll poll
  // necessary in the first place.
  const pendingLoadMoreRef = useRef(false);

  const [initialSyncStatus, setInitialSyncStatus] = useState<
    'idle' | 'running' | 'complete' | 'error'
  >('idle');
  const isFetchingRef = useRef(false);
  const forwardCursorRef = useRef<{ lastActivityAt: number; channelId: string } | null>(null);
  const hasMoreBeforeRef = useRef(false);
  // Latches when a server-complete page confirms the forward end. Live page-1
  // emissions must not resurrect hasMore after that, otherwise the list keeps
  // re-triggering empty loadMore rounds at the bottom.
  const forwardExhaustedRef = useRef(false);
  // Once loadMore advances the cursor, page-1 emissions must not regress it.
  const didPaginateForwardRef = useRef(false);

  useLayoutEffect(() => {
    setInitialSyncStatus('idle');
    commitHasMore(true);
    setIsLoadingMore(false);
    isFetchingRef.current = false;
    pendingLoadMoreRef.current = false;
    forwardCursorRef.current = null;
    hasMoreBeforeRef.current = false;
    forwardExhaustedRef.current = false;
    didPaginateForwardRef.current = false;
  }, [commitHasMore, initialQueryCacheKey]);
  const commitHasMoreBefore = useCallback((next: boolean) => {
    hasMoreBeforeRef.current = next;
  }, []);

  const selectedChannelIdRef = useRef(selectedChannelId);

  useEffect(() => {
    selectedChannelIdRef.current = selectedChannelId;
  }, [selectedChannelId]);

  const initialSyncKeyRef = useRef<string | null>(null);
  const initialSyncTelemetryRef = useRef<InitialSyncTelemetryState | null>(null);
  const { arm: armLiveUpdateProbe, consumeIfNewer: consumeLiveUpdateIfNewer } =
    useListLiveUpdateProbe();

  const getInitialCacheInfo = useCallback(() => {
    const queryCacheRowCount = hadInitialQueryCacheRef.current
      ? getVisibleRowCount(rowsRef.current)
      : 0;
    const initialCacheRowCount = queryCacheRowCount;
    const hadInitialData = queryCacheRowCount > 0;
    const initialDataSource = queryCacheRowCount > 0 ? 'query_cache' : 'none';

    return {
      hadInitialData,
      initialCacheRowCount,
      initialDataSource,
    } as const;
  }, [getVisibleRowCount]);

  const armLiveUpdateBaseline = useCallback(
    (identityKey: string, startedAtMs: number, baselineRows: DmStatsPageResult): void => {
      armLiveUpdateProbe(
        identityKey,
        startedAtMs,
        getLatestActivityAt(baselineRows),
        getVisibleRowCount(baselineRows),
      );
    },
    [armLiveUpdateProbe, getVisibleRowCount],
  );

  const logLiveUpdateIfNewer = useCallback(
    (
      identityKey: string,
      nextRows: DmStatsPageResult,
      queryRowCount: number,
      nextHasMore: boolean,
    ) => {
      const latestItemAt = getLatestActivityAt(nextRows);
      const probe = consumeLiveUpdateIfNewer(identityKey, latestItemAt);
      if (!probe) {
        return;
      }

      const completedAtMs = performance.now();
      logger.info(
        Event.LOTUS_LIST_SYNC,
        buildListSyncPayload({
          listType: 'dm_list',
          stage: 'live_update',
          dataSource: 'zero_subscription',
          listStartedAtMs: probe.startedAtMs,
          queryStartedAtMs: probe.startedAtMs,
          completedAtMs,
          hadInitialData: probe.cacheRowCount > 0,
          visibleRowCount: getVisibleRowCount(nextRows),
          queryRowCount,
          cacheRowCount: probe.cacheRowCount,
          updatedRows: nextRows.filter(row => row.lastActivityAt > probe.latestItemAt).length,
          hasMore: nextHasMore,
          filterTab: getTelemetryFilterTab(),
          queryName: 'dmChannelsLatestMessagesPaginated',
          latestItemAt,
          previousLatestItemAt: probe.latestItemAt,
        }),
      );
    },
    [consumeLiveUpdateIfNewer, getTelemetryFilterTab, getVisibleRowCount],
  );

  const isWorkspaceReady = initialQueryCacheKey !== null;
  // Args are compile-time constants, so this object never needs to change.
  // A fresh identity each render makes useCachedQuery re-derive the query AST
  // and its hash, and useFallbackQuery re-derive its format — roughly five AST
  // builds per render for a query that is always the same.
  const page1Query = useMemo(
    () =>
      queries.dmChannelsLatestMessagesPaginated({
        limit: PAGE_SIZE,
        start: null,
        direction: 'forward',
      }),
    [],
  );
  const [localPage1, localPage1Details, localPage1Meta] = useCachedQuery(page1Query, {
    enabled: liveDataEnabled && isWorkspaceReady,
    cursorEnabled: true,
    includeMeta: true,
  }) as readonly [
    DmStatsPageResult | undefined,
    { type: 'complete' | 'unknown' | 'error'; error?: unknown },
    { source: DmListQuerySource } | undefined,
  ];
  const localWorkspacePage1 = useMemo(
    () => filterDmRowsForWorkspace(localPage1, workspaceId),
    [localPage1, workspaceId],
  );
  const shouldVerifyInitialPage =
    liveDataEnabled &&
    isWorkspaceReady &&
    initialQueryCacheKey !== null &&
    serverVerifiedPageKey !== initialQueryCacheKey &&
    (localPage1Details.type !== 'complete' || localWorkspacePage1.length === 0);
  const [serverPage1, serverPage1Details] = useFallbackQuery(page1Query, {
    enabled: shouldVerifyInitialPage,
  });
  const serverWorkspacePage1 = useMemo(
    () => filterDmRowsForWorkspace(serverPage1, workspaceId),
    [serverPage1, workspaceId],
  );
  const hasServerPage1 =
    serverPage1 !== undefined &&
    serverPage1Details.type === 'complete' &&
    (serverPage1.length === 0 || serverWorkspacePage1.length > 0);

  useEffect(() => {
    if (hasServerPage1 && initialQueryCacheKey) {
      setServerVerifiedPageKey(initialQueryCacheKey);
    }
  }, [hasServerPage1, initialQueryCacheKey]);

  const shouldUseServerPage1 =
    hasServerPage1 && (localPage1Details.type !== 'complete' || localWorkspacePage1.length === 0);
  const rawPage1 = shouldUseServerPage1 ? serverPage1 : localPage1;
  const page1 = useMemo(
    () => filterDmRowsForWorkspace(rawPage1, workspaceId),
    [rawPage1, workspaceId],
  );
  const rawPage1RowCount = rawPage1?.length ?? 0;
  const hasUsableLocalPage =
    localPage1Details.type === 'complete' && localWorkspacePage1.length > 0;
  const didInitialPageVerificationFail =
    shouldVerifyInitialPage && serverPage1Details.type === 'error';
  const page1Details = shouldUseServerPage1
    ? ({ type: 'complete' } as const)
    : hasUsableLocalPage
      ? localPage1Details
      : didInitialPageVerificationFail
        ? serverPage1Details
        : ({ type: 'unknown' } as const);
  const page1DetailsType = page1Details.type;
  const page1Error = page1Details.type === 'error' ? page1Details.error : undefined;
  const page1Meta = shouldUseServerPage1 ? undefined : localPage1Meta;
  // Complete page1 is authoritative on the raw (pre-workspace-filter) count so a
  // filtered-down page cannot falsely claim "more". Incomplete/unknown page1
  // still treats any painted rows as potentially incomplete.
  const page1HasMore =
    page1Details.type === 'complete' ? rawPage1RowCount >= PAGE_SIZE : page1.length > 0;

  useEffect(() => {
    if (!liveDataEnabled || !currentUserId || !schemaVersion || !workspaceId) {
      return;
    }

    const syncKey = getDmQueryCacheKey(currentUserId, schemaVersion, workspaceId);
    if (initialSyncKeyRef.current === syncKey) return;

    initialSyncKeyRef.current = syncKey;
    const { hadInitialData, initialCacheRowCount, initialDataSource } = getInitialCacheInfo();
    initialSyncTelemetryRef.current = {
      key: syncKey,
      startedAtMs: performance.now(),
      hadInitialData,
      initialCacheRowCount,
      initialDataSource,
      logged: false,
    };

    setInitialSyncStatus('running');

    const timeoutTimer = setTimeout(() => {
      const telemetry = initialSyncTelemetryRef.current;
      if (!telemetry || telemetry.key !== syncKey || telemetry.logged) return;

      telemetry.logged = true;
      const completedAtMs = performance.now();
      setInitialSyncStatus('error');
      logger.warn(
        Event.LOTUS_LIST_SYNC,
        buildListSyncPayload({
          listType: 'dm_list',
          stage: telemetry.hadInitialData ? 'warm_cache' : 'first_time',
          dataSource: 'zero_subscription',
          status: 'error',
          listStartedAtMs: telemetry.startedAtMs,
          queryStartedAtMs: telemetry.startedAtMs,
          completedAtMs,
          hadInitialData: telemetry.hadInitialData,
          visibleRowCount: getVisibleRowCount(rowsRef.current),
          queryRowCount: 0,
          cacheRowCount: telemetry.initialCacheRowCount,
          initialDataSource: telemetry.initialDataSource,
          filterTab: getTelemetryFilterTab(),
          queryName: 'dmChannelsLatestMessagesPaginated',
          error: 'dm_initial_sync_timeout',
        }),
      );
      armLiveUpdateBaseline(syncKey, telemetry.startedAtMs, rowsRef.current);
    }, INITIAL_SYNC_TIMEOUT_MS);

    return (): void => {
      clearTimeout(timeoutTimer);
    };
  }, [
    armLiveUpdateBaseline,
    currentUserId,
    getInitialCacheInfo,
    getTelemetryFilterTab,
    getVisibleRowCount,
    liveDataEnabled,
    schemaVersion,
    workspaceId,
  ]);

  useEffect(() => {
    if (page1DetailsType !== 'error' || !currentUserId || !schemaVersion) {
      return;
    }

    const syncKey = getDmQueryCacheKey(currentUserId, schemaVersion, workspaceId);
    const telemetry = initialSyncTelemetryRef.current;
    if (!telemetry || telemetry.key !== syncKey || telemetry.logged) {
      return;
    }

    telemetry.logged = true;
    const completedAtMs = performance.now();
    setInitialSyncStatus('error');
    logger.warn(
      Event.LOTUS_LIST_SYNC,
      buildListSyncPayload({
        listType: 'dm_list',
        stage: telemetry.hadInitialData ? 'warm_cache' : 'first_time',
        dataSource: 'zero_subscription',
        status: 'error',
        listStartedAtMs: telemetry.startedAtMs,
        queryStartedAtMs: telemetry.startedAtMs,
        completedAtMs,
        hadInitialData: telemetry.hadInitialData,
        visibleRowCount: getVisibleRowCount(rowsRef.current),
        queryRowCount: 0,
        cacheRowCount: telemetry.initialCacheRowCount,
        initialDataSource: telemetry.initialDataSource,
        filterTab: getTelemetryFilterTab(),
        queryName: 'dmChannelsLatestMessagesPaginated',
        error: page1Error instanceof Error ? page1Error.message : String(page1Error),
      }),
    );
    armLiveUpdateBaseline(syncKey, telemetry.startedAtMs, rowsRef.current);
  }, [
    armLiveUpdateBaseline,
    currentUserId,
    getTelemetryFilterTab,
    getVisibleRowCount,
    page1DetailsType,
    page1Error,
    schemaVersion,
    workspaceId,
  ]);

  const logInitialSyncIfNeeded = useCallback(
    (
      syncKey: string,
      nextRows: DmStatsPageResult,
      queryRowCount: number,
      nextHasMore: boolean,
    ): boolean => {
      const telemetry = initialSyncTelemetryRef.current;
      if (!telemetry || telemetry.key !== syncKey) return false;

      setInitialSyncStatus('complete');
      const didTimeoutBeforeComplete = telemetry.logged;
      if (!telemetry.logged) {
        telemetry.logged = true;
        const completedAtMs = performance.now();
        logger.info(
          Event.LOTUS_LIST_SYNC,
          buildListSyncPayload({
            listType: 'dm_list',
            stage: telemetry.hadInitialData ? 'warm_cache' : 'first_time',
            dataSource: 'zero_subscription',
            listStartedAtMs: telemetry.startedAtMs,
            queryStartedAtMs: telemetry.startedAtMs,
            completedAtMs,
            hadInitialData: telemetry.hadInitialData,
            visibleRowCount: getVisibleRowCount(nextRows),
            queryRowCount,
            cacheRowCount: telemetry.initialCacheRowCount,
            hasMore: nextHasMore,
            initialDataSource: telemetry.initialDataSource,
            filterTab: getTelemetryFilterTab(),
            queryName: 'dmChannelsLatestMessagesPaginated',
          }),
        );
        armLiveUpdateBaseline(syncKey, telemetry.startedAtMs, nextRows);
      }

      return !didTimeoutBeforeComplete;
    },
    [armLiveUpdateBaseline, getTelemetryFilterTab, getVisibleRowCount],
  );

  // Paint Zero's page1 immediately — do not wait for liveDataEnabled deferral.
  useLayoutEffect(() => {
    if (rowsRef.current.length > 0) {
      return;
    }
    if (page1Details.type !== 'complete' || page1.length === 0) {
      return;
    }

    didHydrateRowsFromQueryCacheRef.current = page1Meta?.source === 'cache';
    if (page1Meta?.source === 'cache') {
      hadInitialQueryCacheRef.current = true;
    }
    commitRows(sortDesc(page1));
    const lastRawPage1Row = rawPage1?.at(-1);
    forwardCursorRef.current = lastRawPage1Row
      ? {
          lastActivityAt: lastRawPage1Row.lastActivityAt,
          channelId: lastRawPage1Row.channelId,
        }
      : null;
    commitHasMore(forwardExhaustedRef.current ? false : page1HasMore);
  }, [
    commitHasMore,
    commitRows,
    page1,
    page1Details.type,
    page1HasMore,
    page1Meta?.source,
    rawPage1,
  ]);

  const isLiveReady =
    liveDataEnabled &&
    isWorkspaceReady &&
    page1Details.type === 'complete' &&
    (page1.length === 0 || rows.length > 0);

  // Stay in loading until rows exist when page1 already has data (covers cached startup → effect gap).
  const isLoading =
    rows.length === 0 &&
    initialSyncStatus !== 'complete' &&
    (liveDataEnabled
      ? !isWorkspaceReady || page1Details.type !== 'complete' || page1.length > 0
      : true);

  useEffect(() => {
    if (!liveDataEnabled || !isWorkspaceReady) return;

    const isPage1Complete = page1Details.type === 'complete';

    if (hasMoreBeforeRef.current) {
      const selectedId = selectedChannelIdRef.current;
      const selectedInPage1 =
        selectedId !== null &&
        selectedId !== undefined &&
        page1.some(s => s.channelId === selectedId);
      if (!selectedInPage1) return;
      commitHasMoreBefore(false);
    }

    if (page1.length === 0) {
      if (!isPage1Complete) {
        return;
      }
      // A fresh in-memory Zero can briefly report an empty local replica.
      // Keep already-painted rows until the server confirms the empty page.
      if (rowsRef.current.length > 0 && !shouldUseServerPage1) {
        return;
      }
      didHydrateRowsFromQueryCacheRef.current = false;
      if (rowsRef.current.length > 0) {
        commitRows([]);
      }
      commitHasMore(forwardExhaustedRef.current ? false : page1HasMore);
      if (currentUserId && schemaVersion && workspaceId) {
        logInitialSyncIfNeeded(
          getDmQueryCacheKey(currentUserId, schemaVersion, workspaceId),
          [],
          0,
          false,
        );
      }
      return;
    }

    const page1Ids = new Set(page1.map(s => s.channelId));
    const shouldReplaceQueryCacheRows = didHydrateRowsFromQueryCacheRef.current && isPage1Complete;
    const deeperRows = shouldReplaceQueryCacheRows
      ? []
      : rowsRef.current.filter(s => !page1Ids.has(s.channelId));
    const merged = sortDesc([...page1, ...deeperRows]);
    didHydrateRowsFromQueryCacheRef.current = false;

    if (!areDmRowsEquivalent(rowsRef.current, merged)) {
      commitRows(merged);
    }
    commitHasMore(forwardExhaustedRef.current ? false : page1HasMore);

    // Keep the forward cursor anchored to the server-complete page 1 tail
    // until loadMore takes over. The cursor must never derive from hydrated
    // cache rows — a non-contiguous cache tail would make the next page skip
    // everything between the true page-1 tail and the stale row.
    if (isPage1Complete && !didPaginateForwardRef.current) {
      const lastRawPage1Row = rawPage1?.at(-1);
      forwardCursorRef.current = lastRawPage1Row
        ? {
            lastActivityAt: lastRawPage1Row.lastActivityAt,
            channelId: lastRawPage1Row.channelId,
          }
        : null;
    }

    if (isPage1Complete) {
      const syncKey =
        currentUserId && schemaVersion && workspaceId
          ? getDmQueryCacheKey(currentUserId, schemaVersion, workspaceId)
          : null;
      const didLogInitialSync =
        syncKey !== null
          ? logInitialSyncIfNeeded(syncKey, merged, rawPage1RowCount, page1HasMore)
          : false;
      if (!didLogInitialSync) {
        const foregroundProbe = consumeForegroundSyncIfNewer(getLatestActivityAt(merged));
        if (foregroundProbe) {
          const completedAtMs = performance.now();
          logger.info(
            Event.LOTUS_LIST_SYNC,
            buildListSyncPayload({
              listType: 'dm_list',
              stage: 'foreground_sync',
              dataSource: 'zero_subscription',
              listStartedAtMs: foregroundProbe.startedAtMs,
              queryStartedAtMs: foregroundProbe.startedAtMs,
              completedAtMs,
              hadInitialData: foregroundProbe.cacheRowCount > 0,
              visibleRowCount: getVisibleRowCount(merged),
              queryRowCount: rawPage1RowCount,
              cacheRowCount: foregroundProbe.cacheRowCount,
              hasMore: page1HasMore,
              filterTab: getTelemetryFilterTab(),
              queryName: 'dmChannelsLatestMessagesPaginated',
            }),
          );
        } else if (syncKey !== null) {
          logLiveUpdateIfNewer(syncKey, merged, rawPage1RowCount, page1HasMore);
        }
      }
    }
  }, [
    commitHasMore,
    commitRows,
    commitHasMoreBefore,
    consumeForegroundSyncIfNewer,
    currentUserId,
    getTelemetryFilterTab,
    getVisibleRowCount,
    logInitialSyncIfNeeded,
    logLiveUpdateIfNewer,
    liveDataEnabled,
    isWorkspaceReady,
    page1,
    page1Details.type,
    page1HasMore,
    rawPage1,
    rawPage1RowCount,
    schemaVersion,
    shouldUseServerPage1,
    workspaceId,
  ]);

  const fetchPage = useCallback(
    (
      start: { lastActivityAt: number; channelId: string } | null,
      direction?: 'forward' | 'backward',
    ) =>
      zero.run(
        queries.dmChannelsLatestMessagesPaginated({
          limit: PAGE_SIZE,
          start,
          direction,
        }),
        { type: 'complete' },
      ),
    [zero],
  );

  // Assigned right after loadMore is defined. The queued round has to call the
  // same function, and a useCallback cannot reference itself in its own body.
  const loadMoreRef = useRef<() => void>(() => undefined);

  const loadMore = useCallback(() => {
    // Pagination is an explicit user action. It must not wait for the live
    // subscription gate; the workspace gate and cursor guard remain in place.
    if (!isWorkspaceReady || !hasMoreRef.current) return;
    // A request that arrives mid-fetch is queued, not dropped. One slot only —
    // the list can never build up a backlog of rounds.
    if (isFetchingRef.current) {
      pendingLoadMoreRef.current = true;
      return;
    }

    // The cursor must chain from server-complete results only (page 1 or a
    // previous loadMore page). Falling back to the oldest visible row would
    // paginate from hydrated cache rows, whose tail is not contiguous — the
    // fetched page then skips everything between the real page-1 tail and
    // that stale row. Until a complete page 1 arrives, stay idle.
    const cursor = forwardCursorRef.current;
    if (!cursor) return;

    isFetchingRef.current = true;
    setIsLoadingMore(true);

    const loadMoreStartTime = performance.now();

    void (async (): Promise<void> => {
      try {
        // Let the loading footer commit before Zero materializes the page.
        await new Promise<void>(resolve => {
          requestAnimationFrame(() => resolve());
        });

        let nextCursor = cursor;
        let rawPage: DmStatsPageResult | undefined;
        let page: DmStatsPageResult = [];

        do {
          rawPage = await fetchPage(nextCursor, 'forward');
          if (!rawPage || rawPage.length === 0) {
            break;
          }

          const lastRawRow = rawPage.at(-1);
          if (lastRawRow) {
            nextCursor = {
              lastActivityAt: lastRawRow.lastActivityAt,
              channelId: lastRawRow.channelId,
            };
            forwardCursorRef.current = nextCursor;
            didPaginateForwardRef.current = true;
          }

          const existingIds = new Set(rowsRef.current.map(row => row.channelId));
          page = filterDmRowsForWorkspace(rawPage, workspaceId).filter(
            row => !existingIds.has(row.channelId),
          );
        } while (page.length === 0 && rawPage.length === PAGE_SIZE);

        const latencyCompletedAtMs = performance.now();
        if (!rawPage || rawPage.length === 0) {
          logger.info(
            Event.LOTUS_LIST_SYNC,
            buildListSyncPayload({
              listType: 'dm_list',
              stage: 'load_more',
              dataSource: 'zero_run',
              listStartedAtMs: loadMoreStartTime,
              queryStartedAtMs: loadMoreStartTime,
              completedAtMs: latencyCompletedAtMs,
              hadInitialData: true,
              visibleRowCount: getVisibleRowCount(rowsRef.current),
              queryRowCount: 0,
              newRows: 0,
              hasMore: false,
              filterTab: getTelemetryFilterTab(),
              queryName: 'dmChannelsLatestMessagesPaginated',
            }),
          );
          forwardExhaustedRef.current = true;
          commitHasMore(false);
          return;
        }

        const newRows = page;

        if (newRows.length > 0) {
          const next = hasMoreBeforeRef.current
            ? [...rowsRef.current, ...newRows]
            : sortDesc([...rowsRef.current, ...newRows]);
          commitRows(next);

          logger.info(
            Event.LOTUS_LIST_SYNC,
            buildListSyncPayload({
              listType: 'dm_list',
              stage: 'load_more',
              dataSource: 'zero_run',
              listStartedAtMs: loadMoreStartTime,
              queryStartedAtMs: loadMoreStartTime,
              completedAtMs: latencyCompletedAtMs,
              hadInitialData: true,
              visibleRowCount: getVisibleRowCount(next),
              queryRowCount: rawPage.length,
              newRows: newRows.length,
              hasMore: rawPage.length === PAGE_SIZE,
              filterTab: getTelemetryFilterTab(),
              queryName: 'dmChannelsLatestMessagesPaginated',
            }),
          );
        } else {
          logger.info(
            Event.LOTUS_LIST_SYNC,
            buildListSyncPayload({
              listType: 'dm_list',
              stage: 'load_more',
              dataSource: 'zero_run',
              listStartedAtMs: loadMoreStartTime,
              queryStartedAtMs: loadMoreStartTime,
              completedAtMs: latencyCompletedAtMs,
              hadInitialData: true,
              visibleRowCount: getVisibleRowCount(rowsRef.current),
              queryRowCount: rawPage.length,
              newRows: 0,
              hasMore: rawPage.length === PAGE_SIZE,
              filterTab: getTelemetryFilterTab(),
              queryName: 'dmChannelsLatestMessagesPaginated',
            }),
          );
        }

        const reachedEnd = rawPage.length < PAGE_SIZE;
        if (reachedEnd) {
          forwardExhaustedRef.current = true;
        }
        commitHasMore(!reachedEnd);
      } catch (error) {
        const completedAtMs = performance.now();
        logger.warn(
          Event.LOTUS_LIST_SYNC,
          buildListSyncPayload({
            listType: 'dm_list',
            stage: 'load_more',
            dataSource: 'zero_run',
            status: 'error',
            listStartedAtMs: loadMoreStartTime,
            queryStartedAtMs: loadMoreStartTime,
            completedAtMs,
            hadInitialData: true,
            visibleRowCount: getVisibleRowCount(rowsRef.current),
            queryRowCount: 0,
            filterTab: getTelemetryFilterTab(),
            queryName: 'dmChannelsLatestMessagesPaginated',
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      } finally {
        isFetchingRef.current = false;
        setIsLoadingMore(false);

        // Drain the single queued slot. hasMoreRef is authoritative here: a
        // round that hit the true end has already set it false, so a queued
        // request at the end of the list resolves to a no-op instead of
        // another fetch.
        if (pendingLoadMoreRef.current) {
          pendingLoadMoreRef.current = false;
          if (hasMoreRef.current) {
            loadMoreRef.current();
          }
        }
      }
    })();
  }, [
    isWorkspaceReady,
    fetchPage,
    commitHasMore,
    commitRows,
    getTelemetryFilterTab,
    getVisibleRowCount,
    workspaceId,
  ]);

  loadMoreRef.current = loadMore;

  const channels = useMemo<DmChannel[]>(
    () =>
      rows
        .filter(s => s.channel !== null)
        .map(s => ({
          ...s.channel!,
          channelStats: {
            lastActivityAt: s.lastActivityAt,
            participantCount: s.participantCount,
          },
        })),
    [rows],
  );

  const messagesMap = useMemo(() => {
    const map = new Map<string, DmConversation>();
    for (const { channelId, channel } of rows) {
      const first = channel?.conversations?.[0];
      if (first) map.set(channelId, first);
    }
    return map;
  }, [rows]);

  return {
    messagesMap,
    channels,
    hasMore,
    loadMore,
    isLoading,
    isLoadingMore,
    isLiveReady,
    hadQueryCache: hadInitialQueryCacheRef.current,
    initialSyncStatus,
  };
}

export type { DmChannel, DmConversation };
