import { BrowserWindow, screen, ipcMain, session, shell } from "electron";
import path from "path";
import Store from "electron-store";
import log from "electron-log/main";
import { config } from "../app/config";
import { getBundledUIUrl } from "./custom-protocol";
import { getMainWindow } from "../window/manager";
import {
  resetClawSessionState,
  syncClawSessionState,
} from "./claw-session-controller";

const clawStore = new Store({ name: "claw-overlay" });
const ENABLED_KEY = "clawOverlayEnabled";
const PANEL_HEIGHT_KEY = "clawPanelHeight";
const SPOTLIGHT_POSITION_KEY = "clawSpotlightPosition";
const THEME_NAME_KEY = "clawOverlayThemeName";
const SPOTLIGHT_REST_HEIGHT = 96;

const VALID_THEME_NAMES = new Set(["classic", "summer_breeze", "midnight"]);

type ClawMode = "pill" | "spotlight";

let clawWindow: BrowserWindow | null = null;
let clawRendererReady = false;
let clawExpanded = false;
let clawMode: ClawMode = "pill";
let pendingSpotlightSummon = false;
let spotlightShownAt = 0;
let spotlightAnchor: { x: number; bottom: number } | null = null;
let spotlightContentHeight = SPOTLIGHT_REST_HEIGHT;
let awaitingSpotlightLayout = false;
let spotlightRevealTimer: ReturnType<typeof setTimeout> | null = null;
let blurDismissSuppressed = false;
let blurSuppressTimer: ReturnType<typeof setTimeout> | null = null;

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
let dismissSpotlightHandler:
  | ((event: Electron.IpcMainEvent) => void)
  | null = null;
let sessionStateHandler:
  | ((event: Electron.IpcMainEvent, state: unknown) => void)
  | null = null;
let spotlightHeightHandler:
  | ((event: Electron.IpcMainEvent, height: number) => void)
  | null = null;
let dragStartHandler: ((event: Electron.IpcMainEvent) => void) | null = null;
let dragEndHandler: ((event: Electron.IpcMainEvent) => void) | null = null;
let dragInterval: ReturnType<typeof setInterval> | null = null;

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

const SPOTLIGHT = { width: 640, height: 560 };
const SPOTLIGHT_TOP_RATIO = 0.2;
const SPOTLIGHT_BLUR_GRACE_MS = 250;
const SPOTLIGHT_MIN_CONTENT_HEIGHT = 56;
const SPOTLIGHT_REVEAL_TIMEOUT_MS = 400;

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

function getSpotlightMaxContentHeight(workArea: Electron.Rectangle): number {
  return Math.max(
    SPOTLIGHT_MIN_CONTENT_HEIGHT,
    Math.min(
      SPOTLIGHT.height,
      workArea.height - SHADOW_GUTTER - PANEL_TOP_MARGIN * 2,
    ),
  );
}

function clampBoundsToWorkArea(
  bounds: Electron.Rectangle,
  workArea: Electron.Rectangle,
): Electron.Rectangle {
  const maxX = workArea.x + Math.max(0, workArea.width - bounds.width);
  const maxY = workArea.y + Math.max(0, workArea.height - bounds.height);
  return {
    width: bounds.width,
    height: bounds.height,
    x: Math.round(Math.min(Math.max(bounds.x, workArea.x), maxX)),
    y: Math.round(Math.min(Math.max(bounds.y, workArea.y), maxY)),
  };
}

function getStoredSpotlightAnchor(): { x: number; bottom: number } | null {
  const raw = clawStore.get(SPOTLIGHT_POSITION_KEY) as
    | { x?: unknown; bottom?: unknown }
    | undefined;
  if (!raw) return null;
  const x = Number(raw.x);
  const bottom = Number(raw.bottom);
  if (!Number.isFinite(x) || !Number.isFinite(bottom)) return null;

  const onVisibleDisplay = screen.getAllDisplays().some((display) => {
    const area = display.workArea;
    return (
      x >= area.x &&
      x < area.x + area.width &&
      bottom > area.y &&
      bottom <= area.y + area.height
    );
  });

  return onVisibleDisplay ? { x, bottom } : null;
}

function startSpotlightDrag(): void {
  if (dragInterval || !clawWindow || clawWindow.isDestroyed()) return;
  if (clawMode !== "spotlight") return;

  const cursor = screen.getCursorScreenPoint();
  const [winX, winY] = clawWindow.getPosition();
  const offsetX = cursor.x - winX;
  const offsetY = cursor.y - winY;

  dragInterval = setInterval(() => {
    if (!clawWindow || clawWindow.isDestroyed() || clawMode !== "spotlight") {
      stopSpotlightDrag();
      return;
    }
    const point = screen.getCursorScreenPoint();
    clawWindow.setPosition(point.x - offsetX, point.y - offsetY);
  }, 16);
}

function stopSpotlightDrag(): void {
  if (dragInterval) {
    clearInterval(dragInterval);
    dragInterval = null;
  }
  if (!clawWindow || clawWindow.isDestroyed()) return;
  if (clawMode !== "spotlight") return;

  const bounds = clawWindow.getBounds();
  const workArea = screen.getDisplayNearestPoint({
    x: bounds.x,
    y: bounds.y,
  }).workArea;
  const clamped = clampBoundsToWorkArea(bounds, workArea);
  if (clamped.x !== bounds.x || clamped.y !== bounds.y) {
    clawWindow.setPosition(clamped.x, clamped.y);
  }
  spotlightAnchor = { x: clamped.x, bottom: clamped.y + clamped.height };
  persistSpotlightAnchor();
}

function persistSpotlightAnchor(): void {
  if (!spotlightAnchor) return;
  clawStore.set(SPOTLIGHT_POSITION_KEY, spotlightAnchor);
}

function applySpotlightBounds(): void {
  if (!clawWindow || clawWindow.isDestroyed()) return;

  const workArea = spotlightAnchor
    ? screen.getDisplayNearestPoint({
        x: spotlightAnchor.x,
        y: spotlightAnchor.bottom,
      }).workArea
    : getNearestWorkArea();

  const maxContent = getSpotlightMaxContentHeight(workArea);
  const contentHeight = Math.round(
    Math.min(Math.max(spotlightContentHeight, SPOTLIGHT_MIN_CONTENT_HEIGHT), maxContent),
  );
  const { width, height } = getWindowSize(SPOTLIGHT.width, contentHeight);

  if (!spotlightAnchor) {
    const maxWindowHeight = getWindowSize(SPOTLIGHT.width, maxContent).height;
    const x = Math.round(workArea.x + (workArea.width - width) / 2);
    const preferredBottom =
      workArea.y +
      Math.round(workArea.height * SPOTLIGHT_TOP_RATIO) +
      maxWindowHeight;
    const bottom = Math.round(
      Math.min(preferredBottom, workArea.y + workArea.height - PANEL_TOP_MARGIN),
    );
    spotlightAnchor = { x, bottom };
  }

  const bounds = clampBoundsToWorkArea(
    {
      x: spotlightAnchor.x,
      y: spotlightAnchor.bottom - height,
      width,
      height,
    },
    workArea,
  );

  spotlightAnchor = { x: bounds.x, bottom: bounds.y + bounds.height };
  applyWindowBounds(bounds);
  applyLinuxContentShape(clawExpanded);
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
  if (clawMode !== "pill") return;
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

  clawWindow.setIgnoreMouseEvents(clawMode === "spotlight" ? false : ignore, {
    forward: true,
  });
}

function applyLinuxContentShape(expanded: boolean, liveHeight?: number): void {
  if (process.platform !== "linux" || !clawWindow || clawWindow.isDestroyed())
    return;
  if (clawMode === "spotlight") {
    const spotlightBounds = clawWindow.getBounds();
    clawWindow.setShape([
      { x: 0, y: 0, width: spotlightBounds.width, height: spotlightBounds.height },
    ]);
    return;
  }

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
      const workArea = screen.getDisplayMatching(
        clawWindow.getBounds(),
      ).workArea;
      clawWindow.webContents.send(
        "claw:panel-height",
        getStoredPanelHeight(workArea),
      );
      clawWindow.webContents.send("claw:mode", clawMode);

      if (pendingSpotlightSummon) {
        pendingSpotlightSummon = false;
        revealSpotlight();
      } else if (isClawOverlayEnabled()) {
        clawWindow.showInactive();
        clawWindow.webContents.send("claw:visibility", true);
        log.info("[ClawOverlay] Showing overlay");
      }
    }
  };
  ipcMain.on("claw:set-expanded", setExpandedHandler);

  dismissSpotlightHandler = (event) => {
    if (!isClawOverlaySender(event)) return;
    dismissClawSpotlight();
  };
  ipcMain.on("claw:dismiss-spotlight", dismissSpotlightHandler);

  dragStartHandler = (event) => {
    if (!isClawOverlaySender(event)) return;
    startSpotlightDrag();
  };
  ipcMain.on("claw:drag-start", dragStartHandler);

  sessionStateHandler = (event, state) => {
    if (!isClawOverlaySender(event)) return;
    if (!state || typeof state !== "object") return;
    syncClawSessionState(state as Record<string, unknown>);
  };
  ipcMain.on("claw:session-state-changed", sessionStateHandler);

  spotlightHeightHandler = (event, height) => {
    if (!isClawOverlaySender(event)) return;
    if (clawMode !== "spotlight") return;
    const next = Number(height);
    if (!Number.isFinite(next) || next <= 0) return;
    spotlightContentHeight = next;
    applySpotlightBounds();
    finishSpotlightReveal();
  };
  ipcMain.on("claw:set-spotlight-height", spotlightHeightHandler);

  dragEndHandler = (event) => {
    if (!isClawOverlaySender(event)) return;
    stopSpotlightDrag();
  };
  ipcMain.on("claw:drag-end", dragEndHandler);

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
  if (dismissSpotlightHandler) {
    ipcMain.removeListener("claw:dismiss-spotlight", dismissSpotlightHandler);
    dismissSpotlightHandler = null;
  }
  if (sessionStateHandler) {
    ipcMain.removeListener("claw:session-state-changed", sessionStateHandler);
    sessionStateHandler = null;
  }
  if (spotlightHeightHandler) {
    ipcMain.removeListener("claw:set-spotlight-height", spotlightHeightHandler);
    spotlightHeightHandler = null;
  }
  if (dragStartHandler) {
    ipcMain.removeListener("claw:drag-start", dragStartHandler);
    dragStartHandler = null;
  }
  if (dragEndHandler) {
    ipcMain.removeListener("claw:drag-end", dragEndHandler);
    dragEndHandler = null;
  }
  if (dragInterval) {
    clearInterval(dragInterval);
    dragInterval = null;
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
    movable: true,
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
    SPOTLIGHT_MIN_CONTENT_HEIGHT + SHADOW_GUTTER,
  );

  const baseUrl = config.useBundledUI
    ? `${getBundledUIUrl()}newWindow/claw`
    : new URL("/newWindow/claw", config.FRONTEND_URL).toString();
  const storedTheme = getStoredThemeName();
  const targetUrl = storedTheme
    ? `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}theme=${encodeURIComponent(storedTheme)}`
    : baseUrl;
  void clawWindow.loadURL(targetUrl);

  clawWindow.webContents.on("dom-ready", () => {
    if (!clawWindow || clawWindow.isDestroyed()) return;
    void clawWindow.webContents
      .insertCSS(
        "html, body, #root, main { background: transparent !important; background-color: transparent !important; } .app-wallpaper-image, [data-slot='switch-loading-overlay'] { display: none !important; } [data-id='error-fallback'] { background: transparent !important; }",
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
        suppressSpotlightBlur();
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
      suppressSpotlightBlur();
      void shell.openExternal(navUrl);
    }
  };

  clawWindow.webContents.on("will-navigate", guardNavigation);
  clawWindow.webContents.on("will-redirect", guardNavigation);

  clawWindow.on("blur", () => {
    if (clawMode !== "spotlight") return;
    if (blurDismissSuppressed) return;
    if (Date.now() - spotlightShownAt < SPOTLIGHT_BLUR_GRACE_MS) return;
    dismissClawSpotlight();
  });

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
    clawMode = "pill";
    resetClawSessionState();
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
    if (blurSuppressTimer) {
      clearTimeout(blurSuppressTimer);
      blurSuppressTimer = null;
    }
    blurDismissSuppressed = false;
    pendingSpotlightSummon = false;
    awaitingSpotlightLayout = false;
    spotlightAnchor = null;
    if (spotlightRevealTimer) {
      clearTimeout(spotlightRevealTimer);
      spotlightRevealTimer = null;
    }
    clawWindow = null;
    clawRendererReady = false;
    clawExpanded = false;
    clawMode = "pill";
    resetClawSessionState();
  });

  log.info("[ClawOverlay] Window created");
  return clawWindow;
}

export async function showClawOverlay(): Promise<void> {
  try {
    if (!(await isUserAuthenticated())) return;
    const alreadyExisted = !!clawWindow && !clawWindow.isDestroyed();
    const win = createClawOverlay();

    if (
      alreadyExisted &&
      clawRendererReady &&
      clawMode === "pill" &&
      !win.isVisible()
    ) {
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

function suppressSpotlightBlur(durationMs = 1500): void {
  blurDismissSuppressed = true;
  if (blurSuppressTimer) clearTimeout(blurSuppressTimer);
  blurSuppressTimer = setTimeout(() => {
    blurSuppressTimer = null;
    blurDismissSuppressed = false;
  }, durationMs);
}

function finishSpotlightReveal(): void {
  if (!awaitingSpotlightLayout) return;
  awaitingSpotlightLayout = false;
  if (spotlightRevealTimer) {
    clearTimeout(spotlightRevealTimer);
    spotlightRevealTimer = null;
  }
  if (!clawWindow || clawWindow.isDestroyed()) return;

  spotlightShownAt = Date.now();
  clawWindow.show();
  clawWindow.focus();
  clawWindow.webContents.send("claw:visibility", true);
  log.info("[ClawOverlay] Spotlight shown");
}

function revealSpotlight(): void {
  if (!clawWindow || clawWindow.isDestroyed()) return;

  if (clawWindow.isVisible()) clawWindow.hide();

  clawMode = "spotlight";
  spotlightAnchor = getStoredSpotlightAnchor();
  spotlightContentHeight = SPOTLIGHT_REST_HEIGHT;
  applyIgnoreMouseEvents(false);
  applySpotlightBounds();

  clawWindow.webContents.send("claw:mode", clawMode);

  awaitingSpotlightLayout = true;
  if (spotlightRevealTimer) clearTimeout(spotlightRevealTimer);
  spotlightRevealTimer = setTimeout(() => {
    spotlightRevealTimer = null;
    finishSpotlightReveal();
  }, SPOTLIGHT_REVEAL_TIMEOUT_MS);
}

export function dismissClawSpotlight(): void {
  if (!clawWindow || clawWindow.isDestroyed()) return;
  if (clawMode !== "spotlight") return;

  persistSpotlightAnchor();
  awaitingSpotlightLayout = false;
  if (spotlightRevealTimer) {
    clearTimeout(spotlightRevealTimer);
    spotlightRevealTimer = null;
  }
  clawMode = "pill";
  clawWindow.webContents.send("claw:mode", clawMode);

  if (isClawOverlayEnabled()) {
    const workArea = screen.getDisplayMatching(clawWindow.getBounds()).workArea;
    applyWindowBounds(
      getDockedBounds(PANEL.width, getStoredPanelHeight(workArea), workArea),
    );
    applyIgnoreMouseEvents(true);
    applyLinuxContentShape(clawExpanded);
    clawWindow.showInactive();
    clawWindow.webContents.send("claw:visibility", true);
  } else {
    clawWindow.hide();
    clawWindow.webContents.send("claw:visibility", false);
  }

  log.info("[ClawOverlay] Spotlight dismissed");
}

export function isClawSpotlightVisible(): boolean {
  return (
    !!clawWindow &&
    !clawWindow.isDestroyed() &&
    clawMode === "spotlight" &&
    clawWindow.isVisible()
  );
}

async function summonSpotlight(toggle: boolean): Promise<void> {
  try {
    if (!(await isUserAuthenticated())) {
      log.info("[ClawOverlay] Spotlight ignored, user not authenticated");
      return;
    }
  } catch (error) {
    log.error("[ClawOverlay] Spotlight authentication check failed", error);
    return;
  }

  const win = createClawOverlay();

  if (toggle && clawMode === "spotlight" && win.isVisible()) {
    dismissClawSpotlight();
    return;
  }

  if (!clawRendererReady) {
    pendingSpotlightSummon = true;
    return;
  }

  revealSpotlight();
}

export function toggleClawSpotlight(): Promise<void> {
  return summonSpotlight(true);
}

export function openClawSpotlight(): Promise<void> {
  return summonSpotlight(false);
}

export function setClawOverlayThemeName(name: string): void {
  if (!VALID_THEME_NAMES.has(name)) return;
  clawStore.set(THEME_NAME_KEY, name);
}

function getStoredThemeName(): string | null {
  const raw = clawStore.get(THEME_NAME_KEY);
  return typeof raw === "string" && VALID_THEME_NAMES.has(raw) ? raw : null;
}

export function isClawOverlayEnabled(): boolean {
  return clawStore.get(ENABLED_KEY, false) as boolean;
}

function destroyClawOverlay(): void {
  if (!clawWindow || clawWindow.isDestroyed()) return;
  resetClawSessionState();
  clawWindow.destroy();
  clawWindow = null;
  log.info("[ClawOverlay] Destroyed");
}

export function setClawOverlayEnabled(enabled: boolean): void {
  clawStore.set(ENABLED_KEY, enabled);
  log.info(`[ClawOverlay] Enabled set to ${enabled}`);

  if (enabled) {
    void showClawOverlay();
  } else if (clawMode === "pill") {
    hideClawOverlay();
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

async function ensureClawOverlayReady(): Promise<void> {
  try {
    if (!(await isUserAuthenticated())) return;
    createClawOverlay();
  } catch (error) {
    log.error("[ClawOverlay] Failed to pre-create overlay window", error);
  }
}

export function initClawOverlayAuthGate(): void {
  if (authGateInitialized) return;
  authGateInitialized = true;

  ipcMain.handle("claw:get-enabled", () => isClawOverlayEnabled());
  ipcMain.on("claw:set-enabled", (event, enabled: boolean) => {
    const mainWindow = getMainWindow();
    const fromMainWindow =
      !!mainWindow &&
      !mainWindow.isDestroyed() &&
      event.sender === mainWindow.webContents;
    if (!fromMainWindow && !isClawOverlaySender(event)) return;
    setClawOverlayEnabled(!!enabled);
  });

  if (isClawOverlayEnabled()) {
    void showClawOverlay();
  } else {
    void ensureClawOverlayReady();
  }

  session.defaultSession.cookies.on(
    "changed",
    (_event, cookie, _cause, removed) => {
      if (cookie.name !== AUTH_COOKIE_NAME) return;
      if (!removed && cookie.value) {
        if (isClawOverlayEnabled()) {
          void showClawOverlay();
        } else {
          void ensureClawOverlayReady();
        }
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
