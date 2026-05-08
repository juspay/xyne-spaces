import { ipcMain, shell, app, BrowserView, BrowserWindow, desktopCapturer, dialog } from 'electron';
import { promises as fs } from 'fs';
import * as path from 'path';
import { clearAllCookies, clearBrowserTabsData, syncXyneCookiesToBrowserPanel } from '../services/cookies';
import { showNotification, NotificationData, showCallNotification, closeCallNotification, CallNotificationData } from '../services/notifications';
import { getMainWindow, loadApp, toggleWindowCompactMode } from '../window/manager';
import { setupMTLSIpcHandlers } from './mtls-handlers';
import { config } from '../app/config';
import { docsPublishService } from '../services/docs-publish';
import { performHardReload } from '../services/version-checker';
import { Logger, errorLogger } from '../services/logger/Logger';
import {
  requestAllMediaPermissions,
} from '../services/media-permission';
import { setCustomScreenPickerEnabled } from '../services/request-interceptor';
import { hideMeetingPopup, hideMeetingPopupAfter } from '../services/meeting-popup-window';
import { showRecordingPill, hideRecordingPill } from '../services/recording-pill-window';
import { meetingDetectorService } from '../services/meeting-detector';
import { browserSettingsService, BrowserSettings } from '../services/browser-settings';
import { errorReportRecorder } from '../services/error-report-recorder';
import Sentry from '@sentry/electron/main';


let previewBrowserView: BrowserView | null = null;

export function setupIpcHandlers(): void {

  // Set up mTLS IPC handlers
  setupMTLSIpcHandlers();

  // Webview preload path handler
  ipcMain.on('get-webview-preload-path', (event) => {
    // Return absolute path to webview preload script
    const preloadPath = path.join(__dirname, 'webview-preload.js');
    event.returnValue = preloadPath;
  });

  // Copy Xyne auth cookies from defaultSession to the persist:xyne-spaces
  // partition before opening a Xyne URL in the browser panel. Called by the
  // renderer (CMD+click / open-in-panel flow) right before dispatching the
  // browserPanelActor OPEN event.
  ipcMain.handle('sync-xyne-cookies-to-browser-panel', async (_event, url: string) => {
    await syncXyneCookiesToBrowserPanel(url);
  });

  // Docs Publish IPC handlers
  ipcMain.handle('docs-publish:get-status', () => {
    return docsPublishService.getStatus();
  });

  ipcMain.handle('docs-publish:clear-output-dir', async () => {
    try {
      await docsPublishService.clearOutputDir();
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('docs-publish:get-output-dir', () => {
    return docsPublishService.getQuartoOutputDir();
  });

  ipcMain.on('open-external', (_event, url: string) => {
    let newUrl = url.startsWith("/api/auth/login") ? `${config.MTLS_BACKEND_URL}${url}` : url;
    if (newUrl.includes("/auth/login") && config.loginTempHeader) {
      const separator = newUrl.includes("?") ? "&" : "?";
      newUrl = `${newUrl}${separator}isNy=true`;
    }
    void shell.openExternal(newUrl);
  });

  ipcMain.on('screen-picker:set-enabled', (_event, enabled: boolean) => {
    setCustomScreenPickerEnabled(enabled);
  });

  ipcMain.on('set-user-email', (_event, email: string) => {
    if (email && typeof email === 'string') {
      Sentry.setUser({ email });
      Logger.setEmailId(email);
    }
  });

  ipcMain.handle('logger:get-client-session-id', () => {
    return Logger.getClientSessionId();
  });

  ipcMain.handle('error-report:get-native-logs', async () => {
    const logFiles = [
      {
        fileName: 'errors.log',
        path: errorLogger.transports.file.getFile().path,
      },
    ];

    const MAX_LOG_BYTES = 512 * 1024;

    const files = await Promise.all(
      logFiles.map(async ({ fileName, path: filePath }) => {
        try {
          const stat = await fs.stat(filePath);
          const start = Math.max(0, stat.size - MAX_LOG_BYTES);
          const fd = await fs.open(filePath, 'r');
          const buf = Buffer.alloc(Math.min(MAX_LOG_BYTES, stat.size));
          await fd.read(buf, 0, buf.length, start);
          await fd.close();
          return { fileName, content: buf.toString('utf8') };
        } catch {
          return null;
        }
      }),
    );

    return files.filter(file => file !== null);
  });

  // Same approach as screen-picker.ts: call getSources from main process
  ipcMain.handle('error-report:get-screen-sources', async () => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 300, height: 180 },
      });

      if (sources.length === 0) {
        return { sources: [], permissionError: 'denied' };
      }

      return {
        sources: sources
          .filter(s => !s.thumbnail.isEmpty())
          .map(s => ({
            id: s.id,
            name: s.name,
            thumbnail: s.thumbnail.toDataURL(),
            displayId: s.display_id,
            type: s.id.startsWith('screen:') ? 'screen' : 'window',
          })),
        permissionError: null,
      };
    } catch {
      return { sources: [], permissionError: 'denied' };
    }
  });

  // Error Report Recorder handlers
  ipcMain.handle('error-report:start-recording', (_event, { sourceId, withMic }: { sourceId: string; withMic: boolean }) =>
    errorReportRecorder.startRecording(sourceId, withMic),
  );
  ipcMain.handle('error-report:stop-recording', () => errorReportRecorder.stopRecording());
  ipcMain.handle('error-report:get-recording-state', () => errorReportRecorder.getRecordingState());
  ipcMain.handle('error-report:read-recording-file', (_event, { filePath }: { filePath: string }) =>
    errorReportRecorder.readRecordingFile(filePath),
  );
  ipcMain.handle('error-report:cleanup-recording', (_event, { filePath }: { filePath: string }) =>
    errorReportRecorder.cleanupRecordingFile(filePath),
  );

  ipcMain.handle('error-report:save-file', async (_event, { fileName, buffer, sourcePath }: { fileName: string; buffer: ArrayBuffer | null; sourcePath: string | null }) => {
    const result = await dialog.showSaveDialog({
      defaultPath: fileName,
      filters: [
        { name: 'Video', extensions: ['webm', 'mp4', 'mov'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    if (result.canceled || !result.filePath) return { saved: false };
    if (sourcePath) {
      // Recording is already on disk — copy directly, no need to load into memory
      errorReportRecorder.assertManagedRecordingPath(sourcePath);
      await fs.copyFile(sourcePath, result.filePath);
    } else if (buffer) {
      await fs.writeFile(result.filePath, Buffer.from(new Uint8Array(buffer)));
    }
    return { saved: true };
  });

  ipcMain.on('clear-all-cookies', () => {
    void clearAllCookies();
  });

  ipcMain.on('set-badge-count', (_event, count: number) => {
    app.setBadgeCount(count);
  });

  ipcMain.on('show-notification', (_event, data: NotificationData) => {
    showNotification(data, getMainWindow());
  });

  ipcMain.on('show-call-notification', (_event, data: CallNotificationData) => {
    showCallNotification(data, getMainWindow());
  });

  ipcMain.on('close-call-notification', (_event, callId: string) => {
    closeCallNotification(callId);
  });

  ipcMain.on('reload-app', () => {
    const mainWindow = getMainWindow();
    if (mainWindow) {
      void loadApp(mainWindow);
    }
  });

  ipcMain.on('toggle-compact-mode', () => {
    toggleWindowCompactMode();
  });

  // BrowserView handlers for inline preview
  ipcMain.on(
    'show-browser-view',
    (
      _event,
      config: {
        url: string;
        userAgent: string;
        bounds: { x: number; y: number; width: number; height: number };
      }
    ) => {
      const mainWindow = getMainWindow();
      if (!mainWindow) return;

      // Create BrowserView if it doesn't exist
      if (!previewBrowserView) {
        previewBrowserView = new BrowserView({
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
          },
        });
        mainWindow.setBrowserView(previewBrowserView);
      }

      // Set user agent
      previewBrowserView.webContents.setUserAgent(config.userAgent);

      // Set bounds
      previewBrowserView.setBounds(config.bounds);

      // Load URL
      void previewBrowserView.webContents.loadURL(config.url);
    }
  );

  ipcMain.on('update-browser-view-bounds', (_event, { bounds }) => {
    const mainWindow = getMainWindow();
    if (previewBrowserView && mainWindow) {
      previewBrowserView.setBounds(bounds as Electron.Rectangle);
    }
  });

  ipcMain.on('hide-browser-view', () => {
    const mainWindow = getMainWindow();
    if (mainWindow && previewBrowserView) {
      mainWindow.removeBrowserView(previewBrowserView);
      previewBrowserView.webContents.close();
      previewBrowserView = null;
    }
  });

  // Preview window handler (opens in separate window)
  ipcMain.on('open-preview-window', (_event, url: string, userAgent?: string) => {
    const previewWindow = new BrowserWindow({
      width: 1200,
      height: 900,
      title: 'Live Preview',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    // Set custom user agent if provided
    if (userAgent) {
      previewWindow.webContents.setUserAgent(userAgent);
    }

    void previewWindow.loadURL(url);
  });

  // Bundle version handler - gets the dashboard's __APP_VERSION__
  ipcMain.handle('get-bundle-version', async () => {
    const mainWindow = getMainWindow();
    if (!mainWindow) {
      return null;
    }
    try {
      const version = await mainWindow.webContents.executeJavaScript('window.__APP_VERSION__');
      return version;
    } catch {
      return null;
    }
  });

  // App update handler - triggers hard reload when user clicks update button
  ipcMain.on('apply-app-update', () => {
    void performHardReload();
  });
  ipcMain.handle('request-all-media-permissions', async () => {
    return requestAllMediaPermissions();
  });

  // Meeting popup actions
  ipcMain.on('meeting-popup:dismiss', () => {
    // Just close the popup — do NOT show/focus the main window
    hideMeetingPopup();
  });

  ipcMain.on('meeting-popup:start-recording', () => {
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      // Navigate and auto-start recording without stealing focus from the meeting
      mainWindow.webContents.send('navigate-to', '/recordings');
      mainWindow.webContents.send('meeting:start-recording');
    }
    // Delay close so the popup can show the recording-started state for 3 seconds,
    // then show the persistent recording pill
    const recordingStartTime = Date.now();
    hideMeetingPopupAfter(3000);
    setTimeout(() => showRecordingPill(recordingStartTime), 3000);
  });

  // Stop recording from the persistent floating pill — focus the app, navigate to
  // /recordings, and fire requestStop so RecordingsScreen shows the title modal
  ipcMain.on('recording-pill:stop-recording', () => {
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send('navigate-to', '/recordings');
      mainWindow.webContents.send('meeting:stop-recording');
    }
    hideRecordingPill();
  });

  // Cancel just closes the pill — recording continues unaffected
  ipcMain.on('recording-pill:cancel-recording', () => {
    hideRecordingPill();
  });

  // Renderer notifies main that recording stopped (e.g. user stopped manually in UI)
  ipcMain.on('recording-pill:recording-stopped', () => {
    hideRecordingPill();
  });

  // Meeting detection toggle (user preference from settings)
  ipcMain.on('meeting-detection:set-enabled', (_event, enabled: boolean) => {
    if (enabled) {
      meetingDetectorService.start();
    } else {
      hideMeetingPopup();
      meetingDetectorService.stop();
    }
  });

  // Browser Settings handlers
  ipcMain.handle('get-browser-settings', () => {
    return browserSettingsService.getSettings();
  });

  ipcMain.handle('set-browser-settings', (_event, settings: Partial<BrowserSettings>) => {
    return browserSettingsService.setSettings(settings);
  });

  ipcMain.handle('clear-site-data', async () => {
    await clearBrowserTabsData();
    return { success: true };
  });

  // Open downloads folder
  ipcMain.handle('open-downloads-folder', async () => {
    try {
      const downloadsPath = app.getPath('downloads');
      await shell.openPath(downloadsPath);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}

