import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import './global.css';
import '@xyne/workflow-ui/styles.css';
import './styles/workflow-ui-theme.css';
import { globalClickTracker } from './services/Analytics/globalClickTracker';
import { installErrorReporting } from './bootstrap/errorReporting';
import { maybeOpenInDesktopApp } from './utils/openInDesktopApp';
import { logger, Event } from './utils/logger';

// Expose app version to window for Electron access
window.__APP_VERSION__ = __APP_VERSION__;

installErrorReporting();

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

// If this is a shared link opened in a plain browser, offer to hand it off to
// the desktop app (Slack-style). No-op inside Electron. This does NOT defer
// render — <App /> still mounts underneath so "Continue in browser" is instant;
// running it before createRoot only avoids a flash of the app before the
// interstitial paints.
maybeOpenInDesktopApp();

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
