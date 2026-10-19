import { installErrorReportLogCollector } from '../utils/errorReportLogCollector';
import { logger, Event } from '../utils/logger';

/**
 * Global error reporting, shared by every page entry (the app's main.tsx and
 * the desktop call window's): console errors, uncaught exceptions and
 * unhandled rejections go to the logger.
 */

const browserConsole = globalThis.console;
const originalConsoleError = browserConsole.error.bind(browserConsole);
// Helper function to get common error properties
const getCommonErrorProperties = (): {
  userAgent: string;
  timestamp: string;
} => ({
  userAgent: navigator.userAgent,
  timestamp: new Date().toISOString(),
});

const handleConsoleError = (args: unknown[]): void => {
  try {
    const errorMessage = args.map(arg => String(arg)).join(' ');
    const error = args.find(arg => arg instanceof Error);

    const properties = {
      type: 'browser_console_error',
      message: errorMessage,
      ...getCommonErrorProperties(),
    };
    logger.error(Event.FRONTEND_ERROR, { ...properties, error });
  } catch (trackingError) {
    originalConsoleError('Failed to track browser console error to PostHog:', trackingError);
  }
};

const handleWindowError = (event: ErrorEvent): void => {
  try {
    const error = event.error as Error | undefined;

    const properties = {
      type: 'uncaught_exception',
      message: event.message,
      source: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      stack: error?.stack,
      errorName: error?.name,
      errorMessage: error?.message,
      ...getCommonErrorProperties(),
    };
    logger.error(Event.FRONTEND_ERROR, { ...properties, error });
  } catch (trackingError) {
    originalConsoleError('Failed to track error to PostHog:', trackingError);
  }
};

const handleUnhandledRejection = (event: PromiseRejectionEvent): void => {
  try {
    const reason = event.reason as Error | string;
    const isError = reason instanceof Error;

    const reasonString = isError
      ? JSON.stringify({ name: reason.name, message: reason.message })
      : typeof reason === 'string'
        ? reason
        : String(reason);

    const properties = {
      type: 'unhandledrejection',
      message: isError ? reason.message : typeof reason === 'string' ? reason : String(reason),
      stack: isError ? reason.stack : undefined,
      errorName: isError ? reason.name : undefined,
      reason: reasonString,
      ...getCommonErrorProperties(),
    };
    logger.error(Event.FRONTEND_ERROR, { ...properties, error: reason });
  } catch (trackingError) {
    originalConsoleError('Failed to track promise rejection to PostHog:', trackingError);
  }
};

export const installErrorReporting = (): void => {
  installErrorReportLogCollector({
    onConsoleError: handleConsoleError,
    onWindowError: handleWindowError,
    onUnhandledRejection: handleUnhandledRejection,
  });
};
