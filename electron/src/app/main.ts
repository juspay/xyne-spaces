import { app } from 'electron';
import path from 'path';
import log from 'electron-log/main';
import { config } from './config';
import { setupDeepLinks } from '../services/deep-links';
import { setupIpcHandlers } from '../ipc/handlers';
import { createMainWindow, getMainWindow, setWindowReferences } from '../window/manager';
import {
  setupRequestInterceptor,
  setupXyneSpacesInterceptor,
} from '../services/request-interceptor';
import { setupMTLS } from '../services/mtls';
import { docsPublishService } from '../services/docs-publish';
import { agentAuthService } from '../services/agent-auth';
import { BrowserWindow } from 'electron';
import { Logger } from '../services/logger/Logger';
import { EnrollmentEvent } from '../services/logger/enrollment-events';
import { startVersionChecker, stopVersionChecker } from '../services/version-checker';
import ElectronEvent from '../services/logger/electron-events';
import { meetingDetectorService } from '../services/meeting-detector';
import { registerProtocolScheme, setupCustomProtocol } from '../services/custom-protocol';
import { initializeUIUpdater } from '../services/ui-updater';
import { initializeTelemetry } from '../services/telemetry';
import { setupGlobalErrorHandlers } from '../services/error-handler';
import { browserSettingsService } from '../services/browser-settings';
import { clearAllCookies } from '../services/cookies';
import { setupWebviewShortcuts } from '../services/webview-shortcuts';
import Sentry from "@sentry/electron/main";


// Forward logs to renderer process for workflow IPC messages.
(log.transports as any).forwardToRenderer = (message: any) => {
  // Convert message data to string for filtering
  const msgContent = (message.data || []).map((item: any) => String(item)).join(' ');
  const shouldForward = msgContent.toLowerCase().includes('workflow');

  if (shouldForward) {
    BrowserWindow.getAllWindows().forEach((w) => {
      if (!w.isDestroyed() && w.webContents && !w.webContents.isDestroyed()) {
        w.webContents.send('electron-log', message);
      }
    });
  }
};

if (process.platform === 'darwin') {
  app.setName(config.APP_NAME);
}
app.setAppUserModelId(config.APP_ID);

// Initialize electron-log for main process
log.initialize();
log.transports.file.level = 'info';
log.transports.console.level = 'info';
log.info('[Main] Electron app starting...');

// Setup global error handlers FIRST to catch any initialization errors
setupGlobalErrorHandlers();

// Initialize Sentry for crash reporting
Sentry.init({ dsn: config.SENTRY_DSN });

// Log app opened event
Logger.info(EnrollmentEvent.APP_OPENED);

if (config.useBundledUI) {
  registerProtocolScheme();
}

// Set userData path BEFORE requesting single-instance lock
// This ensures each flavor has its own lock, session storage, and electron-store data
if (config.USER_DATA_SUFFIX) {
  const currentUserData = app.getPath('userData');
  app.setPath('userData', `${currentUserData}${config.USER_DATA_SUFFIX}`);
}

// Register deep links BEFORE app is ready (required for Windows/Linux)
// This must be called before app.whenReady() for proper protocol handling
const gotTheLock = setupDeepLinks(createMainWindow);

// Track if app is quitting (for Cmd+Q support on macOS)
let isQuitting = false;

export function getIsQuitting(): boolean {
  return isQuitting;
}



// Handle before-quit to allow Cmd+Q to actually quit the app
app.on('before-quit', async () => {
  isQuitting = true;
  
  // Log app quit event
  Logger.info(ElectronEvent.APP_QUIT, {}, 'App');

  // Stop version checker
  stopVersionChecker();

  // Stop meeting detector
  meetingDetectorService.stop();

  // Gracefully stop agent auth server
  try {
    await agentAuthService.stopServer();
    Logger.info(ElectronEvent.AGENT_AUTH_SERVER_STOP, {}, 'App');
  } catch (error) {
    Logger.logError(ElectronEvent.AGENT_AUTH_SERVER_START_FAILED, error, {}, 'App');
  }

  // Gracefully stop docs publish server
  try {
    await docsPublishService.stopServer();
    Logger.info(ElectronEvent.DOCS_PUBLISH_SERVER_STOP, {}, 'App');
  } catch (error) {
    Logger.logError(ElectronEvent.DOCS_PUBLISH_SERVER_START_FAILED, error, {}, 'App');
  }
});



async function initializeApp(): Promise<void> {
  // Setup custom protocol for bundled UI (must be after app.whenReady())
  if (config.useBundledUI) {
    setupCustomProtocol();
  }

  initializeTelemetry();
  setupMTLS();
  setupRequestInterceptor();
  setupXyneSpacesInterceptor();
  setupIpcHandlers();

  // Clear network cache on app start to ensure fresh assets
  try {
    const { session } = await import('electron');
    await session.defaultSession.clearCache();
    log.info('[App] Network cache cleared on startup');
  } catch (error) {
    log.error('[App] Failed to clear cache on startup:', error);
  }

  await createMainWindow();
  setWindowReferences();

  // Auto-start agent authorization server
  startAgentAuthServerInBackground();

  // Initialize UI updater (checks for updates in background)
  if (config.useBundledUI) {
    void initializeUIUpdater();
  }
  // Auto-start docs publish server in the background
  startDocsPublishServerInBackground();

  // Start version checker to auto-reload on new deployments
  startVersionChecker();

  // Start meeting detector (macOS only, event-driven)
  startMeetingDetectorInBackground();

  // setup app state listners 
  setupAppStateListeners();

  app.on('activate', async () => {
    const mainWindow = getMainWindow();
    if (mainWindow) {
      mainWindow.show();
    } else {
      await createMainWindow();
      setWindowReferences();
    }
  });
}

/**
 * Start agent authorization server in the background
 */
function startAgentAuthServerInBackground(): void {
  agentAuthService.startServer(49231)
    .then((port) => {
      log.info(`[App] Agent authorization server started on port ${port}`);
    })
    .catch((error) => {
      log.error('[App] Failed to start agent auth server:', error);
    });
}

/**
 * Start docs publish server in the background
 */
function startDocsPublishServerInBackground(): void {
  docsPublishService.setBackendUrl(config.BACKEND_URL);

  Logger.info(ElectronEvent.DOCS_PUBLISH_SERVER_START, {}, 'App');
  docsPublishService.startServer()
    .then((port) => {
      Logger.info(ElectronEvent.DOCS_PUBLISH_SERVER_STARTED, { port }, 'App');
    })
    .catch((error) => {
      Logger.logError(ElectronEvent.DOCS_PUBLISH_SERVER_START_FAILED, error, {}, 'App');
    });
}

function startMeetingDetectorInBackground(): void {
  if (process.platform !== 'darwin') return;
  meetingDetectorService.start();
}

function setupAppStateListeners(): void {
  // Monitor window focus/blur events
  app.on('browser-window-focus', (_event, window) => {
    Logger.info(ElectronEvent.APP_TRANSITION_TO_FOREGROUND, {
      windowId: window.id,
      windowTitle: window.getTitle(),
    }, 'App');
  });

  app.on('browser-window-blur', (_event, window) => {
    Logger.info(ElectronEvent.APP_TRANSITION_TO_BACKGROUND, {
      windowId: window.id,
      windowTitle: window.getTitle(),
    }, 'App');
  });
}

// Handle webview preload scripts - will-attach-webview fires on the HOST webContents
app.on('web-contents-created', (_event, webContents) => {
  // Listen for will-attach-webview on any webContents (to catch webviews being created in the renderer)
  webContents.on('will-attach-webview', (_event, webPreferences, _params) => {
    // Set the webview preload script for Ask AI text selection
    // In production, the preload script is in resources/app/dist
    // In development, it's in the dist folder (parent of app folder where main.js is)
    const webviewPreloadPath = app.isPackaged
      ? path.join(process.resourcesPath, 'app', 'dist', 'webview-preload.js')
      : path.join(__dirname, '..', 'webview-preload.js');
    
    webPreferences.preload = webviewPreloadPath;
    log.info('[Main] Setting webview preload:', webviewPreloadPath);
    
    // Enable context isolation for security
    webPreferences.contextIsolation = true;
    // Disable node integration for security
    webPreferences.nodeIntegration = false;
    
    // Always enable JavaScript for all sites (modern web requires it)
    webPreferences.javascript = true;
    
    log.info('[Main] Webview preferences set:', {
      preload: webPreferences.preload,
      nodeIntegration: webPreferences.nodeIntegration,
      contextIsolation: webPreferences.contextIsolation,
    });
  });

  // Handle new window requests from webviews
  if (webContents.getType() === 'webview') {
    webContents.setWindowOpenHandler(({ url }) => {      
      try {
        const urlObj = new URL(url);
        if (urlObj.protocol === 'http:' || urlObj.protocol === 'https:') {
          const mainWindow = getMainWindow();
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('open-in-browser-panel', url);
          }
        }
      } catch (e) {
        // Invalid URL, ignore
      }
      
      return { action: 'deny' };
    });

    // Keyboard shortcuts for webview (Cmd+T, Cmd+F, Cmd+R, etc.).
    // To add new shortcuts edit services/webview-shortcuts.ts.
    setupWebviewShortcuts(webContents);
  }
});

// Only initialize if we have the single-instance lock
// setupDeepLinks() already calls app.quit() if lock fails
if (gotTheLock) {
  void app.whenReady().then(initializeApp);
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
