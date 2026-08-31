import { BrowserWindow, shell, Menu, MenuItem, app, dialog, screen } from 'electron';
import path from 'path';
import log from 'electron-log/main';
import { config } from '../app/config';
import { getIsQuitting } from '../app/main';
import { setMainWindow as setDeepLinksMainWindow } from '../services/deep-links';
import { setupPermissionRequestOnFocus } from '../services/media-permission';
import {
  registerAppOwnedWindow,
  setMainWindow as setInterceptorMainWindow,
} from '../services/request-interceptor';
import { getBundledUIUrl } from '../services/custom-protocol';
import { browserSettingsService } from '../services/browser-settings';
import { getCreateOptions, applyPostCreate, track, saveNow } from './window-state';

import { keychain } from '../keychain';
import { Logger } from '../services/logger/Logger';
import { EnrollmentEvent } from '../services/logger/enrollment-events';
import { handleCertificateError, isCertificateError } from '../services/certificate-error-handler';
import { dashboardLoad, enrollmentSkipped, mtlsFrontendLoaded } from '../services/enrollmentMetrics';
import { safeRecordMetric } from '../services/telemetry';
import { isRecordingInProgress, stopRecordingForReload } from '../services/recording-controller';
import type { Counter } from '@opentelemetry/api';

async function confirmReloadWhileRecording(window: BrowserWindow): Promise<boolean> {
  if (!isRecordingInProgress()) return true;

  const { response } = await dialog.showMessageBox(window, {
    type: 'warning',
    buttons: ['Keep recording', 'Reload anyway'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    title: 'Recording in progress',
    message: 'Reloading will stop your recording.',
    detail: 'Everything captured so far is saved to your recordings.',
  });

  if (response !== 1) return false;

  await stopRecordingForReload();
  return true;
}

const MAX_APP_WINDOWS = 3;
const appWindows = new Set<BrowserWindow>();

function isAppWindowUrl(rawUrl: string): boolean {
  try {
    return !new URL(rawUrl).pathname.startsWith('/newWindow/');
  } catch {
    return false;
  }
}

function trackAppWindow(win: BrowserWindow): void {
  appWindows.add(win);
  win.once('closed', () => appWindows.delete(win));
}

const namedChildWindows = new Map<string, BrowserWindow>();

const STANDALONE_WINDOW_PREFIX = 'xyne-window:';

function standaloneWindowKey(frameName: string | undefined): string | null {
  if (!frameName || !frameName.startsWith(STANDALONE_WINDOW_PREFIX)) return null;
  return frameName.slice(STANDALONE_WINDOW_PREFIX.length).split('#')[0] || null;
}

function focusWindow(window: BrowserWindow): void {
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

function applyWindowPolicy(win: BrowserWindow): void {
  // Mirrors 'open-in-browser-panel' so links sent to the external browser are
  // logged too, not just the ones routed into the panel.
  const notifyExternalOpen = (externalUrl: string): void => {
    win.webContents.send('link-opened-external', externalUrl);
  };

  // Handle external links
  win.webContents.setWindowOpenHandler((details) => {
     try {
      const url = details.url;


      const urlObj = new URL(url);
      const currentUrl = win.webContents.getURL();
      const currentUrlObj = new URL(currentUrl || '');
      const currentAppUrl = new URL(config.FRONTEND_URL);
      const isInternalUrl = urlObj.origin === currentAppUrl.origin;
      
      // Only allow http(s) protocols
      if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
        return { action: 'deny' };
      }

      if(currentUrlObj.origin === config.MTLS_FRONTEND_URL) {
        shell.openExternal(url);
        notifyExternalOpen(url);
        return { action: 'deny' };
      }



      if (!isInternalUrl) {
        const prefExternal = browserSettingsService.getSettings().openLinksExternally;
        const modifier = details.disposition === 'background-tab';
        const wantExternal = prefExternal !== modifier;
        if (wantExternal) {
          shell.openExternal(url);
          notifyExternalOpen(url);
        } else {
          win.webContents.send('open-in-browser-panel', url);
        }
        return { action: 'deny' };
      }
      
      // Internal URLs - allow new window
      const windowKey = standaloneWindowKey(details.frameName);
      if (windowKey) {
        const existing = namedChildWindows.get(windowKey);
        if (existing && !existing.isDestroyed()) {
          focusWindow(existing);
          return { action: 'deny' };
        }
        namedChildWindows.delete(windowKey);
      }

      if (isAppWindowUrl(url) && appWindows.size >= MAX_APP_WINDOWS) {
        win.webContents.send('app-window-limit-reached', MAX_APP_WINDOWS);
        log.info(`[WindowManager] app window limit (${MAX_APP_WINDOWS}) reached; denying ${url}`);
        return { action: 'deny' };
      }

      if (urlObj.pathname.startsWith('/newWindow/create-ticket')) {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            width: 900,
            height: 820,
            minWidth: 640,
            minHeight: 600,
          },
        };
      }
      if (!urlObj.pathname.startsWith('/newWindow/')) {
        const { width, height } = screen.getPrimaryDisplay().workAreaSize;
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            width: Math.min(1440, Math.round(width * 0.85)),
            height: Math.min(900, Math.round(height * 0.85)),
            minWidth: 800,
            minHeight: 600,
            titleBarStyle: 'hiddenInset',
            trafficLightPosition: { x: 19, y: 20 },
            webPreferences: {
              nodeIntegration: false,
              contextIsolation: true,
              webviewTag: true,
              preload: path.join(__dirname, '..', 'preload.js'),
              backgroundThrottling: false,
              spellcheck: true,
            },
          },
        };
      }

      return { action: 'allow' };

    } catch (error) {
      log.warn('Failed to parse URL in setWindowOpenHandler:', details.url, error);
      return { action: 'deny' };
    }
});

  // Plain <a href> clicks bypass setWindowOpenHandler; intercept here to keep the app from being replaced.
  win.webContents.on('will-navigate', (event, navUrl) => {
    try {
      const navUrlObj = new URL(navUrl);
      if (navUrlObj.protocol !== 'http:' && navUrlObj.protocol !== 'https:') {
        return;
      }

      const currentAppUrl = new URL(config.FRONTEND_URL);
      const currentUrl = win.webContents.getURL();
      const currentUrlObj = new URL(currentUrl || '');

      // Allow in-app navigation (same origin as configured frontend or current page)
      if (
        navUrlObj.origin === currentAppUrl.origin ||
        navUrlObj.origin === currentUrlObj.origin
      ) {
        return;
      }

      // Mirror the mTLS branch from setWindowOpenHandler
      if (currentUrlObj.origin === config.MTLS_FRONTEND_URL) {
        event.preventDefault();
        shell.openExternal(navUrl);
        notifyExternalOpen(navUrl);
        return;
      }

      event.preventDefault();
      if (browserSettingsService.getSettings().openLinksExternally) {
        shell.openExternal(navUrl);
        notifyExternalOpen(navUrl);
      } else {
        win.webContents.send('open-in-browser-panel', navUrl);
      }
    } catch (err) {
      log.warn('[WindowManager] Failed to handle will-navigate:', navUrl, err);
    }
  });

  win.webContents.on('did-create-window', (childWindow, details) => {
    if (isAppWindowUrl(details.url)) {
      trackAppWindow(childWindow);
    }
    registerAppOwnedWindow(childWindow);

    const windowKey = standaloneWindowKey(details.frameName);
    if (windowKey) {
      namedChildWindows.set(windowKey, childWindow);
      childWindow.on('closed', () => {
        if (namedChildWindows.get(windowKey) === childWindow) {
          namedChildWindows.delete(windowKey);
        }
      });
    }

    applyWindowPolicy(childWindow);
  });

}

let mainWindow: BrowserWindow | null = null;
let isCompactMode = false;
let isReloading = false;
let normalBounds: { width: number; height: number } | null = null;

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

export function setWindowReferences(): void {
  setDeepLinksMainWindow(mainWindow);
  setInterceptorMainWindow(mainWindow);
}

export async function loadApp(window: BrowserWindow) {
  log.info('[WindowManager] loadApp called');
  log.info('[WindowManager] config.enableMtls:', config.enableMtls);
  log.info('[WindowManager] config.useBundledUI:', config.useBundledUI);

  const loadingPage = path.join(__dirname, '..', '..', 'assets', 'loading.html');
  await window.loadFile(loadingPage);
  
  // check mtls
  if (config.enableMtls) {
    const mtls = await keychain.checkIdentity(config.MTLS_IDENTITY_NAME);
    log.info("[WindowManager] MTLS Identity Present:", mtls);

    if (!mtls) {
      const targetUrl = config.MTLS_FRONTEND_URL;
      Logger.info(EnrollmentEvent.MTLS_FRONTEND_LOAD, {
        url: targetUrl,
        has_certificate: false,
      });
      await loadUrl(window, targetUrl, mtlsFrontendLoaded);
      return;
    } else {
      const isHealthy = await certificateHealthCheck();
      if (!isHealthy) {
        return; // certificateHealthCheck will handle the error case and redirect to enrollment
      }
    }
  }
      
  // Enable post-enrollment logging after successful mTLS validation
  Logger.enablePostEnrollmentLogging();

  safeRecordMetric(() => {
    enrollmentSkipped.add(1, { 
      success: 'true',
      has_certificate: 'true',
      buildVersion: app.getVersion(),
    });
  });

  if (config.useBundledUI) {
    const bundledUrl = getBundledUIUrl();
    Logger.info(EnrollmentEvent.DASHBOARD_LOAD, {
      url: bundledUrl,
    });
    await loadUrl(window, bundledUrl, dashboardLoad);
    return;
  }
  else {
    Logger.info(EnrollmentEvent.DASHBOARD_LOAD, {
      url: config.FRONTEND_URL,
    });
    await loadUrl(window, config.FRONTEND_URL, dashboardLoad);
    return;
  }
}

/**
 * Creates the main application window
 */
export async function createMainWindow(options?: { inactive?: boolean }): Promise<BrowserWindow> {
  const iconPath = path.join(__dirname, '..', '..', 'assets', 'images', 'xyne.ico');

  const createOpts = getCreateOptions();

  mainWindow = new BrowserWindow({
    ...createOpts,
    show: false,
    title: config.window.title,
    titleBarStyle: 'hiddenInset',
    // Align the macOS traffic lights with the AppNavigator icons on the 52px
    // top bar (nudged down 2px past the centered 18px for a visual match).
    trafficLightPosition: { x: 19, y: 20 },
    icon: iconPath,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true,
      preload: path.join(__dirname, '..', 'preload.js'),
      backgroundThrottling: false,
      spellcheck: true,
    },
  });

  // Restore maximized/windowed state, then reveal once painted to avoid a resize flash.
  applyPostCreate(mainWindow);
  track(mainWindow, () => isCompactMode);
  mainWindow.once('ready-to-show', () =>
    options?.inactive ? mainWindow?.showInactive() : mainWindow?.show(),
  );

  applyWindowPolicy(mainWindow);

  log.info('✅ setWindowOpenHandler configured for main window');


  // Setup spellchecker context menu
  setupSpellcheckerContextMenu(mainWindow);

  if (process.env.NODE_ENV === 'development') {
    mainWindow?.webContents.openDevTools();
  }

  // Track modifier key state for link clicks
  mainWindow.webContents.on('before-input-event', async (event, input) => {
    const isMac = process.platform === 'darwin';
    const modifierKey = isMac ? input.meta : input.control;
    
    if (modifierKey && input.shift && input.key.toLowerCase() === 'r') {
      event.preventDefault();

      if (isReloading) {
        log.info('[WindowManager] hard Reload already in progress, ignoring duplicate request');
        return;
      }

      log.info('[WindowManager] Hard refresh triggered (Cmd+Shift+R)');
      
      try {
        if (mainWindow) {
          isReloading = true;
          if (!(await confirmReloadWhileRecording(mainWindow))) return;
          // Clear cache before reloading for a true hard refresh
          await mainWindow.webContents.session.clearCache();
          await loadApp(mainWindow);
        }
      } catch (error) {
        log.error('[WindowManager] Error during hard reload:', error);
      } finally {
        isReloading = false;
      }
    }
    else if (modifierKey && input.key.toLowerCase() === 'r') {
      event.preventDefault();
      if (isReloading) {
        log.info('[WindowManager] Reload already in progress, ignoring duplicate request');
        return;
      }
      
      try {
        if (mainWindow) {
          isReloading = true;
          if (!(await confirmReloadWhileRecording(mainWindow))) return;
          await loadUrl(mainWindow, mainWindow.webContents.getURL());
        }
      } catch (error) {
        log.error('[WindowManager] Error during reload:', error);
      } finally {
        isReloading = false;
      }
    }
  });

  // Setup media permission request on first focus (macOS)
  setupPermissionRequestOnFocus(mainWindow);

  // Register RBAC check before loading the app
  mainWindow.webContents.on('did-finish-load', async () => {
    const bodyText = await mainWindow?.webContents.executeJavaScript('document.body.innerText').catch(() => '');
    if (bodyText && bodyText.includes('RBAC: access denied')) {
      const errorPage = path.join(__dirname, '..', '..', 'assets', 'vpn-error.html');
      void mainWindow?.loadFile(errorPage);
    }
  });

  await loadApp(mainWindow);

  // Handle close (hide on macOS, unless quitting via Cmd+Q)
  mainWindow.on('close', (event) => {
    // Persist latest bounds before hide/quit so a cold relaunch restores them.
    if (mainWindow) saveNow(mainWindow);
    // Normal close behavior
    if (process.platform === 'darwin' && !getIsQuitting()) {
      event.preventDefault();
      if (mainWindow?.isFullScreen()) {
        mainWindow.once('leave-full-screen', () => mainWindow?.hide());
        mainWindow.setFullScreen(false);
      } else {
        mainWindow?.hide();
      }
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

export function toggleWindowCompactMode(): void {
  if (!mainWindow) return;

  if (!isCompactMode) {
    normalBounds = {
      width: mainWindow.getBounds().width,
      height: mainWindow.getBounds().height,
    };
    
    const compactHeight = 120;
    mainWindow.setSize(mainWindow.getBounds().width, compactHeight);
    isCompactMode = true;
    
    mainWindow.webContents.send('window-mode-changed', { compact: true });
  } else {
    if (normalBounds) {
      mainWindow.setSize(normalBounds.width, normalBounds.height);
    } else {
      mainWindow.setSize(config.window.width, config.window.height);
    }
    isCompactMode = false;
    normalBounds = null;
    
    mainWindow.webContents.send('window-mode-changed', { compact: false });
  }
}

/**
 * Setup spellchecker context menu with spelling suggestions
 */
function setupSpellcheckerContextMenu(window: BrowserWindow): void {

  if (process.platform !== 'darwin') {
    const availableLanguages = window.webContents.session.availableSpellCheckerLanguages;
    const preferredLanguages = ['en-US', 'en-GB'].filter(lang => 
      availableLanguages.includes(lang)
    );
    
    if (preferredLanguages.length > 0) {
      window.webContents.session.setSpellCheckerLanguages(preferredLanguages);
      log.info('[WindowManager] Spellchecker languages set:', preferredLanguages);
    }
  }

  window.webContents.on('context-menu', (event, params) => {
    if (params.dictionarySuggestions.length === 0 && !params.misspelledWord) {
      return; // Let the default context menu show
    }

    const menu = new Menu();

    for (const suggestion of params.dictionarySuggestions) {
      menu.append(new MenuItem({
        label: suggestion,
        click: () => window.webContents.replaceMisspelling(suggestion)
      }));
    }

    if (params.dictionarySuggestions.length > 0 && params.misspelledWord) {
      menu.append(new MenuItem({ type: 'separator' }));
    }

    if (params.misspelledWord) {
      menu.append(new MenuItem({
        label: `Add "${params.misspelledWord}" to dictionary`,
        click: () => window.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord)
      }));
    }

    menu.popup();
  });

  log.info('[WindowManager] Spellchecker context menu configured');
}

const LOAD_URL_MAX_RETRIES = 3;
const LOAD_URL_RETRY_DELAY_MS = 1000;

export async function loadUrl(window: BrowserWindow, url: string, counter?: Counter): Promise<void> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= LOAD_URL_MAX_RETRIES; attempt++) {
    try {
      await window.loadURL(url);
      Logger.info(EnrollmentEvent.LOAD_URL, { url, attempts: attempt });
      safeRecordMetric(() => {
        counter?.add(1, { success: 'true', buildVersion: app.getVersion() });
      });
      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < LOAD_URL_MAX_RETRIES) {
        Logger.info(EnrollmentEvent.LOAD_URL_RETRY, { url, retry_attempt: attempt, error: lastError });
        await new Promise(resolve => setTimeout(resolve, LOAD_URL_RETRY_DELAY_MS));
      }
    }
  }

  Logger.logError(EnrollmentEvent.URL_LOAD_FAILED, lastError!, { url, total_attempts: LOAD_URL_MAX_RETRIES });
  safeRecordMetric(() => {
    counter?.add(1, { success: 'false', error: 'url_load_error', buildVersion: app.getVersion() });
  });
  const errorPage = path.join(__dirname, '..', '..', 'assets', 'load-error.html');
  await window.loadFile(errorPage);
}

const MAX_HEALTH_CHECK_RETRIES = 3;

/**
 * Validates certificate health with retry logic to handle network timeout issues
 * Retries up to MAX_HEALTH_CHECK_RETRIES times if loading fails (typically due to network timeout while user approves keychain popup)
 * Shows error page if all retries are exhausted
 */
async function certificateHealthCheckWithRetry(validationWindow: BrowserWindow): Promise<boolean> {
  let certErrCount = 0;

  for (let attempt = 0; attempt < MAX_HEALTH_CHECK_RETRIES; attempt++) {
    try {
      const healthUrl = `${config.BACKEND_URL}/api/health`;
      
      // Attempt to load the URL
      await validationWindow.loadURL(healthUrl);

      Logger.info(EnrollmentEvent.HEALTH_CHECK_SUCCESS, {
        certificate_exists: true,
        validation_passed: true,
        attempts: attempt + 1,
      });
      return true;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isLastAttempt = attempt === MAX_HEALTH_CHECK_RETRIES - 1;

      // Track if this was a certificate error
      if (isCertificateError(errorMessage)) {
        Logger.logError(EnrollmentEvent.CERTIFICATE_REVOKED, error, {
          error_at: 'certificate_validation',
          attempt: attempt + 1,
        });
        certErrCount++;
      }

      // If we have retries left, log it and continue the loop
      if (!isLastAttempt) {
        Logger.info(EnrollmentEvent.LOAD_URL_RETRY, {
          url: `${config.BACKEND_URL}/api/health`,
          retry_attempt: attempt + 1,
        });
        continue; // Go to next iteration
      }
      
      // --- ALL RETRIES FAILED --- (Code reaches here only on the last attempt)

      if (certErrCount === MAX_HEALTH_CHECK_RETRIES) {
        // Every single error was a certificate error
        await handleCertificateError({ errorDescription: errorMessage });
      } else {
        // Generic failure (timeout, network, or mixed errors)
        Logger.logError(EnrollmentEvent.UNKNOWN_ERROR, error, {
          error_at: 'certificate_health_check_max_retries',
          total_attempts: MAX_HEALTH_CHECK_RETRIES,
        });

        if (mainWindow && !mainWindow.isDestroyed()) {
          const errorPage = path.join(__dirname, '..', '..', 'assets', 'timeout-error.html');
          await mainWindow.loadFile(errorPage);
        }
      }

      return false;
    }
  }

  return false; // Should not be reachable, but good for type safety
}

export async function certificateHealthCheck(): Promise<boolean> {
  const validationWindow = new BrowserWindow({
    show: false,  // Keep it hidden
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '..', 'preload.js'),
    },
  });
  // Certificate exists, validate it before loading dashboard
  const result = await certificateHealthCheckWithRetry(validationWindow);
  validationWindow.destroy();
  return result;
}
