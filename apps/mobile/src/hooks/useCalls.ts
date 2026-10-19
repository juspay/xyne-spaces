/**
 * useCalls — full port of dashboard/src/routes/CallHistoryScreen/useCallHistory.ts
 * for React Native + expo-router.
 *
 * Design decisions vs dashboard:
 *  - Uses Alert.alert for confirmations instead of modal overlays
 *  - Uses expo-router for navigation instead of useNavigate
 *  - Uses paginated accumulator pattern (page1 + loadMore) for call history
 *  - UPCOMING tab is driven by userScheduledCalls query (not userCallHistory)
 */
import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import { router } from 'expo-router';
import { useSelector } from '@xstate/react';
import { useConnectionState } from '@rocicorp/zero/react';
import { logger, Event } from '@/src/utils/logger';
import { useCachedQuery } from './useCachedQuery';
import { useZero } from './useZero';
import { queries } from '../zero/queries';
import { CallStatus, ChannelScopeType } from '@xyne/shared';
import { useAuth } from '../contexts/AuthContext';
import { useIsInCall, useCurrentCallExternalId } from './useRoomMachine';
import type { CallDisplayData } from '@/src/types/calls';
import { stateMachineActor } from '@/src/machines/appStateMachine';
import { useStartupPhase } from '@/src/providers/StartupPhaseProvider';
import {
  buildCallChannelsById,
  EMPTY_CALL_CHANNELS,
  EMPTY_CALL_USERS,
  getRecentCallsForDisplay,
  getScheduledCallsForDisplay,
  toCallDisplayData,
  type CallChannelLike,
  type CallUserLike,
  type RawCall,
  type ScheduledRawCall,
} from '@/src/utils/callDisplayData';
import { buildListSyncPayload } from '@/src/utils/listSyncTelemetry';
import { useForegroundListSyncProbe } from './useForegroundListSyncProbe';
import { useListLiveUpdateProbe } from './useListLiveUpdateProbe';

// ─── Enums / types ──────────────────────────────────────────────────────────

export enum CallTab {
  ALL = 'all',
  UPCOMING = 'upcoming',
  MISSED = 'missed',
}

export type { CallDisplayData };

type UseCallsOptions = {
  liveDataEnabled?: boolean;
};

// ─── Constants ──────────────────────────────────────────────────────────────

// Same page size and query as the dashboard (usePaginatedCalls).
const PAGE_SIZE = 35;

/**
 * Dashboard merge (queryCacheMachine.mergeCallHistoryPage): upsert each row by id, then
 * order newest first. Every Zero emission is applied — the equivalence gate this
 * replaced compared only call columns, so a change that lived in a related row
 * (participants) was dropped and the list stayed stale.
 */
const mergeCallPage = (existing: RawCall[], page: ReadonlyArray<RawCall>): RawCall[] => {
  const byId = new Map(existing.map(call => [call.id, call]));
  for (const call of page) byId.set(call.id, call);
  return [...byId.values()].sort(
    (a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0) || b.id.localeCompare(a.id),
  );
};

const getCallDisplayTimestamp = (call: CallDisplayData): number =>
  call.startedAt ?? call.startsAt ?? call.createdAt;

const getLatestCallDisplayTimestamp = (calls: ReadonlyArray<CallDisplayData>): number =>
  calls.reduce((latest, call) => Math.max(latest, getCallDisplayTimestamp(call)), 0);

// ─── Hook ───────────────────────────────────────────────────────────────────

export const useCalls = (options: UseCallsOptions = {}) => {
  const liveDataEnabled = options.liveDataEnabled ?? true;
  const [activeTab, setActiveTab] = useState<CallTab>(CallTab.ALL);
  const [searchQuery, setSearchQuery] = useState('');
  const isSearching = searchQuery.trim().length > 0;

  const didLogInitialSyncRef = useRef(false);

  const { user } = useAuth();
  const { hasQueryCacheHydrated } = useStartupPhase();
  const currentUserId = user?.user_id as string;
  const zero = useZero();
  const zeroConnection = useConnectionState();
  const schemaVersion = zero.schemaVersion;
  const allUsers = useSelector(stateMachineActor, state =>
    liveDataEnabled ? (state.context.users as CallUserLike[]) : EMPTY_CALL_USERS,
  );
  const allChannels = useSelector(stateMachineActor, state =>
    liveDataEnabled ? (state.context.allChannels as CallChannelLike[]) : EMPTY_CALL_CHANNELS,
  );
  const isInCall = useIsInCall();
  const currentCallExternalId = useCurrentCallExternalId();

  // ── Channel lookup map ─────────────────────────────────────────────────────
  const channelsById = useMemo(() => buildCallChannelsById(allChannels), [allChannels]);

  const getVisibleTelemetryRowCount = useCallback(
    (
      historyRows: ReadonlyArray<RawCall>,
      scheduledRows: ReadonlyArray<ScheduledRawCall>,
      activeRows: ReadonlyArray<RawCall>,
    ): number => {
      const recentRows = getRecentCallsForDisplay(
        historyRows,
        scheduledRows,
        activeRows,
        currentUserId,
      );
      const upcomingRows = getScheduledCallsForDisplay(scheduledRows, activeRows, currentUserId);

      if (activeTab === CallTab.UPCOMING) {
        return upcomingRows.length;
      }

      if (activeTab === CallTab.MISSED) {
        const recentDisplayRows = recentRows.map(call =>
          toCallDisplayData(call, currentUserId, allUsers, channelsById),
        );

        return recentDisplayRows.filter(
          call =>
            call.status !== CallStatus.SCHEDULED &&
            call.status !== CallStatus.ACTIVE &&
            call.isMissed,
        ).length;
      }

      return recentRows.length + upcomingRows.length;
    },
    [activeTab, allUsers, channelsById, currentUserId],
  );

  // ── Accumulated paginated rows ─────────────────────────────────────────────
  const [rows, setRows] = useState<RawCall[]>([]);
  const rowsRef = useRef<RawCall[]>([]);
  const commitRows = useCallback((next: RawCall[]) => {
    rowsRef.current = next;
    setRows(next);
  }, []);

  const [hasMore, setHasMore] = useState(true);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const isFetchingRef = useRef(false);
  const hasAcceptedNonEmptyLiveCallsRef = useRef(false);

  // ── Zero subscriptions ─────────────────────────────────────────────────────
  const [page1, page1Details] = useCachedQuery(
    queries.userCallHistoryParticipantOnly({ limit: PAGE_SIZE, start: null }),
    { enabled: liveDataEnabled },
  );

  const [allCallsForSearch] = useCachedQuery(
    queries.userCallHistory({ limit: 9999, start: null }),
    { enabled: liveDataEnabled && isSearching },
  );

  const [allScheduledCalls] = useCachedQuery(queries.userScheduledCalls(), {
    enabled: liveDataEnabled,
  });

  const [activeCalls] = useCachedQuery(queries.userActiveCalls(), {
    enabled: liveDataEnabled,
  });

  useEffect(() => {
    if (!liveDataEnabled || didLogInitialSyncRef.current) {
      return;
    }

    let cancelled = false;
    const queryStartedAtMs = performance.now();
    const cacheRowCount = 0;
    const hadInitialData = false;

    void Promise.all([
      zero.run(queries.userCallHistoryParticipantOnly({ limit: PAGE_SIZE, start: null }), {
        type: 'complete',
      }),
      zero.run(queries.userScheduledCalls(), { type: 'complete' }),
      zero.run(queries.userActiveCalls(), { type: 'complete' }),
    ])
      .then(([historyRows, scheduledRows, activeRows]) => {
        if (cancelled) return;

        const completedAtMs = performance.now();
        didLogInitialSyncRef.current = true;
        const safeHistoryRows = historyRows ?? [];
        const safeScheduledRows = scheduledRows ?? [];
        const safeActiveRows = activeRows ?? [];
        const queryRowCount =
          safeHistoryRows.length + safeScheduledRows.length + safeActiveRows.length;
        logger.info(
          Event.LOTUS_LIST_SYNC,
          buildListSyncPayload({
            listType: 'calls_list',
            stage: hadInitialData ? 'warm_cache' : 'first_time',
            dataSource: 'zero_run',
            listStartedAtMs: queryStartedAtMs,
            queryStartedAtMs,
            completedAtMs,
            hadInitialData,
            visibleRowCount: getVisibleTelemetryRowCount(
              safeHistoryRows,
              safeScheduledRows,
              safeActiveRows,
            ),
            queryRowCount,
            cacheRowCount,
            hasMore: activeTab !== CallTab.UPCOMING && safeHistoryRows.length === PAGE_SIZE,
            initialDataSource: 'none',
            filterTab: activeTab,
            queryName: 'calls_initial_bundle',
          }),
        );
      })
      .catch(error => {
        if (cancelled) return;

        const completedAtMs = performance.now();
        didLogInitialSyncRef.current = true;
        logger.warn(
          Event.LOTUS_LIST_SYNC,
          buildListSyncPayload({
            listType: 'calls_list',
            stage: hadInitialData ? 'warm_cache' : 'first_time',
            dataSource: 'zero_run',
            status: 'error',
            listStartedAtMs: queryStartedAtMs,
            queryStartedAtMs,
            completedAtMs,
            hadInitialData,
            visibleRowCount: 0,
            queryRowCount: 0,
            cacheRowCount,
            initialDataSource: 'none',
            filterTab: activeTab,
            queryName: 'calls_initial_bundle',
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      });

    return (): void => {
      cancelled = true;
    };
  }, [activeTab, getVisibleTelemetryRowCount, liveDataEnabled, zero]);

  // ── Merge page1 into accumulator ───────────────────────────────────────────
  useEffect(() => {
    if (!page1) return;
    if (page1.length === 0) {
      const canAcceptEmptyFirstPage =
        zeroConnection.name === 'connected' &&
        (hasQueryCacheHydrated || hasAcceptedNonEmptyLiveCallsRef.current);
      if (canAcceptEmptyFirstPage) {
        commitRows([]);
      }
      setHasMore(false);
      return;
    }
    hasAcceptedNonEmptyLiveCallsRef.current = true;
    commitRows(mergeCallPage(rowsRef.current, page1));
    // Keep a deeper page's verdict: once more rows have loaded, page 1 says nothing about the end.
    if (rowsRef.current.length <= PAGE_SIZE) {
      setHasMore(page1.length === PAGE_SIZE);
    }
  }, [page1, commitRows, hasQueryCacheHydrated, zeroConnection.name]);

  // ── Forward pagination ─────────────────────────────────────────────────────
  const loadMore = useCallback(() => {
    if (activeTab === CallTab.UPCOMING) return;
    if (isFetchingRef.current || !hasMore) return;
    const last = rowsRef.current.at(-1);
    if (!last || last.startedAt === null) {
      setHasMore(false);
      return;
    }
    isFetchingRef.current = true;
    setIsFetchingMore(true);
    const cursor = { id: last.id, startedAt: last.startedAt };
    const loadMoreStartTime = performance.now();

    void (async () => {
      try {
        const page = await zero.run(
          queries.userCallHistoryParticipantOnly({ limit: PAGE_SIZE, start: cursor }),
          {
            type: 'complete',
          },
        );
        const completedAtMs = performance.now();
        if (!page || page.length === 0) {
          logger.info(
            Event.LOTUS_LIST_SYNC,
            buildListSyncPayload({
              listType: 'calls_list',
              stage: 'load_more',
              dataSource: 'zero_run',
              listStartedAtMs: loadMoreStartTime,
              queryStartedAtMs: loadMoreStartTime,
              completedAtMs,
              hadInitialData: true,
              visibleRowCount: getVisibleTelemetryRowCount(
                rowsRef.current,
                allScheduledCalls ?? [],
                activeCalls ?? [],
              ),
              queryRowCount: 0,
              newRows: 0,
              hasMore: false,
              filterTab: activeTab,
              queryName: 'userCallHistory',
            }),
          );
          setHasMore(false);
          return;
        }
        const existingIds = new Set(rowsRef.current.map(c => c.id));
        const newRows = page.filter(c => !existingIds.has(c.id));

        if (newRows.length > 0) {
          const next = mergeCallPage(rowsRef.current, page);
          commitRows(next);
          const visibleRowCount = getVisibleTelemetryRowCount(
            next,
            allScheduledCalls ?? [],
            activeCalls ?? [],
          );

          logger.info(
            Event.LOTUS_LIST_SYNC,
            buildListSyncPayload({
              listType: 'calls_list',
              stage: 'load_more',
              dataSource: 'zero_run',
              listStartedAtMs: loadMoreStartTime,
              queryStartedAtMs: loadMoreStartTime,
              completedAtMs,
              hadInitialData: true,
              visibleRowCount,
              queryRowCount: page.length,
              newRows: newRows.length,
              hasMore: page.length === PAGE_SIZE,
              filterTab: activeTab,
              queryName: 'userCallHistory',
            }),
          );
        } else {
          logger.info(
            Event.LOTUS_LIST_SYNC,
            buildListSyncPayload({
              listType: 'calls_list',
              stage: 'load_more',
              dataSource: 'zero_run',
              listStartedAtMs: loadMoreStartTime,
              queryStartedAtMs: loadMoreStartTime,
              completedAtMs,
              hadInitialData: true,
              visibleRowCount: getVisibleTelemetryRowCount(
                rowsRef.current,
                allScheduledCalls ?? [],
                activeCalls ?? [],
              ),
              queryRowCount: page.length,
              newRows: 0,
              hasMore: page.length === PAGE_SIZE,
              filterTab: activeTab,
              queryName: 'userCallHistory',
            }),
          );
        }
        setHasMore(page.length === PAGE_SIZE);
      } catch (error) {
        const completedAtMs = performance.now();
        logger.warn(
          Event.LOTUS_LIST_SYNC,
          buildListSyncPayload({
            listType: 'calls_list',
            stage: 'load_more',
            dataSource: 'zero_run',
            status: 'error',
            listStartedAtMs: loadMoreStartTime,
            queryStartedAtMs: loadMoreStartTime,
            completedAtMs,
            hadInitialData: true,
            visibleRowCount: getVisibleTelemetryRowCount(
              rowsRef.current,
              allScheduledCalls ?? [],
              activeCalls ?? [],
            ),
            queryRowCount: 0,
            filterTab: activeTab,
            queryName: 'userCallHistory',
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      } finally {
        isFetchingRef.current = false;
        setIsFetchingMore(false);
      }
    })();
  }, [
    activeCalls,
    activeTab,
    allScheduledCalls,
    commitRows,
    getVisibleTelemetryRowCount,
    hasMore,
    zero,
  ]);

  // ── Scheduled calls — future only (same filter as dashboard) ──────────────
  const scheduledCalls = useMemo((): ScheduledRawCall[] => {
    return getScheduledCallsForDisplay(allScheduledCalls ?? [], activeCalls ?? [], currentUserId);
  }, [allScheduledCalls, activeCalls, currentUserId]);

  // ── Recent calls: history + started-scheduled, stale-ACTIVE filtered ──────
  const recentCalls = useMemo((): RawCall[] => {
    const baseCalls = isSearching ? (allCallsForSearch ?? []) : rows;
    return getRecentCallsForDisplay(
      baseCalls,
      allScheduledCalls ?? [],
      activeCalls ?? [],
      currentUserId,
    );
  }, [rows, allCallsForSearch, isSearching, activeCalls, allScheduledCalls, currentUserId]);

  // ── Map to display data ────────────────────────────────────────────────────
  const recentCallsDisplay = useMemo(
    () => recentCalls.map(c => toCallDisplayData(c, currentUserId, allUsers, channelsById)),
    [recentCalls, currentUserId, allUsers, channelsById],
  );

  const scheduledCallsDisplay = useMemo(
    () =>
      scheduledCalls.map(c =>
        toCallDisplayData(c as unknown as RawCall, currentUserId, allUsers, channelsById),
      ),
    [scheduledCalls, currentUserId, allUsers, channelsById],
  );

  const activeCallsDisplay = useMemo(
    () =>
      (activeCalls ?? []).map(c =>
        toCallDisplayData(c as unknown as RawCall, currentUserId, allUsers, channelsById),
      ),
    [activeCalls, currentUserId, allUsers, channelsById],
  );

  const telemetryVisibleCalls = useMemo((): CallDisplayData[] => {
    if (activeTab === CallTab.UPCOMING) {
      return scheduledCallsDisplay;
    }
    if (activeTab === CallTab.MISSED) {
      return recentCallsDisplay.filter(
        call =>
          call.status !== CallStatus.SCHEDULED &&
          call.status !== CallStatus.ACTIVE &&
          call.isMissed,
      );
    }
    return [...recentCallsDisplay, ...scheduledCallsDisplay];
  }, [activeTab, recentCallsDisplay, scheduledCallsDisplay]);

  const { consumeIfNewer: consumeForegroundSyncIfNewer } = useForegroundListSyncProbe({
    enabled: liveDataEnabled && !isSearching && Boolean(currentUserId && schemaVersion),
    identityKey:
      currentUserId && schemaVersion
        ? `calls_list:${currentUserId}:${schemaVersion}:${activeTab}`
        : null,
    getLatestItemAt: () => getLatestCallDisplayTimestamp(telemetryVisibleCalls),
    getRowCount: () => telemetryVisibleCalls.length,
  });
  const callsLiveUpdateIdentityKey =
    currentUserId && schemaVersion && !isSearching
      ? `calls_list:${currentUserId}:${schemaVersion}:${activeTab}`
      : null;
  const {
    arm: armLiveUpdateProbe,
    consumeIfNewer: consumeLiveUpdateIfNewer,
    isArmed: isLiveUpdateProbeArmed,
  } = useListLiveUpdateProbe();

  const logLiveUpdateIfNewer = useCallback(
    (queryRowCount: number, nextHasMore: boolean): void => {
      if (!callsLiveUpdateIdentityKey) {
        return;
      }

      const latestItemAt = getLatestCallDisplayTimestamp(telemetryVisibleCalls);
      const probe = consumeLiveUpdateIfNewer(callsLiveUpdateIdentityKey, latestItemAt);
      if (!probe) {
        return;
      }

      const completedAtMs = performance.now();
      logger.info(
        Event.LOTUS_LIST_SYNC,
        buildListSyncPayload({
          listType: 'calls_list',
          stage: 'live_update',
          dataSource: 'zero_subscription',
          listStartedAtMs: probe.startedAtMs,
          queryStartedAtMs: probe.startedAtMs,
          completedAtMs,
          hadInitialData: probe.cacheRowCount > 0,
          visibleRowCount: telemetryVisibleCalls.length,
          queryRowCount,
          cacheRowCount: probe.cacheRowCount,
          updatedRows: telemetryVisibleCalls.filter(
            call => getCallDisplayTimestamp(call) > probe.latestItemAt,
          ).length,
          hasMore: nextHasMore,
          filterTab: activeTab,
          queryName: 'calls_initial_bundle',
          latestItemAt,
          previousLatestItemAt: probe.latestItemAt,
        }),
      );
    },
    [activeTab, callsLiveUpdateIdentityKey, consumeLiveUpdateIfNewer, telemetryVisibleCalls],
  );

  useEffect(() => {
    if (
      !liveDataEnabled ||
      isSearching ||
      page1Details.type !== 'complete' ||
      allScheduledCalls === undefined ||
      activeCalls === undefined
    ) {
      return;
    }

    const foregroundProbe = consumeForegroundSyncIfNewer(
      getLatestCallDisplayTimestamp(telemetryVisibleCalls),
    );
    const queryRowCount = (page1?.length ?? 0) + allScheduledCalls.length + activeCalls.length;
    const nextHasMore = activeTab !== CallTab.UPCOMING && (page1?.length ?? 0) === PAGE_SIZE;

    if (foregroundProbe) {
      const completedAtMs = performance.now();
      logger.info(
        Event.LOTUS_LIST_SYNC,
        buildListSyncPayload({
          listType: 'calls_list',
          stage: 'foreground_sync',
          dataSource: 'zero_run',
          listStartedAtMs: foregroundProbe.startedAtMs,
          queryStartedAtMs: foregroundProbe.startedAtMs,
          completedAtMs,
          hadInitialData: foregroundProbe.cacheRowCount > 0,
          visibleRowCount: telemetryVisibleCalls.length,
          queryRowCount,
          cacheRowCount: foregroundProbe.cacheRowCount,
          hasMore: nextHasMore,
          filterTab: activeTab,
          queryName: 'calls_initial_bundle',
        }),
      );
      return;
    }

    if (callsLiveUpdateIdentityKey && !isLiveUpdateProbeArmed(callsLiveUpdateIdentityKey)) {
      armLiveUpdateProbe(
        callsLiveUpdateIdentityKey,
        performance.now(),
        getLatestCallDisplayTimestamp(telemetryVisibleCalls),
        telemetryVisibleCalls.length,
      );
      return;
    }

    logLiveUpdateIfNewer(queryRowCount, nextHasMore);
  }, [
    activeCalls,
    activeTab,
    allScheduledCalls,
    armLiveUpdateProbe,
    callsLiveUpdateIdentityKey,
    consumeForegroundSyncIfNewer,
    isLiveUpdateProbeArmed,
    isSearching,
    liveDataEnabled,
    logLiveUpdateIfNewer,
    page1,
    page1Details.type,
    telemetryVisibleCalls,
  ]);

  // ── Tab + search filter ────────────────────────────────────────────────────
  const calls = useMemo((): CallDisplayData[] => {
    const q = searchQuery.trim().toLowerCase();

    if (activeTab === CallTab.UPCOMING) {
      // scheduledCallsDisplay is already deduplicated per recurringSeriesId at source.
      if (!q) return scheduledCallsDisplay;
      return scheduledCallsDisplay.filter(call => {
        if (call.displayTitle.toLowerCase().includes(q)) return true;
        return call.participantAvatars.some(p => p.name.toLowerCase().includes(q));
      });
    }

    const base = recentCallsDisplay;
    const searched = q
      ? base.filter(call => {
          if (call.displayTitle.toLowerCase().includes(q)) return true;
          return call.participantAvatars.some(p => p.name.toLowerCase().includes(q));
        })
      : base;

    if (activeTab === CallTab.MISSED) {
      return searched.filter(
        call =>
          call.status !== CallStatus.SCHEDULED &&
          call.status !== CallStatus.ACTIVE &&
          call.isMissed,
      );
    }

    return searched; // ALL tab
  }, [activeTab, recentCallsDisplay, scheduledCallsDisplay, searchQuery]);

  const hasLiveDisplayRows =
    recentCallsDisplay.length > 0 ||
    scheduledCallsDisplay.length > 0 ||
    activeCallsDisplay.length > 0;
  const canUseEmptyLiveCallData =
    zeroConnection.name === 'connected' &&
    (hasQueryCacheHydrated || hasAcceptedNonEmptyLiveCallsRef.current);
  const hasLiveCallData =
    liveDataEnabled &&
    page1Details.type === 'complete' &&
    allScheduledCalls !== undefined &&
    activeCalls !== undefined &&
    (hasLiveDisplayRows || canUseEmptyLiveCallData);

  const visibleCalls = calls;
  const visibleUpcomingCalls = scheduledCallsDisplay;
  const isLoading = !hasLiveCallData;

  // ── Navigation helpers ─────────────────────────────────────────────────────
  const joinCallByExternalId = useCallback((externalId: string, callType: string) => {
    router.push({
      pathname: '/native-call',
      params: { channelId: externalId, callType, initiateCall: 'false' },
    });
  }, []);

  const initiateCallFromHistory = useCallback((call: CallDisplayData) => {
    const channelId = call.channelId || call.externalId;
    router.push({
      pathname: '/native-call',
      params: { channelId, callType: call.callType, initiateCall: 'true' },
    });
  }, []);

  // ── Row click handler (mirrors dashboard handleCallRowClick) ──────────────
  const handleCallRowClick = useCallback(
    (call: CallDisplayData) => {
      if (call.isScheduled || call.isActive) {
        if (isInCall && currentCallExternalId !== call.externalId) {
          Alert.alert(
            'Already in a call',
            'You are already in a call. Please leave your current call first.',
          );
          return;
        }
        joinCallByExternalId(call.externalId, call.callType);
      } else {
        // Ended call — restart/re-initiate
        if (isInCall) {
          Alert.alert(
            'Already in a call',
            'You are already in a call. Please leave your current call first.',
          );
          return;
        }

        // Active call in same channel → offer to join it
        const activeCallInChannel = (activeCalls ?? []).find(ac => ac.channelId === call.channelId);
        if (activeCallInChannel) {
          Alert.alert(
            'Join ongoing call?',
            "There's already an active call in this chat. Would you like to join?",
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Join',
                onPress: () => joinCallByExternalId(activeCallInChannel.externalId, call.callType),
              },
            ],
          );
          return;
        }

        // DEFAULT channel confirmation
        const channel = call.channelId ? channelsById.get(call.channelId) : undefined;
        if (channel?.scopeType === ChannelScopeType.DEFAULT) {
          Alert.alert(
            'Start a call in this channel?',
            `You'll be starting a call that all members of # ${channel.name} can join.`,
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Start', onPress: () => initiateCallFromHistory(call) },
            ],
          );
          return;
        }

        initiateCallFromHistory(call);
      }
    },
    [
      isInCall,
      currentCallExternalId,
      activeCalls,
      channelsById,
      joinCallByExternalId,
      initiateCallFromHistory,
    ],
  );

  return {
    calls: visibleCalls,
    /** Scheduled future calls — always available regardless of active tab.
     *  Used by the ALL tab to render the "UPCOMING CALLS" section at the top. */
    upcomingCalls: visibleUpcomingCalls,
    isLoading,
    isFetchingMore,
    hasMore,
    loadMore,
    activeTab,
    setActiveTab,
    searchQuery,
    setSearchQuery,
    handleCallRowClick,
  };
};
