import { detectPlatform, type Platform } from '../hooks/usePlatform';
import type { ErrorReportNativeLog } from '../types/electron';
import { logger, Event as LogEvent, limitLibraryStackFrames } from './logger';

type LogLevel = 'error' | 'window.error' | 'unhandledrejection';

const MAX_LOG_ENTRIES = 500;
const MAX_ERROR_REPORT_LOG_BYTES = 512 * 1024;

const browserConsole = globalThis.console;
const originalConsoleError = browserConsole.error.bind(browserConsole);

const logEntries: ErrorReportLogEntry[] = [];

let isInstalled = false;

export interface ErrorReportLogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  stack?: string;
}

export interface ErrorReportContext {
  platform: Platform;
  route: string;
  url: string;
  appVersion: string;
  bundleVersion: string | null;
  clientSessionId: string | null;
  zeroClientId: string | null;
  zeroClientGroupId: string | null;
  timestamp: string;
  nativeLogFiles: string[];
}

interface InstallErrorReportLogCollectorOptions {
  onConsoleError?: (args: unknown[]) => void;
  onWindowError?: (event: ErrorEvent) => void;
  onUnhandledRejection?: (event: PromiseRejectionEvent) => void;
}

const serializeValue = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
};

const appendLogEntry = (level: LogLevel, message: string, error?: unknown): void => {
  const entry: ErrorReportLogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
  };
  if (error instanceof Error && error.stack) {
    entry.stack = limitLibraryStackFrames(error.stack);
  }
  logEntries.push(entry);

  if (logEntries.length > MAX_LOG_ENTRIES) {
    logEntries.splice(0, logEntries.length - MAX_LOG_ENTRIES);
  }
};

const getNativeLogs = async (): Promise<ErrorReportNativeLog[]> => {
  if (!window.electronAPI?.getErrorReportNativeLogs) {
    return [];
  }

  try {
    return await window.electronAPI.getErrorReportNativeLogs();
  } catch (error) {
    logger.warn(LogEvent.FRONTEND_ERROR, {
      type: 'migrated_console_warn',
      message: String('Failed to collect native Electron logs for error report'),
      context: [error],
    });
    return [];
  }
};

const buildContextLines = (context: ErrorReportContext): string[] => {
  return [
    '# Error Report Context',
    `timestamp: ${context.timestamp}`,
    `platform: ${context.platform}`,
    `route: ${context.route}`,
    `url: ${context.url}`,
    `appVersion: ${context.appVersion}`,
    `bundleVersion: ${context.bundleVersion ?? 'unavailable'}`,
    `clientSessionId: ${context.clientSessionId ?? 'unavailable'}`,
    `zeroClientId: ${context.zeroClientId ?? 'unavailable'}`,
    `zeroClientGroupId: ${context.zeroClientGroupId ?? 'unavailable'}`,
    `nativeLogFiles: ${context.nativeLogFiles.length > 0 ? context.nativeLogFiles.join(', ') : 'none'}`,
  ];
};

export const installErrorReportLogCollector = (
  options: InstallErrorReportLogCollectorOptions = {},
): void => {
  if (isInstalled || typeof window === 'undefined') {
    return;
  }

  isInstalled = true;

  browserConsole.error = (...args: unknown[]): void => {
    originalConsoleError(...args);
    appendLogEntry(
      'error',
      args.map(serializeValue).join(' '),
      args.find(arg => arg instanceof Error),
    );
    options.onConsoleError?.(args);
  };

  window.addEventListener('error', event => {
    appendLogEntry(
      'window.error',
      [
        event.message,
        event.filename ? `at ${event.filename}:${event.lineno}:${event.colno}` : '',
        event.error ? serializeValue(event.error) : '',
      ]
        .filter(Boolean)
        .join(' | '),
      event.error,
    );
    options.onWindowError?.(event);
  });

  window.addEventListener('unhandledrejection', event => {
    appendLogEntry('unhandledrejection', serializeValue(event.reason), event.reason);
    options.onUnhandledRejection?.(event);
  });
};

export const createErrorReportLogFile = async (): Promise<{
  file: File;
  context: ErrorReportContext;
}> => {
  const nativeLogs = await getNativeLogs();
  const bundleVersion = await window.electronAPI?.getBundleVersion?.();

  const context: ErrorReportContext = {
    platform: detectPlatform(),
    route: `${window.location.pathname}${window.location.search}${window.location.hash}`,
    url: window.location.href,
    appVersion: __APP_VERSION__,
    bundleVersion: bundleVersion ?? null,
    clientSessionId: logger.clientSessionId ?? null,
    zeroClientId: logger.zeroClientId ?? null,
    zeroClientGroupId: logger.zeroClientGroupId ?? null,
    timestamp: new Date().toISOString(),
    nativeLogFiles: nativeLogs.map(log => log.fileName),
  };

  // Filter to error-level entries only
  const errorEntries = logEntries.filter(
    entry =>
      entry.level === 'error' ||
      entry.level === 'window.error' ||
      entry.level === 'unhandledrejection',
  );

  const sessionLogLines =
    errorEntries.length > 0
      ? errorEntries.map(
          entry =>
            `[${entry.timestamp}] [${entry.level}] ${entry.message}${entry.stack ? `\n${entry.stack}` : ''}`,
        )
      : ['No session logs captured.'];

  const nativeLogSections = nativeLogs.flatMap(nativeLog => [
    '',
    `# Electron Native Log: ${nativeLog.fileName}`,
    nativeLog.content || '(empty log file)',
  ]);

  let logContents = [
    ...buildContextLines(context),
    '',
    '# Session Logs',
    ...sessionLogLines,
    ...nativeLogSections,
  ].join('\n');

  // Enforce 512KB size cap
  const textEncoder = new TextEncoder();
  if (textEncoder.encode(logContents).length > MAX_ERROR_REPORT_LOG_BYTES) {
    const lines = logContents.split('\n');
    // Find where session logs start (after "# Session Logs")
    const sessionStartIdx = lines.findIndex(line => line === '# Session Logs') + 1;

    // Remove oldest session log lines first (from the top of session logs)
    while (
      textEncoder.encode(lines.join('\n')).length > MAX_ERROR_REPORT_LOG_BYTES &&
      sessionStartIdx < lines.length &&
      !(lines[sessionStartIdx] ?? '').startsWith('# Electron Native Log:')
    ) {
      lines.splice(sessionStartIdx, 1);
    }

    // If still too large, truncate from end of file
    while (
      textEncoder.encode(lines.join('\n')).length > MAX_ERROR_REPORT_LOG_BYTES &&
      lines.length > 0
    ) {
      lines.pop();
    }

    logContents = lines.join('\n');
  }

  return {
    file: new File([logContents], 'error-report.log', { type: 'text/plain' }),
    context,
  };
};
