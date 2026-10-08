import { BrowserWindow, shell, Menu, MenuItem, app, dialog, screen } from 'electron';
import path from 'path';
import log from 'electron-log/main';
import { config } from '../app/config';
import { getIsQuitting } from '../app/app-state';
import { setMainWindow as setDeepLinksMainWindow } from '../services/deep-links';
import { setupPermissionRequestOnFocus } from '../services/media-permission';
import {
  registerAppOwnedWindow,
  setMainWindow as setInterceptorMainWindow,
} from '../services/request-interceptor';
import { getBundledUIUrl } from '../services/custom-protocol';
import { browserSettingsService } from '../services/browser-settings';
import { getCreateOptions, applyPostCreate, track, saveNow } from './window-state';
import { callInvitePath } from '../utils/validation';
import {
  configureIncomingCallWindow,
  incomingCallWindowOptions,
  isIncomingCallWindowOpen,
  isOpenedByMainFrame,
} from '../services/incoming-call-window';

import { keychain } from '../keychain';
import { isKeychainToolingError } from '../keychain/errors';
import { Logger } from '../services/logger/Logger';
import { EnrollmentEvent } from '../services/logger/enrollment-events';
import {
  checkCertificateExpiry,
  isClientAuthFailure,
  isStoredCertificateExpired,
  recoverFromClientAuthFailure,
  startCertificateExpiryWatcher,
} from '../services/mtls-recovery';
import { getAppBackgroundColor, getAppTheme } from '../services/app-theme';
import { EnrollmentReason, setEnrollmentReasonIfAbsent } from '../services/enrollment-reason';
import { dashboardLoad, enrollmentSkipped, mtlsFrontendLoaded } from '../services/enrollmentMetrics';
import { safeRecordMetric } from '../services/telemetry';
import {
  isCallActive,
  isRecordingInProgress,
  stopCallForReload,
  stopRecordingForReload,
} from '../services/recording-controller';
import type { Counter } from '@opentelemetry/api';

type ReloadSubject = 'recording' | 'call' | 'both';

const RELOAD_COPY: Record<
  ReloadSubject,
  { title: string; message: string; detail: string; keep: string; proceed: string }
> = {
  recording: {
    title: 'Recording in progress',
    message: 'Reloading will stop your recording.',
    detail: 'Everything captured so far is saved to your recordings.',
    keep: 'Keep recording',
    proceed: 'Stop and reload',
  },
  call: {
    title: 'Call in progress',
    message: 'Reloading will end your call.',
    detail:
      'Reloading drops you from this call. Everyone else stays on, and you can rejoin from the channel.',
    keep: 'Stay on call',
    proceed: 'Leave and reload',
  },
  both: {
    title: 'Call and recording in progress',
    message: 'Reloading will end your call and stop your recording.',
    detail: 'Everything captured so far is saved to your recordings.',
    keep: 'Keep both',
    proceed: 'End and reload',
  },
};

async function confirmReloadWhileBusy(window: BrowserWindow): Promise<boolean> {
  const recording = isRecordingInProgress();
  const call = isCallActive();
  if (!recording && !call) return true;

  const subject: ReloadSubject = recording && call ? 'both' : recording ? 'recording' : 'call';
  const copy = RELOAD_COPY[subject];

  const { response } = await dialog.showMessageBox(window, {
    type: 'warning',
    buttons: [copy.keep, copy.proceed],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    title: copy.title,
    message: copy.message,
    detail: copy.detail,
  });

  if (response !== 1) return false;

  const pending: Promise<void>[] = [];
  if (recording) pending.push(stopRecordingForReload());
  if (call) pending.push(stopCallForReload());
  await Promise.all(pending);
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

/**
 * Whether a full Xyne window — the main one or another app window — has focus.
 * Each of those already shows the in-app incoming-call card, so a ringing call
 * only needs the floating one when none of them does. Asked of the main process
 * because the renderer's own `window` blur also fires when focus moves into an
 * embedded webview (the browser panel) while Xyne is still in front.
 */
export function isAppWindowFocused(): boolean {
  const focused = BrowserWindow.getFocusedWindow();
  return !!focused && (focused === mainWindow || appWindows.has(focused));
}

const appFocusWatchers = new Set<Electron.WebContents>();

/**
 * Read on the next tick so that moving between two Xyne windows (blur, then
 * focus) settles before it is reported, instead of flashing "unfocused".
 */
function reportAppFocus(): void {
  setImmediate(() => {
    const focused = isAppWindowFocused();
    for (const watcher of appFocusWatchers) {
      if (!watcher.isDestroyed()) watcher.send('incoming-call-window:app-focus-changed', focused);
    }
  });
}

/**
 * Starts or stops telling a page whether Xyne has focus. The dashboard only
 * watches while a call is ringing, so the app-wide focus listeners exist only
 * while someone is watching.
 */
export function watchAppFocus(watcher: Electron.WebContents, watch: boolean): void {
  const wasWatched = appFocusWatchers.size > 0;
  if (watch && !appFocusWatchers.has(watcher)) {
    appFocusWatchers.add(watcher);
    watcher.once('destroyed', () => watchAppFocus(watcher, false));
  } else if (!watch) {
    appFocusWatchers.delete(watcher);
  }

  const isWatched = appFocusWatchers.size > 0;
  if (isWatched && !wasWatched) {
    app.on('browser-window-focus', reportAppFocus);
    app.on('browser-window-blur', reportAppFocus);
  } else if (!isWatched && wasWatched) {
    app.removeListener('browser-window-focus', reportAppFocus);
    app.removeListener('browser-window-blur', reportAppFocus);
  }
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

      // The floating incoming-call card. Checked first because it is the one
      // window the app opens on about:blank, which the http(s) rule below denies.
      if (isIncomingCallWindowOpen(details.frameName, url)) {
        return { action: 'allow', overrideBrowserWindowOptions: incomingCallWindowOptions() };
      }


      const urlObj = new URL(url);
      const currentUrl = win.webContents.getURL();
      const currentUrlObj = new URL(currentUrl || '');
      const currentAppUrl = new URL(config.FRONTEND_URL);
      const isInternalUrl = urlObj.origin === currentAppUrl.origin;
      
      // Only allow http(s) protocols
      if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
        return { action: 'deny' };
      }

      // A call the app hosts itself — the router opens it, not a window or a
      // browser panel showing the guest lobby.
      const inviteWindowPath = callInvitePath(url);
      if (inviteWindowPath) {
        win.webContents.send('navigate-to', inviteWindowPath);
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

      const childWebPreferences = {
        nodeIntegration: false,
        contextIsolation: true,
        webviewTag: true,
        preload: path.join(__dirname, '..', 'preload.js'),
        spellcheck: true,
      };

      if (urlObj.pathname.startsWith('/newWindow/create-ticket')) {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            width: 900,
            height: 820,
            minWidth: 640,
            minHeight: 600,
            webPreferences: childWebPreferences,
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
            webPreferences: childWebPreferences,
          },
        };
      }

      return {
        action: 'allow',
        overrideBrowserWindowOptions: { webPreferences: childWebPreferences },
      };

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

      // Checked before the same-origin allow below: an invite URL normally lives
      // on the Spaces origin, so following it would replace the running app with
      // the guest lobby.
      const invitePath = callInvitePath(navUrl);
      if (invitePath) {
        event.preventDefault();
        win.webContents.send('navigate-to', invitePath);
        return;
      }

      const currentAppUrl = new URL(config.FRONTEND_URL);
      const currentUrl = win.webContents.getURL();
      const currentUrlObj = currentUrl ? new URL(currentUrl) : null;

      // Allow in-app navigation (same origin as configured frontend or current page)
      if (
        navUrlObj.origin === currentAppUrl.origin ||
        navUrlObj.origin === currentUrlObj?.origin
      ) {
        return;
      }

      // Mirror the mTLS branch from setWindowOpenHandler
      if (currentUrlObj?.origin === config.MTLS_FRONTEND_URL) {
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
    if (isIncomingCallWindowOpen(details.frameName, details.url)) {
      // Created hidden, so a request from anywhere but the main window's own
      // page (an embedded frame, another window) is destroyed before it shows.
      if (!isOpenedByMainFrame(childWindow, win, mainWindow)) {
        log.warn('[IncomingCallWindow] Refused: not opened by the main window frame');
        childWindow.destroy();
        return;
      }
      configureIncomingCallWindow(childWindow, win.webContents);
      return;
    }

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

/**
 * Shows the "install these packages" page when the platform keystore's external tools are
 * missing. The install command is passed through the URL query because these asset pages are
 * plain files with no IPC bootstrap of their own.
 */
async function showMissingToolingPage(
  window: BrowserWindow,
  missingTools: readonly string[],
  installHint: string,
): Promise<void> {
  const errorPage = path.join(__dirname, '..', '..', 'assets', 'missing-dependencies.html');
  const search = new URLSearchParams({
    tools: missingTools.join(', '),
    hint: installHint,
  }).toString();
  await window.loadFile(errorPage, { search });
}

/**
 * Shows the boot splash — the same mark on the same ground as the dashboard's own inline splash,
 * so the two documents read as one continuous screen rather than a branded page, a white frame,
 * and then a different branded page.
 *
 * The theme comes from the main process's own record of it, because this file: document cannot
 * read the renderer's localStorage.
 */
export async function showBootSplash(window: BrowserWindow): Promise<void> {
  const loadingPage = path.join(__dirname, '..', '..', 'assets', 'loading.html');
  await window.loadFile(loadingPage, {
    search: new URLSearchParams({ theme: getAppTheme() }).toString(),
  });
}

export async function loadApp(window: BrowserWindow) {
  log.info('[WindowManager] loadApp called');
  log.info('[WindowManager] config.enableMtls:', config.enableMtls);
  log.info('[WindowManager] config.useBundledUI:', config.useBundledUI);

  await showBootSplash(window);
  
  // check mtls
  if (config.enableMtls) {
    // The keystore's external tooling is verified before anything reads it. Without this a host
    // missing `certutil` (Linux/NSS) reported "no identity" on every launch and the app
    // re-enrolled over a perfectly good certificate, over and over.
    try {
      await keychain.ensureToolingAvailable?.();
    } catch (error) {
      if (isKeychainToolingError(error)) {
        log.error('[WindowManager] Certificate tooling missing:', error.missingTools);
        await showMissingToolingPage(window, error.missingTools, error.installHint);
        return;
      }
      throw error;
    }

    // An expiry already in the past is handled before the identity lookup, so the user gets the
    // "certificate expired" explanation instead of a bare enrollment screen.
    if (isStoredCertificateExpired()) {
      await checkCertificateExpiry('app_load');
      return;
    }

    let mtls: boolean;
    try {
      mtls = await keychain.checkIdentity(config.MTLS_IDENTITY_NAME);
    } catch (error) {
      // The keystore could not be read. That is not the same as "not enrolled", so we must not
      // push the user through enrollment — show the load error and leave the identity alone.
      Logger.logError(EnrollmentEvent.UNKNOWN_ERROR, error, { error_at: 'check_identity' });
      log.error('[WindowManager] Identity check failed; not re-enrolling:', error);
      const errorPage = path.join(__dirname, '..', '..', 'assets', 'load-error.html');
      await window.loadFile(errorPage);
      return;
    }

    log.info("[WindowManager] MTLS Identity Present:", mtls);

    if (!mtls) {
      const targetUrl = config.MTLS_FRONTEND_URL;
      // First-run enrollment is the common case here; only overwrite the reason when the app has
      // not already recorded a more specific one (expiry, rejection) on the way in.
      setEnrollmentReasonIfAbsent(EnrollmentReason.CERTIFICATE_MISSING);
      Logger.info(EnrollmentEvent.MTLS_FRONTEND_LOAD, {
        url: targetUrl,
        has_certificate: false,
      });
      await loadUrl(window, targetUrl, mtlsFrontendLoaded);
      return;
    } else {
      // No pre-flight request here on purpose.
      //
      // This used to open a hidden window and fetch /api/health before the real navigation, so
      // every launch paid an extra TLS handshake and round trip (up to three, serially) to learn
      // whether the certificate still worked. The navigation that follows answers the same
      // question for free: loadUrl() below recovers into enrollment the moment the server
      // refuses our client certificate, and the expiry watcher catches a certificate that dies
      // while the app is open. Validating twice only made startup slower.
      startCertificateExpiryWatcher();
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
    // Without this the frame — and every inter-document navigation, splash to dashboard
    // included — is painted the browser default white, which flashes against both themes.
    backgroundColor: getAppBackgroundColor(),
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
          if (!(await confirmReloadWhileBusy(mainWindow))) return;
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
          if (!(await confirmReloadWhileBusy(mainWindow))) return;
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

      // The server refused our client certificate. Retrying presents the same certificate and
      // fails the same way, so recover straight into enrollment — this is the check the startup
      // health probe used to perform, now paid for only when it actually fires.
      if (isClientAuthFailure(lastError.message)) {
        Logger.logError(EnrollmentEvent.CERTIFICATE_INVALID, lastError, {
          url,
          error_at: 'load_url_client_auth',
        });
        await recoverFromClientAuthFailure({
          url,
          errorCode: lastError.message,
          trigger: 'load_url',
        });
        return;
      }

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

