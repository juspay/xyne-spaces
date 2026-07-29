/**
 * Pre-Enrollment Logger for Electron
 * 
 * Lightweight logger that works before mTLS enrollment is complete.
 * Sends logs directly to backend endpoint without mTLS validation.
 * Uses the same format as dashboard logger for consistency.
 */

import log from 'electron-log/main';
import { v4 as uuidv4 } from 'uuid';
import type { EnrollmentEventType } from './enrollment-events';
import * as os from 'os';
import { net, app } from 'electron';
import si from 'systeminformation';
import { config } from '../../app/config';
import { ElectronEventType } from './electron-events';
import Store from 'electron-store';

// Create logger instance for errors and warnings only
export const errorLogger = log.create({ logId: 'error' });
errorLogger.transports.file.fileName = 'errors.log';
errorLogger.transports.file.level = 'error'; // Only error
errorLogger.transports.console.level = false; 

type EventType = EnrollmentEventType | ElectronEventType;

export const LogLevel = {
  DEBUG: 'DEBUG',
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR',
} as const;

export type LogLevel = (typeof LogLevel)[keyof typeof LogLevel];

interface LogEntry {
  clientSessionId: string;
  platformName: string;
  electronVersion: string;
  emailId: string | null;
  timestamp: string;
  level: LogLevel;
  hostname: string;
  event: EventType;
  serialNumber: string;
  preProdEnabled: boolean;
  [key: string]: unknown;
}


class LoggerService {
  private static readonly MAX_BUFFER_SIZE = 1000;
  private static readonly DROP_FAILURE_THRESHOLD = 2;

  private clientSessionId: string;
  private platformName: string;
  private electronVersion: string;
  private emailId: string | null = null;
  private logs: LogEntry[] = [];
  private flushInProgress: boolean = false;
  private flushInterval: number = 60000; // 60 seconds
  // private maxBatchSize: number = 20;
  private maxRetries: number = 3;
  private flushTimer: NodeJS.Timeout | null = null;
  private loggerUrl: string;
  private isEnabled: boolean = true;
  private store: Store;
  private consecutiveFailures: number = 0;
  private droppedLogsCount: number = 0; 
  private preProdEnabled: boolean = false;
  private serialNumber: string = '';

  constructor() {
    this.store = new Store();
    this.clientSessionId = this.getOrCreateClientSessionId();
    this.emailId = (this.store.get('userEmail') as string | undefined) ?? null;
    this.preProdEnabled = this.store.get(config.preProdKey) === true;
    this.electronVersion = app.getVersion();
    this.platformName = 
      os.platform() === 'win32' ? 'windows' : 
      os.platform() === 'darwin' ? 'macos' : 
      os.platform();
    // Use a non-mTLS endpoint for pre-enrollment logs
    this.loggerUrl = `${config.UNPROTECTED_URL}/godel/events`;
    void this.loadSerialNumber();
    this.startBackgroundFlush();
  }

  /**
   * Switch to post-enrollment (mTLS protected) endpoint
   */
  enablePostEnrollmentLogging(): void {
    this.loggerUrl = `${config.BACKEND_URL}/godel/events`;
    log.info('[EnrollmentLogger] Switched to post-enrollment endpoint:', this.loggerUrl);
  }

  /**
   * Get or create a persistent client session ID
   */
  private getOrCreateClientSessionId(): string {
    let sessionId = this.store.get('clientSessionId') as string | undefined;
    if (!sessionId) {
      sessionId = uuidv4();
      this.store.set('clientSessionId', sessionId);
    }     
    return sessionId;
  }

  getClientSessionId(): string {
    return this.clientSessionId;
  }

  /**
   * Set email ID for the user (persisted to disk so it survives restarts)
   */
  setEmailId(email: string): void {
    this.emailId = email;
    this.store.set('userEmail', email);
  }

  /**
   * Disable logger (called after enrollment is complete)
   */
  disable(): void {
    this.isEnabled = false;
    this.flushLogs();
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  /**
   * Log a debug event
   */
  debug(event: EventType, extraFields?: Record<string, unknown>, logType?: string): void {
    this.addLog(LogLevel.DEBUG, event, extraFields, logType);
  }

  /**
   * Log an info event
   */
  info(event: EventType, extraFields?: Record<string, unknown>, logType?: string): void {
    this.addLog(LogLevel.INFO, event, extraFields, logType);
  }

  /**
   * Log a warning event
   */
  warn(event: EventType, extraFields?: Record<string, unknown>, logType?: string): void {
    this.addLog(LogLevel.WARN, event, extraFields, logType);
  }

  /**
   * Log an error event
   */
  error(event: EventType, extraFields?: Record<string, unknown>, logType?: string): void {
    this.addLog(LogLevel.ERROR, event, extraFields, logType);
  }

  /**
   * Log an error with exception details
   */
  logError(event: EventType, error: unknown, extraFields?: Record<string, unknown>, logType?: string): void {
    const errorDetails = {
      ...(extraFields || {}),
      error_message: error instanceof Error ? error.message : String(error),
      error_stack: error instanceof Error ? error.stack : undefined,
    };
    this.error(event, errorDetails, logType);
  }

  /**
   * Load system serial once. systeminformation.system() can be expensive on some
   * machines, so it must not run for every log event.
   */
  private async loadSerialNumber(): Promise<void> {
    try {
      const systemInfo = await si.system();
      this.serialNumber = systemInfo.serial;
    } catch (error) {
      log.warn('[Logger] Failed to load system serial number:', error);
    }
  }

  /**
   * Add a log entry
   */
  private addLog(level: LogLevel, event: EventType, extraFields?: Record<string, unknown>, logType?: string): void {
    if (!this.isEnabled) {
      return;
    }

    const logEntry: LogEntry = {
      clientSessionId: this.clientSessionId,
      platformName: this.platformName,
      electronVersion: this.electronVersion,
      preProdEnabled: this.preProdEnabled,
      emailId: this.emailId,
      timestamp: new Date().toISOString(),
      level,
      hostname: os.hostname(),
      serialNumber: this.serialNumber,
      event,
      ...(extraFields || {}),
    };

    // Write to main log (all levels)
    log.info(`[${logType ?? 'EnrollmentLogger'}]`, JSON.stringify(logEntry));
    
    // Write to error log file (only error)
    if (level === LogLevel.ERROR) {
      errorLogger[level.toLowerCase() as 'warn' | 'error'](
        `[${logType ?? 'EnrollmentLogger'}]`,
        JSON.stringify(logEntry)
      );
    }

    if (
      this.consecutiveFailures >= LoggerService.DROP_FAILURE_THRESHOLD &&
      this.logs.length >= LoggerService.MAX_BUFFER_SIZE
    ) {
      this.logs.shift();
      this.droppedLogsCount++;
    }

    this.logs.push(logEntry);

    // Auto-flush if batch size reached
    // if (this.logs.length >= this.maxBatchSize) {
    //   this.flushLogs();
    // }
  }

  /**
   * Start background flush timer
   */
  private startBackgroundFlush(): void {
    this.flushTimer = setInterval(() => {
      if (!this.flushInProgress && this.logs.length > 0) {
        this.flushLogs();
      }
    }, this.flushInterval);
  }

  /**
   * Flush logs to backend
   */
  flushLogs(): void {
    if (this.flushInProgress || this.logs.length === 0) {
      return;
    }

    this.flushInProgress = true;
    const logsToPush = [...this.logs];
    this.logs = [];

    this.sendLogsWithRetry(logsToPush)
      .then(() => {
        this.consecutiveFailures = 0;
      })
      .catch((error) => {
        log.error('[Logger] Failed to push logs after all retries:', error);
        this.consecutiveFailures++;
        if (this.consecutiveFailures >= LoggerService.DROP_FAILURE_THRESHOLD) {
          this.droppedLogsCount += logsToPush.length;
          log.warn(
            `[Logger] Dropped ${logsToPush.length} log entries after ${this.consecutiveFailures} consecutive flush failures (total dropped: ${this.droppedLogsCount})`,
          );
        }
      })
      .finally(() => {
        this.flushInProgress = false;
      });
  }

  /**
   * Send logs with retry logic
   */
  private async sendLogsWithRetry(logs: LogEntry[]): Promise<void> {
    let lastError: unknown = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        await this.sendLogs(logs);
        return;
      } catch (error) {
        lastError = error;
        log.error(`[Logger] Attempt ${attempt + 1} failed:`, error);

        if (attempt < this.maxRetries) {
          const delayMs = Math.pow(2, attempt) * 1000; // Exponential backoff
          await this.sleep(delayMs);
        }
      }
    }

    throw lastError;
  }

  /**
   * Send logs to backend
  */
 private async sendLogs(logs: LogEntry[]): Promise<void> {
    const response = await net.fetch(this.loggerUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(logs),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text}`);
    }
    log.info(`[Logger] sent logs to backend url: ${this.loggerUrl}`);
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Export singleton instance
export const Logger = new LoggerService();
