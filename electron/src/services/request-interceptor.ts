import { session, BrowserWindow, app } from 'electron';
import { config } from '../app/config';
import { clearAllCookies } from './cookies';
import path from 'path';
import { existsSync, mkdirSync } from 'fs';

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
  
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    callback({ video: true, audio: true, useSystemPicker: true } as unknown as Electron.Streams);
  }, { useSystemPicker: true });
}
