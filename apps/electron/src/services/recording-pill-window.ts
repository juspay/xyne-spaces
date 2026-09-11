import { BrowserWindow, screen, ipcMain } from 'electron';
import path from 'path';
import Store from 'electron-store';
import log from 'electron-log/main';

const pillStore = new Store({ name: 'recording-pill' });
const POSITION_KEY = 'pillPosition';
const ENABLED_KEY = 'pillEnabled';

let pillWindow: BrowserWindow | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let pillRequested = false;
let ignoreMouseHandler: ((event: Electron.IpcMainEvent, ignore: boolean) => void) | null = null;
let dragStartHandler: ((event: Electron.IpcMainEvent) => void) | null = null;
let dragEndHandler: ((event: Electron.IpcMainEvent) => void) | null = null;
let dragInterval: ReturnType<typeof setInterval> | null = null;

let displayMetricsHandler: (() => void) | null = null;
let displayRemovedHandler: (() => void) | null = null;
let displayDebounceTimer: ReturnType<typeof setTimeout> | null = null;

let savedPosition: { x: number; y: number } | null = null;
let currentState: RecordingPillState | null = null;
let currentTheme: RecordingPillTheme = 'light';

export type RecordingPillTheme = 'light' | 'dark';

export interface RecordingPillState {
  starting: boolean;
  startTime: number | null;
  paused: boolean;
  pauseStartedAt: number | null;
  accumulatedPausedMs: number;
}

const GUTTER = 32;
const CARD_EXPANDED_WIDTH = 92;
const CARD_MAX_HEIGHT = 98;
const WINDOW_WIDTH = CARD_EXPANDED_WIDTH + GUTTER * 2;
const WINDOW_HEIGHT = CARD_MAX_HEIGHT + GUTTER * 2;
const EDGE_MARGIN = 20;

export function isPillWindow(win: BrowserWindow | null | undefined): boolean {
  return !!win && !!pillWindow && !pillWindow.isDestroyed() && win === pillWindow;
}

export function isPillSender(event: Electron.IpcMainEvent): boolean {
  return (
    !!pillWindow &&
    !pillWindow.isDestroyed() &&
    event.sender === pillWindow.webContents &&
    event.senderFrame === pillWindow.webContents.mainFrame
  );
}

export function isRecordingPillEnabled(): boolean {
  return pillStore.get(ENABLED_KEY, true) as boolean;
}

export function persistRecordingPillEnabled(enabled: boolean): void {
  pillStore.set(ENABLED_KEY, enabled);
}

export function setRecordingPillTheme(theme: RecordingPillTheme): void {
  currentTheme = theme;
  if (!pillWindow || pillWindow.isDestroyed()) return;
  pillWindow.webContents.send('recording-pill:theme-changed', currentTheme);
}

function readStoredPosition(): { x: number; y: number } | null {
  const raw = pillStore.get(POSITION_KEY) as { x?: number; y?: number } | undefined;
  if (!raw || !Number.isFinite(raw.x) || !Number.isFinite(raw.y)) return null;
  return { x: raw.x as number, y: raw.y as number };
}

function persistPosition(pos: { x: number; y: number }): void {
  savedPosition = pos;
  pillStore.set(POSITION_KEY, pos);
}

function getDefaultPosition(): { x: number; y: number } {
  const { workArea } = screen.getPrimaryDisplay();
  const x = workArea.x + workArea.width - WINDOW_WIDTH - EDGE_MARGIN + GUTTER;
  const y = workArea.y + Math.round((workArea.height - WINDOW_HEIGHT) / 2);
  return { x, y };
}

function clampToVisibleDisplay(pos: { x: number; y: number }): { x: number; y: number } {
  const { workArea } = screen.getDisplayNearestPoint(pos);
  const minX = workArea.x - GUTTER;
  const maxX = workArea.x + workArea.width - WINDOW_WIDTH + GUTTER;
  const minY = workArea.y - GUTTER;
  const maxY = workArea.y + workArea.height - WINDOW_HEIGHT + GUTTER;
  return {
    x: Math.round(Math.min(Math.max(pos.x, minX), Math.max(minX, maxX))),
    y: Math.round(Math.min(Math.max(pos.y, minY), Math.max(minY, maxY))),
  };
}

function getInitialPosition(): { x: number; y: number } {
  const stored = savedPosition ?? readStoredPosition();
  return stored ? clampToVisibleDisplay(stored) : getDefaultPosition();
}

function applyIgnoreMouseEvents(ignore: boolean): void {
  if (!pillWindow || pillWindow.isDestroyed()) return;
  if (process.platform === 'linux') return;
  pillWindow.setIgnoreMouseEvents(ignore, { forward: true });
}

function reclampToVisibleDisplay(): void {
  if (!pillWindow || pillWindow.isDestroyed()) return;
  if (dragInterval) return;
  const [x, y] = pillWindow.getPosition();
  const clamped = clampToVisibleDisplay({ x, y });
  if (clamped.x === x && clamped.y === y) return;
  pillWindow.setPosition(clamped.x, clamped.y);
  persistPosition(clamped);
  log.info('[RecordingPill] Re-clamped pill after display change');
}

function scheduleReclamp(): void {
  if (displayDebounceTimer) clearTimeout(displayDebounceTimer);
  displayDebounceTimer = setTimeout(() => {
    displayDebounceTimer = null;
    reclampToVisibleDisplay();
  }, 150);
}

function registerDisplayListeners(): void {
  unregisterDisplayListeners();
  displayMetricsHandler = (): void => scheduleReclamp();
  displayRemovedHandler = (): void => scheduleReclamp();
  screen.on('display-metrics-changed', displayMetricsHandler);
  screen.on('display-removed', displayRemovedHandler);
}

function unregisterDisplayListeners(): void {
  if (displayMetricsHandler) {
    screen.removeListener('display-metrics-changed', displayMetricsHandler);
    displayMetricsHandler = null;
  }
  if (displayRemovedHandler) {
    screen.removeListener('display-removed', displayRemovedHandler);
    displayRemovedHandler = null;
  }
  if (displayDebounceTimer) {
    clearTimeout(displayDebounceTimer);
    displayDebounceTimer = null;
  }
}

function startDrag(): void {
  if (dragInterval || !pillWindow || pillWindow.isDestroyed()) return;

  const cursor = screen.getCursorScreenPoint();
  const [winX, winY] = pillWindow.getPosition();
  const offsetX = cursor.x - winX;
  const offsetY = cursor.y - winY;

  dragInterval = setInterval(() => {
    if (!pillWindow || pillWindow.isDestroyed()) {
      stopDrag();
      return;
    }
    const point = screen.getCursorScreenPoint();
    pillWindow.setPosition(point.x - offsetX, point.y - offsetY);
  }, 16);
}

function stopDrag(): void {
  if (dragInterval) {
    clearInterval(dragInterval);
    dragInterval = null;
  }
  if (!pillWindow || pillWindow.isDestroyed()) return;
  const [x, y] = pillWindow.getPosition();
  const clamped = clampToVisibleDisplay({ x, y });
  if (clamped.x !== x || clamped.y !== y) {
    pillWindow.setPosition(clamped.x, clamped.y);
  }
  persistPosition(clamped);
}

export function showRecordingPill(state: RecordingPillState): void {
  const wasHiding = hideTimer !== null;
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }

  currentState = state;
  pillRequested = true;

  if (!pillWindow || pillWindow.isDestroyed()) {
    createPillWindow();
    return;
  }

  if (pillWindow.webContents.isLoading()) return;

  pillWindow.webContents.send('recording-pill:theme-changed', currentTheme);
  pillWindow.webContents.send('recording-pill:show', currentState);
  if (!pillWindow.isVisible() || wasHiding) {
    applyIgnoreMouseEvents(true);
  }
  if (!pillWindow.isVisible()) {
    pillWindow.showInactive();
  }
}

/**
 * Builds the pill window ahead of the first recording so a start never pays
 * window construction + loadFile on the critical path.
 */
export function prewarmRecordingPill(): void {
  if (pillWindow && !pillWindow.isDestroyed()) return;
  createPillWindow();
}

function createPillWindow(): void {
  const pos = getInitialPosition();

  pillWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    x: pos.x,
    y: pos.y,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    skipTaskbar: true,
    hasShadow: false,
    focusable: true,
    fullscreenable: false,
    show: false,
    paintWhenInitiallyHidden: true,
    type: 'panel',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '..', 'preload.js'),
      backgroundThrottling: false,
    },
  });

  pillWindow.setAlwaysOnTop(true, 'screen-saver');
  pillWindow.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
    skipTransformProcessType: true,
  });

  pillWindow.on('moved', () => {
    if (dragInterval) return;
    if (pillWindow && !pillWindow.isDestroyed()) {
      const [x, y] = pillWindow.getPosition();
      persistPosition({ x, y });
    }
  });

  const pillHtml = path.join(__dirname, '..', '..', 'assets', 'recording-pill.html');
  pillWindow.loadFile(pillHtml).catch((error) => {
    log.error('[RecordingPill] Failed to load pill HTML:', error);
  });

  if (ignoreMouseHandler) {
    ipcMain.removeListener('recording-pill:set-ignore-mouse', ignoreMouseHandler);
  }
  ignoreMouseHandler = (event, ignore): void => {
    if (!isPillSender(event)) return;
    applyIgnoreMouseEvents(ignore);
  };
  ipcMain.on('recording-pill:set-ignore-mouse', ignoreMouseHandler);

  if (dragStartHandler) ipcMain.removeListener('recording-pill:drag-start', dragStartHandler);
  dragStartHandler = (event): void => {
    if (!isPillSender(event)) return;
    startDrag();
  };
  ipcMain.on('recording-pill:drag-start', dragStartHandler);

  if (dragEndHandler) ipcMain.removeListener('recording-pill:drag-end', dragEndHandler);
  dragEndHandler = (event): void => {
    if (!isPillSender(event)) return;
    stopDrag();
  };
  ipcMain.on('recording-pill:drag-end', dragEndHandler);

  pillWindow.webContents.on('did-finish-load', () => {
    if (!pillWindow || pillWindow.isDestroyed()) return;
    void pillWindow.webContents
      .insertCSS(
        `:root { --gutter: ${GUTTER}px !important; --card-expanded-w: ${CARD_EXPANDED_WIDTH}px !important; }`,
      )
      .catch((error) => log.warn('[RecordingPill] Failed to inject layout CSS', error));
    applyIgnoreMouseEvents(true);
    if (!pillRequested || !currentState) return;
    pillWindow.webContents.send('recording-pill:theme-changed', currentTheme);
    pillWindow.webContents.send('recording-pill:show', currentState);
    pillWindow.showInactive();
  });

  pillWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    log.error(`[RecordingPill] Load failed (${errorCode}): ${errorDescription}`);
  });

  pillWindow.webContents.on('render-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit') return;
    log.error(`[RecordingPill] Renderer gone: ${details.reason}`);
    stopDrag();
    if (!pillWindow || pillWindow.isDestroyed()) return;
    applyIgnoreMouseEvents(true);
    pillWindow.reload();
  });

  registerDisplayListeners();

  pillWindow.on('closed', () => {
    if (ignoreMouseHandler) {
      ipcMain.removeListener('recording-pill:set-ignore-mouse', ignoreMouseHandler);
      ignoreMouseHandler = null;
    }
    if (dragStartHandler) {
      ipcMain.removeListener('recording-pill:drag-start', dragStartHandler);
      dragStartHandler = null;
    }
    if (dragEndHandler) {
      ipcMain.removeListener('recording-pill:drag-end', dragEndHandler);
      dragEndHandler = null;
    }
    if (dragInterval) {
      clearInterval(dragInterval);
      dragInterval = null;
    }
    unregisterDisplayListeners();
    pillWindow = null;
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  });

  log.info('[RecordingPill] Pill window created');
}

export function hideRecordingPill(): void {
  pillRequested = false;
  if (!pillWindow || pillWindow.isDestroyed()) return;
  if (hideTimer || !pillWindow.isVisible()) return;

  stopDrag();

  pillWindow.webContents.send('recording-pill:hide');
  hideTimer = setTimeout(() => {
    hideTimer = null;
    if (pillWindow && !pillWindow.isDestroyed()) pillWindow.hide();
  }, 300);

  log.info('[RecordingPill] Hiding recording pill');
}
