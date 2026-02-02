import { BrowserWindow, shell, dialog, Menu, MenuItem } from 'electron';
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
import { Logger } from '../services/logger/pre-enrollment-logger';
import { EnrollmentEvent } from '../services/logger/enrollment-events';

let mainWindow: BrowserWindow | null = null;
let isCompactMode = false;
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
      try{
        const targetUrl = config.MTLS_FRONTEND_URL;
        log.info('[WindowManager] Loading MTLS frontend:', targetUrl);
        Logger.info(EnrollmentEvent.MTLS_FRONTEND_LOAD, {
          url: targetUrl,
          has_certificate: false,
        });
        void loadUrl(window, targetUrl);
        return;
      }
      catch(error){
        Logger.logError(EnrollmentEvent.MTLS_FRONTEND_LOAD_FAILED, error);
      }
    } else {
      // Certificate exists, logging successful authentication
      Logger.info(EnrollmentEvent.MTLS_AUTH_SUCCESS, {
        certifcate_exists: true,
      });
    }
  }

  if (config.useBundledUI) {
    const bundledUrl = getBundledUIUrl();
    log.info('[WindowManager] Loading bundled UI from:', bundledUrl);
    Logger.info(EnrollmentEvent.DASHBOARD_LOAD, {
      url: bundledUrl,
    });
    void loadUrl(window, bundledUrl);
    return;
  }
  else {
    log.info('[WindowManager] Loading frontend URL:', config.FRONTEND_URL);
    Logger.info(EnrollmentEvent.DASHBOARD_LOAD, {
      url: config.FRONTEND_URL,
    });
    void loadUrl(window, config.FRONTEND_URL);
    return;
  }
}

/**
 * Creates the main application window
 */
export async function createMainWindow(): Promise<BrowserWindow> {
  mainWindow = new BrowserWindow({
    width: config.window.width,
    height: config.window.height,
    title: config.window.title,
    titleBarStyle: 'hiddenInset',
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
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
     try {
      const urlObj = new URL(url);
      const currentAppUrl = new URL(config.FRONTEND_URL);
      const isInternalUrl = urlObj.origin === currentAppUrl.origin;
      
      // Only allow http(s) protocols
      if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
        return { action: 'deny' };
      }
      
      // External URLs - open in system browser
      if (!isInternalUrl) {
        void shell.openExternal(url);
        return { action: 'deny' };
      }
      
      // Internal URLs - allow new window
      return { action: 'allow' };
      
    } catch (error) {
       console.warn('Failed to parse URL in setWindowOpenHandler:', url, error);
      return { action: 'deny' };
    }
});

  console.log('✅ setWindowOpenHandler configured for main window');

  // Setup spellchecker context menu
  setupSpellcheckerContextMenu(mainWindow);

  if (process.env.NODE_ENV === 'development') {
    mainWindow?.webContents.openDevTools();
  }

  // Handle keyboard shortcuts for reload
  // Cmd+R / Ctrl+R: Soft reload (in-page reload) - handled by default Electron behavior
  // Cmd+Shift+R / Ctrl+Shift+R: Hard refresh (reload URL from scratch using loadApp)
  mainWindow.webContents.on('before-input-event', (event, input) => {
    const isMac = process.platform === 'darwin';
    const modifierKey = isMac ? input.meta : input.control;
    
    if (modifierKey && input.shift && input.key.toLowerCase() === 'r') {
      event.preventDefault();
      log.info('[WindowManager] Hard refresh triggered (Cmd+Shift+R)');
      if (mainWindow) {
        // Clear cache before reloading for a true hard refresh
        void mainWindow.webContents.session.clearCache().then(() => {
          log.info('[WindowManager] Cache cleared, reloading app...');
          void loadApp(mainWindow!);
        });
      }
    }
  });

  await loadApp(mainWindow);

  // Setup media permission request on first focus (macOS)
  setupPermissionRequestOnFocus(mainWindow);

  mainWindow.webContents.on('did-finish-load', async () => {
    const bodyText = await mainWindow?.webContents.executeJavaScript('document.body.innerText').catch(() => '');
    if (bodyText && bodyText.includes('RBAC: access denied')) {
      const errorPage = path.join(__dirname, '..', '..', 'assets', 'vpn-error.html');
      void mainWindow?.loadFile(errorPage);
    }
  });

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

export async function loadUrl(window: BrowserWindow, url: string): Promise<void> {
  try {
    await window.loadURL(url);
  } catch (error) {
    console.error("Failed to load application URL:", error);
    const errorPage = path.join(__dirname, '..', '..', 'assets', 'load-error.html');
    void window.loadFile(errorPage);
  }
}
