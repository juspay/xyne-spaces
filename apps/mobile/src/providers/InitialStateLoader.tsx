import {
  type ReactElement,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useSelector } from '@xstate/react';
import { useConnectionState } from '@rocicorp/zero/react';
import { AccessType } from '@xyne/shared';
import { AppState, InteractionManager } from 'react-native';
import { useQuery as useTanStackQuery } from '@tanstack/react-query';
import { useAuth } from '@/src/contexts/AuthContext';
import { useZero } from '@/src/hooks/useZero';
import { useCachedQuery } from '@/src/hooks/useCachedQuery';
import { useDeferredLiveData } from '@/src/hooks/useDeferredLiveData';
import { useFallbackHydratedQuery } from '@/src/hooks/useFallbackHydratedQuery';
import { queries } from '@/src/zero/queries';
import { usePendingQueue } from '@xyne/shared/messages';
import { apiGet } from '@/src/services/apiClient';
import { stateMachineActor, type User } from '@/src/machines/appStateMachine';
import {
  hydrateQueryCacheFromStorage,
  queryCacheActor,
  setupQueryCachePersistence,
} from '@/src/machines/queryCacheMachine';
import { useStartupPhase } from '@/src/providers/StartupPhaseProvider';
import {
  endWorkspaceSwitch,
  isWorkspaceSwitchInProgress,
} from '@/src/services/workspaceSessionReset';
import { mmkvStorageAdapter } from '@/src/services/mmkvStorageAdapter';
import { ProtectedStartupScreen } from '@/src/components/startup/ProtectedStartupScreen';
import { startupTimings } from '@/src/utils/startupTimings';
import { reconcileUserDirectory } from '@/src/utils/userDirectoryReconcile';
import { getNavIntentSnapshot, subscribeNavIntent } from '@/src/notifications/tapNavigation';
import { ReactNativeStartupClock } from '@/src/observability/logging/startup/reactNativeColdStart';
import {
  canUseReturningSessionFastPath,
  computeUsersWatermark,
  filterUsersForWorkspace,
  filterVisibleChannelRowsForWorkspace,
  takeLatestVisibleChannelStatusRows,
  getStartupLabel,
  getStartupReadinessProgress,
  isNotificationColdLaunch,
  resolveNotificationProcessAgeMs,
  persistedContextMatchesSession,
  shouldDeferReturningStartupRefresh as shouldDeferReturningStartupRefreshFor,
  type PermissionsApiResponse,
} from './initialStateLoaderUtils';
import { useStartupZeroConnection } from './useStartupZeroConnection';
import { UserGroupsProvider } from './UserGroupsProvider';
import { FlowNormalizationOptionsProvider } from './FlowNormalizationOptionsProvider';

interface InitialStateLoaderProps {
  children: ReactNode;
}

// Returning sessions already have actionable rows in the persisted query
// cache. Give the first screen and its first interaction a quiet window before
// starting the expensive fresh root materialization. First install and
// workspace-switch paths do not use this delay because they need authoritative
// identity/channel data to build the shell.
const RETURNING_STARTUP_REFRESH_DELAY_MS = 5_000;
const RETURNING_STARTUP_REFRESH_TIMEOUT_MS = 10_000;
const startupClock = new ReactNativeStartupClock();

function hasPendingChatNotificationIntent(): boolean {
  const intent = getNavIntentSnapshot();
  return intent !== null && intent.ticketId === undefined && Boolean(intent.channelId);
}

const publishUserDirectory = (
  users: User[],
  hasUsersForActiveWorkspace: boolean,
  isWorkspaceSwitchStartup: boolean,
): boolean => {
  const workspaceSwitching = isWorkspaceSwitchInProgress();
  if (workspaceSwitching && !isWorkspaceSwitchStartup) return false;

  // ADD_USERS replaces the whole directory. Ignore an empty or workspace-
  // mismatched cache/fallback result so a transient miss cannot erase valid
  // identities; workspace reset already clears the old directory when a
  // destination workspace genuinely starts empty.
  if (!hasUsersForActiveWorkspace) return false;

  const currentUsers = stateMachineActor.getSnapshot().context.users;
  // Reconcile every complete snapshot. When the in-memory directory is empty
  // (first install or workspace switch), this still produces the full
  // snapshot. Once it is populated, unchanged rows keep their object identity
  // and do not trigger another whole-directory replacement.
  const reconciliation = reconcileUserDirectory(currentUsers, users);
  const wm = computeUsersWatermark(users);
  startupTimings.setQueryCount('users_v2.initial', users.length);

  if (reconciliation.isNoop) {
    return false;
  }

  stateMachineActor.send({
    type: 'ADD_USERS',
    users: reconciliation.users,
    usersUpdatedAt: wm,
  });
  return true;
};

function WorkspaceSwitchDmPreloader({
  onSettled,
}: {
  onSettled: (settled: boolean) => void;
}): null {
  const query = useMemo(
    () =>
      queries.dmChannelsLatestMessagesPaginated({
        limit: 20,
        start: null,
        direction: 'forward',
      }),
    [],
  );
  const [, details] = useCachedQuery(query, {
    cursorEnabled: true,
  });

  useEffect(() => {
    if (details.type !== 'unknown') {
      onSettled(true);
    }
  }, [details.type, onSettled]);

  return null;
}

function InitialStateDataLoader({ children }: InitialStateLoaderProps): ReactElement {
  const queryCachePersistenceSetupKeyRef = useRef<string | null>(null);
  const queryCacheHydrationKeyRef = useRef<string | null>(null);
  const [queryCacheFallbackReady, setQueryCacheFallbackReady] = useState(false);
  const [isDmPreloadSettled, setIsDmPreloadSettled] = useState(false);
  const [publishedUserDirectoryKey, setPublishedUserDirectoryKey] = useState<string | null>(null);
  const { user, token, workspaceSessionKey, applyRefreshedToken, signOut } = useAuth();
  const userID = user?.user_id;
  const activeWorkspaceId = user?.workspaceId ?? null;
  // Snapshot the lifecycle for this keyed shell. Reading is intentionally
  // non-consuming: the previous workspace may rerender while its state is
  // being cleared, but it must not steal the switch intent from this mount.
  const [isWorkspaceSwitchStartup] = useState(() => isWorkspaceSwitchInProgress());

  const zero = useZero();
  const zeroConnection = useConnectionState();
  const schemaVersion = zero.schemaVersion;
  const zeroMatchesActiveWorkspace =
    Boolean(activeWorkspaceId) && zero.context.workspaceId === activeWorkspaceId;
  useStartupZeroConnection({ activeWorkspaceId, applyRefreshedToken, signOut });
  usePendingQueue();
  const {
    hasFirstFramePainted,
    hasSplashHidden,
    hasQueryCacheHydrated,
    setQueryCacheHydrated,
    setProtectedStartupReady,
    setVisibleChannelsReady,
    setUserDirectoryReady,
  } = useStartupPhase();
  const canRunPostSplashData =
    hasFirstFramePainted || queryCacheFallbackReady || isWorkspaceSwitchStartup;
  const hasPersistedStartupContext = useMemo(() => {
    if (!userID || !schemaVersion) {
      return false;
    }

    return persistedContextMatchesSession(
      mmkvStorageAdapter.getGlobalUserContext(),
      userID,
      schemaVersion,
      activeWorkspaceId,
    );
  }, [activeWorkspaceId, schemaVersion, userID]);
  const canUseReturningSessionFastPathForStartup = canUseReturningSessionFastPath(
    hasPersistedStartupContext,
    isWorkspaceSwitchStartup,
  );
  const [isNotificationLaunch, setIsNotificationLaunch] = useState(() =>
    hasPendingChatNotificationIntent(),
  );
  const [rootLiveQueriesEnabled, setRootLiveQueriesEnabled] = useState(false);
  const startupDataKey = `${workspaceSessionKey}:${userID ?? ''}:${schemaVersion ?? ''}:${activeWorkspaceId ?? ''}`;
  const shouldDeferReturningStartupRefresh = shouldDeferReturningStartupRefreshFor({
    canUseReturningSessionFastPath: canUseReturningSessionFastPathForStartup,
    isWorkspaceSwitchStartup,
    isNotificationLaunch,
  });
  const returningStartupRefreshReady = useDeferredLiveData({
    name: 'root_background_refresh',
    screen: 'root',
    screenReady: hasFirstFramePainted,
    hasInitialData: true,
    delayMs: RETURNING_STARTUP_REFRESH_DELAY_MS,
    timeoutMs: RETURNING_STARTUP_REFRESH_TIMEOUT_MS,
    enabled:
      shouldDeferReturningStartupRefresh &&
      canRunPostSplashData &&
      zeroConnection.name === 'connected',
  });
  const canRunRootRefresh =
    rootLiveQueriesEnabled ||
    (queryCacheFallbackReady && (!shouldDeferReturningStartupRefresh || !hasFirstFramePainted));
  const canRunStartupDataCandidate =
    Boolean(userID && schemaVersion && zeroMatchesActiveWorkspace) && canRunRootRefresh;
  const [startupDataLatchKey, setStartupDataLatchKey] = useState<string | null>(null);
  const canRunStartupData = canRunStartupDataCandidate || startupDataLatchKey === startupDataKey;
  const canRunUserDirectoryStartupData = shouldDeferReturningStartupRefresh
    ? canRunPostSplashData
    : canRunStartupData;

  useEffect(() => {
    if (hasPendingChatNotificationIntent()) {
      setIsNotificationLaunch(true);
    }

    const unsubscribeNavIntent = subscribeNavIntent(() => {
      if (hasPendingChatNotificationIntent()) {
        setIsNotificationLaunch(true);
      }
    });

    let cancelled = false;
    void Promise.all([startupClock.getLaunchTimes(), startupClock.nowUptimeMs()]).then(
      ([launchTimes, now]) => {
        if (cancelled || !launchTimes || now === null) {
          return;
        }

        if (
          isNotificationColdLaunch({
            launchCause: launchTimes.launchCause,
            processAgeMs: resolveNotificationProcessAgeMs(now, launchTimes.appUptimeMs),
          })
        ) {
          setIsNotificationLaunch(true);
        }
      },
    );

    return (): void => {
      cancelled = true;
      unsubscribeNavIntent();
    };
  }, []);

  useEffect(() => {
    if (!canRunStartupDataCandidate || startupDataLatchKey === startupDataKey) {
      return;
    }
    setStartupDataLatchKey(startupDataKey);
  }, [canRunStartupDataCandidate, startupDataKey, startupDataLatchKey]);

  useEffect(() => {
    setRootLiveQueriesEnabled(false);
  }, [schemaVersion, userID, workspaceSessionKey]);

  useEffect(() => {
    if (
      !userID ||
      !schemaVersion ||
      !activeWorkspaceId ||
      !zeroMatchesActiveWorkspace ||
      rootLiveQueriesEnabled ||
      (shouldDeferReturningStartupRefresh && !returningStartupRefreshReady)
    ) {
      return;
    }
    if (!hasFirstFramePainted && !queryCacheFallbackReady && !isWorkspaceSwitchStartup) {
      return;
    }

    let cancelled = false;
    let task: { cancel: () => void } | null = null;

    const enableRootLiveQueries = (): void => {
      if (cancelled) {
        return;
      }
      startupTimings.setQueryStatus('root_live_queries', 'enabled');
      setRootLiveQueriesEnabled(true);
    };

    if (isWorkspaceSwitchStartup) {
      enableRootLiveQueries();
    } else {
      task = InteractionManager.runAfterInteractions(enableRootLiveQueries);
    }

    return (): void => {
      cancelled = true;
      task?.cancel();
    };
  }, [
    hasFirstFramePainted,
    activeWorkspaceId,
    isWorkspaceSwitchStartup,
    queryCacheFallbackReady,
    rootLiveQueriesEnabled,
    returningStartupRefreshReady,
    shouldDeferReturningStartupRefresh,
    schemaVersion,
    userID,
    zeroMatchesActiveWorkspace,
  ]);

  useEffect(() => {
    if (!userID || !schemaVersion || !activeWorkspaceId || !zeroMatchesActiveWorkspace) {
      return;
    }

    if (rootLiveQueriesEnabled || isWorkspaceSwitchStartup) {
      return;
    }

    const timer = setTimeout(() => {
      void startupTimings.mark('query_cache_hydration_fallback_ready');
      setQueryCacheFallbackReady(true);
    }, 5000);

    return (): void => clearTimeout(timer);
  }, [
    activeWorkspaceId,
    isWorkspaceSwitchStartup,
    rootLiveQueriesEnabled,
    schemaVersion,
    userID,
    zeroMatchesActiveWorkspace,
  ]);

  useEffect(() => {
    if (!userID || !schemaVersion || !activeWorkspaceId || !zeroMatchesActiveWorkspace) {
      return;
    }

    let cancelled = false;
    setQueryCacheHydrated(false);

    const queryCacheKey = `${workspaceSessionKey}:${userID}:${schemaVersion}`;

    if (queryCachePersistenceSetupKeyRef.current !== queryCacheKey) {
      void startupTimings.mark('query_cache_setup_start');
      setupQueryCachePersistence(userID, schemaVersion);
      queryCachePersistenceSetupKeyRef.current = queryCacheKey;
      void startupTimings.mark('query_cache_setup_end');
    }

    if (queryCacheHydrationKeyRef.current !== queryCacheKey) {
      if (!canRunPostSplashData) {
        return;
      }

      queryCacheHydrationKeyRef.current = queryCacheKey;

      void startupTimings.mark('query_cache_hydration_start');
      void hydrateQueryCacheFromStorage(userID, schemaVersion).finally(() => {
        if (cancelled) {
          return;
        }
        void startupTimings.mark('query_cache_hydration_end');
        // Flip the queryCacheActor's isHydrated flag so the hydrated queries
        // un-gate their fallback + delta paths. Without
        // this, users/channels stay `type: 'unknown'` forever and the startup
        // gate is stuck on "Setting up your workspace".
        queryCacheActor.send({ type: 'SET_HYDRATED' });
        setQueryCacheHydrated(true);
      });
    }
    return (): void => {
      cancelled = true;
    };
  }, [
    activeWorkspaceId,
    canRunPostSplashData,
    schemaVersion,
    setQueryCacheHydrated,
    userID,
    workspaceSessionKey,
    zeroMatchesActiveWorkspace,
  ]);

  useEffect(() => {
    if (!userID || !schemaVersion) {
      return;
    }
    const subscription = AppState.addEventListener('change', nextState => {
      if (nextState === 'active' && mmkvStorageAdapter.consumeWarmCacheDirty()) {
        void hydrateQueryCacheFromStorage(userID, schemaVersion);
      }
    });
    return (): void => subscription.remove();
  }, [userID, schemaVersion]);

  // The hydrated query reads the complete persisted directory even while its
  // live path is deferred. This keeps names and avatars available to every
  // surface at startup; only the network delta waits for the post-settle gate.
  const userDirectoryKey = `${workspaceSessionKey}:${activeWorkspaceId ?? ''}`;
  const usersQuery = useMemo(() => queries.getUsersV2(), []);
  const userDirectoryLiveQueryEnabled =
    canRunUserDirectoryStartupData &&
    (!shouldDeferReturningStartupRefresh || returningStartupRefreshReady);
  const [usersResult, usersDetails] = useFallbackHydratedQuery(usersQuery, {
    enabled: userDirectoryLiveQueryEnabled,
  });
  const rawUsers = useMemo(() => (usersResult ?? []) as User[], [usersResult]);
  const usersForActiveWorkspace = useMemo(
    () => filterUsersForWorkspace(rawUsers, activeWorkspaceId),
    [activeWorkspaceId, rawUsers],
  );
  const hasUsersForActiveWorkspace = usersForActiveWorkspace.length > 0;
  const inMemoryUsers = useSelector(stateMachineActor, state => state.context.users);
  const inMemoryUsersForActiveWorkspace = useMemo(
    () => filterUsersForWorkspace(inMemoryUsers, activeWorkspaceId),
    [activeWorkspaceId, inMemoryUsers],
  );
  const hasCompleteUserDirectory = usersDetails.type === 'complete' && hasUsersForActiveWorkspace;
  const directoryReadyForShell = !hasUsersForActiveWorkspace
    ? true
    : hasCompleteUserDirectory
      ? publishedUserDirectoryKey === userDirectoryKey
      : publishedUserDirectoryKey === userDirectoryKey ||
        inMemoryUsersForActiveWorkspace.length > 0;
  const canUseReturningSessionFastPathWithUsers =
    canUseReturningSessionFastPathForStartup && hasCompleteUserDirectory && directoryReadyForShell;

  useLayoutEffect(() => {
    if (!hasCompleteUserDirectory) return;
    publishUserDirectory(
      usersForActiveWorkspace,
      hasUsersForActiveWorkspace,
      isWorkspaceSwitchStartup,
    );
    if (publishedUserDirectoryKey !== userDirectoryKey) {
      setPublishedUserDirectoryKey(userDirectoryKey);
    }
  }, [
    hasUsersForActiveWorkspace,
    hasCompleteUserDirectory,
    isWorkspaceSwitchStartup,
    publishedUserDirectoryKey,
    userDirectoryKey,
    usersForActiveWorkspace,
  ]);

  // Visible channels is a full-set query (no updatedAt delta). useCachedQuery
  // replaces the cached snapshot when live data arrives, so closed/deleted
  // memberships that dropped out of the set disappear. useFallbackHydratedQuery
  // would union by id and keep those rows. Cache is still returned while the
  // live path waits (skipped entirely on a notification launch).
  const visibleChannelsQuery = useMemo(() => queries.userVisibleChannelsV2(), []);
  const visibleChannelsLiveQueryEnabled =
    canRunUserDirectoryStartupData &&
    (!shouldDeferReturningStartupRefresh || returningStartupRefreshReady);
  const [visibleChannels, visibleChannelsDetails] = useCachedQuery(visibleChannelsQuery, {
    enabled: visibleChannelsLiveQueryEnabled,
  });
  const visibleChannelsForActiveWorkspace = useMemo(
    () =>
      takeLatestVisibleChannelStatusRows(
        filterVisibleChannelRowsForWorkspace(visibleChannels, activeWorkspaceId),
      ),
    [activeWorkspaceId, visibleChannels],
  );

  const didMarkVisibleChannelsStartRef = useRef(false);
  useEffect(() => {
    if (didMarkVisibleChannelsStartRef.current) return;
    if (!canRunUserDirectoryStartupData) return;
    if (visibleChannelsDetails.type !== 'unknown') return;
    didMarkVisibleChannelsStartRef.current = true;
    startupTimings.setQueryStatus('user_visible_channels_v2', 'started');
    void startupTimings.mark('zero_visible_channels_load_start');
  }, [canRunUserDirectoryStartupData, visibleChannelsDetails.type]);

  const permissionsQuery = useTanStackQuery<PermissionsApiResponse>({
    queryKey: ['user-permissions', userID, activeWorkspaceId],
    queryFn: async () => apiGet<PermissionsApiResponse>('/auth/permissions', { token: token! }),
    staleTime: 10 * 60 * 1000,
    enabled: !!userID && !!token && !!activeWorkspaceId && canRunStartupData,
  });

  useLayoutEffect(() => {
    if (visibleChannelsDetails.type !== 'complete') {
      return;
    }

    void startupTimings.mark('zero_visible_channels_loaded');
    const channels = visibleChannelsForActiveWorkspace
      .map(status => status.channel)
      .filter((channel): channel is NonNullable<typeof channel> => channel !== undefined);
    startupTimings.setQueryStatus('user_visible_channels_v2', 'complete');
    startupTimings.setQueryCount(
      'user_visible_channels_v2',
      visibleChannelsForActiveWorkspace.length,
    );
    stateMachineActor.send({ type: 'ADD_VISIBLE_CHANNELS', channels });
    stateMachineActor.send({
      type: 'ADD_USER_CHANNEL_STATUSES',
      userChannelStatuses: visibleChannelsForActiveWorkspace,
    });
    void startupTimings.mark('zero_visible_channels_state_sent');
  }, [visibleChannelsDetails.type, visibleChannelsForActiveWorkspace]);

  useEffect(() => {
    setVisibleChannelsReady(
      visibleChannelsDetails.type === 'complete' || visibleChannelsDetails.type === 'error',
    );
  }, [setVisibleChannelsReady, visibleChannelsDetails.type]);

  useEffect(() => {
    setUserDirectoryReady(directoryReadyForShell);
  }, [directoryReadyForShell, setUserDirectoryReady]);

  useEffect(() => {
    if (permissionsQuery.isSuccess && permissionsQuery.data?.success) {
      stateMachineActor.send({
        type: 'SET_USER_PERMISSIONS',
        permissions: (permissionsQuery.data.permissions ?? []).map(permission => ({
          resourceName: permission.resourceName,
          accessType: AccessType[permission.accessType],
        })),
      });
    }
  }, [permissionsQuery.data, permissionsQuery.isSuccess]);

  // Destination-workspace rows are immediately usable while subscriptions
  // settle. An authoritative complete result also permits a genuinely empty
  // workspace; query errors never become a false empty list.
  // The setup screen is a first-install/update/workspace-bootstrap gate. A
  // returning session keeps its fast path only when cached identities for the
  // active workspace are present; otherwise it waits instead of showing
  // rows without names or profiles.
  const isUserStartupReady =
    directoryReadyForShell &&
    (canUseReturningSessionFastPathWithUsers ||
      usersDetails.type === 'complete' ||
      usersDetails.type === 'error');
  const isVisibleChannelsStartupReady = visibleChannelsDetails.type === 'complete';
  const isChannelsStartupReady = isVisibleChannelsStartupReady;
  const hasProtectedSession = Boolean(userID || token);
  const hasRequiredStartupContext = Boolean(
    userID && schemaVersion && activeWorkspaceId && zeroMatchesActiveWorkspace,
  );
  const isProtectedStartupReady =
    hasRequiredStartupContext &&
    isUserStartupReady &&
    isChannelsStartupReady &&
    isVisibleChannelsStartupReady;

  const shouldShowStartupScreen =
    hasProtectedSession && !canUseReturningSessionFastPathWithUsers && !isProtectedStartupReady;

  useEffect(() => {
    if (!isProtectedStartupReady || !userID || !schemaVersion) {
      return;
    }
    // Publish the background-safe workspace context after the essential
    // identity and channel model is ready. Permissions continue loading
    // without blocking the protected shell.
    mmkvStorageAdapter.setGlobalUserContext(userID, schemaVersion, activeWorkspaceId);
  }, [activeWorkspaceId, isProtectedStartupReady, schemaVersion, userID]);

  useEffect(() => {
    setProtectedStartupReady(isProtectedStartupReady || canUseReturningSessionFastPathWithUsers);
  }, [canUseReturningSessionFastPathWithUsers, isProtectedStartupReady, setProtectedStartupReady]);

  useEffect(() => {
    if (isWorkspaceSwitchStartup && isProtectedStartupReady) {
      endWorkspaceSwitch();
    }
  }, [isProtectedStartupReady, isWorkspaceSwitchStartup]);

  useEffect(() => {
    return (): void => {
      setProtectedStartupReady(false);
      setVisibleChannelsReady(false);
      setUserDirectoryReady(false);
    };
  }, [setProtectedStartupReady, setUserDirectoryReady, setVisibleChannelsReady]);

  const startupReadiness = {
    hasRequiredStartupContext,
    hasSplashHidden,
    isChannelsStartupReady,
    isProtectedStartupReady,
    isUserStartupReady,
    isVisibleChannelsStartupReady,
  };
  const startupProgress = getStartupReadinessProgress(startupReadiness);
  const startupLabel = getStartupLabel(startupReadiness);
  const shouldPreloadWorkspaceDms =
    isWorkspaceSwitchStartup && hasQueryCacheHydrated && !isDmPreloadSettled;

  return (
    <UserGroupsProvider>
      <FlowNormalizationOptionsProvider>
        {shouldPreloadWorkspaceDms ? (
          <WorkspaceSwitchDmPreloader onSettled={setIsDmPreloadSettled} />
        ) : null}
        {shouldShowStartupScreen ? (
          <ProtectedStartupScreen label={startupLabel} progress={startupProgress} />
        ) : (
          children
        )}
      </FlowNormalizationOptionsProvider>
    </UserGroupsProvider>
  );
}

function InitialStateLoader({ children }: InitialStateLoaderProps): ReactElement {
  const { user, token } = useAuth();
  const userID = user?.user_id;
  const zero = useZero();
  const schemaVersion = zero.schemaVersion;
  const { hasSplashHidden, setProtectedStartupReady } = useStartupPhase();

  const hasProtectedSession = Boolean(userID || token);
  const hasRequiredStartupContext = Boolean(userID && schemaVersion);
  const shouldWaitForStartupContext = hasProtectedSession && !hasRequiredStartupContext;
  const startupProgress = getStartupReadinessProgress({
    hasRequiredStartupContext,
    hasSplashHidden,
    isChannelsStartupReady: false,
    isProtectedStartupReady: false,
    isUserStartupReady: false,
    isVisibleChannelsStartupReady: false,
  });

  useEffect(() => {
    if (shouldWaitForStartupContext) {
      setProtectedStartupReady(false);
    }
  }, [setProtectedStartupReady, shouldWaitForStartupContext]);

  useEffect(() => {
    return (): void => setProtectedStartupReady(false);
  }, [setProtectedStartupReady]);

  if (shouldWaitForStartupContext) {
    return (
      <ProtectedStartupScreen
        label={hasSplashHidden ? 'Preparing your workspace' : 'Starting your workspace'}
        progress={startupProgress}
      />
    );
  }

  return <InitialStateDataLoader>{children}</InitialStateDataLoader>;
}

export default InitialStateLoader;
