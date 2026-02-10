import { app } from 'electron';
import log from 'electron-log/main';
import { config } from './config';
import { setupDeepLinks } from '../services/deep-links';
import { setupIpcHandlers } from '../ipc/handlers';
import { createMainWindow, getMainWindow, setWindowReferences } from '../window/manager';
import { setupRequestInterceptor } from '../services/request-interceptor';
import { setupMTLS } from '../services/mtls';
import { codeServerService } from '../services/code-server';
import { docsPublishService } from '../services/docs-publish';
import { agentAuthService } from '../services/agent-auth';
import { BrowserWindow } from 'electron';
import { Logger } from '../services/logger/pre-enrollment-logger';
import { EnrollmentEvent } from '../services/logger/enrollment-events';
import { startVersionChecker, stopVersionChecker } from '../services/version-checker';

// Forward logs to renderer process
(log.transports as any).forwardToRenderer = (message: any) => {
  // Convert message data to string for filtering
  const msgContent = (message.data || []).map((item: any) => String(item)).join(' ');
  const shouldForward =
    msgContent.includes('[CodeServer]') ||
    msgContent.toLowerCase().includes('workflow');

  if (shouldForward) {
    BrowserWindow.getAllWindows().forEach((w) => {
      if (!w.isDestroyed() && w.webContents && !w.webContents.isDestroyed()) {
        w.webContents.send('electron-log', message);
      }
    });
  }
};
import { registerProtocolScheme, setupCustomProtocol } from '../services/custom-protocol';
import { initializeUIUpdater } from '../services/ui-updater';

// Initialize electron-log for main process
log.initialize();
log.transports.file.level = 'info';
log.transports.console.level = 'info';
log.info('[Main] Electron app starting...');

// Log app opened event
Logger.info(EnrollmentEvent.APP_OPENED);

if (config.useBundledUI) {
  registerProtocolScheme();
}

// Track if app is quitting (for Cmd+Q support on macOS)
let isQuitting = false;

export function getIsQuitting(): boolean {
  return isQuitting;
}



// Handle before-quit to allow Cmd+Q to actually quit the app
app.on('before-quit', async () => {
  isQuitting = true;

  // Stop version checker
  stopVersionChecker();

  // Gracefully stop agent auth server
  try {
    await agentAuthService.stopServer();
    log.info('[App] Agent auth server stopped gracefully');
  } catch (error) {
    log.error('[App] Failed to stop agent auth server:', error);
  }

  // Gracefully stop docs publish server
  try {
    await docsPublishService.stopServer();
    log.info('[App] Docs publish server stopped gracefully');
  } catch (error) {
    log.error('[App] Failed to stop docs publish server:', error);
  }

  // Gracefully stop code-server when app is quitting
  try {
    await codeServerService.stopCodeServer();
    log.info('[App] Code server stopped gracefully');
  } catch (error) {
    log.error('[App] Failed to stop code server:', error);
  }
});



async function initializeApp(): Promise<void> {
  if (process.platform === 'darwin') {
    app.setName(config.APP_NAME);
  }

  // Register deep links BEFORE app is ready
  const gotTheLock = setupDeepLinks(createMainWindow);
  if (!gotTheLock) {
    app.quit();
  }

  // Setup custom protocol for bundled UI (must be after app.whenReady())
  if (config.useBundledUI) {
    setupCustomProtocol();
  }

  setupMTLS();
  setupRequestInterceptor();
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

  // Auto-start code-server in the background
  startCodeServerInBackground();
  // Initialize UI updater (checks for updates in background)
  if (config.useBundledUI) {
    void initializeUIUpdater();
  }
  // Auto-start docs publish server in the background
  startDocsPublishServerInBackground();

  // Start version checker to auto-reload on new deployments
  startVersionChecker();

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
 * Start code-server in the background without blocking app startup
 */
function startCodeServerInBackground(): void {
  codeServerService.startCodeServer()
    .then((url) => {
      log.info(`[App] Code server started automatically at ${url}`);
    })
    .catch((error) => {
      log.error('[App] Failed to auto-start code server:', error);
      // Don't block the app if code-server fails to start
    });
}

/**
 * Start docs publish server in the background
 */
function startDocsPublishServerInBackground(): void {
  docsPublishService.setBackendUrl(config.BACKEND_URL);

  docsPublishService.startServer()
    .then((port) => {
      log.info(`[App] Docs publish server started on port ${port}`);
    })
    .catch((error) => {
      log.error('[App] Failed to start docs publish server:', error);
    });
}

function setupAppStateListeners(): void {
  // Monitor window focus/blur events
  app.on('browser-window-focus', (_event, window) => {
    Logger.info(EnrollmentEvent.APP_TRANSITION_TO_FOREGROUND, {
      windowId: window.id,
      windowTitle: window.getTitle(),
    });
  });

  app.on('browser-window-blur', (_event, window) => {
    Logger.info(EnrollmentEvent.APP_TRANSITION_TO_BACKGROUND, {
      windowId: window.id,
      windowTitle: window.getTitle(),
    });
  });
}

void app.whenReady().then(initializeApp);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
