/**
 * Pre-Enrollment Logger for Electron
 * 
 * Lightweight logger that works before mTLS enrollment is complete.
 * Sends logs directly to backend endpoint without mTLS validation.
 * Uses the same format as dashboard logger for consistency.
 */

import log from 'electron-log/main';
import { v4 as uuidv4 } from 'uuid';
import type { EnrollmentEventType, LogLevel } from './enrollment-events';
import * as os from 'os';
import { net } from 'electron';
import si from 'systeminformation';
import { config } from '../../app/config';

interface LogEntry {
  sessionId: string;
  platformName: string;
  emailId: string | null;
  timestamp: string;
  level: LogLevel;
  hostname: string;
  event: EnrollmentEventType;
  [key: string]: unknown;
}

const LogLevelNames: Record<LogLevel, string> = {
  0: 'DEBUG',
  1: 'INFO',
  2: 'WARN',
  3: 'ERROR',
};

class PreEnrollmentLogger {
  private sessionId: string;
  private platformName: string = 'electron';
  private emailId: string | null = null;
  private logs: LogEntry[] = [];
  private flushInProgress: boolean = false;
  private flushInterval: number = 60000; // 60 seconds
  private maxBatchSize: number = 10;
  private maxRetries: number = 3;
  private flushTimer: NodeJS.Timeout | null = null;
  private loggerUrl: string;
  private isEnabled: boolean = true;

  constructor() {
    this.sessionId = uuidv4();
    // Use a non-mTLS endpoint for pre-enrollment logs
    this.loggerUrl = `${config.UNPROTECTED_URL}/godel/events`;
    this.startBackgroundFlush();
  }

  /**
   * Set email ID for the user
   */
  setEmailId(email: string): void {
    this.emailId = email;
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
  debug(event: EnrollmentEventType, extraFields?: Record<string, unknown>): void {
    this.addLog(0, event, extraFields);
  }

  /**
   * Log an info event
   */
  info(event: EnrollmentEventType, extraFields?: Record<string, unknown>): void {
    this.addLog(1, event, extraFields);
  }

  /**
   * Log a warning event
   */
  warn(event: EnrollmentEventType, extraFields?: Record<string, unknown>): void {
    this.addLog(2, event, extraFields);
  }

  /**
   * Log an error event
   */
  error(event: EnrollmentEventType, extraFields?: Record<string, unknown>): void {
    this.addLog(3, event, extraFields);
  }

  /**
   * Log an error with exception details
   */
  logError(event: EnrollmentEventType, error: unknown, extraFields?: Record<string, unknown>): void {
    const errorDetails = {
      ...(extraFields || {}),
      error_message: error instanceof Error ? error.message : String(error),
      error_stack: error instanceof Error ? error.stack : undefined,
    };
    this.error(event, errorDetails);
  }

  /**
   * Add a log entry
   */
  private async addLog(level: LogLevel, event: EnrollmentEventType, extraFields?: Record<string, unknown>): Promise<void> {
    if (!this.isEnabled) {
      return;
    }

    const systemInfo = await si.system();

    const logEntry: LogEntry = {
      sessionId: this.sessionId,
      platformName: this.platformName,
      emailId: this.emailId,
      timestamp: new Date().toISOString(),
      level,
      hostname: os.hostname(),
      serialNumber: systemInfo.serial,
      event,
      ...(extraFields || {}),
    };

    const logEntryWithLevelName = {
      ...logEntry,
      level: LogLevelNames[level] ?? 'UNKNOWN',
    };

    log.info('[EnrollmentLogger]', JSON.stringify(logEntryWithLevelName));
    this.logs.push(logEntry);

    // Auto-flush if batch size reached
    if (this.logs.length >= this.maxBatchSize) {
      this.flushLogs();
    }
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
      .catch((error) => {
        log.error('[EnrollmentLogger] Failed to push logs after all retries:', error);
        // Re-add logs to queue on failure
        this.logs.unshift(...logsToPush);
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
        log.error(`[EnrollmentLogger] Attempt ${attempt + 1} failed:`, error);

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
   // In local/dev environment, only send logs if explicitly allowed via env variable
   if (process.env.NODE_ENV === 'development') {
     if (!config.sendLogs) {
       return;
      }
    }
    
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
    log.info(`[EnrollmentLogger] sent logs to backend url: ${this.loggerUrl}`);
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Export singleton instance
export const Logger = new PreEnrollmentLogger();
