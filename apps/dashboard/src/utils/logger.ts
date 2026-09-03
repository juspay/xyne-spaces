import { type Platform } from '../hooks/usePlatform';
import { detectPlatform } from '../hooks/usePlatform';
import {
  FLUSH_INTERVAL_IN_MS,
  LOGGER_BASE_URL,
  MAX_BATCH_SIZE,
  MAX_RETRIES,
  isLocalhost,
} from '../config';
import type { WorkerMessage } from './logger.worker';
import { v4 as uuidv4 } from 'uuid';
import {
  detectReactNativeWebView,
  reactNativeBridge,
  setReactNativeBridgeLogger,
} from './reactNativeBridge';

import { Event as LoggerEvent, LogLevel } from '@xyne/shared/logger';

// EventType remains explicit here to document the typed telemetry subset.
// eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
export type LogEvent = EventType | string;

const ERROR_DEDUP_WINDOW_IN_MS = 5_000;
const MAX_LIBRARY_STACK_FRAMES = 3;
const SENSITIVE_KEYS = new Set(['config', 'request', 'response', 'headers', 'options']);

const redact = (value: string): string =>
  value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(
      /\b(authorization|token|password|secret|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi,
      '$1=[REDACTED]',
    );

const isLibraryStackFrame = (line: string): boolean =>
  /(?:[/\\]node_modules[/\\]|\bnode:[^)\s]+|\bat (?:async )?internal[/\\])/.test(line);

export const limitLibraryStackFrames = (stack: string): string => {
  let libraryFrames = 0;

  return stack
    .split('\n')
    .filter((line, index) => {
      if (index === 0 || !isLibraryStackFrame(line)) return true;
      libraryFrames += 1;
      return libraryFrames <= MAX_LIBRARY_STACK_FRAMES;
    })
    .join('\n');
};

const stackFor = (error: Error): string | undefined =>
  error.stack ? redact(limitLibraryStackFrames(error.stack)) : undefined;

const serializeError = (value: unknown): Record<string, unknown> => {
  if (!(value instanceof Error)) {
    return {
      name: 'NonError',
      message: redact(typeof value === 'string' ? value : String(value)),
    };
  }

  return {
    name: value.name,
    message: redact(value.message),
    stack: stackFor(value),
  };
};

const findError = (value: unknown, depth = 0): Error | undefined => {
  if (value instanceof Error) return value;
  if (!value || typeof value !== 'object') return undefined;

  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(key)) continue;
    if (item instanceof Error) return item;
    if (depth === 0) {
      const nestedError = findError(item, depth + 1);
      if (nestedError) return nestedError;
    }
  }
  return undefined;
};

export const NotificationSocketState = {
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
} as const;

export type NotificationSocketState =
  (typeof NotificationSocketState)[keyof typeof NotificationSocketState];

export const ZeroSocketState = {
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
  NEEDS_AUTH: 'needs-auth',
  ERROR: 'error',
  CLOSED: 'closed',
} as const;

export type ZeroSocketState = (typeof ZeroSocketState)[keyof typeof ZeroSocketState];

export const Event = {
  ...LoggerEvent,
  CONVERSATION_PREFERCH_ERROR: 'conversation_prefetch_error',
  ATTACHMENT_FILES_SELECTED: 'attachment_files_selected',
  ATTACHMENT_VALIDATION_FAILED: 'attachment_validation_failed',
  ATTACHMENT_LIMIT_REACHED: 'attachment_limit_reached',
  ATTACHMENT_PASTE_DETECTED: 'attachment_paste_detected',
  ATTACHMENT_LARGE_TEXT_CONVERTED: 'attachment_large_text_converted',
  ATTACHMENT_THUMBNAIL_FAILED: 'attachment_thumbnail_failed',
  ATTACHMENT_UPLOAD_STARTED: 'attachment_upload_started',
  ATTACHMENT_UPLOAD_SUCCESS: 'attachment_upload_success',
  ATTACHMENT_UPLOAD_FAILED: 'attachment_upload_failed',
  DRAFT_ATTACHMENTS_LOAD_FAILED: 'draft_attachments_load_failed',
  MESSAGE_SENT: 'message_sent',
  MESSAGE_SEND_FAILED: 'message_send_failed',
  MESSAGE_DELETED: 'message_deleted',
  MESSAGE_DELETE_FAILED: 'message_delete_failed',
  MESSAGE_FORWARDED: 'message_forwarded',
  MESSAGE_FORWARD_FAILED: 'message_forward_failed',
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
  VESPA_SEARCH_SHOW_RESULTS: 'vespa_search_show_results',
  APP_LOADER_HIDDEN: 'app_loader_hidden',
  INITIAL_STATE_HYDRATION_COMPLETE: 'initial_state_hydration_complete',
  INITIAL_STATE_HYDRATION_FAILED: 'initial_state_hydration_failed',
  APP_REFRESH: 'app_refresh',
  SPLASH_SCREEN_HIDDEN: 'splash_screen_hidden',
  AUTH_ERROR_OCCURRED: 'auth_error_occurred',
  AUTH_REFRESH_SUCCESS: 'auth_refresh_success',
  AUTH_REFRESH_FAILED: 'auth_refresh_failed',
  CLEAR_AUTH_TOKEN_CALLED: 'clear_auth_token_called',
  ZERO_CACHED_QUERY_CALLED: 'zero_cached_query_called',
  ZERO_CACHED_QUERY_COMPLETE: 'zero_cached_query_complete',
  ZERO_CACHED_QUERY_ERROR: 'zero_cached_query_error',
  ZERO_MUTATION_CALLED: 'zero_mutation_called',
  ZERO_MUTATION_COMPLETE: 'zero_mutation_complete',
  ZERO_MUTATION_ERROR: 'zero_mutation_error',
  ZERO_QUERY_CALLED: 'zero_query_called',
  ZERO_QUERY_COMPLETE: 'zero_query_complete',
  ZERO_QUERY_FAILED: 'zero_query_failed',
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
  // Canvas load lifecycle (debug slow loading)
  CANVAS_LOAD_STARTED: 'canvas_load_started',
  CANVAS_LOAD_FROM_STATE: 'canvas_load_from_state',
  CANVAS_LOAD_COMPLETE: 'canvas_load_complete',
  CANVAS_LOAD_SLOW: 'canvas_load_slow',
  CANVAS_LOAD_EMPTY: 'canvas_load_empty',
  CANVAS_EDITOR_MOUNTED: 'canvas_editor_mounted',
  // Canvas save lifecycle (debug save-not-happening)
  CANVAS_SAVE_REQUESTED: 'canvas_save_requested',
  CANVAS_SAVE_SKIPPED_UNCHANGED: 'canvas_save_skipped_unchanged',
  CANVAS_SAVE_SKIPPED_NO_CANVAS: 'canvas_save_skipped_no_canvas',
  CANVAS_SAVE_BLOCKED: 'canvas_save_blocked',
  CANVAS_SAVE_STARTED: 'canvas_save_started',
  CANVAS_SAVE_COMPLETE: 'canvas_save_complete',
  CANVAS_SAVE_FAILED: 'canvas_save_failed',
  CANVAS_SAVE_SLOW: 'canvas_save_slow',
  CANVAS_SAVE_RERUN_QUEUED: 'canvas_save_rerun_queued',
  CANVAS_AUTOSAVE_TRIGGERED: 'canvas_autosave_triggered',
  CANVAS_TITLE_SAVED: 'canvas_title_saved',
  LIVEKIT_HEARTBEAT: 'livekit_heartbeat',
  LIVEKIT_ROOM_DISCONNECTED: 'livekit_room_disconnected',
  LIVEKIT_PARTICIPANT_DISCONNECTED: 'livekit_participant_disconnected',
  LIVEKIT_SOCKET_CONNECTING: 'livekit_socket_connecting',
  LIVEKIT_SOCKET_CONNECTED: 'livekit_socket_connected',
  LIVEKIT_SOCKET_RECONNECTING: 'livekit_socket_reconnecting',
  LIVEKIT_SOCKET_DISCONNECTED: 'livekit_socket_disconnected',
  LIVEKIT_RTC_CONNECTING: 'livekit_rtc_connecting',
  LIVEKIT_RTC_CONNECTED: 'livekit_rtc_connected',
  LIVEKIT_RTC_DISCONNECTED: 'livekit_rtc_disconnected',
  LIVEKIT_TRACK_PUBLISHED: 'livekit_track_published',
  LIVEKIT_TRACK_SUBSCRIBED: 'livekit_track_subscribed',
  LIVEKIT_TRACK_UNSUBSCRIBED: 'livekit_track_unsubscribed',
  LIVEKIT_TRACK_MUTE_CHANGED: 'livekit_track_mute_changed',
  LIVEKIT_TRACK_SUBSCRIPTION_FAILED: 'livekit_track_subscription_failed',
  LIVEKIT_SCREEN_SHARE_RENDERED: 'livekit_screen_share_rendered',
  LIVEKIT_ROOM_EVENT: 'livekit_room_event',
  CANVAS_MENTION_DEBUG: 'canvas_mention_debug',
  CANVAS_EXPORT_FAILED: 'canvas_export_failed',
  SHARE_RECORDING: 'share_recording',
  SHARE_RECORDING_ERROR: 'share_recording_error',
  RECORDING_STATE_CHANGED: 'recording_state_changed',
  RECORDING_STARTED: 'recording_started',
  RECORDING_STOPPED: 'recording_stopped',
  RECORDING_ERROR: 'recording_error',
  ZERO_RUN_ERROR: 'zero_run_error',
  ZERO_RUN_COMPLETE: 'zero_run_complete',
  ZERO_RUN_CALLED: 'zero_run_called',
  THREAD_CONTEXT_BUTTON_CLICKED: 'thread_context_button_clicked',
  THREAD_CONTEXT_SUBMITTED: 'thread_context_submitted',
  KANBAN_ENTITY_LOADED: 'kanban_entity_loaded',
} as const;

export type EventType = (typeof Event)[keyof typeof Event];
const normalizeDedupValue = (value: unknown, seen: WeakSet<object> = new WeakSet()): unknown => {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') {
    return String(value);
  }
  if (value instanceof Error) {
    return serializeError(value);
  }
  if (typeof value !== 'object') {
    return Object.prototype.toString.call(value);
  }
  if (seen.has(value)) {
    return '[Circular]';
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map(item => normalizeDedupValue(item, seen));
  }
  return Object.keys(value as Record<string, unknown>)
    .sort()
    .reduce<Record<string, unknown>>((normalized, key) => {
      normalized[key] = normalizeDedupValue((value as Record<string, unknown>)[key], seen);
      return normalized;
    }, {});
};

const createErrorDedupKey = (
  event: LogEvent,
  stack: string,
  extraFields?: Record<string, unknown>,
): string =>
  JSON.stringify({
    event,
    stack,
    extraFields: normalizeDedupValue(extraFields ?? {}),
  });

export interface LogEntry {
  clientSessionId: string;
  platformName: Platform;
  emailId: string | null;
  timestamp: number;
  level: LogLevel;
  event: LogEvent;
  latency?: number | null;
  version: string;
  pageViewId?: string | null;
  pageUrl?: string | null;
}

export interface LoggerConfig {
  clientSessionId: string;
  platformName: Platform;
  emailId?: string | null;
  notificationWsId?: string | null;
  zeroClientId?: string | null;
  zeroClientGroupId?: string | null;
}

export class Logger implements LoggerConfig {
  static readonly Event = LoggerEvent;

  clientSessionId: string;
  platformName: Platform;
  emailId?: string | null;
  notificationWsId?: string | null;
  zeroClientId?: string | null;
  zeroClientGroupId?: string | null;
  private worker: Worker | null = null;
  private notificationSocketState: NotificationSocketState = NotificationSocketState.DISCONNECTED;
  private zeroSocketState: ZeroSocketState = ZeroSocketState.DISCONNECTED;
  private pageViewId: string | null = null;
  private pageUrl: string | null = null;
  private recentErrors = new Map<string, number>();

  constructor(config: { clientSessionId: string; platform_name: Platform }) {
    this.clientSessionId = config.clientSessionId;
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
        clientSessionId: this.clientSessionId,
        loggerBaseUrl: LOGGER_BASE_URL,
        flushIntervalInMs: FLUSH_INTERVAL_IN_MS,
        maxBatchSize: MAX_BATCH_SIZE,
        maxRetries: MAX_RETRIES,
        version: __APP_VERSION__,
      };
      if (this.emailId !== null) {
        payload.emailId = this.emailId;
      }

      const initMessage: WorkerMessage = {
        type: 'INIT',
        payload,
      };
      this.worker.postMessage(initMessage);
    } catch {
      /* Intentionally ignored. */
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

  setZeroClientId(zeroClientId: string): void {
    this.zeroClientId = zeroClientId;
    if (this.worker) {
      const message: WorkerMessage = {
        type: 'SET_ZERO_CLIENT_ID',
        payload: {
          zeroClientId: zeroClientId,
        },
      };
      this.worker.postMessage(message);
    }
  }

  setZeroClientGroupId(promise: Promise<string>): void {
    promise
      .then(groupId => {
        this.zeroClientGroupId = groupId;
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
        this.zeroClientGroupId = null;
      });
  }

  setNotificationSocketState(state: NotificationSocketState): void {
    this.notificationSocketState = state;
  }

  setZeroSocketState(state: ZeroSocketState): void {
    this.zeroSocketState = state;
  }

  setPageView(pageViewId: string, pageUrl: string): void {
    this.pageViewId = pageViewId;
    this.pageUrl = pageUrl;
    if (this.worker) {
      const message: WorkerMessage = {
        type: 'SET_PAGE_VIEW',
        payload: {
          pageViewId,
          pageUrl,
        },
      };
      this.worker.postMessage(message);
    }
  }

  private postLogMessage(
    level: LogLevel,
    event: LogEvent,
    extraFields?: Record<string, unknown>,
    consoleLog?: boolean,
  ): void {
    const shouldConsoleLog = consoleLog ?? isLocalhost;
    if (this.worker) {
      const payload: WorkerMessage['payload'] = {
        level,
        event,
        notificationSocketState: this.notificationSocketState,
        zeroSocketState: this.zeroSocketState,
        pageViewId: this.pageViewId,
        pageUrl: this.pageUrl,
        consoleLog: shouldConsoleLog,
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

  debug(event: LogEvent, extraFields?: Record<string, unknown>, consoleLog?: boolean): void {
    this.postLogMessage(LogLevel.DEBUG, event, extraFields, consoleLog);
  }

  info(event: LogEvent, extraFields?: Record<string, unknown>, consoleLog?: boolean): void {
    this.postLogMessage(LogLevel.INFO, event, extraFields, consoleLog);
  }

  warn(event: LogEvent, extraFields?: Record<string, unknown>, consoleLog?: boolean): void {
    this.postLogMessage(LogLevel.WARN, event, extraFields, consoleLog);
  }

  error(event: LogEvent, extraFields?: Record<string, unknown>, consoleLog?: boolean): void {
    const message = extraFields?.['message'];
    const error =
      findError(extraFields ?? {}) ?? new Error(typeof message === 'string' ? message : event);
    const serializedError = serializeError(error);
    const stack = typeof serializedError['stack'] === 'string' ? serializedError['stack'] : '';
    const now = Date.now();
    const dedupKey = createErrorDedupKey(event, stack, extraFields);
    const previous = this.recentErrors.get(dedupKey);
    for (const [key, timestamp] of this.recentErrors) {
      if (now - timestamp > ERROR_DEDUP_WINDOW_IN_MS) {
        this.recentErrors.delete(key);
      }
    }
    if (previous && now - previous < ERROR_DEDUP_WINDOW_IN_MS) return;
    this.recentErrors.set(dedupKey, now);
    this.postLogMessage(
      LogLevel.ERROR,
      event,
      {
        ...extraFields,
        error: serializedError,
        release: __APP_VERSION__,
      },
      consoleLog,
    );
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

const getClientSessionId = async (): Promise<string | null> => {
  try {
    if (window.electronAPI?.getClientSessionId) {
      return await window.electronAPI.getClientSessionId();
    } else if (detectReactNativeWebView() && reactNativeBridge.isAvailable()) {
      return await reactNativeBridge.getClientSessionId();
    }
  } catch {
    /* Intentionally ignored. */
  }
  return null;
};

export const getLogger = async (): Promise<Logger> => {
  if (!loggerInstance) {
    const clientSessionId = await getClientSessionId();
    loggerInstance = new Logger({
      clientSessionId: clientSessionId ?? uuidv4(),
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

export const logger = await getLogger();
setReactNativeBridgeLogger(logger);

export const cleanupLogger = (): void => {
  if (loggerInstance) {
    loggerInstance.destroy();
    loggerInstance = null;
  }
};
