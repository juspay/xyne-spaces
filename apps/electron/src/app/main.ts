import { app, dialog, Menu, MenuItem } from 'electron';
import path from 'path';
import log from 'electron-log/main';
import { config, ENABLE_LOCAL_HARNESS } from './config';
import { setIsQuitting } from './app-state';
import { setupDeepLinks } from '../services/deep-links';
import { setupIpcHandlers } from '../ipc/handlers';
import { createMainWindow, getMainWindow, setWindowReferences } from '../window/manager';
import {
  setupRequestInterceptor,
  setupXyneSpacesInterceptor,
  hydrateCachedUserFromCookies,
} from '../services/request-interceptor';
import { setupMTLS } from '../services/mtls';
import { agentAuthService } from '../services/agent-auth';
import { installElectronLogStackHook, Logger } from '../services/logger/Logger';
import { localHarnessBridge } from '../services/local-harness';
import { BrowserWindow } from 'electron';
import { EnrollmentEvent } from '../services/logger/enrollment-events';
import { startVersionChecker, stopVersionChecker } from '../services/version-checker';
import ElectronEvent from '../services/logger/electron-events';
import { meetingDetectorService } from '../services/meeting-detector';
import { initTray } from '../services/tray';
import { registerGlobalShortcuts } from '../services/global-shortcuts';
import { initRecordingPillVisibility } from '../services/recording-controller';
import { initClawOverlayAuthGate } from '../services/claw-overlay-window';
import { registerProtocolScheme, setupCustomProtocol } from '../services/custom-protocol';
import { initializeUIUpdater } from '../services/ui-updater';
import { initializeTelemetry } from '../services/telemetry';
import { setupGlobalErrorHandlers } from '../services/error-handler';
import { setupWebviewShortcuts } from '../services/webview-shortcuts';
import { followAppTheme } from '../services/webview-theme';
import { setupBrowserTabsUserAgent } from '../services/browser-tabs-session';
import { trackBrowserHistory } from '../services/browser-history';
import { watchBrowserMemory } from '../services/browser-memory';
import { setupBrowserDownloads } from '../services/browser-downloads';
import { routeMenuZoom } from '../services/zoom-menu';
import { browserSettingsService } from '../services/browser-settings';
import { callInvitePath } from '../utils/validation';
import Store from 'electron-store';

const store = new Store();

if (process.platform === 'darwin') {
  app.setName(config.APP_NAME);
}
app.setAppUserModelId(config.APP_ID);

// Initialize electron-log for main process
process.setSourceMapsEnabled(true);
log.initialize();
installElectronLogStackHook();
log.transports.file.level = 'info';
log.transports['console'].level = 'info';
log.info('[Main] Electron app starting...');

// Setup global error handlers FIRST to catch any initialization errors
setupGlobalErrorHandlers();

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

// Let hidden windows actually go hidden (frames stop), while keeping the timer
// guarantees Zero and the sync socket rely on: the 1/min intensive clamp after 5min
// hidden would trip Zero's 10s ping / 20s detection into reconnect churn.
const addDisabledFeatures = (features: string[]): void => {
  const existing = app.commandLine.getSwitchValue('disable-features');
  const merged = Array.from(
    new Set(existing.split(',').filter(Boolean).concat(features)),
  );
  app.commandLine.appendSwitch('disable-features', merged.join(','));
};

app.commandLine.appendSwitch('disable-renderer-backgrounding');
addDisabledFeatures(
  [
    'IntensiveWakeUpThrottling',
    'AllowAggressiveThrottlingWithWebSocket',
  ].concat(
    // Windows occlusion tracking has a live blank-client-area bug; macOS needs
    // nothing here, Electron already disables MacWebContentsOcclusion.
    process.platform === 'win32' ? ['CalculateNativeWinOcclusion'] : [],
  ),
);

// Register deep links BEFORE app is ready (required for Windows/Linux)
// This must be called before app.whenReady() for proper protocol handling
const gotTheLock = setupDeepLinks(createMainWindow);

// Handle before-quit to allow Cmd+Q to actually quit the app
app.on('before-quit', async () => {
  setIsQuitting(true);

  // Log app quit event
  Logger.info(ElectronEvent.APP_QUIT, {}, 'App');

  // Stop version checker
  stopVersionChecker();

  // Stop meeting detector
  meetingDetectorService.stop();

  localHarnessBridge.stop();

  // Gracefully stop agent auth server
  try {
    await agentAuthService.stopServer();
    Logger.info(ElectronEvent.AGENT_AUTH_SERVER_STOP, {}, 'App');
  } catch (error) {
    Logger.logError(ElectronEvent.AGENT_AUTH_SERVER_START_FAILED, error, {}, 'App');
  }

});



function setupApplicationMenu(): void {
  // Append to Electron's existing default menu instead of rebuilding it from
  // a template. Copying `role`-derived `click` handlers off built MenuItems
  // into a fresh Menu.buildFromTemplate() call detaches Electron's internal
  // role dispatcher from its original context, which throws
  // "e.getOwnerBrowserWindow is not a function" the next time a role item
  // (e.g. macOS Window menu's zoom/front) is clicked and crashes the main
  // process.
  const menu = Menu.getApplicationMenu() ?? new Menu();

  // ⌘+, ⌘- and ⌘0 zoom what has the keyboard: a browser's page, so its bar shows the
  // size, or else the app.
  routeMenuZoom(menu);

  menu.append(new MenuItem({
    label: 'Beta',
    submenu: [
      {
        label: 'Enable pre-prod features',
        type: 'checkbox',
        checked: store.get(config.preProdKey, false) as boolean,
        click: () => {
          const currentValue = store.get(config.preProdKey, false) as boolean;
          store.set(config.preProdKey, !currentValue);
          log.info('[Menu] Pre-prod features toggled', store.get(config.preProdKey, false) as boolean);

          dialog.showMessageBoxSync({
            type: 'info',
            message: `Experimental features have been ${!currentValue ? 'enabled' : 'disabled'}. The application will now restart to apply the changes.`,
            buttons: ['OK'],
          });

          app.relaunch();
          app.quit();
        },
      },
    ],
  }));

  Menu.setApplicationMenu(menu);
}

async function initializeApp(): Promise<void> {
  // Setup custom protocol for bundled UI (must be after app.whenReady())
  if (config.useBundledUI) {
    setupCustomProtocol();
  }
  // Setup application menu with Tools submenu
  setupApplicationMenu();

  initializeTelemetry();
  setupMTLS();
  setupRequestInterceptor();
  setupXyneSpacesInterceptor();
  setupBrowserTabsUserAgent();
  setupBrowserDownloads();
  void hydrateCachedUserFromCookies();
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
  startLocalHarnessBridgeInBackground();

  // Initialize UI updater (checks for updates in background)
  if (config.useBundledUI) {
    void initializeUIUpdater();
  }
  // Start version checker to auto-reload on new deployments
  startVersionChecker();

  // Start meeting detector (macOS only, event-driven)
  startMeetingDetectorInBackground();

  initTray();
  registerGlobalShortcuts();
  initRecordingPillVisibility();

  initClawOverlayAuthGate();

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

function startLocalHarnessBridgeInBackground(): void {
  if (!ENABLE_LOCAL_HARNESS) return;
  try {
    localHarnessBridge.start();
  } catch (error) {
    log.error('[App] Failed to start local harness bridge:', error);
  }
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
  webContents.on('will-attach-webview', (_event, webPreferences, params) => {
    // The SDLC folder page's browser marks its pages in their webpreferences: they
    // are plain browsing, with no use for the panel's Ask AI script — whose button
    // sits over a site's own popups for a selection — nor for its bridge to the app,
    // which a third-party page has no business holding.
    // Xyne AI's workspace browser marks its pages `plain` for the same reason.
    // Xyne's own pages, in their own partition, keep the script whatever the mark:
    // it is how a Xyne page knows it is in a panel and shows only what fits one.
    const features = typeof params.webpreferences === 'string' ? params.webpreferences : '';
    const ownPage = params.partition === 'persist:xyne-spaces';
    if (!ownPage && /(^|,)\s*xyneSurface=(sdlc|plain)\s*(,|$)/.test(features)) {
      delete webPreferences.preload;
      log.info('[Main] Plain browsing page: no webview preload');
    } else {
      // Xyne's own pages, which load in their own partition, are told they are
      // in the browser panel; a third-party site never is.
      if (ownPage) {
        webPreferences.additionalArguments = [
          ...(webPreferences.additionalArguments ?? []),
          '--xyne-own-page',
        ];
      }
      // Set the webview preload script for Ask AI text selection
      // In production, the preload script is in resources/app/dist
      // In development, it's in the dist folder (parent of app folder where main.js is)
      const webviewPreloadPath = app.isPackaged
        ? path.join(process.resourcesPath, 'app', 'dist', 'webview-preload.js')
        : path.join(__dirname, '..', 'webview-preload.js');

      webPreferences.preload = webviewPreloadPath;
      log.info('[Main] Setting webview preload:', webviewPreloadPath);
    }
    
    // A page going full screen — a video — fills the app's window, which the app
    // does for it, and never resizes or full-screens the window itself: leaving it
    // would otherwise take the whole app out of macOS full screen with it.
    webPreferences.disableHtmlFullscreenWindowResize = true;

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
    webContents.setWindowOpenHandler(({ url, disposition }) => {
      // A script's own window — a popup — is held back while popups are turned off
      // in the browser's settings. Links that open in a new tab are not popups.
      if (disposition === 'new-window' && !browserSettingsService.getSettings().popups) {
        return { action: 'deny' };
      }
      try {
        const urlObj = new URL(url);
        if (urlObj.protocol === 'http:' || urlObj.protocol === 'https:') {
          const mainWindow = getMainWindow();
          // The renderer that embedded this webview is the one holding the
          // handler for it. In the main window that is the main window; for a
          // folder opened in its own window it is that window, and sending the
          // popup to the main one instead would throw the page into the app's
          // browser panel — the thing the embedded tabs exist to avoid.
          const host = webContents.hostWebContents;
          const embedder = host && !host.isDestroyed() ? host : null;
          if (mainWindow && !mainWindow.isDestroyed()) {
            // A call invite followed inside the browser panel still belongs to
            // the app, not to another panel tab.
            const invitePath = callInvitePath(url);
            if (invitePath) {
              mainWindow.webContents.send('navigate-to', invitePath);
            } else {
              // How it asked: a ⌘-click or middle click opens a tab behind.
              (embedder ?? mainWindow.webContents).send(
                'open-in-browser-panel',
                url,
                webContents.id,
                disposition,
              );
            }
          } else if (embedder) {
            embedder.send('open-in-browser-panel', url, webContents.id, disposition);
          }
        }
      } catch (e) {
        // Invalid URL, ignore
      }
      
      return { action: 'deny' };
    });

    // Pages see the app's theme, not the OS's, as prefers-color-scheme.
    followAppTheme(webContents);

    // Where the in-app browsers go, for their address bars to suggest.
    trackBrowserHistory(webContents);

    // How much memory the pages use, so a window lets go of hidden ones when too much.
    watchBrowserMemory();

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
