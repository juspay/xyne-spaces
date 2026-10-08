import { app, BrowserWindow, screen } from 'electron';
import type { BrowserWindowConstructorOptions, WebContents } from 'electron';
import log from 'electron-log/main';

/**
 * The floating incoming-call card: a small always-on-top window that rings over
 * whatever the user is doing, the way Slack's does, so a call is not missed just
 * because Xyne is behind another app.
 *
 * The dashboard opens it itself with `window.open('', <INCOMING_CALL_FRAME_PREFIX>…)`
 * and renders its own incoming-call card into it, so there is one card, not a
 * second copy kept in step by hand. This module only turns that window into a
 * floating, focus-free panel; what it shows and when it closes are the
 * dashboard's business.
 */

/**
 * Must match the dashboard. Each open uses a fresh name after the prefix, so a
 * new card never lands in a previous window that is still closing.
 */
export const INCOMING_CALL_FRAME_PREFIX = 'xyne-incoming-call:';

/** The card is 400x520; the rest is room for its shadow. */
const WINDOW_WIDTH = 440;
const WINDOW_HEIGHT = 572;
/**
 * Backstop only. The dashboard opens a new window per call and closes it when
 * the ring ends (the backend gives up on a ring after ~32s), but if it never
 * gets to (renderer crash mid-ring) a call card must not float forever.
 */
const MAX_LIFETIME_MS = 90_000;

export function isIncomingCallWindowOpen(frameName: string | undefined, url: string): boolean {
  return !!frameName?.startsWith(INCOMING_CALL_FRAME_PREFIX) && url === 'about:blank';
}

/**
 * Only the main window's own page may open the floating card. The window-open
 * handler also sees requests from frames embedded in that page — canvas embeds,
 * workspace items — and those must not get an always-on-top, frameless panel
 * centred on the user's screen.
 */
export function isOpenedByMainFrame(child: BrowserWindow, opener: BrowserWindow, mainWindow: BrowserWindow | null): boolean {
  if (!mainWindow || mainWindow.isDestroyed() || opener !== mainWindow) return false;
  const openerFrame = child.webContents.opener;
  const mainFrame = mainWindow.webContents.mainFrame;
  return (
    !!openerFrame &&
    openerFrame.processId === mainFrame.processId &&
    openerFrame.routingId === mainFrame.routingId
  );
}

export function incomingCallWindowOptions(): BrowserWindowConstructorOptions {
  // Centred on the display the user is working on, where the in-app card would
  // sit if Xyne were in front.
  const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  return {
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    x: Math.round(workArea.x + (workArea.width - WINDOW_WIDTH) / 2),
    y: Math.round(workArea.y + (workArea.height - WINDOW_HEIGHT) / 2),
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    focusable: true,
    // The panel never becomes key on its own; without this macOS spends the
    // user's first click on Answer making it key, and the click is lost.
    acceptFirstMouse: true,
    // Shown with showInactive once configured: appearing must not take focus.
    show: false,
    // NSPanel on macOS: floats above other apps and full-screen spaces without
    // activating Xyne, so the user's typing stays where it was.
    type: 'panel',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      // Kept: the card is visible for its whole short life, so this is a no-op except when it
      // is occluded — which is exactly the case that matters, a call arriving while the user is
      // in a full-screen app. A throttled ring is a missed call.
      backgroundThrottling: false,
    },
  };
}

export function configureIncomingCallWindow(win: BrowserWindow, opener: WebContents): void {
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
    skipTransformProcessType: true,
  });
  win.showInactive();

  // The window belongs to the page that opened it; it must not outlive it.
  const closeWindow = (): void => {
    if (!win.isDestroyed()) win.close();
  };
  const lifetime = setTimeout(closeWindow, MAX_LIFETIME_MS);
  opener.once('did-navigate', closeWindow);
  opener.once('render-process-gone', closeWindow);
  opener.once('destroyed', closeWindow);
  win.once('closed', () => {
    clearTimeout(lifetime);
    if (!opener.isDestroyed()) {
      opener.removeListener('did-navigate', closeWindow);
      opener.removeListener('render-process-gone', closeWindow);
      opener.removeListener('destroyed', closeWindow);
    }
  });

  log.info('[IncomingCallWindow] Shown');
}

/**
 * Answering from the card puts the user in the call, so Xyne comes to the front.
 * The card is a non-activating panel, so clicking it does not do that on its own.
 */
export function bringMainWindowToFront(mainWindow: BrowserWindow | null): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  if (process.platform === 'darwin') app.focus({ steal: true });
}
