/**
 * Logging abstraction to replace console.log usage
 */

export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
  OFF = 'off'
}

export interface LogEntry {
  readonly level: LogLevel;
  readonly message: string;
  readonly timestamp: Date;
  readonly context?: Record<string, unknown>;
  readonly error?: Error;
}

export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, error?: Error, context?: Record<string, unknown>): void;
  setLevel(level: LogLevel): void;
}

/**
 * Simple logger implementation that respects ESLint no-console rule
 */
class SimpleLogger implements Logger {
  private minLevel: LogLevel = LogLevel.OFF;

  public setLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  private shouldLog(level: LogLevel): boolean {
    // If logging is turned OFF, don't log anything
    if (this.minLevel === LogLevel.OFF) {
      return false;
    }
    
    const levels = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR];
    const levelIndex = levels.indexOf(level);
    const minLevelIndex = levels.indexOf(this.minLevel);
    return levelIndex >= minLevelIndex;
  }

  private log(level: LogLevel, message: string, error?: Error, context?: Record<string, unknown>): void {
    if (!this.shouldLog(level)) {
      return;
    }
    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date(),
      ...(context && { context }),
      ...(error && { error })
    };
    
    // In production, this would integrate with proper logging service
    // For now, we'll use a simple implementation that doesn't violate ESLint
    if (typeof process !== 'undefined' && process.env['NODE_ENV'] !== 'test') {
      const logMessage = `[${entry.timestamp.toISOString()}] ${level.toUpperCase()}: ${message}`;
      const logData = context ? ` | Context: ${JSON.stringify(context)}` : '';
      const errorData = error ? ` | Error: ${error.message}` : '';
      
      process.stdout.write(`${logMessage}${logData}${errorData}\n`);
    }
  }

  public debug(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.DEBUG, message, undefined, context);
  }

  public info(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.INFO, message, undefined, context);
  }

  public warn(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.WARN, message, undefined, context);
  }

  public error(message: string, error?: Error, context?: Record<string, unknown>): void {
    this.log(LogLevel.ERROR, message, error, context);
  }
}

export const logger: Logger = new SimpleLogger();