/**
 * Centralized logger utility for consistent logging across the test automation codebase.
 * Provides prefixed log messages with timestamps and log levels.
 * Supports nested prefixes for hierarchical logging (e.g., [Cucumber] [API]).
 *
 * In CI/test mode (environment='test'), logs are written to a file only.
 */

import * as fs from 'fs';
import * as path from 'path';

import { environment } from '@/config';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LoggerOptions {
  prefix: string;
  showTimestamp?: boolean;
  parentPrefix?: string;
}

// Check if running in test mode based on config environment
function isTestMode(): boolean {
  return environment === 'test';
}

// Get log directory - use /app/report if in container, ./report otherwise
function getLogDir(): string {
  if (fs.existsSync('/app')) {
    return '/app/report';
  }
  return './report';
}

// Create a write stream for file logging in CI mode
let logStream: fs.WriteStream | null = null;
let logStreamError: boolean = false;

function getLogStream(): fs.WriteStream | null {
  if (logStreamError) {
    return null;
  }

  if (!logStream) {
    try {
      const logDir = getLogDir();
      const logFile = path.join(logDir, 'automation.log');
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }
      logStream = fs.createWriteStream(logFile, { flags: 'a' });

      logStream.on('error', (err) => {
        logStreamError = true;
        console.error(`[Logger] File stream error: ${err.message}`);
        logStream = null;
      });
    } catch (err) {
      logStreamError = true;
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`[Logger] Failed to initialize log file: ${errorMessage}`);
      return null;
    }
  }
  return logStream;
}

function writeToFile(message: string): void {
  try {
    const stream = getLogStream();
    if (stream && !stream.destroyed) {
      const success = stream.write(message + '\n');
      if (!success && !logStreamError) {
        console.warn('[Logger] Write buffer full, some logs may be delayed');
      }
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[Logger] Failed to write to log file: ${errorMessage}`);
  }
}

class Logger {
  private prefix: string;
  private showTimestamp: boolean;
  private parentPrefix?: string;

  constructor(options: LoggerOptions) {
    this.prefix = options.prefix;
    this.showTimestamp = options.showTimestamp ?? false;
    this.parentPrefix = options.parentPrefix;
  }

  private formatMessage(level: LogLevel, message: string): string {
    const timestamp = this.showTimestamp ? `[${new Date().toISOString()}] ` : '';
    const levelIcon = this.getLevelIcon(level);
    const parentPart = this.parentPrefix ? `[${this.parentPrefix}] ` : '';
    return `${timestamp}${parentPart}[${this.prefix}] ${levelIcon}${message}`;
  }

  private getLevelIcon(level: LogLevel): string {
    switch (level) {
      case 'debug':
        return '🔍 ';
      case 'info':
        return '';
      case 'warn':
        return '⚠️ ';
      case 'error':
        return '❌ ';
      default:
        return '';
    }
  }

  private output(level: LogLevel, message: string, args: unknown[]): void {
    const formattedMessage = this.formatMessage(level, message);
    const argsStr = args.length > 0 ? ' ' + args.map((a) => JSON.stringify(a)).join(' ') : '';

    // Always write to file
    writeToFile(formattedMessage + argsStr);

    // In local mode (not test), also print to console
    if (!isTestMode()) {
      switch (level) {
        case 'debug':
          console.debug(formattedMessage, ...args);
          break;
        case 'warn':
          console.warn(formattedMessage, ...args);
          break;
        case 'error':
          console.error(formattedMessage, ...args);
          break;
        default:
          console.log(formattedMessage, ...args);
      }
    }
  }

  debug(message: string, ...args: unknown[]): void {
    this.output('debug', message, args);
  }

  info(message: string, ...args: unknown[]): void {
    this.output('info', message, args);
  }

  warn(message: string, ...args: unknown[]): void {
    this.output('warn', message, args);
  }

  error(message: string, ...args: unknown[]): void {
    this.output('error', message, args);
  }

  success(message: string, ...args: unknown[]): void {
    this.output('info', `✅ ${message}`, args);
  }

  fail(message: string, ...args: unknown[]): void {
    this.output('info', `❌ ${message}`, args);
  }

  /**
   * Create a child logger that inherits this logger's prefix as parent
   */
  child(childPrefix: string): Logger {
    const fullParentPrefix = this.parentPrefix
      ? `${this.parentPrefix}] [${this.prefix}`
      : this.prefix;
    return new Logger({
      prefix: childPrefix,
      showTimestamp: this.showTimestamp,
      parentPrefix: fullParentPrefix,
    });
  }
}

/**
 * Create a logger instance with a specific prefix
 */
export function createLogger(prefix: string, showTimestamp = false): Logger {
  return new Logger({ prefix, showTimestamp });
}

/**
 * Create a child logger with a parent prefix
 * This creates logs formatted as [parentPrefix] [prefix] message
 */
function createChildLogger(parentPrefix: string, prefix: string, showTimestamp = false): Logger {
  return new Logger({ prefix, showTimestamp, parentPrefix });
}

/**
 * Flush and close the log stream (call at end of test run)
 */
export function closeLogger(): Promise<void> {
  return new Promise((resolve) => {
    if (logStream) {
      logStream.end(() => {
        logStream = null;
        resolve();
      });
    } else {
      resolve();
    }
  });
}

// Pre-configured loggers for common use cases
export const cucumberLogger = createLogger('Cucumber');

// Test type loggers - nested under Cucumber for consistent formatting
// Output format: [Cucumber] [API] message
export const apiLogger = createChildLogger('Cucumber', 'API');
export const e2eLogger = createChildLogger('Cucumber', 'E2E');
export const uiLogger = createChildLogger('Cucumber', 'UI');
export const browserLogger = createChildLogger('Cucumber', 'Browser');

export { Logger };
