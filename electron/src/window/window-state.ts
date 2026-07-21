/**
 * Main-window state persistence.
 *
 * Persists the main window's size / position / maximized flag to electron-store
 * (the same persistence primitive used elsewhere in this app) and restores it on
 * the next launch. On the very first run (no saved state) the window defaults to
 * maximized so it fills the work area while keeping the menu bar and Dock visible.
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

const store = new Store<{ [STORE_KEY]?: WindowState }>({ name: 'window-state' });

// The last known *windowed* (non-maximized, non-compact) bounds. This is what we
// restore to, so a maximized window doesn't persist the maximized rectangle as its
// restore size.
let lastNormalBounds: { width: number; height: number; x: number; y: number } | null = null;

let saveTimer: ReturnType<typeof setTimeout> | null = null;

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

/**
 * Read + validate the saved state. Returns null if there is no valid saved state.
 */
export function getSavedState(): WindowState | null {
  const raw = store.get(STORE_KEY);
  if (!raw || typeof raw !== 'object') return null;

  if (!isFiniteNumber(raw.width) || !isFiniteNumber(raw.height)) return null;

  const width = Math.max(MIN_WIDTH, Math.round(raw.width));
  const height = Math.max(MIN_HEIGHT, Math.round(raw.height));
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
    log.info('[WindowState] saved bounds off-screen; restoring size only, centered');
    return { width, height, isMaximized };
  }

  return { width, height, isMaximized };
}

/**
 * Options to spread into the BrowserWindow constructor. Falls back to the config
 * default size (centered) when there is no valid saved state.
 */
export function getCreateOptions(): CreateOptions {
  const saved = getSavedState();
  const base: CreateOptions = {
    width: saved?.width ?? config.window.width,
    height: saved?.height ?? config.window.height,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
  };
  if (saved && isFiniteNumber(saved.x) && isFiniteNumber(saved.y)) {
    base.x = saved.x;
    base.y = saved.y;
  }
  return base;
}

/**
 * Apply post-construction state. Must be called right after `new BrowserWindow`.
 * - If there is saved state and it was maximized -> maximize.
 * - If there is NO saved state (first run) -> maximize as the default so the window
 *   fills the work area (menu bar + Dock stay visible; this is NOT full screen).
 */
export function applyPostCreate(win: BrowserWindow): void {
  const saved = getSavedState();
  if (!saved) {
    log.info('[WindowState] no saved state (first run) -> maximize');
    win.maximize();
    return;
  }
  if (saved.isMaximized) {
    log.info('[WindowState] restoring maximized window');
    win.maximize();
  } else {
    log.info('[WindowState] restored windowed bounds', {
      width: saved.width,
      height: saved.height,
      x: saved.x,
      y: saved.y,
    });
  }
}

function computeAndSave(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  const isMaximized = win.isMaximized();

  // Keep the windowed bounds current whenever the window is in a normal state.
  if (!isMaximized && !win.isFullScreen()) {
    const b = win.getBounds();
    lastNormalBounds = { width: b.width, height: b.height, x: b.x, y: b.y };
  }

  const restore = lastNormalBounds ?? {
    width: config.window.width,
    height: config.window.height,
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
}

/**
 * Persist immediately (used on close so Cmd+Q and hide both capture latest bounds).
 */
export function saveNow(win: BrowserWindow): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  computeAndSave(win);
}

function scheduleSave(win: BrowserWindow): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    computeAndSave(win);
  }, SAVE_DEBOUNCE_MS);
}

/**
 * Wire up persistence listeners.
 *
 * @param win           the main window
 * @param isSaveBlocked optional predicate; when it returns true, resize/move events
 *                      are ignored (e.g. while compact mode has forced a small size).
 */
export function track(win: BrowserWindow, isSaveBlocked?: () => boolean): void {
  const onBoundsChange = () => {
    if (isSaveBlocked?.()) return;
    scheduleSave(win);
  };

  win.on('resize', onBoundsChange);
  win.on('move', onBoundsChange);
  // Maximize/unmaximize should persist immediately and are never "blocked".
  win.on('maximize', () => computeAndSave(win));
  win.on('unmaximize', () => computeAndSave(win));
}
