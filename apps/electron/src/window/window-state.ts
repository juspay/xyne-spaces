/**
 * Window state persistence.
 *
 * Persists a window's size / position / maximized flag to electron-store
 * (the same persistence primitive used elsewhere in this app) and restores it on
 * the next launch. On the very first run (no saved state) the main window defaults
 * to maximized so it fills the work area while keeping the menu bar and Dock visible.
 *
 * Deliberately does NOT persist/restore macOS full screen — full screen is a
 * separate Space and relaunching directly into it is jarring.
 */
import { BrowserWindow, screen } from 'electron';
import Store from 'electron-store';
import log from 'electron-log/main';
import { config } from '../app/config';

const STORE_KEY = 'windowState';

// Minimum sane window size; also used to clamp restored/corrupt values.
const MIN_WIDTH = 800;
const MIN_HEIGHT = 600;

// Debounce window for resize/move persistence to avoid store thrash while dragging.
const SAVE_DEBOUNCE_MS = 400;

interface WindowState {
  width: number;
  height: number;
  x?: number;
  y?: number;
  isMaximized: boolean;
}

interface CreateOptions {
  width: number;
  height: number;
  x?: number;
  y?: number;
  minWidth: number;
  minHeight: number;
}

export interface WindowStateTrackerOptions {
  storeName: string;
  defaultWidth: number;
  defaultHeight: number;
  minWidth: number;
  minHeight: number;
  maximizeOnFirstRun: boolean;
  logLabel: string;
}

export interface WindowStateTracker {
  getSavedState: () => WindowState | null;
  getCreateOptions: () => CreateOptions;
  applyPostCreate: (win: BrowserWindow) => void;
  saveNow: (win: BrowserWindow) => void;
  track: (win: BrowserWindow, isSaveBlocked?: () => boolean) => void;
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

/**
 * True if the given bounds are visible on at least one currently-connected display.
 * Guards against restoring a window off-screen after a monitor is unplugged or the
 * display layout changes.
 */
function isVisibleOnSomeDisplay(x: number, y: number, width: number, height: number): boolean {
  return screen.getAllDisplays().some((d) => {
    const wa = d.workArea;
    return (
      x < wa.x + wa.width &&
      x + width > wa.x &&
      y < wa.y + wa.height &&
      y + height > wa.y
    );
  });
}

export function createWindowStateTracker(options: WindowStateTrackerOptions): WindowStateTracker {
  const store = new Store<{ [STORE_KEY]?: WindowState }>({ name: options.storeName });

  // The last known *windowed* (non-maximized, non-compact) bounds. This is what we
  // restore to, so a maximized window doesn't persist the maximized rectangle as its
  // restore size.
  let lastNormalBounds: { width: number; height: number; x: number; y: number } | null = null;

  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Read + validate the saved state. Returns null if there is no valid saved state.
   */
  const getSavedState = (): WindowState | null => {
    const raw = store.get(STORE_KEY);
    if (!raw || typeof raw !== 'object') return null;

    if (!isFiniteNumber(raw.width) || !isFiniteNumber(raw.height)) return null;

    const width = Math.max(options.minWidth, Math.round(raw.width));
    const height = Math.max(options.minHeight, Math.round(raw.height));
    const isMaximized = raw.isMaximized === true;

    const hasPosition = isFiniteNumber(raw.x) && isFiniteNumber(raw.y);
    if (hasPosition) {
      const x = Math.round(raw.x as number);
      const y = Math.round(raw.y as number);
      // Drop the position if it would place the window off every connected screen,
      // but keep the size so we still restore dimensions (centered).
      if (isVisibleOnSomeDisplay(x, y, width, height)) {
        return { width, height, x, y, isMaximized };
      }
      log.info(`[${options.logLabel}] saved bounds off-screen; restoring size only, centered`);
      return { width, height, isMaximized };
    }

    return { width, height, isMaximized };
  };

  const getCreateOptions = (): CreateOptions => {
    const saved = getSavedState();
    const base: CreateOptions = {
      width: saved?.width ?? options.defaultWidth,
      height: saved?.height ?? options.defaultHeight,
      minWidth: options.minWidth,
      minHeight: options.minHeight,
    };
    if (saved && isFiniteNumber(saved.x) && isFiniteNumber(saved.y)) {
      base.x = saved.x;
      base.y = saved.y;
    }
    return base;
  };

  const applyPostCreate = (win: BrowserWindow): void => {
    const saved = getSavedState();
    if (!saved) {
      if (options.maximizeOnFirstRun) {
        log.info(`[${options.logLabel}] no saved state (first run) -> maximize`);
        win.maximize();
      }
      return;
    }
    if (saved.isMaximized) {
      log.info(`[${options.logLabel}] restoring maximized window`);
      win.maximize();
    } else {
      log.info(`[${options.logLabel}] restored windowed bounds`, {
        width: saved.width,
        height: saved.height,
        x: saved.x,
        y: saved.y,
      });
    }
  };

  const computeAndSave = (win: BrowserWindow): void => {
    if (win.isDestroyed()) return;
    const isMaximized = win.isMaximized();

    // Keep the windowed bounds current whenever the window is in a normal state.
    if (!isMaximized && !win.isFullScreen()) {
      const b = win.getBounds();
      lastNormalBounds = { width: b.width, height: b.height, x: b.x, y: b.y };
    }

    const restore = lastNormalBounds ?? {
      width: options.defaultWidth,
      height: options.defaultHeight,
      x: undefined as unknown as number,
      y: undefined as unknown as number,
    };

    const next: WindowState = {
      width: restore.width,
      height: restore.height,
      isMaximized,
    };
    if (isFiniteNumber(restore.x) && isFiniteNumber(restore.y)) {
      next.x = restore.x;
      next.y = restore.y;
    }
    store.set(STORE_KEY, next);
  };

  /**
   * Persist immediately (used on close so Cmd+Q and hide both capture latest bounds).
   */
  const saveNow = (win: BrowserWindow): void => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    computeAndSave(win);
  };

  const scheduleSave = (win: BrowserWindow): void => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      computeAndSave(win);
    }, SAVE_DEBOUNCE_MS);
  };

  const track = (win: BrowserWindow, isSaveBlocked?: () => boolean): void => {
    const onBoundsChange = () => {
      if (isSaveBlocked?.()) return;
      scheduleSave(win);
    };

    win.on('resize', onBoundsChange);
    win.on('move', onBoundsChange);
    // Maximize/unmaximize should persist immediately and are never "blocked".
    win.on('maximize', () => computeAndSave(win));
    win.on('unmaximize', () => computeAndSave(win));
  };

  return { getSavedState, getCreateOptions, applyPostCreate, saveNow, track };
}

const mainWindowTracker = createWindowStateTracker({
  storeName: 'window-state',
  defaultWidth: config.window.width,
  defaultHeight: config.window.height,
  minWidth: MIN_WIDTH,
  minHeight: MIN_HEIGHT,
  maximizeOnFirstRun: true,
  logLabel: 'WindowState',
});

export const getSavedState = mainWindowTracker.getSavedState;
export const getCreateOptions = mainWindowTracker.getCreateOptions;
export const applyPostCreate = mainWindowTracker.applyPostCreate;
export const saveNow = mainWindowTracker.saveNow;
export const track = mainWindowTracker.track;
