import { type Platform } from '../hooks/usePlatform';
import { detectPlatform } from '../hooks/usePlatform';
import { FLUSH_INTERVAL_IN_MS, LOGGER_BASE_URL, MAX_BATCH_SIZE, MAX_RETRIES } from '../config';
import type { WorkerMessage } from './logger.worker';
import { v4 as uuidv4 } from 'uuid';

export const LogLevel = {
  DEBUG: 'DEBUG',
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR',
} as const;

export type LogLevel = (typeof LogLevel)[keyof typeof LogLevel];

export const Event = {
  API_CALL_SUCCESSFUL: 'api_call_successful',
  API_CALL_FAILED: 'api_call_failed',
  WEBSOCKET_CONNECTED: 'websocket_connection_successful',
  WEBSOCKET_CONNECTION_CLOSED: 'websocket_connection_closed',
  WEBSOCKET_CONNECTION_FAILED: 'websocket_connection_failed',
  ZERO_SOCKET_CONNECTED: 'zero_socket_connected',
  ZERO_SOCKET_CONNECTION_CLOSED: 'zero_socket_connection_closed',
  ZERO_SOCKET_CONNECTING: 'zero_socket_connecting',
  ZERO_SOCKET_DISCONNECTED: 'zero_socket_disconnected',
  ZERO_SOCKET_AUTH_REQUIRED: 'zero_socket_auth_required',
  ZERO_SOCKET_CONNECTION_ERROR: 'zero_socket_connection_error',
  ZERO_ERROR_RELOAD_INITIATED: 'zero_error_reload_initiated',
  ZERO_ERROR_RECONNECT_INITIATED: 'zero_error_reconnect_initiated',
  ZERO_ERROR_RELOAD_LIMIT_REACHED: 'zero_error_reload_limit_reached',
  LOADING_ANIMATION_HIDDEN: 'loading_animation_hidden',
  THREAD_MESSAGES_LOADED: 'thread_messages_loaded',
  ACTIVITIES_LOADED: 'activities_loaded',
  CALL_HISTORY_LOADED: 'call_history_loaded',
  VESPA_SEARCH_SESSION_START: 'vespa_search_session_start',
  VESPA_SEARCH_IMPRESSION: 'vespa_search_impression',
  VESPA_SEARCH_CLICK: 'vespa_search_click',
  VESPA_SEARCH_SESSION_END: 'vespa_search_session_end',
  VESPA_SEARCH_TAB_CLICK: 'vespa_search_tab_click',
  APP_LOADER_HIDDEN: 'app_loader_hidden',
  INITIAL_STATE_HYDRATION_COMPLETE: 'initial_state_hydration_complete',
  INITIAL_STATE_HYDRATION_FAILED: 'initial_state_hydration_failed',
  APP_REFRESH: 'app_refresh',
  SPLASH_SCREEN_HIDDEN: 'splash_screen_hidden',
  AUTH_ERROR_OCCURRED: 'auth_error_occurred',
  AUTH_REFRESH_SUCCESS: 'auth_refresh_success',
  AUTH_REFRESH_FAILED: 'auth_refresh_failed',
  CLEAR_AUTH_TOKEN_CALLED: 'clear_auth_token_called',
  QUARTO_SETUP_STARTED: 'quarto_setup_started',
  QUARTO_SETUP_SUCCESS: 'quarto_setup_success',
  QUARTO_SETUP_FAILED: 'quarto_setup_failed',
  QUARTO_ACCESS_SETUP_SUCCESS: 'quarto_access_setup_success',
  QUARTO_ACCESS_SETUP_FAILED: 'quarto_access_setup_failed',
  QUARTO_WORKSPACE_READY: 'quarto_workspace_ready',
  QUARTO_REPO_CREATED: 'quarto_repo_created',
  QUARTO_REPO_UPDATED: 'quarto_repo_updated',
  QUARTO_REPO_DELETED: 'quarto_repo_deleted',
  IDE_SETUP_STARTED: 'ide_setup_started',
  IDE_SETUP_FAILED: 'ide_setup_failed',
  IDE_WORKSPACE_READY: 'ide_workspace_ready',
  IDE_REPO_CREATED: 'ide_repo_created',
  IDE_REPO_UPDATED: 'ide_repo_updated',
  IDE_REPO_DELETED: 'ide_repo_deleted',
  API_ERROR_INTERCEPTOR_CAUGHT: 'api_error_interceptor_caught',
  AUTH_SESSION_EXPIRED: 'auth_session_expired',
  API_NETWORK_ERROR: 'api_network_error',
  API_OPERATIONAL_ERROR: 'api_operational_error',
  CANVAS_PREFETCH_STARTED: 'canvas_prefetch_started',
  CANVAS_PREFETCH_SUCCESS: 'canvas_prefetch_success',
  CANVAS_PREFETCH_FAILED: 'canvas_prefetch_failed',
  CANVAS_PREFETCH_TIMEOUT: 'canvas_prefetch_timeout',
  CANVAS_CREATED: 'canvas_created',
  CANVAS_CREATE_FAILED: 'canvas_create_failed',
  CANVAS_OPENED: 'canvas_opened',
  CANVAS_OPENED_FROM_PREFETCH: 'canvas_opened_from_prefetch',
  CANVAS_CONNECTION_ESTABLISHED: 'canvas_connection_established',
  CANVAS_CONNECTION_ERROR: 'canvas_connection_error',
  CANVAS_SYNC_COMPLETE: 'canvas_sync_complete',
  CANVAS_DELETED: 'canvas_deleted',
  CANVAS_DUPLICATED: 'canvas_duplicated',
  LIVEKIT_HEARTBEAT: 'livekit_heartbeat',
  LIVEKIT_ROOM_DISCONNECTED: 'livekit_room_disconnected',
  LIVEKIT_PARTICIPANT_DISCONNECTED: 'livekit_participant_disconnected',
} as const;

export type EventType = (typeof Event)[keyof typeof Event];

export interface LogEntry {
  sessionId: string;
  platformName: Platform;
  emailId: string | null;
  timestamp: number;
  level: LogLevel;
  event: EventType;
  latency?: number | null;
  version: string;
}

export interface LoggerConfig {
  sessionId: string;
  platformName: Platform;
  emailId?: string | null;
  notificationWsId?: string | null;
  zeroClientID?: string | null;
  zeroClientGroupID?: string | null;
}

export class Logger implements LoggerConfig {
  static readonly Event = Event;

  sessionId: string;
  platformName: Platform;
  emailId?: string | null;
  notificationWsId?: string | null;
  zeroClientID?: string | null;
  zeroClientGroupID?: string | null;
  private worker: Worker | null = null;

  constructor(config: { platform_name: Platform }) {
    this.sessionId = uuidv4();
    this.platformName = config.platform_name;

    this.initializeWorker();
  }

  private initializeWorker(): void {
    try {
      this.worker = new Worker(new URL('./logger.worker.ts', import.meta.url), {
        type: 'module',
      });

      const payload: WorkerMessage['payload'] = {
        platformName: this.platformName,
        sessionId: this.sessionId,
        loggerBaseUrl: LOGGER_BASE_URL,
        flushIntervalInMs: FLUSH_INTERVAL_IN_MS,
        maxBatchSize: MAX_BATCH_SIZE,
        maxRetries: MAX_RETRIES,
        version: '1.0',
      };
      if (this.emailId !== null) {
        payload.emailId = this.emailId;
      }

      const initMessage: WorkerMessage = {
        type: 'INIT',
        payload,
      };
      this.worker.postMessage(initMessage);
      this.worker.onerror = error => {
        console.error('Logger worker error:', error);
      };
    } catch (error) {
      console.error('Failed to initialize logger worker:', error);
    }
  }

  setEmailId(email_id: string): void {
    this.emailId = email_id;
    if (this.worker) {
      const message: WorkerMessage = {
        type: 'SET_EMAIL',
        payload: {
          emailId: email_id,
        },
      };
      this.worker.postMessage(message);
    }
  }

  setNotificationWsId(notificationWsId: string): void {
    this.notificationWsId = notificationWsId;
    if (this.worker) {
      const message: WorkerMessage = {
        type: 'SET_NOTIFICATION_WS_ID',
        payload: {
          notificationWsId: notificationWsId,
        },
      };
      this.worker.postMessage(message);
    }
  }

  setZeroClientID(zeroClientID: string): void {
    this.zeroClientID = zeroClientID;
    if (this.worker) {
      const message: WorkerMessage = {
        type: 'SET_ZERO_CLIENT_ID',
        payload: {
          zeroClientId: zeroClientID,
        },
      };
      this.worker.postMessage(message);
    }
  }

  setZeroClientGroupID(promise: Promise<string>): void {
    promise
      .then(groupId => {
        this.zeroClientGroupID = groupId;
        if (this.worker) {
          const message: WorkerMessage = {
            type: 'SET_ZERO_CLIENT_GROUP_ID',
            payload: {
              zeroClientGroupId: groupId,
            },
          };
          this.worker.postMessage(message);
        }
      })
      .catch(() => {
        this.zeroClientGroupID = null;
      });
  }

  private postLogMessage(
    level: LogLevel,
    event: EventType,
    extraFields?: Record<string, unknown>,
  ): void {
    if (this.worker) {
      const payload: WorkerMessage['payload'] = {
        level,
        event,
      };
      if (extraFields !== undefined) {
        payload.extraFields = extraFields;
      }

      const message: WorkerMessage = {
        type: 'LOG',
        payload,
      };
      this.worker.postMessage(message);
    }
  }

  debug(event: EventType, extraFields?: Record<string, unknown>): void {
    this.postLogMessage(LogLevel.DEBUG, event, extraFields);
  }

  info(event: EventType, extraFields?: Record<string, unknown>): void {
    this.postLogMessage(LogLevel.INFO, event, extraFields);
  }

  warn(event: EventType, extraFields?: Record<string, unknown>): void {
    this.postLogMessage(LogLevel.WARN, event, extraFields);
  }

  error(event: EventType, extraFields?: Record<string, unknown>): void {
    this.postLogMessage(LogLevel.ERROR, event, extraFields);
  }

  pushlogs(): void {
    if (this.worker) {
      const message: WorkerMessage = {
        type: 'FLUSH',
      };
      this.worker.postMessage(message);
    }
  }

  destroy(): void {
    if (this.worker) {
      this.pushlogs();
      this.worker.terminate();
      this.worker = null;
    }
  }
}

let loggerInstance: Logger | null = null;

export const getLogger = (): Logger => {
  if (!loggerInstance) {
    loggerInstance = new Logger({
      platform_name: detectPlatform(),
    });
    window.addEventListener('beforeunload', () => {
      if (loggerInstance) {
        loggerInstance.destroy();
        loggerInstance = null;
      }
    });
  }
  return loggerInstance;
};

export const logger = getLogger();

export const cleanupLogger = (): void => {
  if (loggerInstance) {
    loggerInstance.destroy();
    loggerInstance = null;
  }
};
