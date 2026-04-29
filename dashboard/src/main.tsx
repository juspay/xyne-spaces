import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import './global.css';
import { mixpanelService } from './services/Analytics/mixpanelService';
import { globalClickTracker } from './services/Analytics/globalClickTracker';
import { installErrorReportLogCollector } from './utils/errorReportLogCollector';

// Expose app version to window for Electron access
window.__APP_VERSION__ = __APP_VERSION__;

// Store original console.error
// eslint-disable-next-line no-console
const originalConsoleError = console.error;
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

    mixpanelService.track('Frontend Error', {
      type: 'console.error',
      message: errorMessage,
      ...getCommonErrorProperties(),
    });
  } catch (trackingError) {
    originalConsoleError('Failed to track console.error to Mixpanel:', trackingError);
  }
};

const handleWindowError = (event: ErrorEvent): void => {
  try {
    const error = event.error as Error | undefined;

    mixpanelService.track('Frontend Error', {
      type: 'uncaught_exception',
      message: event.message,
      source: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      stack: error?.stack,
      errorName: error?.name,
      errorMessage: error?.message,
      ...getCommonErrorProperties(),
    });
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

    mixpanelService.track('Frontend Error', {
      type: 'unhandledrejection',
      message: isError ? reason.message : typeof reason === 'string' ? reason : String(reason),
      stack: isError ? reason.stack : undefined,
      errorName: isError ? reason.name : undefined,
      reason: reasonString,
      ...getCommonErrorProperties(),
    });
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
        console.log('Service Worker registered with scope:', registration.scope);
      })
      .catch(error => {
        console.error('Service Worker registration failed:', error);
      });
  });
}

globalClickTracker.initialize();

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
