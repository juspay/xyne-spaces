import { BrowserWindow, screen, ipcMain, session, shell } from "electron";
import path from "path";
import Store from "electron-store";
import log from "electron-log/main";
import { config } from "../app/config";
import { getBundledUIUrl } from "./custom-protocol";
import { getMainWindow } from "../window/manager";

const clawStore = new Store({ name: "claw-overlay" });
const ENABLED_KEY = "clawOverlayEnabled";
const PANEL_HEIGHT_KEY = "clawPanelHeight";

let clawWindow: BrowserWindow | null = null;
let clawRendererReady = false;
let clawExpanded = false;

let panelHeightPersistTimer: ReturnType<typeof setTimeout> | null = null;
let pendingPanelHeight: number | null = null;
let resizableLatchTimer: ReturnType<typeof setTimeout> | null = null;

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
let setPanelHeightHandler:
  | ((event: Electron.IpcMainEvent, height: number) => void)
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

const DEFAULT_PANEL_HEIGHT = PANEL.height;
const MIN_PANEL_HEIGHT = 400;
const PANEL_TOP_MARGIN = 8;

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

function getMaxPanelHeight(workArea: Electron.Rectangle): number {
  return Math.max(
    MIN_PANEL_HEIGHT,
    workArea.height - SHADOW_GUTTER - PANEL_TOP_MARGIN,
  );
}

function clampPanelHeight(height: number, workArea: Electron.Rectangle): number {
  const safe = Number.isFinite(height) ? height : DEFAULT_PANEL_HEIGHT;
  const max = getMaxPanelHeight(workArea);
  return Math.round(Math.min(Math.max(safe, MIN_PANEL_HEIGHT), max));
}

function getStoredPanelHeight(workArea: Electron.Rectangle): number {
  const raw = Number(clawStore.get(PANEL_HEIGHT_KEY, DEFAULT_PANEL_HEIGHT));
  return clampPanelHeight(raw, workArea);
}

function persistPanelHeightDebounced(height: number): void {
  pendingPanelHeight = height;
  if (panelHeightPersistTimer) return;
  panelHeightPersistTimer = setTimeout(() => {
    panelHeightPersistTimer = null;
    if (pendingPanelHeight !== null) {
      clawStore.set(PANEL_HEIGHT_KEY, pendingPanelHeight);
      pendingPanelHeight = null;
    }
  }, 250);
}

function computeInitialBounds(): Electron.Rectangle {
  const workArea = getNearestWorkArea();
  return getDockedBounds(PANEL.width, getStoredPanelHeight(workArea), workArea);
}

function applyWindowBounds(bounds: Electron.Rectangle): void {
  if (!clawWindow || clawWindow.isDestroyed()) return;
  if (resizableLatchTimer) {
    clearTimeout(resizableLatchTimer);
  } else {
    clawWindow.setResizable(true);
  }
  clawWindow.setBounds(bounds);
  resizableLatchTimer = setTimeout(() => {
    resizableLatchTimer = null;
    if (clawWindow && !clawWindow.isDestroyed()) clawWindow.setResizable(false);
  }, 300);
}

function redockToCorner(): void {
  if (!clawWindow || clawWindow.isDestroyed()) return;
  const workArea = screen.getDisplayMatching(clawWindow.getBounds()).workArea;
  const currentHeight = clawWindow.getBounds().height - SHADOW_GUTTER;
  const panelHeight = clampPanelHeight(currentHeight, workArea);
  const bounds = getDockedBounds(PANEL.width, panelHeight, workArea);
  applyWindowBounds(bounds);
  applyLinuxContentShape(clawExpanded, panelHeight);
  clawWindow.webContents.send("claw:panel-height", panelHeight);
  log.info("[ClawOverlay] Re-docked to corner after display change");
}

function registerDisplayListeners(): void {
  unregisterDisplayListeners();

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

function applyLinuxContentShape(expanded: boolean, liveHeight?: number): void {
  if (process.platform !== "linux" || !clawWindow || clawWindow.isDestroyed())
    return;
  const workArea = screen.getDisplayMatching(clawWindow.getBounds()).workArea;
  const panelHeight = liveHeight ?? getStoredPanelHeight(workArea);
  const content = expanded ? { width: PANEL.width, height: panelHeight } : PILL;
  const windowSize = getWindowSize(PANEL.width, panelHeight);
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

function isClawOverlaySender(
  event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent,
): boolean {
  return (
    !!clawWindow &&
    !clawWindow.isDestroyed() &&
    event.sender === clawWindow.webContents &&
    event.senderFrame === clawWindow.webContents.mainFrame
  );
}

function registerIpcHandlers(): void {
  cleanupIpcHandlers();

  setIgnoreMouseHandler = (event, ignore) => {
    if (!isClawOverlaySender(event)) return;
    applyIgnoreMouseEvents(ignore);
  };
  ipcMain.on("claw:set-ignore-mouse", setIgnoreMouseHandler);

  setExpandedHandler = (event, expanded) => {
    if (!isClawOverlaySender(event)) return;
    clawExpanded = expanded;
    const firstReady = !clawRendererReady;
    clawRendererReady = true;
    applyLinuxContentShape(expanded);
    if (firstReady && clawWindow && !clawWindow.isDestroyed()) {
      clawWindow.showInactive();
      clawWindow.webContents.send("claw:visibility", true);
      const workArea = screen.getDisplayMatching(
        clawWindow.getBounds(),
      ).workArea;
      clawWindow.webContents.send(
        "claw:panel-height",
        getStoredPanelHeight(workArea),
      );
      log.info("[ClawOverlay] Showing overlay");
    }
  };
  ipcMain.on("claw:set-expanded", setExpandedHandler);

  setPanelHeightHandler = (event, height) => {
    if (!isClawOverlaySender(event)) return;
    if (!clawWindow || clawWindow.isDestroyed()) return;
    const workArea = screen.getDisplayMatching(clawWindow.getBounds()).workArea;
    const clamped = clampPanelHeight(Number(height), workArea);
    persistPanelHeightDebounced(clamped);
    const bounds = getDockedBounds(PANEL.width, clamped, workArea);
    applyWindowBounds(bounds);
    applyLinuxContentShape(clawExpanded, clamped);
    clawWindow.webContents.send("claw:panel-height", clamped);
  };
  ipcMain.on("claw:set-panel-height", setPanelHeightHandler);

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

  ipcMain.removeHandler("claw:reconcile");
  ipcMain.handle(
    "claw:reconcile",
    (event, rect: { x: number; y: number; width: number; height: number }) => {
      if (!isClawOverlaySender(event)) return null;
      if (!clawWindow || clawWindow.isDestroyed()) return null;
      if (
        !rect ||
        ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)
      ) {
        return null;
      }
      const cursor = screen.getCursorScreenPoint();
      const wb = clawWindow.getBounds();
      return (
        cursor.x >= wb.x + rect.x &&
        cursor.x <= wb.x + rect.x + rect.width &&
        cursor.y >= wb.y + rect.y &&
        cursor.y <= wb.y + rect.y + rect.height
      );
    },
  );
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
  if (setPanelHeightHandler) {
    ipcMain.removeListener("claw:set-panel-height", setPanelHeightHandler);
    setPanelHeightHandler = null;
  }
  ipcMain.removeHandler("claw:reconcile");
}

export function forwardAuthEventToClawOverlay(
  channel: "auth:success" | "auth:mtls-success",
  payload?: unknown,
): void {
  const send = (): void => {
    if (!clawWindow || clawWindow.isDestroyed()) return;
    if (payload === undefined) {
      clawWindow.webContents.send(channel);
    } else {
      clawWindow.webContents.send(channel, payload);
    }
  };
  send();
  setTimeout(send, 2500);
  setTimeout(send, 6000);
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
  clawExpanded = false;

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
  clawWindow.setMinimumSize(
    PANEL.width + SHADOW_GUTTER,
    MIN_PANEL_HEIGHT + SHADOW_GUTTER,
  );

  const targetUrl = config.useBundledUI
    ? `${getBundledUIUrl()}newWindow/claw`
    : new URL("/newWindow/claw", config.FRONTEND_URL).toString();
  void clawWindow.loadURL(targetUrl);

  clawWindow.webContents.on("dom-ready", () => {
    if (!clawWindow || clawWindow.isDestroyed()) return;
    void clawWindow.webContents
      .insertCSS(
        "html, body, #root, main { background: transparent !important; background-color: transparent !important; } .app-wallpaper-image, .app-wallpaper-overlay, [data-slot='switch-loading-overlay'] { display: none !important; } [data-id='error-fallback'] { background: transparent !important; }",
      )
      .catch((error) => {
        log.warn("[ClawOverlay] Failed to inject transparency CSS", error);
      });
  });

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
    clawExpanded = false;
    applyLinuxContentShape(false);
    applyIgnoreMouseEvents(true);
    if (clawWindow && !clawWindow.isDestroyed()) {
      clawWindow.hide();
      clawWindow.reload();
    }
  });

  registerIpcHandlers();
  registerDisplayListeners();

  const createdWindow = clawWindow;
  clawWindow.on("closed", () => {
    if (clawWindow !== null && clawWindow !== createdWindow) return;
    cleanupIpcHandlers();
    unregisterDisplayListeners();
    if (panelHeightPersistTimer) {
      clearTimeout(panelHeightPersistTimer);
      panelHeightPersistTimer = null;
    }
    if (pendingPanelHeight !== null) {
      clawStore.set(PANEL_HEIGHT_KEY, pendingPanelHeight);
      pendingPanelHeight = null;
    }
    if (resizableLatchTimer) {
      clearTimeout(resizableLatchTimer);
      resizableLatchTimer = null;
    }
    clawWindow = null;
    clawRendererReady = false;
    clawExpanded = false;
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
  return clawStore.get(ENABLED_KEY, true) as boolean;
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
