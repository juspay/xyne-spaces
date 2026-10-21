import { useEffect, useRef } from 'react';
import { Alert, AppState } from 'react-native';
import { useConnectionState } from '@rocicorp/zero/react';

import { stateMachineActor } from '@/src/machines/appStateMachine';
import { refreshAuthSession } from '@/src/services/AuthServices';
import {
  getAuthRetryDelay,
  INITIAL_AUTH_RETRY_STATE,
  nextAuthRetry,
  type AuthRetryState,
} from '@/src/services/sessionTokenPolicy';
import { useZero } from '@/src/hooks/useZero';
import { Event, logger, ZeroSocketState } from '@/src/utils/logger';
import { logger as structuredLogger } from '@/src/observability/logging/appLogger';
import { getActiveWorkspaceId } from '@/src/utils/activeWorkspace';
import { getAuthOperation, getAuthSessionGeneration } from '@/src/services/authSessionLifecycle';
import { getRetryDelay } from './initialStateLoaderUtils';
import {
  isFatalZeroClientResetReason,
  requestZeroClientRefresh,
  shouldRequestZeroConnect,
} from './zeroClientState';

const MODAL_DELAY_MS = 60_000;
const MAX_RETRIES = 4;

type UseStartupZeroConnectionArgs = {
  activeWorkspaceId: string | null;
  applyRefreshedToken: (token: string, generation?: number, operation?: number) => Promise<boolean>;
  signOut: () => Promise<void>;
};

const clearTimer = (timerRef: { current: ReturnType<typeof setTimeout> | null }): void => {
  if (timerRef.current !== null) {
    clearTimeout(timerRef.current);
    timerRef.current = null;
  }
};

export function useStartupZeroConnection({
  activeWorkspaceId,
  applyRefreshedToken,
  signOut,
}: UseStartupZeroConnectionArgs): void {
  const zero = useZero();
  const zeroConnection = useConnectionState();
  const connectionName = zeroConnection.name;

  const zeroRef = useRef(zero);
  const connectionNameRef = useRef(connectionName);
  const connectionReasonRef = useRef<unknown>(
    'reason' in zeroConnection ? zeroConnection.reason : undefined,
  );
  const applyRefreshedTokenRef = useRef(applyRefreshedToken);
  const signOutRef = useRef(signOut);
  const previousStateRef = useRef<string>('');
  const connectionStartTimeRef = useRef<number | null>(null);
  const firstConnectionAttemptTimeRef = useRef<number | null>(null);
  const connectionAttemptsRef = useRef(0);
  const sessionStartTimeRef = useRef<number | null>(null);
  const retryCountRef = useRef(0);
  const authRetryStateRef = useRef<AuthRetryState>(INITIAL_AUTH_RETRY_STATE);
  const activeWorkspaceIdRef = useRef(activeWorkspaceId);
  const isRefreshingRef = useRef(false);
  const isActiveRef = useRef(true);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const authRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    zeroRef.current = zero;
    connectionNameRef.current = connectionName;
    connectionReasonRef.current = 'reason' in zeroConnection ? zeroConnection.reason : undefined;
    applyRefreshedTokenRef.current = applyRefreshedToken;
    signOutRef.current = signOut;
    activeWorkspaceIdRef.current = activeWorkspaceId;
  }, [activeWorkspaceId, applyRefreshedToken, connectionName, signOut, zero, zeroConnection]);

  const scheduleAuthRetry = (delayMs: number): void => {
    clearTimer(authRetryTimerRef);
    authRetryTimerRef.current = setTimeout(() => {
      authRetryTimerRef.current = null;
      if (connectionNameRef.current === 'needs-auth' && isActiveRef.current) {
        void recoverFromNeedsAuthRef.current();
      }
    }, delayMs);
  };

  /**
   * Refresh and reconnect in the foreground. Only a session cookie the server
   * keeps refusing sends the user to login; everything else backs off and
   * retries, so a network blip never logs anyone out.
   */
  const recoverFromNeedsAuth = async (): Promise<void> => {
    if (isRefreshingRef.current) {
      return;
    }
    isRefreshingRef.current = true;
    const requestedWorkspaceId = activeWorkspaceIdRef.current;
    const generation = getAuthSessionGeneration();
    const operation = getAuthOperation();

    try {
      const result = await refreshAuthSession(
        requestedWorkspaceId ?? undefined,
        generation,
        operation,
      );
      if (!isActiveRef.current || getActiveWorkspaceId() !== requestedWorkspaceId) {
        return;
      }
      if (result.ok) {
        authRetryStateRef.current = INITIAL_AUTH_RETRY_STATE;
        clearTimer(authRetryTimerRef);
        const applied = await applyRefreshedTokenRef.current(result.token, generation, operation);
        if (!applied) {
          return;
        }
        if (!isActiveRef.current || getActiveWorkspaceId() !== requestedWorkspaceId) {
          return;
        }
        await zeroRef.current.connection.connect({ auth: result.token });
        return;
      }

      const decision = nextAuthRetry(result.kind, authRetryStateRef.current);
      if (decision.action === 'sign-out') {
        structuredLogger.warn(Event.ZERO_SOCKET_AUTH_REQUIRED, {
          stage: 'refresh_retries_exhausted',
          reason: result.kind,
        });
        await signOutRef.current();
        return;
      }

      authRetryStateRef.current = decision.state;
      structuredLogger.warn(Event.ZERO_SOCKET_AUTH_REQUIRED, {
        stage: 'refresh_retry_scheduled',
        reason: result.kind,
        attempt: decision.state.attempts,
        delayMs: decision.delayMs,
      });
      scheduleAuthRetry(decision.delayMs);
    } catch (error) {
      structuredLogger.warn(Event.ZERO_SOCKET_AUTH_REQUIRED, {
        stage: 'refresh_exception',
        error,
      });
      if (!isActiveRef.current) {
        return;
      }
      const attempt = authRetryStateRef.current.attempts;
      authRetryStateRef.current = { ...authRetryStateRef.current, attempts: attempt + 1 };
      scheduleAuthRetry(getAuthRetryDelay(attempt));
    } finally {
      isRefreshingRef.current = false;
    }
  };
  const recoverFromNeedsAuthRef = useRef(recoverFromNeedsAuth);
  recoverFromNeedsAuthRef.current = recoverFromNeedsAuth;

  useEffect(() => {
    logger.setZeroClientId(zero.clientID);
    logger.setZeroClientGroupId(zero.clientGroupID);
  }, [zero.clientGroupID, zero.clientID]);

  useEffect(() => {
    const currentState = connectionName;
    const previousState = previousStateRef.current;
    const reason = connectionReasonRef.current;
    if (currentState === previousState) {
      return;
    }

    // A new connection state supersedes delayed UI/reset work from the old state.
    clearTimer(resetTimerRef);
    if (currentState !== 'error') {
      clearTimer(modalTimerRef);
    }

    const resetRetryBudgetAfterError = (): void => {
      if (previousState !== 'error') {
        return;
      }
      clearTimer(resetTimerRef);
      resetTimerRef.current = setTimeout(() => {
        retryCountRef.current = 0;
        resetTimerRef.current = null;
      }, 5000);
    };

    switch (currentState) {
      case 'connecting': {
        clearTimer(reconnectTimerRef);
        logger.setZeroSocketState(ZeroSocketState.CONNECTING);
        connectionAttemptsRef.current += 1;
        firstConnectionAttemptTimeRef.current ??= Date.now();
        structuredLogger.info(Event.ZERO_SOCKET_CONNECTING, {
          reason,
          zeroReconnectionAttempts: connectionAttemptsRef.current,
          currentState,
          previousState,
        });
        connectionStartTimeRef.current = Date.now();
        sessionStartTimeRef.current = null;
        break;
      }
      case 'needs-auth': {
        logger.setZeroSocketState(ZeroSocketState.NEEDS_AUTH);
        structuredLogger.error(Event.ZERO_SOCKET_AUTH_REQUIRED, {
          reason,
          currentState,
          previousState,
        });
        void recoverFromNeedsAuthRef.current();
        break;
      }
      case 'error': {
        logger.setZeroSocketState(ZeroSocketState.ERROR);
        structuredLogger.error(Event.ZERO_SOCKET_CONNECTION_ERROR, {
          reason,
          currentState,
          previousState,
        });
        if (isFatalZeroClientResetReason(reason)) {
          if (requestZeroClientRefresh()) {
            stateMachineActor.send({ type: 'REFRESH_ZERO' });
          }
          break;
        }
        if (retryCountRef.current < MAX_RETRIES) {
          retryCountRef.current += 1;
          const delayMs = getRetryDelay(retryCountRef.current - 1);
          clearTimer(reconnectTimerRef);
          reconnectTimerRef.current = setTimeout(() => {
            reconnectTimerRef.current = null;
            if (connectionNameRef.current !== 'error') {
              return;
            }
            void zeroRef.current.connection.connect();
          }, delayMs);
        } else if (!modalTimerRef.current) {
          modalTimerRef.current = setTimeout(() => {
            Alert.alert(
              'Unable to connect',
              'Live sync could not be restored after several attempts. Check your connection and try opening the app again.',
            );
            modalTimerRef.current = null;
          }, MODAL_DELAY_MS);
        }
        break;
      }
      case 'connected': {
        clearTimer(reconnectTimerRef);
        clearTimer(authRetryTimerRef);
        logger.setZeroSocketState(ZeroSocketState.CONNECTED);
        const latencyMs = connectionStartTimeRef.current
          ? Date.now() - connectionStartTimeRef.current
          : 0;
        const totalLatencyMs = firstConnectionAttemptTimeRef.current
          ? Date.now() - firstConnectionAttemptTimeRef.current
          : latencyMs;
        structuredLogger.info(Event.ZERO_SOCKET_CONNECTED, {
          latencyMs,
          totalLatencyMs,
          currentState,
          previousState,
          connectionAttempts: connectionAttemptsRef.current,
        });
        connectionStartTimeRef.current = null;
        firstConnectionAttemptTimeRef.current = null;
        connectionAttemptsRef.current = 0;
        sessionStartTimeRef.current = Date.now();
        clearTimer(modalTimerRef);
        resetRetryBudgetAfterError();
        break;
      }
      case 'disconnected': {
        logger.setZeroSocketState(ZeroSocketState.DISCONNECTED);
        const sessionDurationMs = sessionStartTimeRef.current
          ? Date.now() - sessionStartTimeRef.current
          : null;
        structuredLogger.warn(Event.ZERO_SOCKET_DISCONNECTED, {
          reason,
          currentState,
          previousState,
          sessionDurationMs,
        });
        connectionStartTimeRef.current = Date.now();
        sessionStartTimeRef.current = null;
        resetRetryBudgetAfterError();
        break;
      }
      default: {
        resetRetryBudgetAfterError();
      }
    }

    previousStateRef.current = currentState;
  }, [connectionName]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState !== 'active' || !shouldRequestZeroConnect(connectionNameRef.current)) {
        return;
      }
      if (connectionNameRef.current === 'needs-auth') {
        recoverFromNeedsAuthRef.current();
        return;
      }
      void zeroRef.current.connection.connect();
    });
    return (): void => subscription.remove();
  }, []);

  useEffect(() => {
    isActiveRef.current = true;
    return (): void => {
      isActiveRef.current = false;
      clearTimer(resetTimerRef);
      clearTimer(reconnectTimerRef);
      clearTimer(modalTimerRef);
      clearTimer(authRetryTimerRef);
    };
  }, []);
}
