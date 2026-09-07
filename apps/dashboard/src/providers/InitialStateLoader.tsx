import React, { ReactNode, useEffect, useRef, useState } from 'react';
import { useConnectionState } from '@rocicorp/zero/react';
import { useZero } from '../hooks/useZero';
import { useQuery as useTanStackQuery } from '@tanstack/react-query';
import { queries } from '../zero/queries';
import { useAuthContextValues } from '../hooks/useAuth';
import AppLoader from '../components/AppLoader/AppLoader';
import { stateMachineActor, User } from '../machines/stateMachine';
import {
  setupQueryCachePersistence,
  hydrateQueryCacheFromIndexedDB,
  queryCacheActor,
} from '../machines/queryCacheMachine';
import { UserPermission } from '../machines/stateMachine';
import { apiInstance } from '../services/clients/apiClient';
import { useFallbackHydratedQuery } from '@xyne/shared/hooks';
import { ReadonlyJSONValue } from '@rocicorp/zero';
import { websocketService } from '../services/clients/socketClient';
import { ZeroConnectionFailureModal } from '../components/ZeroConnectionStatus/ZeroConnectionFailureModal';
import { DeferredLoader } from '../components/DeferredLoader';
import axios from 'axios';
import { API_BASE_URL } from '../config';
import { v4 as uuidv4 } from 'uuid';
import { dropZeroDatabases } from '../zero/dropZeroDatabases';
import { clearAuthTokens } from '../services/clients/apiClient';
import { logger, Event as LoggerEvent } from '../utils/logger';
import { useZeroConnectionLogger } from '../services/zeroConnectionLogger';
import { useCachedQuery } from '../hooks/useCachedQuery';
import { authRefreshDuration, authRefreshTotal, safeRecordMetric } from '../services/otel';
import { usePendingQueue } from '@xyne/shared/messages';
import {
  SharedAuthProvider,
  HttpClientProvider,
  ChannelServiceProvider,
  AffinityServiceProvider,
} from '@xyne/shared/hooks';
import { axiosHttpClient, affinityService } from '../services/affinityService';
import { channelService } from '../services/Chat/channelService';

interface InitialStateLoaderProps {
  children: ReactNode;
}

interface PermissionsApiResponse {
  success: boolean;
  permissions: UserPermission[];
}

type QueryDetails =
  | {
      readonly type: 'complete';
    }
  | {
      readonly type: 'unknown';
    }
  | {
      readonly type: 'error';
      readonly retry: () => void;
      readonly refetch: () => void;
      readonly error:
        | {
            readonly type: 'app';
            readonly message: string;
            readonly details?: ReadonlyJSONValue;
          }
        | {
            readonly type: 'parse';
            readonly message: string;
            readonly details?: ReadonlyJSONValue;
          };
    };

const isQueryCompleted = (obj: QueryDetails): boolean => {
  return obj.type === 'complete';
};

const areQueriesCompleted = (obj: QueryDetails[]): boolean => {
  return obj.every(isQueryCompleted);
};

// Show modal after 60 seconds of disconnected/error state
const MODAL_DELAY_MS = 60000;

const InitialStateLoader: React.FC<InitialStateLoaderProps> = ({ children }): ReactNode => {
  const isRefreshing = useRef(false);
  const persistenceSetup = useRef(false);

  const [isHydrated, setIsHydrated] = useState(false);
  const [permissionsHydrated, setPermissionsHydrated] = useState(false);
  const context = useAuthContextValues();
  const zero = useZero();
  const state = useConnectionState();
  logger.setZeroClientId(zero.clientID);
  logger.setZeroClientGroupId(zero.clientGroupID);

  useZeroConnectionLogger(state);

  // Durable pending-message queue: reconciles server-confirmed sends and
  // auto-retries messages queued while the socket was reconnecting.
  usePendingQueue();

  // Connection failure modal state — in-memory only
  const [showModal, setShowModal] = useState(false);
  const modalTimerRef = useRef<NodeJS.Timeout | null>(null);

  const schemaVersion = zero.schemaVersion;

  // Retry logic state
  const retryCountRef = useRef(0);
  const resetTimerRef = useRef<NodeJS.Timeout | null>(null);
  const previousStateRef = useRef<string>('');
  const MAX_RETRIES = 4;

  const getRetryDelay = (retryCount: number): number => {
    return Math.min(1000 * Math.pow(2, retryCount), 10000); // Max 10 seconds
  };

  const handlePostErrorReset = (previousState: string): void => {
    if (previousState === 'error') {
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
      }
      resetTimerRef.current = setTimeout(() => {
        retryCountRef.current = 0;
        resetTimerRef.current = null;
      }, 5000);
    }
  };

  const handleReAuth = async (): Promise<void> => {
    // Prevent multiple simultaneous refresh attempts
    if (isRefreshing.current) {
      return;
    }

    isRefreshing.current = true;
    try {
      // Note: Using direct axios call instead of apiInstance
      // Call refresh endpoint directly (browser receives Set-Cookie)
      const refreshHeaders: Record<string, string> = {};
      refreshHeaders['x-request-id'] = uuidv4();
      if (logger.zeroClientId) {
        refreshHeaders['x-client-id'] = logger.zeroClientId;
      }
      if (logger.zeroClientGroupId) {
        refreshHeaders['x-zero-client-group-id'] = logger.zeroClientGroupId;
      }
      const userEmail = logger.emailId;
      if (userEmail) {
        refreshHeaders['x-user-email'] = userEmail;
      }
      const refreshStartTime = Date.now();

      await axios.get(`${API_BASE_URL}/auth/refresh-session`, {
        withCredentials: true, // Send cookies (session ID)
        headers: refreshHeaders,
      });

      const refreshLatency = Date.now() - refreshStartTime;

      logger.info(LoggerEvent.AUTH_REFRESH_SUCCESS, {
        trigger: 'ZERO_SYNC_AUTH_REQUIRED',
        refresh_latency_ms: refreshLatency,
      });

      safeRecordMetric(() => {
        authRefreshDuration.record(refreshLatency, {
          trigger: 'zero_sync_auth_invalidated',
          platformName: logger.platformName,
        });
        authRefreshTotal.add(1, {
          trigger: 'zero_sync_auth_invalidated',
          platformName: logger.platformName,
          status: 'success',
        });
      });

      // Reconnect WebSocket with new token
      if (websocketService.isConnectedToServer()) {
        websocketService.reconnect();
      }

      await zero.connection.connect();
      isRefreshing.current = false;

      logger.info(LoggerEvent.APP_REFRESH, {
        url: window.location.href,
        trigger: 'ZERO_SYNC_AUTH_INVALIDATED',
      });
    } catch (err) {
      logger.error(LoggerEvent.AUTH_REFRESH_FAILED, {
        trigger: 'ZERO_SYNC_AUTH_INVALIDATED',
        error_message: err,
        sessionDuration: Date.now() - (window.performance?.timing?.navigationStart || 0),
      });

      safeRecordMetric(() => {
        authRefreshTotal.add(1, {
          trigger: 'zero_sync_auth_invalidated',
          status: 'error',
          platformName: logger.platformName,
          reason: err instanceof Error ? err.message : 'Unknown error',
        });
      });

      // Clear this lane's Zero local databases
      void dropZeroDatabases();

      // Clear all cookies and auth tokens (handles Electron + Web)
      clearAuthTokens();

      // Force hard reload to reset all state
      window.location.href = '/auth';
      window.location.reload();
    } finally {
      isRefreshing.current = false;
    }
  };

  // Hydrate from IndexedDB on mount (only when logged in)
  useEffect(() => {
    const initializeState = async (): Promise<void> => {
      try {
        if (context.userID) {
          const hydrationStartTime = Date.now();
          // User is logged in - hydrate their specific database
          await hydrateQueryCacheFromIndexedDB(context.userID, schemaVersion, context.workspaceId);

          const hydrationLatency = Date.now() - hydrationStartTime;

          logger.info(LoggerEvent.INITIAL_STATE_HYDRATION_COMPLETE, {
            schemaVersion,
            latency: hydrationLatency,
          });
        }
      } catch (error) {
        logger.error(LoggerEvent.INITIAL_STATE_HYDRATION_FAILED, {
          schemaVersion,
          error,
        });
      } finally {
        queryCacheActor.send({ type: 'SET_HYDRATED' });
        setIsHydrated(true);
      }
    };

    void initializeState();
  }, [context.userID, schemaVersion]);

  useEffect(() => {
    if (context.userID && !persistenceSetup.current && isHydrated) {
      setupQueryCachePersistence(context.userID, schemaVersion, context.workspaceId);
      persistenceSetup.current = true;
    }
  }, [context.userID, schemaVersion, isHydrated]);

  useEffect(() => {
    const currentState = state.name;
    const previousState = previousStateRef.current;

    switch (currentState) {
      case 'needs-auth':
        void handleReAuth();
        break;
      case 'error':
        // Clear timer when we hit error state
        if (resetTimerRef.current) {
          clearTimeout(resetTimerRef.current);
          resetTimerRef.current = null;
        }

        // On mobile, the OS can kill the WebView's IDB storage process during backgrounding.
        // When this happens, all IDB handles (including newly opened ones) are broken within
        // the current page context. Only a full page reload reinitializes the storage process.
        if (String(state.reason).includes('Connection to Indexed Database server lost')) {
          logger.info(LoggerEvent.ZERO_ERROR_RELOAD_INITIATED, {
            trigger: 'IDB_CONNECTION_LOST',
            reason: state.reason,
          });
          window.location.reload();
          return;
        }

        // Only attempt reconnect if we haven't exceeded max retries
        if (retryCountRef.current < MAX_RETRIES) {
          retryCountRef.current += 1;

          // Calculate exponential backoff delay
          const delay = getRetryDelay(retryCountRef.current - 1);

          // Apply exponential backoff before retry
          setTimeout(() => {
            if (retryCountRef.current === 1) {
              logger.info(LoggerEvent.ZERO_ERROR_RECONNECT_INITIATED, {
                trigger: 'ZERO_SOCKET_CONNECTION_ERROR',
                reason: state.reason,
              });
              void zero.connection.connect();
              return;
            }
            logger.info(LoggerEvent.ZERO_ERROR_RELOAD_INITIATED, {
              trigger: 'ZERO_SOCKET_CONNECTION_ERROR',
              reason: state.reason,
            });
            stateMachineActor.send({ type: 'REFRESH_ZERO' });
          }, delay);
        } else {
          // Track max retries reached
          modalTimerRef.current = setTimeout(() => {
            setShowModal(true);
            modalTimerRef.current = null;
          }, MODAL_DELAY_MS);
          logger.info(LoggerEvent.ZERO_ERROR_RELOAD_LIMIT_REACHED, {
            trigger: 'ZERO_ERROR_RELOAD_INITIATED',
            count: retryCountRef.current,
          });
        }
        break;
      case 'connected':
        if (modalTimerRef.current) {
          clearTimeout(modalTimerRef.current);
          modalTimerRef.current = null;
        }
        setShowModal(false);
        handlePostErrorReset(previousState);
        break;
      case 'disconnected':
        // Don't show modal for disconnected state, only for error state
        handlePostErrorReset(previousState);
        break;
      default:
        handlePostErrorReset(previousState);
        break;
    }

    // Update previous state for next iteration
    previousStateRef.current = currentState;

    // Cleanup timers on unmount
    return () => {
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
      }
      if (modalTimerRef.current) {
        clearTimeout(modalTimerRef.current);
        modalTimerRef.current = null;
      }
    };
  }, [state.name]);

  // Users: fallback-hydrated query (REST initial + Zero delta)
  const [users, usersDetails] = useFallbackHydratedQuery(queries.getUsersV2());

  // Channels: fallback-hydrated query (REST initial + Zero delta)
  const [allChannels, allChannelsDetails] = useFallbackHydratedQuery(queries.userAllChannels());

  const setLoggerEmail = (usersList: User[]): void => {
    if (context.userID) {
      const currentUser = usersList.find(u => u.id === context.userID);
      if (currentUser?.email) {
        logger.setEmailId(currentUser.email);
      }
    }
  };

  const [bookmarks, bookmarksDetails] = useCachedQuery(queries.userBookmarks(), {
    ttl: '10m',
  });
  const [visibleChannels, visibleChannelsDetails] = useCachedQuery(
    queries.userVisibleChannelsV3(),
    {
      ttl: '10m',
    },
  );
  const [allUserGroups, allUserGroupsDetails] = useCachedQuery(queries.getAllUserGroups(), {
    updatedAtEnabled: true,
  });

  const [userGroupMappings, userGroupMappingsDetails] = useCachedQuery(
    queries.getUserGroupMappingsByUserId(),
  );

  const [userDrafts, userDraftsDetails] = useCachedQuery(queries.userDrafts(), { ttl: '10m' });
  const [userDelayedMessages, userDelayedMessagesDetails] = useCachedQuery(
    queries.userDelayedMessages(),
    { ttl: '10m' },
  );
  const [userPreference, userPreferenceDetails] = useCachedQuery(
    queries.getCurrentUserPreference({}),
    { ttl: '10m' },
  );

  const permissionsQuery = useTanStackQuery<PermissionsApiResponse>({
    queryKey: ['user-permissions', context.userID],
    queryFn: async () => {
      const response = await apiInstance.get<PermissionsApiResponse>('/auth/permissions');
      return response.data;
    },
    staleTime: 10 * 60 * 1000,
    enabled: !!context.userID,
  });

  // Reset workspace-scoped state when the auth identity or workspace changes.
  useEffect(() => {
    setPermissionsHydrated(false);
    stateMachineActor.send({ type: 'RESET_ALL_USER_GROUPS' });
  }, [context.userID, context.workspaceId]);

  useEffect(() => {
    if (usersDetails.type === 'complete' && users) {
      stateMachineActor.send({ type: 'ADD_USERS', users });
      setLoggerEmail(users as User[]);
    }

    if (allChannelsDetails.type === 'complete' && allChannels) {
      stateMachineActor.send({ type: 'ADD_ALL_CHANNELS', channels: allChannels });
    }

    if (isQueryCompleted(visibleChannelsDetails)) {
      const channels = (visibleChannels || [])
        .map(s => s.channel)
        .filter((c): c is NonNullable<typeof c> => c !== undefined);
      stateMachineActor.send({ type: 'ADD_VISIBLE_CHANNELS', channels });
      stateMachineActor.send({
        type: 'ADD_USER_CHANNEL_STATUSES',
        userChannelStatuses: visibleChannels || [],
      });
    }

    if (permissionsQuery.isSuccess && permissionsQuery.data?.success) {
      stateMachineActor.send({
        type: 'SET_USER_PERMISSIONS',
        permissions: permissionsQuery.data.permissions || [],
      });
      setPermissionsHydrated(true);
    }

    if (isQueryCompleted(bookmarksDetails)) {
      stateMachineActor.send({ type: 'ADD_USER_BOOKMARKS', bookmarks: bookmarks });
    }

    if (isQueryCompleted(allUserGroupsDetails)) {
      stateMachineActor.send({ type: 'ADD_ALL_USER_GROUPS', userGroups: allUserGroups });
    }

    if (isQueryCompleted(userGroupMappingsDetails)) {
      stateMachineActor.send({ type: 'ADD_USER_GROUP_MAPPINGS', userGroupMappings });
    }

    if (isQueryCompleted(userDraftsDetails)) {
      stateMachineActor.send({ type: 'ADD_USER_DRAFTS', draftMessages: userDrafts });
    }

    if (isQueryCompleted(userDelayedMessagesDetails)) {
      stateMachineActor.send({
        type: 'ADD_USER_DELAYED_MESSAGES',
        delayedMessages: userDelayedMessages,
      });
    }

    if (isQueryCompleted(userPreferenceDetails)) {
      stateMachineActor.send({
        type: 'SET_USER_PREFERENCE',
        userPreference,
      });
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    users,
    usersDetails.type,
    context.userID,
    allChannels,
    allChannelsDetails.type,
    visibleChannels,
    visibleChannelsDetails.type,
    permissionsQuery.data,
    bookmarks,
    bookmarksDetails.type,
    allUserGroups,
    allUserGroupsDetails.type,
    userGroupMappings,
    userGroupMappingsDetails.type,
    userDrafts,
    userDraftsDetails.type,
    userDelayedMessages,
    userDelayedMessagesDetails.type,
    userPreference,
    userPreferenceDetails.type,
  ]);

  const areAllQueriesCompleted =
    areQueriesCompleted([
      usersDetails,
      allChannelsDetails,
      bookmarksDetails,
      visibleChannelsDetails,
    ]) &&
    permissionsQuery.isSuccess &&
    permissionsQuery.data?.success === true &&
    permissionsHydrated;

  if (areAllQueriesCompleted) {
    return (
      <SharedAuthProvider value={context}>
        <HttpClientProvider client={axiosHttpClient}>
          <AffinityServiceProvider value={affinityService}>
            <ChannelServiceProvider
              getVespaParticipants={(id): Promise<string[]> =>
                channelService.getVespaParticipants(id)
              }
            >
              {showModal && <ZeroConnectionFailureModal onClose={() => setShowModal(false)} />}
              <DeferredLoader />
              {children}
            </ChannelServiceProvider>
          </AffinityServiceProvider>
        </HttpClientProvider>
      </SharedAuthProvider>
    );
  }

  return <AppLoader />;
};

export default InitialStateLoader;
