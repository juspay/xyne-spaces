import { BrowserWindow, screen, ipcMain } from 'electron';
import path from 'path';
import log from 'electron-log/main';

let pillWindow: BrowserWindow | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let contentSizeHandler: ((_event: Electron.IpcMainEvent, width: number, height: number) => void) | null = null;

// Persist position across show/hide within the same app session
let savedPosition: { x: number; y: number } | null = null;

const PILL_MARGIN = 24;
const INITIAL_WIDTH = 64;
const INITIAL_HEIGHT = 200;

function getDefaultPosition(width: number, height: number): { x: number; y: number } {
  const { workArea } = screen.getPrimaryDisplay();
  // Mid-right: right edge minus margin, vertically centered
  const x = workArea.x + workArea.width - width - PILL_MARGIN;
  const y = workArea.y + Math.round((workArea.height - height) / 2);
  return { x, y };
}

export function showRecordingPill(recordingStartTime?: number): void {
  if (pillWindow && !pillWindow.isDestroyed()) {
    pillWindow.webContents.send('recording-pill:show', recordingStartTime ?? Date.now());
    return;
  }

  const pos = savedPosition ?? getDefaultPosition(INITIAL_WIDTH, INITIAL_HEIGHT);

  pillWindow = new BrowserWindow({
    width: INITIAL_WIDTH,
    height: INITIAL_HEIGHT,
    x: pos.x,
    y: pos.y,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,   // user can drag the pill
    skipTaskbar: true,
    hasShadow: false,
    focusable: true,
    show: false,
    type: 'panel',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '..', 'preload.js'),
    },
  });

  pillWindow.setAlwaysOnTop(true, 'screen-saver');
  pillWindow.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
    skipTransformProcessType: true,
  });

  // Save position whenever user drags the pill
  pillWindow.on('moved', () => {
    if (pillWindow && !pillWindow.isDestroyed()) {
      const [x, y] = pillWindow.getPosition();
      savedPosition = { x, y };
    }
  });

  const pillHtml = path.join(__dirname, '..', '..', 'assets', 'recording-pill.html');
  void pillWindow.loadFile(pillHtml);

  // Clean up any previous listener before registering a new one
  if (contentSizeHandler) {
    ipcMain.removeListener('recording-pill:content-size', contentSizeHandler);
  }
  contentSizeHandler = (_event: Electron.IpcMainEvent, width: number, height: number): void => {
    if (!pillWindow || pillWindow.isDestroyed()) return;
    const finalWidth = Math.ceil(width);
    const finalHeight = Math.ceil(height);
    // On first show use saved/default position, recalculate right-edge anchor if no saved pos
    const { x: curX, y: curY } = savedPosition ?? getDefaultPosition(finalWidth, finalHeight);
    pillWindow.setResizable(true);
    pillWindow.setBounds({ x: curX, y: curY, width: finalWidth, height: finalHeight });
    pillWindow.setResizable(false);
    pillWindow.showInactive();
    pillWindow.blur();
  };
  ipcMain.on('recording-pill:content-size', contentSizeHandler);

  pillWindow.webContents.once('did-finish-load', () => {
    pillWindow?.webContents.send('recording-pill:show', recordingStartTime ?? Date.now());
  });

  pillWindow.on('closed', () => {
    if (contentSizeHandler) {
      ipcMain.removeListener('recording-pill:content-size', contentSizeHandler);
      contentSizeHandler = null;
    }
    pillWindow = null;
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  });

  log.info('[RecordingPill] Showing recording pill');
}

export function hideRecordingPill(): void {
  if (!pillWindow || pillWindow.isDestroyed()) return;
  if (hideTimer) return;

  // Save position before closing
  const [x, y] = pillWindow.getPosition();
  savedPosition = { x, y };

  pillWindow.blur();
  pillWindow.webContents.send('recording-pill:hide');
  hideTimer = setTimeout(() => {
    hideTimer = null;
    if (pillWindow && !pillWindow.isDestroyed()) {
      pillWindow.close();
      pillWindow = null;
    }
  }, 300);

  log.info('[RecordingPill] Hiding recording pill');
}
