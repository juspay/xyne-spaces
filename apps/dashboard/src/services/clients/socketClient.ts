import { io, Socket } from 'socket.io-client';
import { mixpanelService, EVENTS, EVENT_PROPERTIES } from '../Analytics/mixpanelService';
import { API_BASE_URL } from '../../config';
import { logger, Logger, NotificationSocketState } from '../../utils/logger';
import {
  socketConnectionAttemptDuration,
  socketConnectionTotalDuration,
  socketConnectionRetriesPerRequest,
  socketSessionDuration,
  socketEventsTotal,
  safeRecordMetric,
} from '../otel';
export interface TypingEvent {
  conversationId: string;
  userId: string;
  isTyping: boolean;
  timestamp: Date;
}

function formatDurationFromMs(durationMs: number): string {
  if (durationMs < 0) return '0 seconds';

  const hours = Math.floor(durationMs / 3600000);
  const minutes = Math.floor((durationMs % 3600000) / 60000);
  const seconds = Math.floor((durationMs % 60000) / 1000);

  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours} hour${hours !== 1 ? 's' : ''}`);
  if (minutes > 0) parts.push(`${minutes} minute${minutes !== 1 ? 's' : ''}`);
  if (seconds > 0 || parts.length === 0) {
    parts.push(`${seconds} second${seconds !== 1 ? 's' : ''}`);
  }

  return parts.join(' ');
}

class WebSocketService {
  private socket: Socket | null = null;
  private isConnected = false;
  private reconnectAttempts = 0;
  private connectionStartTime: number | null = null;
  private reconnectionStartTime: number | null = null;
  private connectionPromise: Promise<void> | null = null;
  private connectionAttemptStartTime: number | null = null;
  private sessionStartTime: number | null = null;
  private firstConnectionAttemptTime: number | null = null;
  private connectListeners: Array<() => void> = [];

  // Survives socket recreation, unlike on('connect') which binds to the
  // current socket instance. Fires on every (re)connection.
  onConnect(listener: () => void): () => void {
    this.connectListeners.push(listener);
    return () => {
      this.connectListeners = this.connectListeners.filter(l => l !== listener);
    };
  }

  connect(): Promise<void> {
    // If already connected, return immediately
    if (this.socket && this.isConnected) {
      return Promise.resolve();
    }

    // If connection is in progress, return the existing promise
    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    this.connectionPromise = new Promise((resolve, reject) => {
      // Tokens are in HTTP-only cookies and sent automatically
      // Socket.io will include cookies with the handshake request
      if (!this.firstConnectionAttemptTime) {
        this.firstConnectionAttemptTime = Date.now();
      }
      this.connectionAttemptStartTime = Date.now();
      const apiUrl = API_BASE_URL;
      const serverUrl = apiUrl?.replace('/api', '') || 'http://localhost:3001';

      // Disconnect any existing socket before creating a new one
      if (this.socket) {
        this.socket.disconnect();
        this.socket.removeAllListeners();
        this.socket = null;
      }

      this.socket = io(serverUrl, {
        path: '/api/socket.io/',
        withCredentials: true, // Important: send cookies with socket connection
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 30000,
        randomizationFactor: 0.5,
      });

      this.socket.io.on('reconnect_attempt', (attempt: number) => {
        this.reconnectAttempts = attempt;
        safeRecordMetric(() => {
          socketEventsTotal.add(1, { event: 'retry', reason: `attempt_${attempt}` });
        });
      });

      this.socket.on('connect', () => {
        const attemptLatency =
          this.connectionAttemptStartTime !== null
            ? Date.now() - this.connectionAttemptStartTime
            : 0;

        const totalLatency = this.firstConnectionAttemptTime
          ? Date.now() - this.firstConnectionAttemptTime
          : attemptLatency;

        if (this.socket?.id) {
          logger.setNotificationWsId(this.socket.id);
        }

        logger.setNotificationSocketState(NotificationSocketState.CONNECTED);

        logger.info(Logger.Event.WEBSOCKET_CONNECTED, {
          latencyMs: attemptLatency,
          totalLatencyMs: totalLatency,
          reconnectAttempts: this.reconnectAttempts,
        });

        if (this.reconnectAttempts > 0 && this.reconnectionStartTime) {
          mixpanelService.track(EVENTS.PERFORMANCE_METRIC, {
            type: EVENT_PROPERTIES.PERFORMANCE_METRIC_TYPES.WS_CONNECTION_RECONNECT_ATTEMPT,
            timeTakenMs: Date.now() - this.reconnectionStartTime,
            reconnectAttempts: this.reconnectAttempts,
          });
        }

        safeRecordMetric(() => {
          socketConnectionAttemptDuration.record(attemptLatency);
          socketConnectionTotalDuration.record(totalLatency);
          socketConnectionRetriesPerRequest.record(this.reconnectAttempts);
          socketEventsTotal.add(1, {
            event: 'connect',
            reason: this.reconnectAttempts > 0 ? 'reconnect' : 'initial',
          });
        });

        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.connectionStartTime = Date.now();
        this.sessionStartTime = Date.now();
        this.reconnectionStartTime = null;
        this.firstConnectionAttemptTime = null;
        this.connectionPromise = null; // Clear the promise after successful connection

        for (const listener of this.connectListeners) {
          try {
            listener();
          } catch {
            // A listener failure must not break the connection flow.
          }
        }

        resolve();
      });

      this.socket.on('disconnect', reason => {
        this.isConnected = false;
        this.reconnectionStartTime = Date.now();
        this.connectionPromise = null; // Clear the promise on disconnect

        logger.setNotificationSocketState(NotificationSocketState.DISCONNECTED);

        // Track WebSocket disconnection
        const durationMs = this.connectionStartTime ? Date.now() - this.connectionStartTime : 0;
        this.connectionStartTime = null; // Reset to prevent incorrect calculations on subsequent disconnects
        const durationFormatted = formatDurationFromMs(durationMs);

        logger.info(Logger.Event.WEBSOCKET_CONNECTION_CLOSED, {
          sessionDurationMs: durationMs,
          reason: reason,
        });

        mixpanelService.track(EVENTS.WS_CONNECTION_CLOSED, {
          reason: reason,
          durationMs, // Exact time in milliseconds
          durationFormatted, // Human-readable format (e.g., "1 minute 30 seconds")
        });

        safeRecordMetric(() => {
          if (this.sessionStartTime) {
            const sessionDurationSeconds = Date.now() - this.sessionStartTime;
            socketSessionDuration.record(sessionDurationSeconds);
            this.sessionStartTime = null;
          }
          socketEventsTotal.add(1, {
            event: 'disconnect',
            reason: reason || 'unknown',
          });
        });

        if (reason === 'io server disconnect') {
          this.socket?.connect();
        }
      });

      this.socket.on('connect_error', error => {
        const attemptLatency =
          this.connectionAttemptStartTime !== null
            ? Date.now() - this.connectionAttemptStartTime
            : 0;

        const errorMessage = error instanceof Error ? error.message : String(error);

        this.isConnected = false;
        this.connectionPromise = null; // Clear the promise on error

        logger.setNotificationSocketState(NotificationSocketState.DISCONNECTED);
        logger.error(Logger.Event.WEBSOCKET_CONNECTION_FAILED, { reason: error });

        safeRecordMetric(() => {
          socketConnectionAttemptDuration.record(attemptLatency);
          socketEventsTotal.add(1, {
            event: 'fail',
            reason: `connect_error: ${errorMessage}`,
          });
        });

        reject(error);
      });

      // Set up error handlers
      this.socket.on('error', (error: Error) => {
        const errorMessage = error instanceof Error ? error.message : String(error);

        logger.setNotificationSocketState(NotificationSocketState.DISCONNECTED);
        logger.error(Logger.Event.WEBSOCKET_CONNECTION_FAILED, { reason: error });

        safeRecordMetric(() => {
          socketEventsTotal.add(1, {
            event: 'fail',
            reason: `socket_error: ${errorMessage}`,
          });
        });

        // If error occurs while connected, mark as disconnected
        if (this.isConnected) {
          this.isConnected = false;
          this.connectionPromise = null;
          if (this.sessionStartTime) {
            const sessionDurationSeconds = Date.now() - this.sessionStartTime;
            socketSessionDuration.record(sessionDurationSeconds);
            this.sessionStartTime = null;
          }
        }
      });
    });

    return this.connectionPromise;
  }

  disconnect(): void {
    if (this.socket) {
      safeRecordMetric(() => {
        if (this.sessionStartTime) {
          const sessionDurationSeconds = Date.now() - this.sessionStartTime;
          socketSessionDuration.record(sessionDurationSeconds);
          this.sessionStartTime = null;
        }
        socketEventsTotal.add(1, {
          event: 'disconnect',
          reason: 'client_disconnect',
        });
      });
      this.socket.disconnect();
      this.socket = null;
      this.isConnected = false;
      this.firstConnectionAttemptTime = null;
    }
  }

  reconnect(): void {
    this.forceReconnect();
  }

  forceReconnect(): void {
    if (!this.socket) return;
    this.socket.disconnect();
    this.socket.connect();
  }

  startTyping(sessionId: string): void {
    if (!this.socket || !this.isConnected) return;

    this.socket.emit('typing_start', { sessionId });
  }

  stopTyping(sessionId: string): void {
    if (!this.socket || !this.isConnected) return;

    this.socket.emit('typing_stop', { sessionId });
  }

  // Generic emit method for any event
  emit<T = unknown>(event: string, data?: T): void {
    if (!this.socket || !this.isConnected) {
      return;
    }
    this.socket.emit(event, data);
  }

  on<T = unknown>(event: string, callback: (data: T) => void): void {
    if (!this.socket) return;

    this.socket.on(event, callback);
  }

  // Remove event listeners
  removeAllListeners(): void {
    if (!this.socket) return;

    this.socket.removeAllListeners();
  }

  removeListener<T = unknown>(event: string, callback?: (data: T) => void): void {
    if (!this.socket) return;

    if (callback) {
      this.socket.off(event, callback);
    } else {
      this.socket.removeAllListeners(event);
    }
  }

  // Utility methods
  isConnectedToServer(): boolean {
    return this.isConnected;
  }

  getSocket(): Socket | null {
    return this.socket;
  }
}

// Export singleton instance
export const websocketService = new WebSocketService();
