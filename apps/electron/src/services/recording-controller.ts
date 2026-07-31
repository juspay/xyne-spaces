import { BrowserWindow } from 'electron';
import log from 'electron-log/main';
import { getMainWindow, createMainWindow, setWindowReferences } from '../window/manager';
import { showRecordingPill, hideRecordingPill } from './recording-pill-window';

export type RecordingTrigger = 'tray' | 'shortcut' | 'pill';

export interface RecordingSnapshot {
  active: boolean;
  startTime: number | null;
}

const RENDERER_READY_TIMEOUT_MS = 10_000;
const EXTERNAL_START_TIMEOUT_MS = 5 * 60_000;

let active = false;
let startTime: number | null = null;
let externalStartExpiry: ReturnType<typeof setTimeout> | null = null;

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

export function focusMainWindow(pathname?: string): BrowserWindow | null {
  const mainWindow = getMainWindow();
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  mainWindow.show();
  mainWindow.focus();
  if (pathname) mainWindow.webContents.send('navigate-to', pathname);
  return mainWindow;
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
    if (externalStartExpiry) {
      clearExternalStartPending();
      showRecordingPill(startTime ?? Date.now());
    }
  } else if (!nextActive && wasActive) {
    hideRecordingPill();
  }

  notifyListeners();
}
