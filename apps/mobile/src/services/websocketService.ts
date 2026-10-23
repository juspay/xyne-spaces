import { Platform } from 'react-native';
import { io, type Socket, type ManagerOptions } from 'socket.io-client';

import { API_ORIGIN, isMtlsFeatureEnabled } from '@/src/config';
import { getValidAccessToken } from '@/src/services/authToken';
import { Event, logger, NotificationSocketState } from '@/src/utils/logger';
import { initializeMtlsTransport } from '@/src/utils/mtlsTransport';

const CONNECT_TIMEOUT_MS = 60_000;
const PRESENCE_LOG = '[Presence][Socket]';

/**
 * Realtime Socket.IO client for presence and other push events.
 *
 * Transport strategy (must match platform TLS capabilities):
 * - Web dashboard: cookies on handshake + websocket with polling fallback
 * - Native + mTLS: websocket only via MtlsSocketModule (global WebSocket interceptor)
 * - Native dev without mTLS: websocket + polling (same as web)
 */
class WebSocketService {
  private socket: Socket | null = null;
  private connectionPromise: Promise<void> | null = null;
  private connectAttemptStartedAt: number | null = null;
  private firstConnectAttemptStartedAt: number | null = null;
  private connectionStartedAt: number | null = null;

  connect(): Promise<void> {
    if (this.socket?.connected) {
      console.log(PRESENCE_LOG, 'already connected, skipping');
      return Promise.resolve();
    }

    if (this.connectionPromise) {
      console.log(PRESENCE_LOG, 'connection already in progress');
      return this.connectionPromise;
    }

    this.connectionPromise = this.openConnection();
    return this.connectionPromise;
  }

  private async openConnection(): Promise<void> {
    initializeMtlsTransport();

    const token = await getValidAccessToken(60);
    if (!token) {
      this.connectionPromise = null;
      console.warn(PRESENCE_LOG, 'connect aborted: no auth token');
      throw new Error('[WebSocket] No auth token');
    }

    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }

    const options = buildManagerOptions(token);
    const useMtlsWebSocketOnly = Platform.OS !== 'web' && isMtlsFeatureEnabled();
    this.connectAttemptStartedAt = Date.now();
    this.firstConnectAttemptStartedAt ??= this.connectAttemptStartedAt;
    logger.setNotificationSocketState(NotificationSocketState.DISCONNECTED);

    console.log(PRESENCE_LOG, 'connecting', {
      origin: API_ORIGIN,
      platform: Platform.OS,
      mtlsWebSocketOnly: useMtlsWebSocketOnly,
      transports: options.transports,
    });

    return new Promise((resolve, reject) => {
      const socket = io(API_ORIGIN, options);
      this.socket = socket;

      const timeoutId = setTimeout(() => {
        socket.off('connect', onConnect);
        socket.off('connect_error', onConnectError);
        this.connectionPromise = null;
        console.warn(PRESENCE_LOG, 'connect timeout', { ms: CONNECT_TIMEOUT_MS });
        reject(new Error('[WebSocket] Connection timeout'));
      }, CONNECT_TIMEOUT_MS);

      const onConnect = (): void => {
        const isInitialConnect = this.connectionPromise !== null;
        const attemptLatencyMs =
          this.connectAttemptStartedAt !== null ? Date.now() - this.connectAttemptStartedAt : 0;
        const totalLatencyMs =
          this.firstConnectAttemptStartedAt !== null
            ? Date.now() - this.firstConnectAttemptStartedAt
            : attemptLatencyMs;
        this.connectionStartedAt = Date.now();
        this.connectAttemptStartedAt = null;
        logger.setNotificationWsId(socket.id ?? '');
        logger.setNotificationSocketState(NotificationSocketState.CONNECTED);
        logger.info(Event.WEBSOCKET_CONNECTED, {
          notificationWsId: socket.id ?? '',
          notificationSocketState: NotificationSocketState.CONNECTED,
          latencyMs: attemptLatencyMs,
          totalLatencyMs,
          isReconnect: !isInitialConnect,
        });
        console.log(PRESENCE_LOG, 'connected', {
          id: socket.id,
          transport: socket.io.engine?.transport?.name,
          isReconnect: !isInitialConnect,
        });

        if (isInitialConnect) {
          clearTimeout(timeoutId);
          this.connectionPromise = null;
          this.firstConnectAttemptStartedAt = null;
          resolve();
        }
      };

      const onConnectError = (error: Error): void => {
        const message = error instanceof Error ? error.message : String(error);
        logger.setNotificationSocketState(NotificationSocketState.DISCONNECTED);
        logger.error(Event.WEBSOCKET_CONNECTION_FAILED, {
          reason: error,
          notificationSocketState: NotificationSocketState.DISCONNECTED,
        });
        console.warn(PRESENCE_LOG, 'connect_error', {
          message,
          ...(error && typeof error === 'object' && 'description' in error
            ? { description: (error as { description?: unknown }).description }
            : {}),
        });
      };

      socket.on('connect', onConnect);
      socket.on('connect_error', onConnectError);

      socket.on('disconnect', reason => {
        const sessionDurationMs =
          this.connectionStartedAt !== null ? Date.now() - this.connectionStartedAt : 0;
        this.connectionStartedAt = null;
        this.connectAttemptStartedAt = Date.now();
        logger.setNotificationSocketState(NotificationSocketState.DISCONNECTED);
        logger.info(Event.WEBSOCKET_CONNECTION_CLOSED, {
          reason,
          sessionDurationMs,
          notificationSocketState: NotificationSocketState.DISCONNECTED,
        });
        console.log(PRESENCE_LOG, 'disconnected', { reason });
      });
    });
  }

  disconnect(): void {
    if (this.socket) {
      console.log(PRESENCE_LOG, 'disconnecting');
      this.socket.disconnect();
      this.socket.removeAllListeners();
      this.socket = null;
    }
    this.connectAttemptStartedAt = null;
    this.firstConnectAttemptStartedAt = null;
    this.connectionStartedAt = null;
    this.connectionPromise = null;
  }

  emit<T = unknown>(event: string, data?: T): void {
    if (!this.socket?.connected) {
      console.warn(PRESENCE_LOG, 'emit skipped (not connected)', { event });
      return;
    }
    this.socket.emit(event, data);
  }

  on<T = unknown>(event: string, callback: (data: T) => void): void {
    this.socket?.on(event, callback);
  }

  removeListener<T = unknown>(event: string, callback?: (data: T) => void): void {
    if (!this.socket) return;
    if (callback) {
      this.socket.off(event, callback);
    } else {
      this.socket.removeAllListeners(event);
    }
  }

  getSocket(): Socket | null {
    return this.socket;
  }

  isConnectedToServer(): boolean {
    return this.socket?.connected ?? false;
  }
}

function buildManagerOptions(token: string): Partial<ManagerOptions> {
  const shared = {
    path: '/api/socket.io/',
    auth: { token },
    extraHeaders: {
      Authorization: `Bearer ${token}`,
    },
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
  };

  const useMtlsWebSocketOnly = Platform.OS !== 'web' && isMtlsFeatureEnabled();

  if (useMtlsWebSocketOnly) {
    return {
      ...shared,
      transports: ['websocket'],
      upgrade: false,
    };
  }

  return {
    ...shared,
    transports: ['websocket', 'polling'],
    upgrade: true,
  };
}

export const websocketService = new WebSocketService();
