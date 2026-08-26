import { BrowserWindow, screen, session, ipcMain } from 'electron';
import path from 'path';
import log from 'electron-log/main';
import { Logger } from './logger/Logger';
import ElectronEvent from './logger/electron-events';
import { isMicOwnedByXyne } from './recording-controller';

let popupWindow: BrowserWindow | null = null;
let autoDismissTimer: ReturnType<typeof setTimeout> | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;

const POPUP_HEIGHT_INITIAL = 80; // placeholder until renderer reports actual height
const POPUP_MARGIN = 16;
/** Auto-dismiss after 15 seconds if user doesn't interact */
const AUTO_DISMISS_MS = 15_000;

async function isUserLoggedIn(): Promise<boolean> {
  const cookies = await session.defaultSession.cookies.get({});
  return cookies.some((c) => c.name === 'google_access_token' && c.value);
}

export async function showMeetingPopup(meetingData: { app: string; startedAt: string }): Promise<void> {
  if (popupWindow && !popupWindow.isDestroyed()) {
    popupWindow.webContents.send('meeting-popup:update', meetingData);
    resetAutoDismiss();
    return;
  }

  if (isMicOwnedByXyne()) {
    log.info('[MeetingPopup] Recording already in progress, skipping popup');
    Logger.info(
      ElectronEvent.MEETING_POPUP_SKIPPED_RECORDING,
      { app: meetingData.app },
      'MeetingDetector',
    );
    return;
  }

  // Only show popup if user is logged in to Xyne Spaces
  const loggedIn = await isUserLoggedIn();
  if (!loggedIn) {
    log.info('[MeetingPopup] User not logged in, skipping popup');
    Logger.info(
      ElectronEvent.MEETING_POPUP_SKIPPED_LOGGED_OUT,
      { app: meetingData.app },
      'MeetingDetector',
    );
    return;
  }

  const { workArea } = screen.getPrimaryDisplay();
  const POPUP_WIDTH = Math.round(workArea.width * 0.40);
  const x = Math.max(workArea.x, Math.round(workArea.x + (workArea.width - POPUP_WIDTH) / 2));
  const y = workArea.y + POPUP_MARGIN;

  popupWindow = new BrowserWindow({
    width: POPUP_WIDTH,
    height: POPUP_HEIGHT_INITIAL,
    x,
    y,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    hasShadow: false,
    focusable: true,
    show: false,              // Don't show until content is ready
    // 'panel' (NSPanel) is a macOS(not available on other platforms) floating panel that sits above normal windows
    // and full-screen spaces without triggering a process-type transformation.
    // This avoids the Dock icon disappearing / traffic lights stripping issue.
    type: 'panel',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '..', 'preload.js'),
    },
  });

  // 'screen-saver' keeps it above full-screen apps.
  // visibleOnFullScreen makes it appear in full-screen spaces (e.g. Chrome full-screen).
  // skipTransformProcessType=true is safe here because 'panel' type windows don't
  // require the process-type switch — they handle workspace visibility natively.
  popupWindow.setAlwaysOnTop(true, 'screen-saver');
  popupWindow.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
    skipTransformProcessType: true,
  });

  const popupHtml = path.join(__dirname, '..', '..', 'assets', 'meeting-popup.html');
  void popupWindow.loadFile(popupHtml);

  // Original center X — kept constant so the popup never shifts horizontally
  const centerX = x + Math.round(POPUP_WIDTH / 2);

  // Renderer reports actual rendered size via IPC — resize then show
  const onContentSize = (_event: Electron.IpcMainEvent, width: number, height: number): void => {
    if (popupWindow && !popupWindow.isDestroyed()) {
      const finalWidth = width ? Math.ceil(width) : POPUP_WIDTH;
      const finalHeight = Math.ceil(height) + 20; // +20 for box-shadow bleed
      // Keep the same center X so the popup doesn't shift when width changes
      const newX = Math.round(centerX - finalWidth / 2);
      popupWindow.setResizable(true);
      popupWindow.setBounds({ x: newX, y, width: finalWidth, height: finalHeight });
      popupWindow.setResizable(false);
      popupWindow.showInactive();
      popupWindow.blur();
      log.info('[MeetingPopup] Resized to:', finalWidth, 'x', finalHeight);
    }
  };
  ipcMain.on('meeting-popup:content-height', onContentSize);

  // Send meeting data once the page is ready
  popupWindow.webContents.once('did-finish-load', () => {
    popupWindow?.webContents.send('meeting-popup:show', meetingData);
  });

  popupWindow.on('closed', () => {
    // Clean up size listener when popup closes
    ipcMain.removeListener('meeting-popup:content-height', onContentSize);
    popupWindow = null;
    if (autoDismissTimer) {
      clearTimeout(autoDismissTimer);
      autoDismissTimer = null;
    }
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  });

  log.info('[MeetingPopup] Showing popup for:', meetingData.app);
  Logger.info(
    ElectronEvent.MEETING_POPUP_SHOWN,
    { app: meetingData.app, startedAt: meetingData.startedAt },
    'MeetingDetector',
  );
  resetAutoDismiss();
}

export function hideMeetingPopupAfter(delayMs: number): void {
  setTimeout(() => hideMeetingPopup(), delayMs);
}

export function hideMeetingPopup(): void {
  if (autoDismissTimer) {
    clearTimeout(autoDismissTimer);
    autoDismissTimer = null;
  }

  if (!popupWindow || popupWindow.isDestroyed()) return;

  if (hideTimer) return; // already hiding

  // Blur before animating out so macOS doesn't focus the main window on close
  popupWindow.blur();
  // Animate out via IPC, then close
  popupWindow.webContents.send('meeting-popup:hide');
  hideTimer = setTimeout(() => {
    hideTimer = null;
    if (popupWindow && !popupWindow.isDestroyed()) {
      popupWindow.blur();
      popupWindow.close();
      popupWindow = null;
    }
  }, 300); // Match CSS transition duration

  log.info('[MeetingPopup] Hiding popup');
  Logger.info(ElectronEvent.MEETING_POPUP_HIDDEN, {}, 'MeetingDetector');
}

function resetAutoDismiss(): void {
  if (autoDismissTimer) clearTimeout(autoDismissTimer);
  autoDismissTimer = setTimeout(() => {
    hideMeetingPopup();
  }, AUTO_DISMISS_MS);
}
