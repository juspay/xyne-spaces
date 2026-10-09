import { ipcMain, shell, app, session, BrowserView, BrowserWindow, desktopCapturer, dialog, clipboard, nativeTheme, powerMonitor } from 'electron';
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import { promises as fs } from 'fs';
import * as path from 'path';
import { clearAllCookies, clearBrowserTabsData, syncXyneCookiesToBrowserPanel } from '../services/cookies';
import { clearBrowserHistory, suggestFromHistory, topSites } from '../services/browser-history';
import { acceptBrowserCommands } from '../services/webview-shortcuts';
import { zoomAppWindow } from '../services/zoom-menu';
import { setEmbeddedPageFrozen } from '../services/webview-lifecycle';
import { isBrowserStateKey, readBrowserState, writeBrowserState } from '../services/browser-state';
import { acceptBrowserDownloads, actOnDownload } from '../services/browser-downloads';
import {
  BrowserImportError,
  chromeProfileAvailable,
  importChromeCookies,
  importFromSource,
  listBrowserProfiles,
  listImportBrowsers,
} from '../services/browser-import';
import { showNotification, NotificationData, showCallNotification, closeCallNotification, CallNotificationData } from '../services/notifications';
import {
  getMainWindow,
  isAppWindowFocused,
  loadApp,
  toggleWindowCompactMode,
  watchAppFocus,
} from '../window/manager';
import { setupMTLSIpcHandlers } from './mtls-handlers';
import { config, ENABLE_LOCAL_HARNESS } from '../app/config';
import { performHardReload } from '../services/version-checker';
import { Logger, errorLogger } from '../services/logger/Logger';
import ElectronEvent from '../services/logger/electron-events';
import { normalizeExternalUrl } from '../utils/validation';
import {
  requestAllMediaPermissions,
} from '../services/media-permission';
import { setCustomScreenPickerEnabled, setCachedUser } from '../services/request-interceptor';
import { hideMeetingPopup, hideMeetingPopupAfter } from '../services/meeting-popup-window';
import { bringMainWindowToFront } from '../services/incoming-call-window';
import {
  isPillSender,
  isRecordingPillEnabled,
  setRecordingPillTheme,
} from '../services/recording-pill-window';
import { isTrayVisible, setTrayVisible } from '../services/tray';
import {
  focusMainWindow,
  isRecordingInProgress,
  markRendererReady,
  resumeRecordingFromOutside,
  setCallActive,
  setOverlayMinimized,
  setRecordingPillEnabled,
  setRecordingStarting,
  stopRecording,
  syncRecordingState,
} from '../services/recording-controller';
import { meetingDetectorService } from '../services/meeting-detector';
import { browserSettingsService, BrowserSettings } from '../services/browser-settings';
import { errorReportRecorder } from '../services/error-report-recorder';
import { localHarnessBridge, LOCAL_HARNESS_PROVIDERS, type LocalHarnessProvider } from '../services/local-harness';


let previewBrowserView: BrowserView | null = null;

// ─── XYNE-17182 Issue 227 — hardening for BrowserView preview handlers ────
// The workflow live-preview loads a customer-owned URL into a BrowserView
// overlaid on the main window. Without validation, a renderer-supplied URL
// could load file:// / data: / javascript: schemes, or reach the app's
// authenticated defaultSession (Xyne cookies + mTLS cert). These helpers
// enforce: https-only, no IP/loopback/private hosts, dedicated session
// partition, no post-load navigation escape, clamped bounds, top-level
// main-window sender.
const PREVIEW_PARTITION = 'preview';

function isAllowedPreviewScheme(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

function isReasonablePreviewHost(url: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase();
    if (!h) return false;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return false;                // IPv4 literal
    if (h.startsWith('[') && h.endsWith(']')) return false;             // IPv6 literal
    if (h === 'localhost') return false;
    const badSuffixes = ['.local', '.internal', '.corp', '.lan'];
    if (badSuffixes.some((s) => h.endsWith(s))) return false;
    return true;
  } catch {
    return false;
  }
}

function isSafePreviewUrl(url: unknown): url is string {
  return typeof url === 'string' && isAllowedPreviewScheme(url) && isReasonablePreviewHost(url);
}

function clampPreviewBounds(raw: unknown, win: Electron.Rectangle): Electron.Rectangle | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Record<string, unknown>;
  const nums: number[] = [];
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    const v = b[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    nums.push(Math.floor(v));
  }
  const [x, y, width, height] = nums;
  const MIN = 50;
  const MAX = 8000;
  return {
    x: Math.max(0, Math.min(x, Math.max(0, win.width - MIN))),
    y: Math.max(0, Math.min(y, Math.max(0, win.height - MIN))),
    width: Math.max(MIN, Math.min(width, MAX)),
    height: Math.max(MIN, Math.min(height, MAX)),
  };
}

function attachPreviewGuards(wc: Electron.WebContents): void {
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  const guard = (e: Electron.Event, navUrl: string): void => {
    if (!isSafePreviewUrl(navUrl)) {
      e.preventDefault();
      errorLogger.warn('[preview] Blocked navigation to unsafe URL', { navUrl });
    }
  };
  wc.on('will-navigate', guard);
  wc.on('will-redirect', guard);
}

function isPreviewSenderTrusted(event: IpcMainEvent): boolean {
  const mainWindow = getMainWindow();
  const frame = event.senderFrame;
  const trusted =
    !!mainWindow &&
    !mainWindow.isDestroyed() &&
    event.sender === mainWindow.webContents &&
    !!frame &&
    frame.parent === null;
  if (!trusted) {
    errorLogger.warn('[preview] Blocked IPC from untrusted sender');
  }
  return trusted;
}

// The privileged handlers gated with this
// helper act on the authenticated session — wipe cookies, set telemetry
// identity, write persisted settings. Only honor them from the trusted main
// window's top-level frame, so a sub-frame, webview, or untrusted origin cannot
// force a one-call logout/DoS, spoof telemetry identity, or pollute config.
function isMainWindowSender(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  const mainWindow = getMainWindow();
  const frame = event.senderFrame;
  const trusted =
    !!mainWindow &&
    !mainWindow.isDestroyed() &&
    event.sender === mainWindow.webContents &&
    !!frame &&
    frame.parent === null;
  if (!trusted) {
    errorLogger.warn('[ipc] Blocked privileged IPC from untrusted sender');
  }
  return trusted;
}

function isAppWindowSender(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  const frame = event.senderFrame;
  const trusted =
    !!frame && frame.parent === null && !!BrowserWindow.fromWebContents(event.sender);
  if (!trusted) {
    errorLogger.warn('[ipc] Blocked UI-preference IPC from untrusted sender');
  }
  return trusted;
}

function broadcastToAppWindows(channel: string, value: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    win.webContents.send(channel, value);
  }
}

// XYNE-16859 Issue 24: the error-report screen/mic capture handlers can enumerate
// displays, start a silent screen+microphone recording, and read the captured bytes
// back. Restrict them to the trusted top-level frame of the main application window
// so embedded <webview>s, browser panels, and injected sub-frames cannot drive
// silent capture or read recordings.
function isTrustedErrorReportSender(event: IpcMainInvokeEvent): boolean {
  const mainWindow = getMainWindow();
  const frame = event.senderFrame;
  return (
    !!mainWindow &&
    !mainWindow.isDestroyed() &&
    event.sender === mainWindow.webContents &&
    !!frame &&
    frame.parent === null
  );
}

function assertTrustedErrorReportSender(event: IpcMainInvokeEvent): void {
  if (!isTrustedErrorReportSender(event)) {
    errorLogger.warn('[error-report] blocked capture IPC from untrusted sender');
    throw new Error('Unauthorized sender for error-report capture');
  }
}

export function setupIpcHandlers(): void {
  // Flags <html data-fs> while a window is in native full screen.
  app.on('browser-window-created', (_e, win) => {
    const set = (on: boolean): void => {
      win.webContents
        .executeJavaScript(`document.documentElement.toggleAttribute('data-fs', ${on})`)
        .catch(() => {});
    };
    win.on('enter-full-screen', () => set(true));
    win.on('leave-full-screen', () => set(false));
    win.webContents.on('did-finish-load', () => set(win.isFullScreen()));
  });

  // Set up mTLS IPC handlers
  setupMTLSIpcHandlers();

  // Webview preload path handler
  ipcMain.on('get-webview-preload-path', (event) => {
    // Return absolute path to webview preload script
    const preloadPath = path.join(__dirname, 'webview-preload.js');
    event.returnValue = preloadPath;
  });

  // Focus the embedder. A <webview> guest holds focus in its own web contents,
  // and nothing in the renderer can take it back — window.focus() and blurring
  // the element both leave it where it is. Until focus returns, the first click
  // on the app's own chrome is spent transferring it and never reaches the DOM,
  // so buttons beside an embedded page appear to need two clicks.
  ipcMain.handle('focus-host-webcontents', (event) => {
    // Any top frame of a window this app opened, not only the main one: folder
    // windows embed pages too, and there the main-window check would both
    // refuse the focus and log a blocked-sender warning on every pointerenter.
    const sender = BrowserWindow.fromWebContents(event.sender);
    const frame = event.senderFrame;
    if (!sender || sender.isDestroyed() || !frame || frame.parent !== null) return;
    event.sender.focus();
  });

  // Copy Xyne auth cookies from defaultSession to the persist:xyne-spaces
  // partition before opening a Xyne URL in the browser panel. Called by the
  // renderer (CMD+click / open-in-panel flow) right before dispatching the
  // browserPanelActor OPEN event.
  ipcMain.handle('sync-xyne-cookies-to-browser-panel', async (event, url: string) => {
    if (!isMainWindowSender(event)) throw new Error('Unauthorized sender');
    // Only sync auth cookies for first-party Xyne origins.
    let host: string;
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch {
      throw new Error('Invalid sync URL');
    }
    const isXyne = host === 'xyne.juspay.net' || host.endsWith('.xyne.juspay.net');
    const isLocal = host === 'localhost' || host === '127.0.0.1';
    if (!isXyne && !isLocal) {
      errorLogger.warn('[sync-cookies] Rejected non-Xyne origin');
      throw new Error('Cookie sync only allowed for Xyne origins');
    }
    await syncXyneCookiesToBrowserPanel(url);
  });

  ipcMain.on('open-external', (_event, url: string) => {
    if (typeof url !== 'string') return;
    let newUrl = url.startsWith("/api/auth/login") ? `${config.MTLS_BACKEND_URL}${url}` : url;
    if (newUrl.includes("/auth/login") && config.loginTempHeader) {
      const separator = newUrl.includes("?") ? "&" : "?";
      newUrl = `${newUrl}${separator}isNy=true`;
    }
    const safeUrl = normalizeExternalUrl(newUrl);
    if (!safeUrl) {
      Logger.error(ElectronEvent.OPEN_EXTERNAL_BLOCKED, { url: newUrl });
      return;
    }
    void shell.openExternal(safeUrl);
  });

  ipcMain.on('screen-picker:set-enabled', (_event, enabled: boolean) => {
    setCustomScreenPickerEnabled(enabled);
  });

  ipcMain.on('set-user-email', (event, email: string) => {
    if (!isMainWindowSender(event)) return;
    // Validate the email format before applying it to logger
    // identity so a compromised renderer cannot poison telemetry.
    if (
      typeof email === 'string' &&
      email.length <= 254 &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
      Logger.setEmailId(email);
      setCachedUser(email);
    }
  });

  ipcMain.handle('logger:get-client-session-id', () => {
    return Logger.getClientSessionId();
  });

  ipcMain.handle('error-report:get-native-logs', async (event) => {
    assertTrustedErrorReportSender(event);
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
  ipcMain.handle('error-report:get-screen-sources', async (event) => {
    if (!isTrustedErrorReportSender(event)) {
      return { sources: [], permissionError: 'denied' };
    }
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
  ipcMain.handle('error-report:start-recording', async (event, { sourceId, withMic }: { sourceId: string; withMic: boolean }) => {
    assertTrustedErrorReportSender(event);

    // XYNE-16859 Issue 24: never start a screen/mic recording silently. Require an
    // explicit main-process consent confirmation that a compromised renderer cannot
    // fake or bypass.
    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) {
      throw new Error('No active window for screen recording');
    }
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      buttons: ['Cancel', 'Start recording'],
      defaultId: 1,
      cancelId: 0,
      noLink: true,
      title: 'Screen recording',
      message: withMic
        ? 'Xyne Spaces will record the screen you selected and your microphone for this error report.'
        : 'Xyne Spaces will record the screen you selected for this error report.',
      detail: 'Recording begins only after you confirm, and you can stop it at any time.',
    });
    if (response !== 1) {
      throw new Error('Screen recording consent denied');
    }

    return errorReportRecorder.startRecording(sourceId, withMic);
  });
  ipcMain.handle('error-report:stop-recording', (event) => {
    assertTrustedErrorReportSender(event);
    return errorReportRecorder.stopRecording();
  });
  ipcMain.handle('error-report:get-recording-state', (event) => {
    assertTrustedErrorReportSender(event);
    return errorReportRecorder.getRecordingState();
  });
  ipcMain.handle('error-report:read-recording-file', (event, { recordingToken }: { recordingToken: string }) => {
    assertTrustedErrorReportSender(event);
    return errorReportRecorder.readRecordingByToken(recordingToken);
  });
  ipcMain.handle('error-report:cleanup-recording', (event, { filePath }: { filePath: string }) => {
    assertTrustedErrorReportSender(event);
    return errorReportRecorder.cleanupRecordingFile(filePath);
  });

  ipcMain.handle('error-report:save-file', async (event, { fileName, buffer, sourcePath }: { fileName: string; buffer: ArrayBuffer | null; sourcePath: string | null }) => {
    assertTrustedErrorReportSender(event);
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

  ipcMain.handle('canvas:export-pdf', async (_event, { fileName, html }: { fileName: string; html: string }) => {
    const result = await dialog.showSaveDialog({
      defaultPath: fileName,
      filters: [
        { name: 'PDF', extensions: ['pdf'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });

    if (result.canceled || !result.filePath) return { saved: false };

    const printWindow = new BrowserWindow({
      show: false,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    try {
      await printWindow.loadURL('about:blank');
      await printWindow.webContents.executeJavaScript(
        `document.open();document.write(${JSON.stringify(html)});document.close();`,
      );

      const pdf = await printWindow.webContents.printToPDF({
        pageSize: 'A4',
        printBackground: true,
      });

      await fs.writeFile(result.filePath, pdf);
      return { saved: true, filePath: result.filePath };
    } finally {
      printWindow.destroy();
    }
  });

  ipcMain.handle('canvas:export-markdown', async (_event, { fileName, content }: { fileName: string; content: string }) => {
    const result = await dialog.showSaveDialog({
      defaultPath: fileName,
      filters: [
        { name: 'Markdown', extensions: ['md'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });

    if (result.canceled || !result.filePath) return { saved: false };

    await fs.writeFile(result.filePath, content, 'utf8');
    return { saved: true, filePath: result.filePath };
  });

  ipcMain.on('clear-all-cookies', (event) => {
    if (!isMainWindowSender(event)) return;
    void clearAllCookies('renderer_ipc_request');
  });

  ipcMain.on('set-badge-count', (_event, count: number) => {
    app.setBadgeCount(count);
  });

  ipcMain.on('show-notification', (_event, data: NotificationData) => {
    showNotification(data, getMainWindow());
  });

  ipcMain.on('focus-app', () => {
    const mainWindow = getMainWindow();
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
      if (process.platform === 'darwin') app.dock?.bounce('critical');
    }
  });

  ipcMain.on('show-call-notification', (_event, data: CallNotificationData) => {
    showCallNotification(data, getMainWindow());
  });

  ipcMain.on('close-call-notification', (_event, callId: string) => {
    closeCallNotification(callId);
  });

  ipcMain.on('incoming-call-window:bring-app-to-front', (event) => {
    const mainWindow = getMainWindow();
    // Only the main window answers calls; nothing else gets to steal focus.
    if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) return;
    bringMainWindowToFront(mainWindow);
  });

  ipcMain.handle('incoming-call-window:is-app-focused', () => isAppWindowFocused());

  ipcMain.on('incoming-call-window:watch-focus', (event, watch: unknown) => {
    watchAppFocus(event.sender, watch === true);
  });

  // Every app window runs the incoming-call UI; only the main one floats the
  // card, so two windows never open (and fight over) the same floating window.
  // `mainExists` lets the others fall back to the OS banner when there is no
  // main window left to float it (Windows/Linux, main closed, another open).
  ipcMain.handle('incoming-call-window:get-host', (event) => {
    const mainWindow = getMainWindow();
    const mainExists = !!mainWindow && !mainWindow.isDestroyed();
    return { isMain: mainExists && event.sender === mainWindow.webContents, mainExists };
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

  // BrowserView handlers for inline preview.
  // See XYNE-17182 Issue 227 helpers above for the hardening rationale.
  ipcMain.on(
    'show-browser-view',
    (event, config: { url: unknown; bounds: unknown }) => {
      if (!isPreviewSenderTrusted(event)) return;
      if (!isSafePreviewUrl(config.url)) {
        errorLogger.warn('[preview] Rejected unsafe preview URL', { url: config.url });
        return;
      }
      const mainWindow = getMainWindow();
      if (!mainWindow) return;
      const clamped = clampPreviewBounds(config.bounds, mainWindow.getBounds());
      if (!clamped) {
        errorLogger.warn('[preview] Rejected invalid preview bounds');
        return;
      }

      if (!previewBrowserView) {
        previewBrowserView = new BrowserView({
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            // Isolate from defaultSession so the loaded page carries no Xyne
            // cookies and no mTLS client cert.
            partition: PREVIEW_PARTITION,
          },
        });
        mainWindow.setBrowserView(previewBrowserView);
        attachPreviewGuards(previewBrowserView.webContents);
      }

      // Renderer-supplied userAgent intentionally ignored — Chromium default
      // is used so the renderer cannot spoof platform-detection headers.
      previewBrowserView.setBounds(clamped);
      void previewBrowserView.webContents.loadURL(config.url);
    }
  );

  ipcMain.on('update-browser-view-bounds', (event, payload: { bounds: unknown }) => {
    if (!isPreviewSenderTrusted(event)) return;
    const mainWindow = getMainWindow();
    if (!previewBrowserView || !mainWindow) return;
    const clamped = clampPreviewBounds(payload?.bounds, mainWindow.getBounds());
    if (!clamped) return;
    previewBrowserView.setBounds(clamped);
  });

  ipcMain.on('hide-browser-view', (event) => {
    if (!isPreviewSenderTrusted(event)) return;
    const mainWindow = getMainWindow();
    if (mainWindow && previewBrowserView) {
      mainWindow.removeBrowserView(previewBrowserView);
      previewBrowserView.webContents.close();
      previewBrowserView = null;
    }
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
    Logger.info(ElectronEvent.MEETING_POPUP_DISMISSED, {}, 'MeetingDetector');
    // Just close the popup — do NOT show/focus the main window
    hideMeetingPopup();
  });

  ipcMain.on('meeting-popup:start-recording', () => {
    Logger.info(ElectronEvent.MEETING_POPUP_START_RECORDING, {}, 'MeetingDetector');
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed() && !isRecordingInProgress()) {
      // Auto-start recording without stealing focus from the meeting. The
      // renderer navigates itself — main has no workspace id, and the router is
      // /:workspaceId/recordings.
      mainWindow.webContents.send('meeting:start-recording');
    }
    // Delay close so the popup can show the recording-started state for 3 seconds
    hideMeetingPopupAfter(3000);
  });

  // Stop recording from the persistent floating pill — focus the app, navigate to
  // /recordings, and fire requestStop so RecordingsScreen shows the title modal
  ipcMain.on('recording-pill:stop-recording', (event) => {
    if (!isPillSender(event)) return;
    stopRecording('pill');
  });
  ipcMain.on('recording-pill:open-app', (event) => {
    if (!isPillSender(event)) return;
    focusMainWindow();
    setOverlayMinimized(false);
  });

  ipcMain.on('recording-pill:resume-recording', (event) => {
    if (!isPillSender(event)) return;
    resumeRecordingFromOutside('pill');
  });

  ipcMain.handle('tray:get-visible', () => isTrayVisible());

  ipcMain.on('tray:set-visible', (event, visible: unknown) => {
    if (!isAppWindowSender(event)) return;
    setTrayVisible(!!visible);
    broadcastToAppWindows('tray:visible-changed', isTrayVisible());
  });

  ipcMain.handle('recording-pill:get-enabled', () => isRecordingPillEnabled());

  ipcMain.on('recording-pill:set-enabled', (event, enabled: unknown) => {
    if (!isAppWindowSender(event)) return;
    setRecordingPillEnabled(!!enabled);
    broadcastToAppWindows('recording-pill:enabled-changed', isRecordingPillEnabled());
  });

  ipcMain.on('recording:set-minimized', (event, isMinimized: unknown) => {
    if (!isMainWindowSender(event)) return;
    setOverlayMinimized(!!isMinimized);
  });

  ipcMain.on(
    'recording:state-changed',
    (
      event,
      state: {
        active: boolean;
        starting?: boolean;
        startTime?: number;
        paused?: boolean;
        pauseStartedAt?: number | null;
        accumulatedPausedMs?: number;
      },
    ) => {
      if (!isMainWindowSender(event)) return;
      markRendererReady();
      // Applied before clearing `starting`: the reverse order briefly leaves
      // both flags false, which flickers the pill off and back on every start.
      syncRecordingState(!!state?.active, state?.startTime, {
        paused: !!state?.paused,
        pauseStartedAt: state?.pauseStartedAt ?? null,
        accumulatedPausedMs: state?.accumulatedPausedMs ?? 0,
      });
      setRecordingStarting(!!state?.starting);
    },
  );

  ipcMain.on('app:theme-changed', (event, theme: unknown) => {
    if (!isMainWindowSender(event)) return;
    if (theme !== 'light' && theme !== 'dark') return;
    setRecordingPillTheme(theme);
    // Pages in the in-app browsers follow Xyne's theme, not the OS's: sites read it
    // as prefers-color-scheme, as they would in a browser set to dark or light.
    nativeTheme.themeSource = theme;
  });

  ipcMain.on('call:state-changed', (event, inCall: unknown) => {
    if (!isMainWindowSender(event)) return;
    setCallActive(!!inCall);
  });

  ipcMain.on('recording:renderer-ready', (event) => {
    if (!isMainWindowSender(event)) return;
    markRendererReady();
  });

  ipcMain.on('recording-pill:recording-stopped', (event) => {
    if (!isMainWindowSender(event)) return;
    syncRecordingState(false);
  });

  // Seeds the renderer's meeting state. The 'meeting:detected' broadcast is
  // fire-and-forget, so a renderer that reloads mid-meeting would otherwise
  // never learn one is running and would ring a call it should have silenced.
  ipcMain.handle('meeting:get-current', () => meetingDetectorService.getCurrentMeeting());

  // Same reason, for the signal that actually silences the ring.
  ipcMain.handle('mic:get-state', () => meetingDetectorService.getMicActive());

  // Meeting detection toggle (user preference from settings)
  ipcMain.on('meeting-detection:set-enabled', (_event, enabled: boolean) => {
    Logger.info(
      enabled
        ? ElectronEvent.MEETING_DETECTION_ENABLED
        : ElectronEvent.MEETING_DETECTION_DISABLED,
      { enabled },
      'MeetingDetector',
    );
    // Only the "record this meeting?" popup. Stopping the detector here used to
    // take the mic signal down with it, so a user who turned detection off got a
    // full-volume ringtone through every Zoom call.
    meetingDetectorService.setPopupEnabled(enabled);
  });

  // Browser Settings handlers
  ipcMain.handle('get-browser-settings', () => {
    return browserSettingsService.getSettings();
  });

  ipcMain.handle('set-browser-settings', (event, settings: Partial<BrowserSettings>) => {
    if (!isMainWindowSender(event)) throw new Error('Unauthorized sender');
    return browserSettingsService.setSettings(settings);
  });

  ipcMain.handle('app-window:capture', async (event, maxWidth: unknown) => {
    if (!isMainWindowSender(event)) throw new Error('Unauthorized sender');
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return { data: '' };
    const image = await win.webContents.capturePage();
    const width = typeof maxWidth === 'number' && maxWidth > 200 ? Math.floor(maxWidth) : 1280;
    const size = image.getSize();
    const resized = size.width > width ? image.resize({ width }) : image;
    return { data: resized.toPNG().toString('base64') };
  });

  ipcMain.handle('clipboard:read-text', (event) => {
    if (!isMainWindowSender(event)) throw new Error('Unauthorized sender');
    return clipboard.readText();
  });

  ipcMain.handle('clipboard:write-text', (event, text: unknown) => {
    if (!isMainWindowSender(event)) throw new Error('Unauthorized sender');
    clipboard.writeText(typeof text === 'string' ? text : '');
    return { success: true };
  });

  ipcMain.handle('browser-import:available', async (event) => {
    if (!isMainWindowSender(event)) throw new Error('Unauthorized sender');
    if (process.platform !== 'darwin') return { available: false };
    return { available: await chromeProfileAvailable() };
  });

  ipcMain.handle('browser-import:chrome', async (event) => {
    if (!isMainWindowSender(event)) throw new Error('Unauthorized sender');
    if (process.platform !== 'darwin') {
      return { success: false, error: 'unsupported-platform' };
    }
    try {
      const result = await importChromeCookies();
      return { success: true, ...result };
    } catch (error) {
      Logger.logError('browser-import.chrome.failed', error);
      return { success: false, error: 'import-failed' };
    }
  });

  // The browsers on this computer whose sign-ins can be brought into the in-app ones,
  // found without opening their data.
  ipcMain.handle('browser-import:browsers', async (event) => {
    if (!isMainWindowSender(event)) throw new Error('Unauthorized sender');
    return listImportBrowsers();
  });

  // One browser's profiles, from its data: where macOS may ask for access.
  ipcMain.handle('browser-import:profiles', async (event, browser: unknown) => {
    if (!isMainWindowSender(event)) throw new Error('Unauthorized sender');
    if (typeof browser !== 'string' || browser.length > 64) {
      return { success: false, error: 'unknown-source' };
    }
    try {
      return { success: true, profiles: await listBrowserProfiles(browser) };
    } catch (error) {
      if (error instanceof BrowserImportError) return { success: false, error: error.reason };
      Logger.logError('browser-import.profiles.failed', error);
      return { success: false, error: 'import-failed' };
    }
  });

  ipcMain.handle('browser-import:run', async (event, sourceId: unknown) => {
    if (!isMainWindowSender(event)) throw new Error('Unauthorized sender');
    if (typeof sourceId !== 'string' || sourceId.length > 1024) {
      return { success: false, error: 'unknown-source' };
    }
    try {
      const result = await importFromSource(sourceId);
      return { success: true, ...result };
    } catch (error) {
      if (error instanceof BrowserImportError) return { success: false, error: error.reason };
      Logger.logError('browser-import.failed', error);
      return { success: false, error: 'import-failed' };
    }
  });

  // Safari's cookies need Full Disk Access: the pane that grants it.
  // System Settings where Xyne is let into a browser's data: Files & Folders, which
  // holds the "data from other apps" access macOS asks for on import, or Full Disk
  // Access, the only way into Safari's.
  ipcMain.handle('browser-import:open-access-settings', async (event, access: unknown) => {
    if (!isMainWindowSender(event)) throw new Error('Unauthorized sender');
    if (process.platform !== 'darwin') return { success: false };
    const pane = access === 'full-disk' ? 'Privacy_AllFiles' : 'Privacy_FilesAndFolders';
    await shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${pane}`);
    return { success: true };
  });

  // The in-app browsers' history, as suggestions for what is being typed: never
  // handed over whole. From the app's own windows only, a folder's included.
  ipcMain.handle('browser-history:suggest', async (event, typed: unknown, limit: unknown) => {
    if (!isAppWindowSender(event)) return { searches: [], pages: [] };
    if (typeof typed !== 'string' || typed.length > 500) return { searches: [], pages: [] };
    const count = typeof limit === 'number' && limit > 0 ? Math.min(Math.floor(limit), 12) : 8;
    return suggestFromHistory(typed, count);
  });

  ipcMain.handle('browser-history:top', async (event, limit: unknown) => {
    if (!isAppWindowSender(event)) return [];
    const count = typeof limit === 'number' && limit > 0 ? Math.min(Math.floor(limit), 12) : 8;
    return topSites(count);
  });

  ipcMain.handle('browser-history:clear', async (event) => {
    if (!isAppWindowSender(event)) return { success: false };
    await clearBrowserHistory();
    return { success: true };
  });

  // The in-app browser's open tabs and per-site zoom, kept encrypted here rather
  // than in the app's own storage. From the app's own windows only.
  ipcMain.handle('browser-state:get', async (event, key: unknown) => {
    if (!isAppWindowSender(event) || !isBrowserStateKey(key)) return null;
    return readBrowserState(key);
  });
  ipcMain.handle('browser-state:set', async (event, key: unknown, value: unknown) => {
    if (!isAppWindowSender(event) || !isBrowserStateKey(key)) return { success: false };
    return { success: await writeBrowserState(key, value) };
  });

  // A page of the in-app browsers out of sight, frozen so it runs nothing; woken when
  // shown again. Only by the window that holds it.
  ipcMain.handle('browser-page:set-frozen', async (event, pageId: unknown, frozen: unknown) => {
    if (!isAppWindowSender(event)) return { success: false };
    if (typeof pageId !== 'number' || !Number.isInteger(pageId) || typeof frozen !== 'boolean') {
      return { success: false };
    }
    return { success: await setEmbeddedPageFrozen(event.sender, pageId, frozen) };
  });

  // Whether the computer runs on battery: the in-app browsers freeze hidden pages
  // sooner then, as Chrome's Energy Saver does.
  ipcMain.handle('power:state', event => {
    if (!isAppWindowSender(event)) return { onBattery: false };
    return { onBattery: powerMonitor.isOnBatteryPower() };
  });
  const powerChanged = (onBattery: boolean) => () =>
    broadcastToAppWindows('power:changed', { onBattery });
  powerMonitor.on('on-battery', powerChanged(true));
  powerMonitor.on('on-ac', powerChanged(false));

  // Connecting ahead to where the address bar is about to go, so it opens sooner.
  ipcMain.handle('browser:preconnect', (event, url: unknown) => {
    if (!isAppWindowSender(event) || typeof url !== 'string' || url.length > 2048) return;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return;
      session.fromPartition('persist:browser-tabs').preconnect({ url: parsed.origin, numSockets: 1 });
    } catch {
      /* not an address */
    }
  });

  // A floating video's "back to tab": the window holding its page comes to the front.
  ipcMain.on('browser:bring-to-front', event => {
    if (!isAppWindowSender(event)) return;
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    // Asked for by a click in the app's own floating window, so the app may come forward.
    if (process.platform === 'darwin') app.focus({ steal: true });
  });

  // A window's app saying it shows its pages' downloads, and acting on one.
  ipcMain.on('browser-downloads:accept', event => {
    if (isAppWindowSender(event)) acceptBrowserDownloads(event.sender);
  });
  ipcMain.handle('browser-download:act', async (event, id: unknown, action: unknown) => {
    if (!isAppWindowSender(event) || typeof id !== 'string') return { success: false };
    if (action !== 'open' && action !== 'show' && action !== 'cancel' && action !== 'pause' && action !== 'resume') {
      return { success: false };
    }
    return { success: await actOnDownload(event.sender, id, action) };
  });

  // The View menu's zoom, which the window's app passed back: nothing of its browser
  // had the keyboard, so the app itself zooms.
  ipcMain.on('app-zoom:apply', (event, step: unknown) => {
    if (isAppWindowSender(event)) zoomAppWindow(event.sender, step);
  });

  // A window's app saying it handles browser keys pressed inside its pages.
  ipcMain.on('browser-commands:accept', (event, accept: unknown) => {
    if (!isAppWindowSender(event)) return;
    acceptBrowserCommands(event.sender, accept === true);
  });

  ipcMain.handle('clear-site-data', async (event) => {
    if (!isMainWindowSender(event)) throw new Error('Unauthorized sender');
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

  const requireLocalHarness = (event: IpcMainInvokeEvent): void => {
    if (!isMainWindowSender(event)) throw new Error('Unauthorized sender');
    if (!ENABLE_LOCAL_HARNESS) throw new Error('Local harness is not available in this build');
  };

  ipcMain.handle('local-harness:status', async (event) => {
    if (!isMainWindowSender(event)) throw new Error('Unauthorized sender');
    if (!ENABLE_LOCAL_HARNESS) {
      return {
        supported: false,
        connected: false,
        deviceId: null,
        deviceName: '',
        platform: process.platform,
        installations: [],
        lastError: null,
      };
    }
    return localHarnessBridge.status();
  });

  ipcMain.handle('local-harness:detect', async (event) => {
    requireLocalHarness(event);
    return localHarnessBridge.rescan();
  });

  ipcMain.handle('local-harness:set-provider', async (event, provider: unknown, enabled: unknown) => {
    requireLocalHarness(event);
    if (!LOCAL_HARNESS_PROVIDERS.includes(provider as LocalHarnessProvider)) {
      throw new Error('Unknown local harness provider');
    }
    return localHarnessBridge.setProviderEnabled(
      provider as LocalHarnessProvider,
      enabled === true,
      await xyneCookieHeader(),
    );
  });

  ipcMain.handle('local-harness:connect', async (event) => {
    requireLocalHarness(event);
    return localHarnessBridge.connect(await xyneCookieHeader());
  });

  ipcMain.handle('local-harness:disconnect', async (event) => {
    requireLocalHarness(event);
    return localHarnessBridge.disconnect(await xyneCookieHeader());
  });

  ipcMain.handle('local-harness:connect-computer', async (event) => {
    requireLocalHarness(event);
    return localHarnessBridge.connectComputer(await xyneCookieHeader());
  });

  ipcMain.handle('local-harness:disconnect-computer', async (event) => {
    requireLocalHarness(event);
    return localHarnessBridge.disconnectComputer(await xyneCookieHeader());
  });

  ipcMain.handle('local-harness:pick-folder', async (event) => {
    requireLocalHarness(event);
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) throw new Error('Unauthorized sender');

    const picked = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'createDirectory'],
    });
    const selected = picked.canceled ? undefined : picked.filePaths[0];
    if (!selected) return null;

    return localHarnessBridge.addWorkspace(selected);
  });

  ipcMain.handle('local-harness:list-folders', async (event) => {
    requireLocalHarness(event);
    return localHarnessBridge.listWorkspaces();
  });
}

async function xyneCookieHeader(): Promise<string> {
  const cookies = await session.defaultSession.cookies.get({ url: config.FRONTEND_URL });
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}
