import { BrowserWindow, dialog, ipcMain, screen, shell } from 'electron';
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import path from 'path';
import Store from 'electron-store';
import log from 'electron-log/main';
import { config } from '../app/config';
import { getIsQuitting } from '../app/app-state';
import { getBundledUIUrl } from './custom-protocol';
import { registerAppOwnedWindow } from './request-interceptor';
import { browserSettingsService } from './browser-settings';
import { setCallWindowActive } from './recording-controller';
import { getMainWindow } from '../window/manager';
import { callInvitePath } from '../utils/validation';

/**
 * The call window: a call running in its own top-level window (as in Slack
 * huddles) instead of the overlay inside the main window.
 *
 * The main window's renderer stays in charge of *whether* there is a call — it
 * fetches the LiveKit token, handles the lobby, rings, switches calls — and
 * hands the token to this window, which owns the actual LiveKit connection and
 * renders the call UI. State flows back as `call-window:status` so the main
 * window can mirror it (the same shape as the React Native host's native mode).
 *
 * Every handoff carries an id. A status only counts for the handoff it echoes,
 * so a late "ended" from the previous call can never tear down the next one.
 */

const ROUTE_PATH = '/newWindow/call';
const DESTROY_AFTER_HIDE_MS = 15_000;
const LEAVE_TIMEOUT_MS = 3_000;
const BOUNDS_KEY = 'callWindowBounds';

const store = new Store({ name: 'call-window' });

export type CallWindowPhase = 'connecting' | 'connected' | 'ending' | 'ended';

interface CallWindowParticipant {
  identity: string;
  name?: string;
  isCameraEnabled: boolean;
  isMicrophoneEnabled: boolean;
  isScreenShareEnabled: boolean;
  isLocal: boolean;
}

export interface CallWindowStatus {
  handoffId: number;
  phase: CallWindowPhase;
  externalId: string | null;
  callId: string | null;
  channelId: string | null;
  callType: string | null;
  roomLink: string | null;
  scopeType: string | null;
  conversationId: string | null;
  callStartTime: number | null;
  connectionState: string | null;
  participants: CallWindowParticipant[];
  error: string | null;
}

interface CallWindowHandoff {
  handoffId: number;
  // The rest is opaque to main: produced by one renderer, consumed by another.
  [key: string]: unknown;
}

type CallWindowCommand =
  | { type: 'DISCONNECT'; endForAll?: boolean }
  | { type: 'TOGGLE_MIC' }
  | { type: 'TOGGLE_CAMERA' }
  | { type: 'TOGGLE_CALL_CHAT' };

const COMMAND_TYPES = new Set<CallWindowCommand['type']>([
  'DISCONNECT',
  'TOGGLE_MIC',
  'TOGGLE_CAMERA',
  'TOGGLE_CALL_CHAT',
]);

let callWindow: BrowserWindow | null = null;
let callWindowWorkspaceId: string | null = null;
let rendererLoaded = false;
let nextHandoffId = 1;
let pendingHandoff: CallWindowHandoff | null = null;
let lastStatus: CallWindowStatus | null = null;
// False from a handoff until its call is reported over. Covers the stretch
// after the window took the handoff but before its first report.
let handoffSettled = true;
// The window has read the pending handoff at least once. The handoff stays
// readable until the window's first report for it: a renderer whose call UI
// remounts while booting asks again and must get the same answer, not null.
let handoffTaken = false;
// The user closed a window opened ahead of its call (see prepareCallWindow):
// the join it was waiting for must not open another one.
let prepareCancelled = false;
let destroyTimer: ReturnType<typeof setTimeout> | null = null;
let allowClose = false;
let leavePrompt: Promise<void> | null = null;
const statusWaiters = new Set<() => void>();

function isLive(status: CallWindowStatus | null): boolean {
  return !!status && (status.phase === 'connecting' || status.phase === 'connected');
}

function currentHandoffId(): number {
  return nextHandoffId - 1;
}

function sendToMainWindow(channel: string, ...args: unknown[]): BrowserWindow | null {
  const mainWindow = getMainWindow();
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  mainWindow.webContents.send(channel, ...args);
  return mainWindow;
}

function focusMain(): void {
  const mainWindow = getMainWindow();
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function publishStatus(status: CallWindowStatus): void {
  lastStatus = status;
  if (status.phase === 'ended') handoffSettled = true;
  setCallWindowActive(isLive(status));
  sendToMainWindow('call-window:status', status);
  for (const waiter of [...statusWaiters]) waiter();
}

function waitUntilSettled(timeoutMs: number): Promise<void> {
  if (handoffSettled) return Promise.resolve();
  return new Promise(resolve => {
    const finish = (): void => {
      clearTimeout(timer);
      statusWaiters.delete(check);
      resolve();
    };
    const check = (): void => {
      if (handoffSettled) finish();
    };
    const timer = setTimeout(finish, timeoutMs);
    statusWaiters.add(check);
  });
}

/**
 * Tell the main window the call is over when the window went away without
 * saying so itself (closed mid-call, renderer crashed, failed to load).
 */
function publishEndedIfLive(error: string | null): void {
  if (handoffSettled) return;
  const base = lastStatus && lastStatus.handoffId === currentHandoffId() ? lastStatus : null;
  pendingHandoff = null;
  publishStatus({
    handoffId: currentHandoffId(),
    phase: 'ended',
    externalId: base?.externalId ?? null,
    callId: base?.callId ?? null,
    channelId: base?.channelId ?? null,
    callType: base?.callType ?? null,
    roomLink: base?.roomLink ?? null,
    scopeType: base?.scopeType ?? null,
    conversationId: base?.conversationId ?? null,
    callStartTime: base?.callStartTime ?? null,
    connectionState: 'disconnected',
    participants: [],
    error,
  });
}

function isMainWindowTopFrame(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  const mainWindow = getMainWindow();
  const trusted =
    !!mainWindow &&
    !mainWindow.isDestroyed() &&
    event.sender === mainWindow.webContents &&
    !!event.senderFrame &&
    event.senderFrame.parent === null;
  if (!trusted) log.warn('[CallWindow] Blocked IPC from a sender other than the main window');
  return trusted;
}

function isCallWindowTopFrame(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  const trusted =
    !!callWindow &&
    !callWindow.isDestroyed() &&
    event.sender === callWindow.webContents &&
    !!event.senderFrame &&
    event.senderFrame.parent === null;
  if (!trusted) log.warn('[CallWindow] Blocked IPC from a sender other than the call window');
  return trusted;
}

function routeUrl(workspaceId: string | null): string {
  const query = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : '';
  return config.useBundledUI
    ? `${getBundledUIUrl()}newWindow/call${query}`
    : `${new URL(ROUTE_PATH, config.FRONTEND_URL).toString()}${query}`;
}

function isOwnRoute(rawUrl: string): boolean {
  try {
    const target = new URL(rawUrl);
    const own = new URL(routeUrl(null));
    return (
      target.protocol === own.protocol &&
      target.host === own.host &&
      target.pathname === own.pathname
    );
  } catch {
    return false;
  }
}

function isAppOrigin(rawUrl: string): boolean {
  try {
    const target = new URL(rawUrl);
    if (target.origin === new URL(config.FRONTEND_URL).origin) return true;
    return config.useBundledUI && target.protocol === new URL(getBundledUIUrl()).protocol;
  } catch {
    return false;
  }
}

/**
 * The call window shows one route. Anything else it is asked to open belongs to
 * the main window — following it here would unmount the call UI.
 */
function forwardUrlToMain(rawUrl: string): void {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return;
  }

  const invitePath = callInvitePath(rawUrl);
  if (invitePath) {
    sendToMainWindow('navigate-to', invitePath);
    focusMain();
    return;
  }

  if (isAppOrigin(rawUrl)) {
    const appPath = `${url.pathname}${url.search}${url.hash}`;
    sendToMainWindow('navigate-to', appPath.replace(/^\/newWindow(?=\/)/, ''));
    focusMain();
    return;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  if (browserSettingsService.getSettings().openLinksExternally) {
    void shell.openExternal(rawUrl);
    sendToMainWindow('link-opened-external', rawUrl);
    return;
  }
  if (sendToMainWindow('open-in-browser-panel', rawUrl)) {
    focusMain();
  } else {
    void shell.openExternal(rawUrl);
  }
}

function getInitialBounds(): Electron.Rectangle {
  const saved = store.get(BOUNDS_KEY) as Electron.Rectangle | undefined;
  if (saved && typeof saved.x === 'number' && typeof saved.width === 'number') {
    const visible = screen.getAllDisplays().some(display => {
      const area = display.workArea;
      return (
        saved.x < area.x + area.width &&
        saved.x + saved.width > area.x &&
        saved.y < area.y + area.height &&
        saved.y + saved.height > area.y
      );
    });
    if (visible) return saved;
  }

  const anchor = getMainWindow();
  const display =
    anchor && !anchor.isDestroyed()
      ? screen.getDisplayMatching(anchor.getBounds())
      : screen.getPrimaryDisplay();
  const area = display.workArea;
  const width = Math.min(1100, Math.round(area.width * 0.7));
  const height = Math.min(760, Math.round(area.height * 0.75));
  return {
    x: area.x + Math.round((area.width - width) / 2),
    y: area.y + Math.round((area.height - height) / 2),
    width,
    height,
  };
}

function cancelScheduledDestroy(): void {
  if (destroyTimer) {
    clearTimeout(destroyTimer);
    destroyTimer = null;
  }
}

function destroyCallWindow(): void {
  cancelScheduledDestroy();
  if (callWindow && !callWindow.isDestroyed()) {
    allowClose = true;
    callWindow.destroy();
  }
}

/**
 * The user left: get the window off screen at once while the renderer finishes
 * the disconnect (leave signal, end-for-all) out of sight. It is closed for good
 * when the call reports ended, or by the timer if it never does.
 *
 * A full-screen window is left alone instead. Hiding one leaves an empty black
 * Space behind on macOS, and leaving full screen first plays the shrink
 * animation; closing it on "ended" lets macOS take the Space away natively.
 */
function hideWhileLeaving(): void {
  if (!callWindow || callWindow.isDestroyed()) return;
  cancelScheduledDestroy();
  destroyTimer = setTimeout(destroyCallWindow, DESTROY_AFTER_HIDE_MS);
  if (callWindow.isFullScreen()) return;
  callWindow.hide();
}

function requestLeave(win: BrowserWindow): Promise<void> {
  if (leavePrompt) return leavePrompt;

  leavePrompt = (async () => {
    const { response } = await dialog.showMessageBox(win, {
      type: 'question',
      buttons: ['Leave call', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
      title: 'Leave call?',
      message: 'Leave this call?',
      detail: 'Closing the call window drops you from the call. Everyone else stays on.',
    });
    if (response !== 0 || win.isDestroyed()) return;

    win.webContents.send('call-window:command', { type: 'DISCONNECT' });
    // Closed only once the leave went through: closing sooner would cut the
    // renderer off mid-disconnect and leave a ghost participant in the room.
    await waitUntilSettled(LEAVE_TIMEOUT_MS);
    publishEndedIfLive(null);
    destroyCallWindow();
  })().finally(() => {
    leavePrompt = null;
  });

  return leavePrompt;
}

function createCallWindow(workspaceId: string | null): BrowserWindow {
  const bounds = getInitialBounds();
  rendererLoaded = false;
  allowClose = false;
  callWindowWorkspaceId = workspaceId;

  const win = new BrowserWindow({
    ...bounds,
    minWidth: 480,
    minHeight: 360,
    show: false,
    title: 'Call',
    backgroundColor: '#131314',
    icon: path.join(__dirname, '..', '..', 'assets', 'images', 'xyne.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '..', 'preload.js'),
      spellcheck: true,
      // A call in a background window must keep sending audio and video.
      backgroundThrottling: false,
    },
  });
  callWindow = win;

  // Grants getUserMedia/getDisplayMedia (first-party URL only) — see
  // installMediaPermissionGuard.
  registerAppOwnedWindow(win);

  // Up at once: the dark background paints immediately and the page's own
  // "Joining call…" takes over as soon as the bundle runs.
  win.show();
  win.focus();

  // The page sets its own title; keep a stable one in the window switcher.
  win.on('page-title-updated', event => event.preventDefault());

  win.webContents.setWindowOpenHandler(details => {
    forwardUrlToMain(details.url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, navUrl) => {
    if (isOwnRoute(navUrl)) return;
    event.preventDefault();
    forwardUrlToMain(navUrl);
  });

  // Reloading the call window would silently drop the call; the main window's
  // reload shortcuts are handled separately in window/manager.
  win.webContents.on('before-input-event', (event, input) => {
    const modifier = process.platform === 'darwin' ? input.meta : input.control;
    if (modifier && input.key.toLowerCase() === 'r') {
      event.preventDefault();
    }
  });

  win.webContents.on('did-finish-load', () => {
    rendererLoaded = true;
  });

  // A reload or navigation of the page itself (View › Reload from the menu
  // bar gets past before-input-event) tears down the LiveKit room. Say so,
  // rather than leaving the main window mirroring a call that is gone.
  win.webContents.on('did-start-navigation', details => {
    if (!details.isMainFrame || details.isSameDocument || !rendererLoaded) return;
    rendererLoaded = false;
    log.warn('[CallWindow] Page navigated mid-session; ending the mirrored call');
    publishEndedIfLive(null);
    destroyCallWindow();
  });

  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, _url, isMainFrame) => {
    if (!isMainFrame) return;
    log.error(`[CallWindow] Failed to load (${errorCode}): ${errorDescription}`);
    publishEndedIfLive('Could not open the call window');
    destroyCallWindow();
  });

  win.webContents.on('render-process-gone', (_event, details) => {
    log.error('[CallWindow] Renderer gone:', details.reason);
    publishEndedIfLive('The call window stopped unexpectedly');
    destroyCallWindow();
  });

  win.on('close', event => {
    if (allowClose || getIsQuitting()) return;
    if (isLive(lastStatus)) {
      event.preventDefault();
      void requestLeave(win);
      return;
    }
    // Nothing to leave (still booting, or already ending): just close. Closed
    // while waiting for its call to be handed over means "never mind".
    if (handoffSettled) prepareCancelled = true;
    publishEndedIfLive(null);
  });

  const persistBounds = (): void => {
    if (win.isDestroyed() || win.isFullScreen() || win.isMaximized() || win.isMinimized()) return;
    store.set(BOUNDS_KEY, win.getBounds());
  };
  win.on('resized', persistBounds);
  win.on('moved', persistBounds);

  win.on('closed', () => {
    if (callWindow === win) {
      callWindow = null;
      callWindowWorkspaceId = null;
      rendererLoaded = false;
      publishEndedIfLive(null);
    }
  });

  void win.loadURL(routeUrl(workspaceId)).catch(error => {
    log.error('[CallWindow] loadURL failed:', error);
  });

  return win;
}

function openCallWindow(handoff: Record<string, unknown>, workspaceId: string | null): number {
  cancelScheduledDestroy();
  const handoffId = nextHandoffId++;
  pendingHandoff = { ...handoff, handoffId };
  lastStatus = null;
  handoffSettled = false;
  handoffTaken = false;

  if (prepareCancelled) {
    // The user closed the window this call was being opened in: end it here,
    // before it connects. The main window sees "ended" for this handoff.
    prepareCancelled = false;
    log.info(`[CallWindow] Handoff ${handoffId} dropped: its window was closed while joining`);
    publishEndedIfLive(null);
    return handoffId;
  }

  // Reused even while still loading (opened early by prepareCallWindow): the
  // renderer reads the handoff on boot, and the ping covers one already up.
  const reusable =
    callWindow && !callWindow.isDestroyed() && callWindowWorkspaceId === workspaceId;

  if (reusable && callWindow) {
    callWindow.webContents.send('call-window:handoff-ready');
    if (callWindow.isMinimized()) callWindow.restore();
    callWindow.show();
    callWindow.focus();
  } else {
    destroyCallWindow();
    createCallWindow(workspaceId);
  }

  log.info(`[CallWindow] Handoff ${handoffId} queued`);
  return handoffId;
}

/**
 * Open the window as the user clicks to join, while the main window is still
 * fetching the token, so the app boots in parallel instead of after.
 */
function prepareCallWindow(workspaceId: string | null): void {
  prepareCancelled = false;
  cancelScheduledDestroy();
  if (callWindow && !callWindow.isDestroyed()) {
    if (callWindowWorkspaceId === workspaceId) {
      if (callWindow.isMinimized()) callWindow.restore();
      callWindow.show();
      callWindow.focus();
      return;
    }
    // A call is still live in another workspace's window: leave it be; the
    // handoff will replace the window once that call has been left.
    if (!handoffSettled) return;
    destroyCallWindow();
  }
  createCallWindow(workspaceId);
}

/** The join it was opened for did not happen (lobby, error, cancelled). */
function cancelPreparedCallWindow(): void {
  if (!handoffSettled || pendingHandoff) return;
  destroyCallWindow();
}

export function setupCallWindowHandlers(): void {
  ipcMain.handle('call-window:open', (event, payload: unknown) => {
    if (!isMainWindowTopFrame(event)) throw new Error('Unauthorized sender');
    if (!payload || typeof payload !== 'object') throw new Error('Invalid call handoff');
    const { handoff, workspaceId } = payload as {
      handoff?: unknown;
      workspaceId?: unknown;
    };
    if (!handoff || typeof handoff !== 'object') throw new Error('Invalid call handoff');
    const safeWorkspaceId =
      typeof workspaceId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(workspaceId)
        ? workspaceId
        : null;
    return openCallWindow(handoff as Record<string, unknown>, safeWorkspaceId);
  });

  ipcMain.on('call-window:prepare', (event, payload: unknown) => {
    if (!isMainWindowTopFrame(event)) return;
    const workspaceId = (payload as { workspaceId?: unknown } | null)?.workspaceId;
    prepareCallWindow(
      typeof workspaceId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(workspaceId)
        ? workspaceId
        : null,
    );
  });

  ipcMain.on('call-window:cancel-prepare', event => {
    if (!isMainWindowTopFrame(event)) return;
    cancelPreparedCallWindow();
  });

  ipcMain.handle('call-window:take-handoff', event => {
    if (!isCallWindowTopFrame(event)) return null;
    if (pendingHandoff) {
      handoffTaken = true;
      log.info(`[CallWindow] Handoff ${pendingHandoff.handoffId} read by the call window`);
    }
    return pendingHandoff;
  });

  ipcMain.on('call-window:status', (event, status: unknown) => {
    if (!isCallWindowTopFrame(event)) return;
    if (!status || typeof status !== 'object') return;
    const next = status as CallWindowStatus;
    if (next.handoffId !== currentHandoffId()) return;
    // The window is running this handoff; it no longer needs to be readable.
    if (pendingHandoff?.handoffId === next.handoffId) pendingHandoff = null;
    const previousPhase = lastStatus?.handoffId === next.handoffId ? lastStatus.phase : null;
    publishStatus(next);
    if (next.phase === 'ended') {
      // As Slack does with a huddle: the window closes when the call does, and
      // the next call gets a fresh one.
      destroyCallWindow();
    } else if (next.phase === 'ending') {
      hideWhileLeaving();
    } else if (
      (previousPhase === 'ending' || previousPhase === 'ended') &&
      callWindow &&
      !callWindow.isDestroyed()
    ) {
      // Left one call for another from inside the window: bring it back.
      cancelScheduledDestroy();
      callWindow.show();
    }
  });

  ipcMain.handle('call-window:get-status', event => {
    if (!isMainWindowTopFrame(event)) return null;
    return isLive(lastStatus) ? lastStatus : null;
  });

  ipcMain.on('call-window:command', (event, command: unknown) => {
    if (!isMainWindowTopFrame(event)) return;
    if (!command || typeof command !== 'object') return;
    const { type, endForAll } = command as { type?: unknown; endForAll?: unknown };
    if (typeof type !== 'string' || !COMMAND_TYPES.has(type as CallWindowCommand['type'])) return;
    if (!callWindow || callWindow.isDestroyed()) {
      // Nothing to command: make sure the main window does not wait on it.
      if (type === 'DISCONNECT') publishEndedIfLive(null);
      return;
    }
    if (type === 'DISCONNECT' && handoffSettled) {
      // Opened ahead of a call that was left before it was handed over.
      destroyCallWindow();
      return;
    }
    if (type === 'DISCONNECT' && pendingHandoff && !handoffTaken) {
      // Left before the window picked the call up (still booting): withdraw
      // the handoff so the window never connects to a call nobody is in.
      publishEndedIfLive(null);
      destroyCallWindow();
      return;
    }
    const safe: CallWindowCommand =
      type === 'DISCONNECT'
        ? { type, endForAll: endForAll === true }
        : ({ type } as CallWindowCommand);
    callWindow.webContents.send('call-window:command', safe);
  });

  ipcMain.on('call-window:focus', event => {
    if (!isMainWindowTopFrame(event)) return;
    if (!callWindow || callWindow.isDestroyed() || !isLive(lastStatus)) return;
    if (callWindow.isMinimized()) callWindow.restore();
    callWindow.show();
    callWindow.focus();
  });

  ipcMain.on('call-window:open-in-main', (event, appPath: unknown) => {
    if (!isCallWindowTopFrame(event)) return;
    if (typeof appPath !== 'string' || !appPath.startsWith('/') || appPath.startsWith('//')) {
      return;
    }
    sendToMainWindow('navigate-to', appPath);
    focusMain();
  });
}
