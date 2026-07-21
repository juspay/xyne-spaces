import { BrowserWindow, screen, ipcMain, session, shell } from "electron";
import path from "path";
import Store from "electron-store";
import log from "electron-log/main";
import { config } from "../app/config";
import { getBundledUIUrl } from "./custom-protocol";
import { getMainWindow } from "../window/manager";

const clawStore = new Store({ name: "claw-overlay" });
const ENABLED_KEY = "clawOverlayEnabled";

let clawWindow: BrowserWindow | null = null;
let clawRendererReady = false;

let setIgnoreMouseHandler:
  | ((event: Electron.IpcMainEvent, ignore: boolean) => void)
  | null = null;
let setExpandedHandler:
  | ((event: Electron.IpcMainEvent, expanded: boolean) => void)
  | null = null;
let focusHandler: ((event: Electron.IpcMainEvent) => void) | null = null;
let blurHandler: ((event: Electron.IpcMainEvent) => void) | null = null;
let openInMainHandler:
  | ((event: Electron.IpcMainEvent, pathname: string) => void)
  | null = null;

let displayMetricsHandler:
  | ((
      event: Electron.Event,
      display: Electron.Display,
      changedMetrics: string[],
    ) => void)
  | null = null;
let displayRemovedHandler:
  | ((event: Electron.Event, display: Electron.Display) => void)
  | null = null;
let metricsDebounceTimer: ReturnType<typeof setTimeout> | null = null;

const SHADOW_GUTTER = 32;

const PILL = { width: 120, height: 44 };
const PANEL = { width: 420, height: 600 };

function getWindowSize(
  contentWidth: number,
  contentHeight: number,
): { width: number; height: number } {
  return {
    width: contentWidth + SHADOW_GUTTER,
    height: contentHeight + SHADOW_GUTTER,
  };
}

function getNearestWorkArea(): Electron.Rectangle {
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
}

function getDockedBounds(
  contentWidth: number,
  contentHeight: number,
  workArea: Electron.Rectangle,
): Electron.Rectangle {
  const { width, height } = getWindowSize(contentWidth, contentHeight);
  return {
    x: workArea.x + workArea.width - width,
    y: workArea.y + workArea.height - height,
    width,
    height,
  };
}

function computeInitialBounds(): Electron.Rectangle {
  return getDockedBounds(PANEL.width, PANEL.height, getNearestWorkArea());
}

function redockToCorner(): void {
  if (!clawWindow || clawWindow.isDestroyed()) return;
  const workArea = screen.getDisplayMatching(clawWindow.getBounds()).workArea;
  const bounds = getDockedBounds(
    PANEL.width,
    PANEL.height,
    workArea,
  );
  clawWindow.setPosition(bounds.x, bounds.y);
  log.info("[ClawOverlay] Re-docked to corner after display change");
}

function registerDisplayListeners(): void {
  displayMetricsHandler = (_event, _display, changedMetrics) => {
    if (
      !changedMetrics.includes("workArea") &&
      !changedMetrics.includes("scaleFactor")
    )
      return;
    if (metricsDebounceTimer) clearTimeout(metricsDebounceTimer);
    metricsDebounceTimer = setTimeout(() => {
      metricsDebounceTimer = null;
      redockToCorner();
    }, 150);
  };
  displayRemovedHandler = () => redockToCorner();

  screen.on("display-metrics-changed", displayMetricsHandler);
  screen.on("display-removed", displayRemovedHandler);
}

function unregisterDisplayListeners(): void {
  if (displayMetricsHandler) {
    screen.removeListener("display-metrics-changed", displayMetricsHandler);
    displayMetricsHandler = null;
  }
  if (displayRemovedHandler) {
    screen.removeListener("display-removed", displayRemovedHandler);
    displayRemovedHandler = null;
  }
  if (metricsDebounceTimer) {
    clearTimeout(metricsDebounceTimer);
    metricsDebounceTimer = null;
  }
}

function applyIgnoreMouseEvents(ignore: boolean): void {
  if (!clawWindow || clawWindow.isDestroyed()) return;
  if (process.platform === "linux") {
    return;
  }

  clawWindow.setIgnoreMouseEvents(ignore, { forward: true });
}

function applyLinuxContentShape(expanded: boolean): void {
  if (process.platform !== "linux" || !clawWindow || clawWindow.isDestroyed())
    return;
  const content = expanded ? PANEL : PILL;
  const windowSize = getWindowSize(PANEL.width, PANEL.height);
  const width = content.width;
  const height = content.height;
  clawWindow.setShape([
    {
      x: windowSize.width - width,
      y: windowSize.height - height,
      width,
      height,
    },
  ]);
}

function isClawOverlaySender(event: Electron.IpcMainEvent): boolean {
  return (
    !!clawWindow &&
    !clawWindow.isDestroyed() &&
    event.sender === clawWindow.webContents &&
    event.senderFrame === clawWindow.webContents.mainFrame
  );
}

function registerIpcHandlers(): void {
  setIgnoreMouseHandler = (event, ignore) => {
    if (!isClawOverlaySender(event)) return;
    applyIgnoreMouseEvents(ignore);
  };
  ipcMain.on("claw:set-ignore-mouse", setIgnoreMouseHandler);

  setExpandedHandler = (event, expanded) => {
    if (!isClawOverlaySender(event)) return;
    const firstReady = !clawRendererReady;
    clawRendererReady = true;
    applyLinuxContentShape(expanded);
    if (firstReady && clawWindow && !clawWindow.isDestroyed()) {
      clawWindow.showInactive();
      clawWindow.webContents.send("claw:visibility", true);
      log.info("[ClawOverlay] Showing overlay");
    }
  };
  ipcMain.on("claw:set-expanded", setExpandedHandler);

  focusHandler = (event) => {
    if (!isClawOverlaySender(event)) return;
    if (!clawWindow || clawWindow.isDestroyed()) return;
    clawWindow.focus();
  };
  ipcMain.on("claw:focus", focusHandler);

  blurHandler = (event) => {
    if (!isClawOverlaySender(event)) return;
    if (!clawWindow || clawWindow.isDestroyed()) return;
    clawWindow.blur();
  };
  ipcMain.on("claw:blur", blurHandler);

  openInMainHandler = (event, pathname) => {
    if (!isClawOverlaySender(event)) return;
    forwardToMainWindow(pathname);
  };
  ipcMain.on("claw:open-in-main", openInMainHandler);
}

function cleanupIpcHandlers(): void {
  if (setIgnoreMouseHandler) {
    ipcMain.removeListener("claw:set-ignore-mouse", setIgnoreMouseHandler);
    setIgnoreMouseHandler = null;
  }
  if (setExpandedHandler) {
    ipcMain.removeListener("claw:set-expanded", setExpandedHandler);
    setExpandedHandler = null;
  }
  if (focusHandler) {
    ipcMain.removeListener("claw:focus", focusHandler);
    focusHandler = null;
  }
  if (blurHandler) {
    ipcMain.removeListener("claw:blur", blurHandler);
    blurHandler = null;
  }
  if (openInMainHandler) {
    ipcMain.removeListener("claw:open-in-main", openInMainHandler);
    openInMainHandler = null;
  }
}

export function forwardToMainWindow(pathname: string): void {
  const mainWindow = getMainWindow();
  if (!mainWindow || mainWindow.isDestroyed()) {
    log.warn(
      "[ClawOverlay] No main window available to forward navigation to:",
      pathname,
    );
    return;
  }
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.send("navigate-to", pathname);
}

function createClawOverlay(): BrowserWindow {
  if (clawWindow && !clawWindow.isDestroyed()) return clawWindow;

  const bounds = computeInitialBounds();
  clawRendererReady = false;

  clawWindow = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    resizable: false,
    movable: false,
    skipTaskbar: true,
    hasShadow: false,
    focusable: true,
    fullscreenable: false,
    show: false,

    type: "panel",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "..", "preload.js"),

      backgroundThrottling: false,
    },
  });

  clawWindow.setAlwaysOnTop(true, "screen-saver");
  clawWindow.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
    skipTransformProcessType: true,
  });

  const targetUrl = config.useBundledUI
    ? `${getBundledUIUrl()}newWindow/claw`
    : new URL("/newWindow/claw", config.FRONTEND_URL).toString();
  void clawWindow.loadURL(targetUrl);

  const isOwnRoute = (navUrl: string): boolean => {
    try {
      const a = new URL(navUrl);
      const b = new URL(targetUrl);

      return (
        a.protocol === b.protocol &&
        a.host === b.host &&
        a.pathname === b.pathname
      );
    } catch {
      return false;
    }
  };

  clawWindow.webContents.setWindowOpenHandler((details) => {
    try {
      const url = new URL(details.url);
      if (url.protocol === "http:" || url.protocol === "https:") {
        void shell.openExternal(details.url);
      }
    } catch (error) {
      log.warn(
        "[ClawOverlay] Failed to parse window-open URL, denying:",
        details.url,
        error,
      );
    }

    return { action: "deny" };
  });

  const guardNavigation = (event: Electron.Event, navUrl: string): void => {
    if (isOwnRoute(navUrl)) return;

    event.preventDefault();
    log.warn(
      "[ClawOverlay] Blocked navigation away from overlay route:",
      navUrl,
    );

    let parsed: URL;
    try {
      parsed = new URL(navUrl);
    } catch (error) {
      log.warn(
        "[ClawOverlay] Failed to parse blocked navigation URL:",
        navUrl,
        error,
      );
      return;
    }

    const target = new URL(targetUrl);
    const isSameOrigin =
      parsed.protocol === target.protocol && parsed.host === target.host;

    if (isSameOrigin) {
      forwardToMainWindow(parsed.pathname + parsed.search + parsed.hash);
    } else if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      void shell.openExternal(navUrl);
    }
  };

  clawWindow.webContents.on("will-navigate", guardNavigation);
  clawWindow.webContents.on("will-redirect", guardNavigation);

  applyLinuxContentShape(false);
  applyIgnoreMouseEvents(true);

  clawWindow.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription) => {
      log.error(
        `[ClawOverlay] Load failed (${errorCode}): ${errorDescription}`,
      );
      applyIgnoreMouseEvents(true);
    },
  );

  clawWindow.webContents.on("render-process-gone", (_event, details) => {
    log.error(`[ClawOverlay] Renderer gone: ${details.reason}`);
    clawRendererReady = false;
    applyLinuxContentShape(false);
    applyIgnoreMouseEvents(true);
    if (clawWindow && !clawWindow.isDestroyed()) {
      clawWindow.hide();
      clawWindow.reload();
    }
  });

  registerIpcHandlers();
  registerDisplayListeners();

  clawWindow.on("closed", () => {
    cleanupIpcHandlers();
    unregisterDisplayListeners();
    clawWindow = null;
    clawRendererReady = false;
  });

  log.info("[ClawOverlay] Window created");
  return clawWindow;
}

export async function showClawOverlay(): Promise<void> {
  try {
    if (!(await isUserAuthenticated())) return;
    const alreadyExisted = !!clawWindow && !clawWindow.isDestroyed();
    const win = createClawOverlay();

    if (alreadyExisted && clawRendererReady && !win.isVisible()) {
      win.showInactive();
      win.webContents.send("claw:visibility", true);
      log.info("[ClawOverlay] Showing overlay");
    }
  } catch (error) {
    log.error("[ClawOverlay] Authentication check failed", error);
  }
}

export function hideClawOverlay(): void {
  if (!clawWindow || clawWindow.isDestroyed()) return;

  clawWindow.hide();
  clawWindow.webContents.send("claw:visibility", false);
  log.info("[ClawOverlay] Hiding overlay");
}

export function isClawOverlayEnabled(): boolean {
  return clawStore.get(ENABLED_KEY, false) as boolean;
}

function destroyClawOverlay(): void {
  if (!clawWindow || clawWindow.isDestroyed()) return;
  clawWindow.destroy();
  clawWindow = null;
  log.info("[ClawOverlay] Destroyed");
}

export function setClawOverlayEnabled(enabled: boolean): void {
  clawStore.set(ENABLED_KEY, enabled);
  log.info(`[ClawOverlay] Enabled set to ${enabled}`);

  if (enabled) {
    void showClawOverlay();
  } else {
    destroyClawOverlay();
  }

  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed())
      win.webContents.send("claw:enabled-changed", enabled);
  }
}

const AUTH_COOKIE_NAME = "user_session_id";

let authGateInitialized = false;

async function isUserAuthenticated(): Promise<boolean> {
  const cookies = await session.defaultSession.cookies.get({});
  return cookies.some((c) => c.name === AUTH_COOKIE_NAME && !!c.value);
}

export function initClawOverlayAuthGate(): void {
  if (authGateInitialized) return;
  authGateInitialized = true;

  ipcMain.handle("claw:get-enabled", () => isClawOverlayEnabled());
  ipcMain.on("claw:set-enabled", (_event, enabled: boolean) =>
    setClawOverlayEnabled(!!enabled),
  );

  if (isClawOverlayEnabled()) void showClawOverlay();

  session.defaultSession.cookies.on(
    "changed",
    (_event, cookie, _cause, removed) => {
      if (cookie.name !== AUTH_COOKIE_NAME) return;
      if (!removed && cookie.value) {
        if (isClawOverlayEnabled()) void showClawOverlay();
        return;
      }
      if (removed) {
        void isUserAuthenticated().then((stillLoggedIn) => {
          if (!stillLoggedIn) destroyClawOverlay();
        });
      }
    },
  );
}
