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
import { detectReactNativeWebView, reactNativeBridge } from './reactNativeBridge';

// Event constants and LogLevel are the single source of truth from shared
export { Event, LogLevel } from '@xyne/shared/logger';
export type { EventType } from '@xyne/shared/logger';

import { Event as LoggerEvent, LogLevel } from '@xyne/shared/logger';
import type { EventType } from '@xyne/shared/logger';

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

export interface LogEntry {
  clientSessionId: string;
  platformName: Platform;
  emailId: string | null;
  timestamp: number;
  level: LogLevel;
  event: EventType;
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
    event: EventType,
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

  debug(event: EventType, extraFields?: Record<string, unknown>, consoleLog?: boolean): void {
    this.postLogMessage(LogLevel.DEBUG, event, extraFields, consoleLog);
  }

  info(event: EventType, extraFields?: Record<string, unknown>, consoleLog?: boolean): void {
    this.postLogMessage(LogLevel.INFO, event, extraFields, consoleLog);
  }

  warn(event: EventType, extraFields?: Record<string, unknown>, consoleLog?: boolean): void {
    this.postLogMessage(LogLevel.WARN, event, extraFields, consoleLog);
  }

  error(event: EventType, extraFields?: Record<string, unknown>, consoleLog?: boolean): void {
    this.postLogMessage(LogLevel.ERROR, event, extraFields, consoleLog);
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
  } catch (error) {
    console.error('Error getting client session ID for logger:', error);
  }
  return null;
};

export const getLogger = async (): Promise<Logger> => {
  if (!loggerInstance) {
    const clientSessionId = await getClientSessionId();
    if (!clientSessionId) {
      console.warn('Failed to get client session ID from native, generating a new one');
    }
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

export const cleanupLogger = (): void => {
  if (loggerInstance) {
    loggerInstance.destroy();
    loggerInstance = null;
  }
};
