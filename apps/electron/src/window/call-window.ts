import { BrowserWindow, shell } from 'electron';
import path from 'path';
import log from 'electron-log/main';
import { config } from '../app/config';
import { getIsQuitting } from '../app/main';
import { getBundledUIUrl } from '../services/custom-protocol';
import { setCallWindow as setInterceptorCallWindow } from '../services/request-interceptor';
import { setupPermissionRequestOnFocus } from '../services/media-permission';
import {
  clearCallActiveForWindow,
  isCallActiveForWindow,
} from '../services/recording-controller';
import { createWindowStateTracker } from './window-state';

const CALL_WINDOW_ROUTE_PREFIX = '/newWindow/call/';

const IDLE_CALL_ROUTE = '/newWindow/call/idle/VIDEO?stage=idle';

const stateTracker = createWindowStateTracker({
  storeName: 'call-window-state',
  defaultWidth: 960,
  defaultHeight: 640,
  minWidth: 480,
  minHeight: 360,
  maximizeOnFirstRun: false,
  logLabel: 'CallWindowState',
});

let callWindow: BrowserWindow | null = null;

let pendingCallRoute: string | null = null;

export function takePendingCallRoute(): string | null {
  const route = pendingCallRoute;
  pendingCallRoute = null;
  return route;
}

function setRingAttention(win: BrowserWindow, ringing: boolean): void {
  if (win.isDestroyed()) return;
  if (ringing) {
    win.setAlwaysOnTop(true, 'floating');
    win.moveTop();
    return;
  }
  win.setAlwaysOnTop(false);
}

export function setCallWindowRinging(ringing: boolean): void {
  const win = getCallWindow();
  if (win) setRingAttention(win, ringing);
}

export function getCallWindow(): BrowserWindow | null {
  return callWindow && !callWindow.isDestroyed() ? callWindow : null;
}

function buildCallUrl(relativePath: string): string {
  const suffix = relativePath.startsWith('/') ? relativePath.slice(1) : relativePath;
  return config.useBundledUI
    ? `${getBundledUIUrl()}${suffix}`
    : new URL(`/${suffix}`, config.FRONTEND_URL).toString();
}

function isCallRoute(navUrl: string): boolean {
  try {
    const target = new URL(navUrl);
    const base = new URL(buildCallUrl(IDLE_CALL_ROUTE));
    if (target.protocol !== base.protocol || target.host !== base.host) return false;
    return target.pathname.startsWith(CALL_WINDOW_ROUTE_PREFIX);
  } catch {
    return false;
  }
}

export interface OpenCallWindowRequest {
  relativePath: string;
  inactive?: boolean;
}

export function prewarmCallWindow(): void {
  if (getCallWindow()) return;
  log.info('[CallWindow] prewarming');
  createCallWindow({ relativePath: IDLE_CALL_ROUTE, inactive: true }, { prewarm: true });
}

export function openCallWindow(request: OpenCallWindowRequest): BrowserWindow {
  const existing = getCallWindow();
  if (existing) {
    pendingCallRoute = request.relativePath;
    existing.webContents.send('call:navigate', request.relativePath);
    if (request.inactive) {
      setRingAttention(existing, true);
      existing.showInactive();
    } else {
      if (existing.isMinimized()) existing.restore();
      existing.show();
      existing.focus();
    }
    return existing;
  }

  return createCallWindow(request);
}

function createCallWindow(
  request: OpenCallWindowRequest,
  options?: { prewarm?: boolean },
): BrowserWindow {
  const createOpts = stateTracker.getCreateOptions();

  callWindow = new BrowserWindow({
    ...createOpts,
    show: false,
    title: 'Xyne Call',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 19, y: 20 },
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '..', 'preload.js'),
      backgroundThrottling: false,
    },
  });

  setInterceptorCallWindow(callWindow);

  stateTracker.applyPostCreate(callWindow);
  stateTracker.track(callWindow);

  callWindow.once('ready-to-show', () => {
    if (!callWindow || callWindow.isDestroyed()) return;
    if (options?.prewarm) return;
    if (request.inactive) {
      setRingAttention(callWindow, true);
      callWindow.showInactive();
    } else {
      callWindow.show();
      callWindow.focus();
    }
  });

  setupPermissionRequestOnFocus(callWindow);

  callWindow.webContents.setWindowOpenHandler((details) => {
    try {
      const url = new URL(details.url);
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        void shell.openExternal(details.url);
      }
    } catch (error) {
      log.warn('[CallWindow] Failed to parse window-open URL, denying:', details.url, error);
    }
    return { action: 'deny' };
  });

  callWindow.webContents.on('will-navigate', (event, navUrl) => {
    if (isCallRoute(navUrl)) return;
    event.preventDefault();
    log.warn('[CallWindow] Blocked navigation away from call route:', navUrl);
  });

  callWindow.on('close', (event) => {
    if (callWindow && !callWindow.isDestroyed()) {
      stateTracker.saveNow(callWindow);
    }
    if (getIsQuitting()) {
      log.info('[CallWindow] closing during app quit');
      return;
    }
    if (!callWindow || callWindow.isDestroyed()) return;

    event.preventDefault();
    setRingAttention(callWindow, false);

    if (isCallActiveForWindow(callWindow.webContents.id)) {
      callWindow.webContents.send('call:leave');
      callWindow.hide();
      return;
    }

    callWindow.hide();
    pendingCallRoute = IDLE_CALL_ROUTE;
    callWindow.webContents.send('call:navigate', IDLE_CALL_ROUTE);
  });

  const webContentsId = callWindow.webContents.id;
  callWindow.webContents.on('did-start-loading', () => {
    clearCallActiveForWindow(webContentsId);
  });
  callWindow.webContents.on('render-process-gone', () => {
    clearCallActiveForWindow(webContentsId);
    const win = getCallWindow();
    if (win) setRingAttention(win, false);
  });

  callWindow.on('closed', () => {
    clearCallActiveForWindow(webContentsId);
    setInterceptorCallWindow(null);
    callWindow = null;
  });

  void callWindow.loadURL(buildCallUrl(request.relativePath));

  return callWindow;
}

export function closeCallWindow(): void {
  const win = getCallWindow();
  if (win) win.close();
}
