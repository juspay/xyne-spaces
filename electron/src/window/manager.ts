import { BrowserWindow, shell, dialog, Menu, MenuItem, app, webContents } from 'electron';
import path from 'path';
import log from 'electron-log/main';
import { config } from '../app/config';
import { getIsQuitting } from '../app/main';
import { setMainWindow as setDeepLinksMainWindow } from '../services/deep-links';
import { setupPermissionRequestOnFocus } from '../services/media-permission';
import { setMainWindow as setInterceptorMainWindow } from '../services/request-interceptor';
import { codeServerService } from '../services/code-server';
import { getBundledUIUrl } from '../services/custom-protocol';

import { keychain } from '../keychain';
import { Logger } from '../services/logger/Logger';
import { EnrollmentEvent } from '../services/logger/enrollment-events';
import { handleCertificateError, isCertificateError } from '../services/certificate-error-handler';
import { dashboardLoad, enrollmentSkipped, mtlsFrontendLoaded } from '../services/enrollmentMetrics';
import { safeRecordMetric } from '../services/telemetry';
import type { Counter } from '@opentelemetry/api';

let mainWindow: BrowserWindow | null = null;
let isCompactMode = false;
let isReloading = false;
let normalBounds: { width: number; height: number } | null = null;
const EXTERNAL_XYNE_PATHS: string[] = ['/claw', '/changelog', '/demo', '/apps/downloads'];

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
export async function createMainWindow(): Promise<BrowserWindow> {
  const iconPath = path.join(__dirname, '..', '..', 'assets', 'images', 'xyne.ico');

  mainWindow = new BrowserWindow({
    width: config.window.width,
    height: config.window.height,
    title: config.window.title,
    titleBarStyle: 'hiddenInset',
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

  // Handle external links
  mainWindow.webContents.setWindowOpenHandler((details) => {
     try {
      const url = details.url;


      const urlObj = new URL(url);
      const currentUrl = mainWindow?.webContents.getURL();
      const currentUrlObj = new URL(currentUrl || '');
      const currentAppUrl = new URL(config.FRONTEND_URL);
      const isInternalUrl = urlObj.origin === currentAppUrl.origin;
      
      // Only allow http(s) protocols
      if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
        return { action: 'deny' };
      }

      if(currentUrlObj.origin === config.MTLS_FRONTEND_URL) {
        shell.openExternal(url);
        return { action: 'deny' };
      }

      const isExternalXynePath =
        isInternalUrl &&
        EXTERNAL_XYNE_PATHS.some(
          (p) => urlObj.pathname === p || urlObj.pathname.startsWith(p + '/'),
        );

      if (!isInternalUrl || isExternalXynePath) {
        if (details.disposition === 'foreground-tab') {
          mainWindow?.webContents.send('open-in-browser-panel', url);
        }
        if (details.disposition === 'background-tab') {
          shell.openExternal(url);
        }
        
        return { action: 'deny' };
      }
      
      // Internal URLs - allow new window
      return { action: 'allow' };
      
    } catch (error) {
      console.warn('Failed to parse URL in setWindowOpenHandler:', details.url, error);
      return { action: 'deny' };
    }
});

  console.log('✅ setWindowOpenHandler configured for main window');


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
          
          // Check if a webview is focused
          const focusedWC = webContents.getFocusedWebContents();
          const mainWCId = mainWindow.webContents.id;
          
          if (focusedWC && focusedWC.id !== mainWCId) {
            // A webview is focused - reload it
            log.info('[WindowManager] Reloading focused webview');
            focusedWC.reload();
          } else {
            // Main window is focused - reload the dashboard app
            log.info('[WindowManager] Reloading main window (dashboard)');
            await loadApp(mainWindow);
          }
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
    // Check if VS Code has active sessions
    if (codeServerService.hasActiveSessions() && !getIsQuitting()) {
      event.preventDefault();
      
      const choice = dialog.showMessageBoxSync(mainWindow!, {
        type: 'warning',
        buttons: ['Go Back', 'Close VS Code'],
        defaultId: 0,
        cancelId: 0,
        title: 'Close VS Code?',
        message: 'VS Code is currently open. Closing it may result in unsaved changes being lost.',
        detail: 'Make sure to save your work before continuing.',
      });

      if (choice === 1) {
        // User confirmed - clear sessions and allow close
        codeServerService.clearActiveSessions();
        
        if (process.platform === 'darwin' && !getIsQuitting()) {
          if (mainWindow?.isFullScreen()) {
            mainWindow.once('leave-full-screen', () => mainWindow?.hide());
            mainWindow.setFullScreen(false);
          } else {
            mainWindow?.hide();
          }
        } else {
          mainWindow?.close();
        }
      }
      // If choice === 0 (Go Back), do nothing - window stays open
      return;
    }

    // Normal close behavior when no VS Code sessions
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

export async function loadUrl(window: BrowserWindow, url: string, counter?: Counter): Promise<void> {
  try {
    await window.loadURL(url);
    safeRecordMetric(() => {
      counter?.add(1, { 
        success: 'true',
        buildVersion: app.getVersion(),
      });
    });
  } catch (error) {
    safeRecordMetric(() => {
      counter?.add(1, { 
        success: 'false',
        error: 'url_load_error',
        buildVersion: app.getVersion(),
      });
    });
    const errorPage = path.join(__dirname, '..', '..', 'assets', 'load-error.html');
    await window.loadFile(errorPage);
  }
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
