import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import type { LogEvent } from './logger';

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface LogEntry {
  clientSessionId: string;
  platformName: string;
  emailId: string | null;
  timestamp: string;
  level: LogLevel;
  event: LogEvent;
  latency?: number | null;
  version: string;
  pageViewId?: string | null;
  pageUrl?: string | null;
  [key: string]: unknown;
}

export interface WorkerMessage {
  type:
    | 'INIT'
    | 'LOG'
    | 'SET_EMAIL'
    | 'SET_NOTIFICATION_WS_ID'
    | 'SET_ZERO_CLIENT_ID'
    | 'SET_ZERO_CLIENT_GROUP_ID'
    | 'SET_PAGE_VIEW'
    | 'FLUSH'
    | 'SHUTDOWN';
  payload?: {
    platformName?: string | undefined;
    clientSessionId?: string | undefined;
    emailId?: string | undefined;
    level?: LogLevel | undefined;
    event?: LogEvent | undefined;
    extraFields?: Record<string, unknown> | undefined;
    consoleLog?: boolean | undefined;
    logs?: LogEntry[] | undefined;
    notificationWsId?: string | undefined;
    notificationSocketState?: string | undefined;
    zeroClientId?: string | undefined;
    zeroClientGroupId?: string | undefined;
    zeroSocketState?: string | undefined;
    pageViewId?: string | null | undefined;
    pageUrl?: string | null | undefined;
    loggerBaseUrl?: string | undefined;
    flushIntervalInMs?: number | undefined;
    maxBatchSize?: number | undefined;
    maxRetries?: number | undefined;
    version?: string | undefined;
  };
}

class LoggerWorker {
  private static readonly MAX_BUFFER_SIZE = 1000;
  private static readonly DROP_FAILURE_THRESHOLD = 2;

  private clientSessionId: string = '';
  private platformName: string = '';
  private emailId: string | null = null;
  private notificationWsId: string | null = null;
  private zeroClientId: string | null = null;
  private zeroClientGroupId: string | null = null;
  private pageViewId: string | null = null;
  private pageUrl: string | null = null;
  private loggerBaseUrl: string = '';
  private version: string = '';
  private logs: LogEntry[] = [];
  private flushInProgress: boolean = false;
  private flushInterval: number = 60000;
  private maxBatchSize: number = 10;
  private maxRetries: number = 3;
  private lastFlushTime: number = Date.now();
  private flushTimer: number | null = null;
  private consecutiveFailures: number = 0;
  private droppedLogsCount: number = 0;

  constructor() {
    this.setupMessageHandler();
  }

  private setupMessageHandler(): void {
    self.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const { type, payload } = event.data;

      switch (type) {
        case 'INIT':
          this.handleInit(payload);
          break;
        case 'LOG':
          this.handleLog(payload);
          break;
        case 'SET_EMAIL':
          this.handleSetEmail(payload);
          break;
        case 'SET_NOTIFICATION_WS_ID':
          this.handleSetNotificationWsId(payload);
          break;
        case 'SET_ZERO_CLIENT_ID':
          this.handleSetZeroClientId(payload);
          break;
        case 'SET_ZERO_CLIENT_GROUP_ID':
          this.handleSetZeroClientGroupId(payload);
          break;
        case 'SET_PAGE_VIEW':
          this.handleSetPageView(payload);
          break;
        case 'FLUSH':
          this.handleFlush();
          break;
        case 'SHUTDOWN':
          this.handleShutdown();
          break;
      }
    };
  }

  private handleInit(payload?: WorkerMessage['payload']): void {
    if (payload?.platformName) {
      this.platformName = payload.platformName;
      this.clientSessionId = payload.clientSessionId ?? uuidv4();
      this.emailId = payload.emailId ?? null;
      this.loggerBaseUrl = payload.loggerBaseUrl ?? '';
      this.flushInterval = payload.flushIntervalInMs ?? 60000;
      this.maxBatchSize = payload.maxBatchSize ?? 10;
      this.maxRetries = payload.maxRetries ?? 3;
      this.version = payload.version ?? 'unknown';
      this.startBackgroundFlush();
    }
  }

  private handleLog(payload?: WorkerMessage['payload']): void {
    if (payload?.level !== undefined && payload?.event) {
      const logEntry: LogEntry = {
        clientSessionId: this.clientSessionId,
        platformName: this.platformName,
        emailId: this.emailId,
        timestamp: new Date(Date.now()).toISOString(),
        level: payload.level,
        event: payload.event,
        version: this.version,
        ...(payload.extraFields ?? {}),
      };

      if (this.notificationWsId !== null) {
        (logEntry as Record<string, unknown>)['notificationWsId'] = this.notificationWsId;
      }
      if (payload.notificationSocketState !== undefined) {
        (logEntry as Record<string, unknown>)['notificationSocketState'] =
          payload.notificationSocketState;
      }
      if (this.zeroClientId !== null) {
        (logEntry as Record<string, unknown>)['zeroClientId'] = this.zeroClientId;
      }
      if (this.zeroClientGroupId !== null) {
        (logEntry as Record<string, unknown>)['zeroClientGroupId'] = this.zeroClientGroupId;
      }
      if (payload.zeroSocketState !== undefined) {
        (logEntry as Record<string, unknown>)['zeroSocketState'] = payload.zeroSocketState;
      }
      if (this.pageViewId !== null) {
        (logEntry as Record<string, unknown>)['pageViewId'] = this.pageViewId;
      }
      if (this.pageUrl !== null) {
        (logEntry as Record<string, unknown>)['pageUrl'] = this.pageUrl;
      }

      if (
        this.consecutiveFailures >= LoggerWorker.DROP_FAILURE_THRESHOLD &&
        this.logs.length >= LoggerWorker.MAX_BUFFER_SIZE
      ) {
        this.logs.shift();
        this.droppedLogsCount++;
      }

      this.logs.push(logEntry);
    }
  }

  private handleSetEmail(payload?: WorkerMessage['payload']): void {
    if (payload?.emailId) {
      this.emailId = payload.emailId;
    }
  }

  private handleSetNotificationWsId(payload?: WorkerMessage['payload']): void {
    if (payload?.notificationWsId) {
      this.notificationWsId = payload.notificationWsId;
    }
  }

  private handleSetZeroClientId(payload?: WorkerMessage['payload']): void {
    if (payload?.zeroClientId) {
      this.zeroClientId = payload.zeroClientId;
    }
  }

  private handleSetZeroClientGroupId(payload?: WorkerMessage['payload']): void {
    if (payload?.zeroClientGroupId) {
      this.zeroClientGroupId = payload.zeroClientGroupId;
    }
  }

  private handleSetPageView(payload?: WorkerMessage['payload']): void {
    if (payload?.pageViewId !== undefined && payload?.pageUrl !== undefined) {
      this.pageViewId = payload.pageViewId;
      this.pageUrl = payload.pageUrl;
    }
  }

  private handleFlush(): void {
    void this.flushLogs();
  }

  private handleShutdown(): void {
    if (this.flushTimer !== null) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    void this.flushLogs();
  }

  private startBackgroundFlush(): void {
    this.flushTimer = self.setInterval(() => {
      void (async () => {
        const currentTime = Date.now();
        const timeElapsed = currentTime - this.lastFlushTime;
        if (
          !this.flushInProgress &&
          (this.logs.length >= this.maxBatchSize || timeElapsed >= this.flushInterval)
        ) {
          await this.flushLogs();
          this.lastFlushTime = currentTime;
        }
      })();
    }, this.flushInterval);
  }

  private async flushLogs(): Promise<void> {
    if (this.flushInProgress) {
      return;
    }

    this.flushInProgress = true;

    const logsToPush = this.flushAndGetLogBatch();
    if (logsToPush.length > 0) {
      try {
        const url = this.loggerBaseUrl;
        await this.sendLogsWithRetry(url, logsToPush);
        this.consecutiveFailures = 0;
      } catch {
        this.consecutiveFailures++;

        const combined = [...logsToPush, ...this.logs];
        if (
          this.consecutiveFailures >= LoggerWorker.DROP_FAILURE_THRESHOLD &&
          combined.length > LoggerWorker.MAX_BUFFER_SIZE
        ) {
          const dropped = combined.length - LoggerWorker.MAX_BUFFER_SIZE;
          this.droppedLogsCount += dropped;
          this.logs = combined.slice(combined.length - LoggerWorker.MAX_BUFFER_SIZE);
        } else {
          this.logs = combined;
        }
      }
    }

    this.flushInProgress = false;
  }

  private flushAndGetLogBatch(): LogEntry[] {
    const logsToPush = [...this.logs];
    this.logs = [];
    return logsToPush;
  }

  private async sendLogsWithRetry(url: string, logs: LogEntry[]): Promise<void> {
    let lastError: unknown = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        await axios.post(url, logs, {
          headers: {
            'Content-Type': 'application/json',
          },
        });

        return;
      } catch (error) {
        lastError = error;

        if (attempt < this.maxRetries) {
          const delayMs = Math.pow(2, attempt) * 60000;
          await this.sleep(delayMs);
        }
      }
    }

    throw lastError;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
new LoggerWorker();
