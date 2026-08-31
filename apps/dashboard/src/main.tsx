import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import './global.css';
import { posthogService } from './services/Analytics/posthogService';
import { globalClickTracker } from './services/Analytics/globalClickTracker';
import { installErrorReportLogCollector } from './utils/errorReportLogCollector';
import { logger, Event } from './utils/logger';

// Expose app version to window for Electron access
window.__APP_VERSION__ = __APP_VERSION__;

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
    posthogService.capture('Frontend Error', properties);
    logger.error(Event.FRONTEND_ERROR, { ...properties, error });
  } catch (trackingError) {
    originalConsoleError('Failed to track browser console error to Mixpanel:', trackingError);
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
    posthogService.capture('Frontend Error', properties);
    logger.error(Event.FRONTEND_ERROR, { ...properties, error });
  } catch (trackingError) {
    originalConsoleError('Failed to track error to Mixpanel:', trackingError);
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
    posthogService.capture('Frontend Error', properties);
    logger.error(Event.FRONTEND_ERROR, { ...properties, error: reason });
  } catch (trackingError) {
    originalConsoleError('Failed to track promise rejection to Mixpanel:', trackingError);
  }
};

installErrorReportLogCollector({
  onConsoleError: handleConsoleError,
  onWindowError: handleWindowError,
  onUnhandledRejection: handleUnhandledRejection,
});

// Register Service Worker for docs preview and push notifications
// Note: Service Workers are not supported on custom protocols (xyne-spaces://, xyne-spaces-dev://, etc.)
const isCustomProtocol = window.location.protocol.startsWith('xyne-spaces');
if ('serviceWorker' in navigator && !isCustomProtocol) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then(registration => {
        logger.info(Event.FRONTEND_ERROR, {
          type: 'migrated_console_log',
          message: String('Service Worker registered with scope:'),
          context: [registration.scope],
        });
      })
      .catch(error => {
        logger.error(Event.FRONTEND_ERROR, {
          type: 'service_worker_registration',
          message: 'Service Worker registration failed',
          error,
        });
      });
  });
}

globalClickTracker.initialize();

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
