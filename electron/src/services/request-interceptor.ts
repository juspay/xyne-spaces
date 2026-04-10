import { session, BrowserWindow, app } from 'electron';
import { config } from '../app/config';
import { clearAllCookies } from './cookies';
import path from 'path';
import { existsSync, mkdirSync } from 'fs';
import Logger from 'electron-log';
import { EnrollmentEvent } from './logger/enrollment-events';
import { showScreenPicker } from './screen-picker';

let mainWindow: BrowserWindow | null = null;

export function setMainWindow(window: BrowserWindow | null): void {
  mainWindow = window;
}

/**
 * Sets up the download handler to prevent unwanted "Save As" dialogs
 * This fixes an Electron bug where reload or parallel downloads trigger the dialog
 * even when saveAs is set to false.
 * See: https://github.com/electron/electron/issues/23273
 */
function setupDownloadHandler(): void {
  session.defaultSession.on('will-download', (_event, item, _webContents) => {
    const downloadsPath = app.getPath('downloads');
    if (!existsSync(downloadsPath)) {
      mkdirSync(downloadsPath, { recursive: true });
    }    
    const originalFilename = item.getFilename();
    let filePath = path.join(downloadsPath, originalFilename);
    
    let counter = 1;
    const ext = path.extname(originalFilename);
    const baseName = path.basename(originalFilename, ext);
    while (existsSync(filePath)) {
      filePath = path.join(downloadsPath, `${baseName} (${counter})${ext}`);
      counter++;
    }
    item.setSavePath(filePath);
    
    console.log(`[Download] Saving file to: ${filePath}`);
  });
}

/**
 * Sets up request and response interception
 */
export function setupRequestInterceptor(): void {
  // Set up download handler first to prevent "Save As" dialog issues
  setupDownloadHandler();
  
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: [`${config.BACKEND_URL}/*`] },
    (details, callback) => {
      details.requestHeaders['X-Platform'] = 'electron';
      callback({ requestHeaders: details.requestHeaders });
    }
  );

  // Handle responses for auth-related actions
  session.defaultSession.webRequest.onHeadersReceived(
    { urls: [`${config.BACKEND_URL}/*`] },
    (details, callback) => {
      if (details.statusCode === 401) {
        const contentType = details.responseHeaders?.['content-type']?.[0];
        if (contentType?.includes('application/json')) {
          void clearAllCookies();
          mainWindow?.webContents.send('auth:token-expired');
        }
      }

      if (details.url.includes('/logout') && details.statusCode === 200) {
        void clearAllCookies();
      }

      callback({ responseHeaders: details.responseHeaders });
    }
  );
  
  // Start with native OS picker by default — matches the CAC default (customPickerEnabled: false).
  // CustomLiveKitRoom will call setCustomScreenPickerEnabled(true) if CAC enables the custom picker.
  setCustomScreenPickerEnabled(false);

  session.defaultSession.webRequest.onErrorOccurred(
    { urls: [`${config.BACKEND_URL}/*`] },
    (details) => {
      Logger.error(EnrollmentEvent.NETWORK_ERROR, {
        url: details.url,
        error: details.error,
      });
    }
  );
}

/**
 * Installs the custom display-media handler that shows the in-app screen picker.
 * Called on startup and re-called after a native OS picker fallback completes.
 */
function setupDisplayMediaHandler(): void {
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    const safeCallback = (streams: Electron.Streams): void => {
      try {
        callback(streams);
      } catch (err) {
        // Electron throws "Video was requested, but no video stream was provided"
        // when callback({}) is called after user cancellation — suppress it.
        Logger.info('[ScreenShare] Cancelled or no stream provided:', String(err));
      }
    };
    showScreenPicker(safeCallback);
  });
}

/**
 * Switch between the custom in-app screen picker and the native macOS picker.
 * When disabled, re-registers the handler with useSystemPicker: true so Electron
 * delegates to the native OS picker instead of our custom UI.
 */
export function setCustomScreenPickerEnabled(enabled: boolean): void {
  if (enabled) {
    setupDisplayMediaHandler();
    Logger.info('[ScreenShare] Custom screen picker enabled');
  } else {
    // useSystemPicker: true tells Electron to use the native macOS picker.
    // The handler is still registered but never actually invoked when the
    // system picker is available — macOS handles the entire flow natively.
    session.defaultSession.setDisplayMediaRequestHandler(
      (_request, callback) => {
        callback({ video: true, audio: true, useSystemPicker: true } as unknown as Electron.Streams);
      },
      { useSystemPicker: true },
    );
    Logger.info('[ScreenShare] Custom screen picker disabled — using native OS picker');
  }
}
