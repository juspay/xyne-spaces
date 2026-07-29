/** biome-ignore-all lint/suspicious/noConsole: logger intentionally uses console for local output and bootstrap failures */
import * as fs from 'node:fs';
import * as path from 'node:path';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  pid: number;
  runner: string;
  prefix: string;
  message: string;
  args?: unknown[];
}

function shouldLogToConsole(): boolean {
  return process.env.XYNE_LOG_TO_STDOUT !== 'false';
}

let logFileLabel = `runner-${process.pid}`;

function getRunnerLabel(): string {
  const parts = logFileLabel.split('/');
  if (parts.length >= 2) return parts[parts.length - 2];
  return 'main';
}

function getLogDir(): string {
  if (process.env.XYNE_RUN_ARTIFACT_DIR) {
    return process.env.XYNE_RUN_ARTIFACT_DIR;
  }

  if (fs.existsSync('/app')) {
    return '/app/reports';
  }

  return './reports';
}

let logStream: fs.WriteStream | null = null;
let logStreamError = false;

export function setLoggerFileLabel(label: string): void {
  if (label === logFileLabel) {
    return;
  }

  logFileLabel = label;

  if (logStream) {
    logStream.end();
    logStream = null;
  }
}

export function getLoggerFilePath(): string {
  return path.join(getLogDir(), `${logFileLabel}.log`);
}

function getLogStream(): fs.WriteStream | null {
  if (logStreamError) {
    return null;
  }

  if (!logStream) {
    try {
      const logFile = getLoggerFilePath();
      const logDir = path.dirname(logFile);

      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }

      logStream = fs.createWriteStream(logFile, { flags: 'w' });
      logStream.on('error', (error) => {
        logStreamError = true;
        console.error(`[Logger] File stream error: ${error.message}`);
        logStream = null;
      });
    } catch (error) {
      logStreamError = true;
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[Logger] Failed to initialize log file: ${errorMessage}`);
      return null;
    }
  }

  return logStream;
}

function writeToFile(entry: LogEntry): void {
  try {
    const stream = getLogStream();

    if (stream && !stream.destroyed) {
      const success = stream.write(`${JSON.stringify(entry)}\n`);
      if (!success && !logStreamError) {
        console.warn('[Logger] Write buffer full, some logs may be delayed');
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[Logger] Failed to write to log file: ${errorMessage}`);
  }
}

function writeToConsole(level: LogLevel, formattedMessage: string, args: unknown[]): void {
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

class Logger {
  private readonly prefix: string;

  constructor(prefix: string) {
    this.prefix = prefix;
  }

  private formatMessage(level: LogLevel, message: string): string {
    const levelIcon = this.getLevelIcon(level);
    const runnerPart = `[runner:  ${getRunnerLabel()}]`;
    const prefixPart = this.prefix ? `[${this.prefix}] ` : '';

    return `${runnerPart}${prefixPart}${levelIcon}${message}`;
  }

  private getLevelIcon(level: LogLevel): string {
    switch (level) {
      case 'debug':
        return '🔍 ';
      case 'warn':
        return '⚠️ ';
      case 'error':
        return '❌ ';
      default:
        return '';
    }
  }

  private output(level: LogLevel, message: string, args: unknown[]): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      pid: process.pid,
      runner: getRunnerLabel(),
      prefix: this.prefix,
      message,
      args: args.length > 0 ? args : undefined,
    };

    writeToFile(entry);

    if (!shouldLogToConsole()) {
      return;
    }

    const formattedMessage = this.formatMessage(level, message);
    writeToConsole(level, formattedMessage, args);
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
}

export function closeLogger(): Promise<void> {
  return new Promise((resolve) => {
    if (logStream) {
      logStream.end(() => {
        logStream = null;
        resolve();
      });
      return;
    }

    resolve();
  });
}

export const gaugeLogger = new Logger('Gauge');
export const baselineLogger = new Logger('');
