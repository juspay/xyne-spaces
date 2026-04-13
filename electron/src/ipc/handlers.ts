import { ipcMain, shell, app, BrowserView, BrowserWindow } from 'electron';
import * as path from 'path';
import { clearAllCookies, clearBrowserTabsData } from '../services/cookies';
import { showNotification, NotificationData, showCallNotification, closeCallNotification, CallNotificationData } from '../services/notifications';
import { getMainWindow, loadApp, toggleWindowCompactMode } from '../window/manager';
import { setupMTLSIpcHandlers } from './mtls-handlers';
import { config } from '../app/config';
import { codeServerService } from '../services/code-server';
import { docsPublishService } from '../services/docs-publish';
import { performHardReload } from '../services/version-checker';
import { Logger } from '../services/logger/Logger';
import {
  requestAllMediaPermissions,
} from '../services/media-permission';
import { setCustomScreenPickerEnabled } from '../services/request-interceptor';
import { hideMeetingPopup, hideMeetingPopupAfter } from '../services/meeting-popup-window';
import { meetingDetectorService } from '../services/meeting-detector';
import { browserSettingsService, BrowserSettings } from '../services/browser-settings';
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

  // Code Server IPC handlers
  ipcMain.handle('code-server:start', async () => {
    try {
      const url = await codeServerService.startCodeServer();
      return { success: true, url };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('code-server:stop', async () => {
    try {
      await codeServerService.stopCodeServer();
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('code-server:restart', async () => {
    try {
      const url = await codeServerService.restartCodeServer();
      return { success: true, url };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('code-server:status', () => {
    return codeServerService.getStatus();
  });

  ipcMain.handle('code-server:get-url', () => {
    return codeServerService.getServerUrl();
  });

  ipcMain.handle('code-server:download-binary', async () => {
    try {
      await codeServerService.downloadBinary();
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('code-server:is-binary-installed', () => {
    return codeServerService.isBinaryInstalled();
  });

  // Git workspace handlers
  ipcMain.handle('code-server:clone-branch', async (
    _event,
    repoUrl: string,
    branch: string,
    commitHash: string | undefined,
    executionId: string
  ) => {
    return codeServerService.cloneOrPullBranch(repoUrl, branch, commitHash, executionId);
  });

  ipcMain.handle('code-server:pull-updates', async (
    _event,
    executionId: string,
    branch: string,
    repoUrl: string
  ) => {
    if (!codeServerService.workspaceExists(executionId)) {
      return { success: false, error: 'Workspace does not exist' };
    }
    const workspacePath = codeServerService.getWorkspacePath(executionId);
    try {
      // Use cloneOrPullBranch which handles pull when workspace exists
      return await codeServerService.cloneOrPullBranch(repoUrl, branch, undefined, executionId);
    } catch (error) {
      return { success: false, workspacePath, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('code-server:get-workspace-path', (_event, executionId: string) => {
    return codeServerService.getWorkspacePath(executionId);
  });

  ipcMain.handle('code-server:workspace-exists', (_event, executionId: string) => {
    return codeServerService.workspaceExists(executionId);
  });

  ipcMain.handle('code-server:get-url-with-folder', (_event, folderPath: string) => {
    return codeServerService.getUrlWithFolder(folderPath);
  });

  ipcMain.handle('code-server:open-folder-dialog', async () => {
    const { dialog } = await import('electron');
    const mainWindow = getMainWindow();
    if (!mainWindow) return null;

    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Open Folder',
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths[0];
  });

  ipcMain.handle('code-server:delete-workspace', async (_event, executionId: string) => {
    try {
      await codeServerService.deleteWorkspace(executionId);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('code-server:list-workspaces', () => {
    return codeServerService.listWorkspaces();
  });

  // Xyne-spaces repo management handlers
  ipcMain.handle('code-server:get-xyne-spaces-dir', () => {
    return codeServerService.getXyneSpacesDir();
  });

  ipcMain.handle('code-server:list-repos', () => {
    return codeServerService.listRepos();
  });

  ipcMain.handle('code-server:get-repo-status', async (_event, repoPath: string) => {
    return codeServerService.getRepoStatus(repoPath);
  });

  ipcMain.handle('code-server:stash-changes', async (_event, repoPath: string) => {
    return codeServerService.stashChanges(repoPath);
  });

  ipcMain.handle('code-server:checkout-branch', async (
    _event,
    repoPath: string,
    branchName: string,
    baseBranch?: string
  ) => {
    return codeServerService.checkoutBranch(repoPath, branchName, baseBranch);
  });

  ipcMain.handle('code-server:prepare-for-ticket', async (
    _event,
    repoUrl: string,
    baseBranch: string,
    ticketBranchName: string
  ) => {
    return codeServerService.prepareWorkspaceForTicket(repoUrl, baseBranch, ticketBranchName);
  });

  ipcMain.handle('code-server:get-repo-path', (_event, repoName: string) => {
    return codeServerService.getRepoPath(repoName);
  });

  ipcMain.handle('code-server:has-active-sessions', () => {
    return codeServerService.hasActiveSessions();
  });

  ipcMain.handle('code-server:get-active-session-count', () => {
    return codeServerService.getActiveSessionCount();
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
    const newUrl = url.startsWith("/api/auth/login") ? `${config.MTLS_BACKEND_URL}${url}` : url;
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
    // Delay close so the popup can show the recording-started state for 3 seconds
    hideMeetingPopupAfter(3000);
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

