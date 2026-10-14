import { useCallback, useEffect, useRef } from 'react';
import { AppState, InteractionManager, type AppStateStatus } from 'react-native';

import { useAuth } from '@/src/contexts/AuthContext';
import { cleanupPresenceListeners, setupPresenceListeners } from '@/src/machines/appStateMachine';
import { websocketService } from '@/src/services/websocketService';
import { startupTimings } from '@/src/utils/startupTimings';

/**
 * Boots Socket.IO presence the same way as dashboard NotificationHandler:
 * connect once when signed in, wire shared listeners, request presence snapshot on connect.
 */

const PRESENCE_LOG = '[Presence][Setup]';
const PRESENCE_START_DELAY_MS = 1000;
const PRESENCE_STATE_REQUEST_MIN_INTERVAL_MS = 5000;
const PRESENCE_STATE_REQUEST_RETRY_MS = 1000;

type PresenceWebsocketService = Parameters<typeof setupPresenceListeners>[1];

const createLotusPresenceService = (): PresenceWebsocketService => ({
  on: <T>(event: string, callback: (data: T) => void): void => {
    websocketService.on(event, callback);
  },
  removeListener: (event: string): void => {
    websocketService.removeListener(event);
  },
});

const lotusPresenceService = createLotusPresenceService();

export function usePresenceSetup(options: { enabled?: boolean } = {}): void {
  const enabled = options.enabled ?? true;
  const { user, isSignedIn, token } = useAuth();
  const isConnectedRef = useRef(false);
  const onSocketConnectRef = useRef<(() => void) | null>(null);
  const lastPresenceStateRequestAtRef = useRef(0);
  const presenceStateRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPresenceStateRetry = useCallback((): void => {
    if (!presenceStateRetryTimerRef.current) return;
    clearTimeout(presenceStateRetryTimerRef.current);
    presenceStateRetryTimerRef.current = null;
  }, []);

  const emitPresenceStateRequest = useCallback((force = false): void => {
    const socket = websocketService.getSocket();
    if (!socket) {
      return;
    }

    const now = Date.now();
    if (
      !force &&
      now - lastPresenceStateRequestAtRef.current < PRESENCE_STATE_REQUEST_MIN_INTERVAL_MS
    ) {
      return;
    }

    lastPresenceStateRequestAtRef.current = now;
    socket.emit('request_presence_state');
  }, []);

  const requestPresenceStateWithRetry = useCallback((): void => {
    emitPresenceStateRequest(true);
    clearPresenceStateRetry();
    presenceStateRetryTimerRef.current = setTimeout(() => {
      presenceStateRetryTimerRef.current = null;
      emitPresenceStateRequest(true);
    }, PRESENCE_STATE_REQUEST_RETRY_MS);
  }, [clearPresenceStateRetry, emitPresenceStateRequest]);

  useEffect(() => {
    const userId = user?.user_id;
    if (!enabled || !isSignedIn || !token || !userId) {
      return;
    }

    let cancelled = false;
    let startTimer: ReturnType<typeof setTimeout> | null = null;

    startTimer = setTimeout(() => {
      InteractionManager.runAfterInteractions(() => {
        if (cancelled) return;
        void startupTimings.mark('presence_setup_start');
        void websocketService
          .connect()
          .then(() => {
            if (cancelled) return;

            isConnectedRef.current = true;
            cleanupPresenceListeners(lotusPresenceService);
            setupPresenceListeners(userId, lotusPresenceService);

            const socket = websocketService.getSocket();
            if (!socket) {
              console.warn(PRESENCE_LOG, 'connected but socket ref is null');
              return;
            }

            const requestPresenceState = (): void => requestPresenceStateWithRetry();

            if (onSocketConnectRef.current) {
              socket.off('connect', onSocketConnectRef.current);
            }
            onSocketConnectRef.current = requestPresenceState;
            socket.on('connect', requestPresenceState);
            requestPresenceStateWithRetry();
            void startupTimings.mark('presence_setup_end');
          })
          .catch(error => {
            if (!cancelled) {
              isConnectedRef.current = false;
              console.warn(PRESENCE_LOG, 'initial connect failed', error);
            }
          });
      });
    }, PRESENCE_START_DELAY_MS);

    return (): void => {
      cancelled = true;
      if (startTimer) {
        clearTimeout(startTimer);
      }
      clearPresenceStateRetry();
      const socket = websocketService.getSocket();
      if (socket && onSocketConnectRef.current) {
        socket.off('connect', onSocketConnectRef.current);
        onSocketConnectRef.current = null;
      }
      cleanupPresenceListeners(lotusPresenceService);
      if (isConnectedRef.current) {
        websocketService.disconnect();
        isConnectedRef.current = false;
      }
    };
  }, [
    clearPresenceStateRetry,
    enabled,
    isSignedIn,
    requestPresenceStateWithRetry,
    token,
    user?.user_id,
  ]);

  useEffect(() => {
    const userId = user?.user_id;
    if (!enabled || !isSignedIn || !token || !userId) return;

    const onAppStateChange = (next: AppStateStatus): void => {
      if (next !== 'active') return;

      if (websocketService.isConnectedToServer()) {
        requestPresenceStateWithRetry();
        return;
      }

      void websocketService
        .connect()
        .then(() => {
          isConnectedRef.current = true;
          cleanupPresenceListeners(lotusPresenceService);
          setupPresenceListeners(userId, lotusPresenceService);
          requestPresenceStateWithRetry();
        })
        .catch(error => {
          console.warn(PRESENCE_LOG, 'foreground reconnect failed', error);
        });
    };

    const sub = AppState.addEventListener('change', onAppStateChange);
    return (): void => {
      sub.remove();
    };
  }, [enabled, isSignedIn, requestPresenceStateWithRetry, token, user?.user_id]);
}
