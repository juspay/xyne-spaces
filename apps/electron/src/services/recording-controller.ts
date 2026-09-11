import { app, BrowserWindow, powerMonitor, powerSaveBlocker } from 'electron';
import log from 'electron-log/main';
import { getMainWindow, createMainWindow, setWindowReferences } from '../window/manager';
import {
  showRecordingPill,
  hideRecordingPill,
  isPillWindow,
  isRecordingPillEnabled,
  persistRecordingPillEnabled,
  prewarmRecordingPill,
} from './recording-pill-window';

export type RecordingTrigger = 'tray' | 'shortcut' | 'pill';

export interface RecordingSnapshot {
  active: boolean;
  startTime: number | null;
  paused: boolean;
  pauseStartedAt: number | null;
  accumulatedPausedMs: number;
}

export interface RecordingPauseState {
  paused: boolean;
  pauseStartedAt: number | null;
  accumulatedPausedMs: number;
}

const RENDERER_READY_TIMEOUT_MS = 10_000;
const STARTING_RECORDING_TIMEOUT_MS = 2 * 60_000;
const EXTERNAL_START_TIMEOUT_MS = 5 * 60_000;
const PILL_SYNC_DEBOUNCE_MS = 150;
const FOCUS_REQUEST_GRACE_MS = 2_000;

let pillSyncTimer: ReturnType<typeof setTimeout> | null = null;
let focusRequestTimer: ReturnType<typeof setTimeout> | null = null;

let active = false;
let startingRecording = false;
let callActive = false;
let startingRecordingExpiry: ReturnType<typeof setTimeout> | null = null;
let startTime: number | null = null;
let paused = false;
let pauseStartedAt: number | null = null;
let accumulatedPausedMs = 0;
let externalStartExpiry: ReturnType<typeof setTimeout> | null = null;

let minimized = false;

let powerSaveBlockerId: number | null = null;

let rendererReady = false;
let rendererReadyWaiters: Array<() => void> = [];
const watchedRenderers = new WeakSet<BrowserWindow>();

const listeners = new Set<(snapshot: RecordingSnapshot) => void>();

function getSnapshot(): RecordingSnapshot {
  return { active, startTime, paused, pauseStartedAt, accumulatedPausedMs };
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
    // A reload tears down the LiveKit connection, so any call is over; the
    // remounted renderer resends call state either way. Without this a renderer
    // that hangs mid-reload would strand the flag true and mute detection.
    callActive = false;
  });
  win.webContents.on('render-process-gone', () => {
    rendererReady = false;
    // syncRecordingState early-returns on inactive -> inactive, so a crash
    // mid-start would strand the flag.
    setRecordingStarting(false);
    callActive = false;
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

export function focusMainWindow(): BrowserWindow | null {
  const mainWindow = getMainWindow();
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  markFocusRequested();
  mainWindow.show();
  mainWindow.focus();
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
  const wantsPill =
    (active || startingRecording) &&
    isRecordingPillEnabled() &&
    (minimized || !isMainWindowFocused());
  if (wantsPill) {
    showRecordingPill({
      starting: !active,
      startTime: active ? (startTime ?? Date.now()) : null,
      paused,
      pauseStartedAt,
      accumulatedPausedMs,
    });
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

export function setRecordingPillEnabled(enabled: boolean): void {
  persistRecordingPillEnabled(enabled);
  if (enabled) prewarmRecordingPill();
  syncPillVisibility();
  log.info(`[RecordingController] Recording pill ${enabled ? 'enabled' : 'disabled'}`);
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
  if (isRecordingPillEnabled()) prewarmRecordingPill();

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
  if (active || startingRecording) return;

  setRecordingStarting(true);

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
      setRecordingStarting(false);
      return;
    }
  }

  mainWindow = getMainWindow();
  if (!mainWindow || mainWindow.isDestroyed()) {
    setRecordingStarting(false);
    return;
  }

  if (
    !rendererReady &&
    (createdMainWindow || mainWindow.webContents.isLoadingMainFrame())
  ) {
    await waitForRenderer();
  }

  mainWindow = getMainWindow();
  if (!mainWindow || mainWindow.isDestroyed()) {
    setRecordingStarting(false);
    return;
  }

  log.info(`[RecordingController] Start requested from ${trigger}`);
  markExternalStartPending();

  if (!rendererReady) {
    log.warn(`[RecordingController] Renderer not ready for ${trigger} start`);
    setRecordingStarting(false);
  }

  if (!isRecordingPillEnabled()) focusMainWindow();
  mainWindow.webContents.send('meeting:start-recording');
}

export function stopRecording(trigger: RecordingTrigger): void {
  minimized = false;
  cancelPendingPillSync();
  setRecordingStarting(false);
  focusMainWindow()?.webContents.send('meeting:stop-recording');
  hideRecordingPill();
  log.info(`[RecordingController] Stop requested from ${trigger}`);
}

export async function stopRecordingForReload(timeoutMs = 3000): Promise<void> {
  if (!isRecordingInProgress()) return;

  const mainWindow = getMainWindow();
  if (!mainWindow || mainWindow.isDestroyed()) return;

  mainWindow.webContents.send('recording:stop-for-teardown');
  log.info('[RecordingController] Stop requested before reload');

  await new Promise<void>(resolve => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let unsubscribe: (() => void) | null = null;
    const finish = (): void => {
      if (timer) clearTimeout(timer);
      unsubscribe?.();
      resolve();
    };
    unsubscribe = onRecordingStateChange(() => {
      if (!isRecordingInProgress()) finish();
    });
    timer = setTimeout(finish, timeoutMs);
  });
}

export function pauseRecordingFromOutside(trigger: RecordingTrigger): void {
  if (!active || paused) return;
  const mainWindow = getMainWindow();
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('recording:pause-requested');
  log.info(`[RecordingController] Pause requested from ${trigger}`);
}

export function resumeRecordingFromOutside(trigger: RecordingTrigger): void {
  if (!active || !paused) return;
  const mainWindow = getMainWindow();
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('recording:resume-requested');
  log.info(`[RecordingController] Resume requested from ${trigger}`);
}

export function toggleRecording(trigger: RecordingTrigger): void {
  if (active) {
    stopRecording(trigger);
  } else {
    void startRecordingFromOutside(trigger);
  }
}

// Not folded into syncRecordingState: that early-returns when the recording is
// inactive and was already inactive, which is exactly what a start looks like.
export function setRecordingStarting(next: boolean): void {
  if (startingRecordingExpiry) {
    clearTimeout(startingRecordingExpiry);
    startingRecordingExpiry = null;
  }
  const changed = startingRecording !== next;
  startingRecording = next;
  if (changed) syncPillVisibility();
  if (!next) return;

  // The renderer is the only thing that clears this, and a hung start never
  // reports back, so bound it — otherwise one stuck start suppresses the meeting
  // popup for the rest of the session.
  startingRecordingExpiry = setTimeout(() => {
    startingRecordingExpiry = null;
    startingRecording = false;
    syncPillVisibility();
    log.warn('[RecordingController] Recording start was not confirmed by the renderer');
  }, STARTING_RECORDING_TIMEOUT_MS);
}

export function isRecordingInProgress(): boolean {
  return active || startingRecording;
}

// Calls enable the mic the same way recordings do, so the meeting detector must
// treat both as ours. The renderer reports call state on every transition and on
// mount; the lifecycle hooks above clear it when the renderer reloads or dies.
export function setCallActive(next: boolean): void {
  callActive = next;
}

export function isMicOwnedByXyne(): boolean {
  return active || startingRecording || callActive;
}

export function syncRecordingState(
  nextActive: boolean,
  nextStartTime?: number,
  nextPause?: RecordingPauseState,
): void {
  const wasActive = active;
  if (!nextActive && !wasActive) return;

  active = nextActive;
  startTime = nextActive ? (nextStartTime ?? Date.now()) : null;
  paused = nextActive ? !!nextPause?.paused : false;
  pauseStartedAt = nextActive ? (nextPause?.pauseStartedAt ?? null) : null;
  accumulatedPausedMs = nextActive ? (nextPause?.accumulatedPausedMs ?? 0) : 0;

  if (nextActive) {
    // Via the setter so the watchdog is cleared too, not just the flag.
    setRecordingStarting(false);
  }
  if (nextActive && !wasActive) {
    clearExternalStartPending();
  }
  if (!nextActive) minimized = false;

  syncPowerSaveBlocker();
  syncPillVisibility();

  notifyListeners();
}
