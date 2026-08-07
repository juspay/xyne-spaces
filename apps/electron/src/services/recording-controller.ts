import { app, BrowserWindow, powerMonitor, powerSaveBlocker } from 'electron';
import log from 'electron-log/main';
import { getMainWindow, createMainWindow, setWindowReferences } from '../window/manager';
import { showRecordingPill, hideRecordingPill, isPillWindow } from './recording-pill-window';

export type RecordingTrigger = 'tray' | 'shortcut' | 'pill';

export interface RecordingSnapshot {
  active: boolean;
  startTime: number | null;
}

const RENDERER_READY_TIMEOUT_MS = 10_000;
const EXTERNAL_START_TIMEOUT_MS = 5 * 60_000;
const PILL_SYNC_DEBOUNCE_MS = 150;
const FOCUS_REQUEST_GRACE_MS = 2_000;

let pillSyncTimer: ReturnType<typeof setTimeout> | null = null;
let focusRequestTimer: ReturnType<typeof setTimeout> | null = null;

let active = false;
let startTime: number | null = null;
let externalStartExpiry: ReturnType<typeof setTimeout> | null = null;

let minimized = false;

let powerSaveBlockerId: number | null = null;

let rendererReady = false;
let rendererReadyWaiters: Array<() => void> = [];
const watchedRenderers = new WeakSet<BrowserWindow>();

const listeners = new Set<(snapshot: RecordingSnapshot) => void>();

function getSnapshot(): RecordingSnapshot {
  return { active, startTime };
}

function notifyListeners(): void {
  const snapshot = getSnapshot();
  for (const listener of listeners) listener(snapshot);
}

function clearExternalStartPending(): void {
  if (externalStartExpiry) {
    clearTimeout(externalStartExpiry);
    externalStartExpiry = null;
  }
}

export function getRecordingSnapshot(): RecordingSnapshot {
  return getSnapshot();
}

export function onRecordingStateChange(
  listener: (snapshot: RecordingSnapshot) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function watchRendererLifecycle(win: BrowserWindow): void {
  if (watchedRenderers.has(win)) return;
  watchedRenderers.add(win);
  win.webContents.on('did-start-loading', () => {
    rendererReady = false;
  });
  win.webContents.on('render-process-gone', () => {
    rendererReady = false;
    syncRecordingState(false);
  });
}

export function markRendererReady(): void {
  rendererReady = true;
  const win = getMainWindow();
  if (win && !win.isDestroyed()) watchRendererLifecycle(win);
  const waiters = rendererReadyWaiters;
  rendererReadyWaiters = [];
  for (const waiter of waiters) waiter();
}

function waitForRenderer(): Promise<void> {
  if (rendererReady) return Promise.resolve();
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const waiter = (): void => {
      if (timer) clearTimeout(timer);
      resolve();
    };
    timer = setTimeout(() => {
      rendererReadyWaiters = rendererReadyWaiters.filter((entry) => entry !== waiter);
      log.warn('[RecordingController] Renderer did not report ready in time');
      resolve();
    }, RENDERER_READY_TIMEOUT_MS);
    rendererReadyWaiters.push(waiter);
  });
}

function markFocusRequested(): void {
  clearFocusRequested();
  focusRequestTimer = setTimeout(() => {
    focusRequestTimer = null;
    syncPillVisibility();
  }, FOCUS_REQUEST_GRACE_MS);
}

function clearFocusRequested(): void {
  if (!focusRequestTimer) return;
  clearTimeout(focusRequestTimer);
  focusRequestTimer = null;
}

export function focusMainWindow(pathname?: string): BrowserWindow | null {
  const mainWindow = getMainWindow();
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  markFocusRequested();
  mainWindow.show();
  mainWindow.focus();
  if (pathname) mainWindow.webContents.send('navigate-to', pathname);
  return mainWindow;
}

function isMainWindowFocused(): boolean {
  if (focusRequestTimer) return true;
  const mainWindow = getMainWindow();
  return !!mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused();
}

function syncPowerSaveBlocker(): void {
  if (active && powerSaveBlockerId === null) {
    powerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension');
  } else if (!active && powerSaveBlockerId !== null) {
    powerSaveBlocker.stop(powerSaveBlockerId);
    powerSaveBlockerId = null;
  }
}

function cancelPendingPillSync(): void {
  if (pillSyncTimer) {
    clearTimeout(pillSyncTimer);
    pillSyncTimer = null;
  }
}

function syncPillVisibility(): void {
  cancelPendingPillSync();
  if (active && (minimized || !isMainWindowFocused())) {
    showRecordingPill(startTime ?? Date.now());
  } else {
    hideRecordingPill();
  }
}

function scheduleSyncPillVisibility(): void {
  cancelPendingPillSync();
  pillSyncTimer = setTimeout(() => {
    pillSyncTimer = null;
    syncPillVisibility();
  }, PILL_SYNC_DEBOUNCE_MS);
}

export function setOverlayMinimized(next: boolean): void {
  if (minimized === next) return;
  minimized = next;
  syncPillVisibility();
  const mainWindow = getMainWindow();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('recording:minimized-changed', minimized);
  }
}

export function initRecordingPillVisibility(): void {
  const handleWindowFocus = (_event: Electron.Event, window: BrowserWindow): void => {
    if (isPillWindow(window)) return;
    if (window === getMainWindow()) clearFocusRequested();
    scheduleSyncPillVisibility();
  };
  const handleWindowBlur = (_event: Electron.Event, window: BrowserWindow): void => {
    if (isPillWindow(window)) return;
    scheduleSyncPillVisibility();
  };

  app.on('browser-window-focus', handleWindowFocus);
  app.on('browser-window-blur', handleWindowBlur);

  // A screen lock is not necessarily a lid close (it can be automatic or
  // user-initiated), so only react to system suspension. This includes lid
  // close while leaving an active recording alone when the screen merely locks.
  const handleSuspend = (): void => {
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('recording:system-suspend');
    }

    if (!active) return;
    syncRecordingState(false);
    log.info('[RecordingController] Stop requested because the system is suspending');
  };
  powerMonitor.on('suspend', handleSuspend);

  app.once('will-quit', () => {
    cancelPendingPillSync();
    clearFocusRequested();
    app.removeListener('browser-window-focus', handleWindowFocus);
    app.removeListener('browser-window-blur', handleWindowBlur);
    powerMonitor.removeListener('suspend', handleSuspend);
    if (powerSaveBlockerId !== null) {
      powerSaveBlocker.stop(powerSaveBlockerId);
      powerSaveBlockerId = null;
    }
  });
}

function markExternalStartPending(): void {
  clearExternalStartPending();
  externalStartExpiry = setTimeout(() => {
    externalStartExpiry = null;
    log.warn('[RecordingController] External start was not confirmed by the renderer');
  }, EXTERNAL_START_TIMEOUT_MS);
}

export async function startRecordingFromOutside(trigger: RecordingTrigger): Promise<void> {
  if (active) return;

  let mainWindow = getMainWindow();
  let createdMainWindow = false;
  if (!mainWindow || mainWindow.isDestroyed()) {
    rendererReady = false;
    try {
      await createMainWindow({ inactive: true });
      setWindowReferences();
      createdMainWindow = true;
    } catch (error) {
      log.error(`[RecordingController] Failed to create window for ${trigger} start:`, error);
      return;
    }
  }

  mainWindow = getMainWindow();
  if (!mainWindow || mainWindow.isDestroyed()) return;

  if (
    !rendererReady &&
    (createdMainWindow || mainWindow.webContents.isLoadingMainFrame())
  ) {
    await waitForRenderer();
  }

  mainWindow = getMainWindow();
  if (!mainWindow || mainWindow.isDestroyed()) return;

  log.info(`[RecordingController] Start requested from ${trigger}`);
  markExternalStartPending();
  mainWindow.webContents.send('navigate-to', '/recordings');
  mainWindow.webContents.send('meeting:start-recording');
}

export function stopRecording(trigger: RecordingTrigger): void {
  minimized = false;
  cancelPendingPillSync();
  focusMainWindow('/recordings')?.webContents.send('meeting:stop-recording');
  hideRecordingPill();
  log.info(`[RecordingController] Stop requested from ${trigger}`);
}

export function toggleRecording(trigger: RecordingTrigger): void {
  if (active) {
    stopRecording(trigger);
  } else {
    void startRecordingFromOutside(trigger);
  }
}

export function syncRecordingState(nextActive: boolean, nextStartTime?: number): void {
  const wasActive = active;
  if (!nextActive && !wasActive) return;

  active = nextActive;
  startTime = nextActive ? (nextStartTime ?? Date.now()) : null;

  if (nextActive && !wasActive) {
    clearExternalStartPending();
  }
  if (!nextActive) minimized = false;

  syncPowerSaveBlocker();
  syncPillVisibility();

  notifyListeners();
}
