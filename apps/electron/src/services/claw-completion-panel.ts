import { BrowserWindow, Notification, ipcMain, nativeTheme, screen } from "electron";
import path from "path";
import log from "electron-log/main";
import type { ClawSessionCompletion } from "./claw-session-controller";

const PANEL_WIDTH = 330;
const PANEL_HEIGHT = 112;
const PANEL_MARGIN = 8;
const AUTO_DISMISS_MS = 12_000;
const HIDE_ANIMATION_MS = 220;

let panelWindow: BrowserWindow | null = null;
let autoDismissTimer: ReturnType<typeof setTimeout> | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let openHandler: (() => void) | null = null;
let dismissHandler: ((event: Electron.IpcMainEvent) => void) | null = null;
let openIpcHandler: ((event: Electron.IpcMainEvent) => void) | null = null;
let anchorProvider: (() => Electron.Rectangle | null) | null = null;

export function setClawCompletionAnchorProvider(
  provider: () => Electron.Rectangle | null,
): void {
  anchorProvider = provider;
}

export function setClawCompletionOpenHandler(handler: () => void): void {
  openHandler = handler;
}

function isPanelSender(event: Electron.IpcMainEvent): boolean {
  return (
    !!panelWindow &&
    !panelWindow.isDestroyed() &&
    event.sender === panelWindow.webContents &&
    event.senderFrame === panelWindow.webContents.mainFrame
  );
}

function computeBounds(): Electron.Rectangle {
  const anchor = anchorProvider?.() ?? null;
  const hasAnchor = !!anchor && anchor.width > 0 && anchor.height > 0;

  const reference = hasAnchor
    ? screen.getDisplayNearestPoint({ x: anchor.x, y: anchor.y }).workArea
    : screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;

  const x = hasAnchor
    ? Math.round(anchor.x + anchor.width / 2 - PANEL_WIDTH / 2)
    : reference.x + reference.width - PANEL_WIDTH - PANEL_MARGIN;
  const y = hasAnchor
    ? Math.round(anchor.y + anchor.height + PANEL_MARGIN)
    : reference.y + PANEL_MARGIN;

  const maxX = reference.x + Math.max(0, reference.width - PANEL_WIDTH);
  const maxY = reference.y + Math.max(0, reference.height - PANEL_HEIGHT);

  return {
    width: PANEL_WIDTH,
    height: PANEL_HEIGHT,
    x: Math.round(Math.min(Math.max(x, reference.x), maxX)),
    y: Math.round(Math.min(Math.max(y, reference.y), maxY)),
  };
}

function clearTimers(): void {
  if (autoDismissTimer) {
    clearTimeout(autoDismissTimer);
    autoDismissTimer = null;
  }
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
}

function destroyPanel(): void {
  clearTimers();
  if (openIpcHandler) {
    ipcMain.removeListener("claw-completion:open", openIpcHandler);
    openIpcHandler = null;
  }
  if (dismissHandler) {
    ipcMain.removeListener("claw-completion:dismiss", dismissHandler);
    dismissHandler = null;
  }
  if (panelWindow && !panelWindow.isDestroyed()) panelWindow.destroy();
  panelWindow = null;
}

function hideClawCompletionPanel(): void {
  if (!panelWindow || panelWindow.isDestroyed()) return;
  clearTimers();
  panelWindow.webContents.send("claw-completion:hide");
  hideTimer = setTimeout(destroyPanel, HIDE_ANIMATION_MS);
}

function scheduleAutoDismiss(): void {
  if (autoDismissTimer) clearTimeout(autoDismissTimer);
  autoDismissTimer = setTimeout(hideClawCompletionPanel, AUTO_DISMISS_MS);
}

function fallbackToNotification(event: ClawSessionCompletion): void {
  if (!Notification.isSupported()) return;
  const title =
    event.outcome === "needs-input"
      ? "Claw needs your input"
      : event.outcome === "error"
        ? "Claw hit an error"
        : "Claw finished";

  const notification = new Notification({
    title,
    body: event.preview ?? "Open Xyne to see the result.",
    silent: true,
  });
  notification.on("click", () => openHandler?.());
  notification.show();
}

export function showClawCompletionPanel(event: ClawSessionCompletion): void {
  if (process.platform !== "darwin" && process.platform !== "win32") {
    fallbackToNotification(event);
    return;
  }

  destroyPanel();

  const bounds = computeBounds();

  panelWindow = new BrowserWindow({
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
    focusable: false,
    fullscreenable: false,
    show: false,
    type: "panel",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "..", "preload.js"),
    },
  });

  panelWindow.setAlwaysOnTop(true, "screen-saver");
  panelWindow.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
    skipTransformProcessType: true,
  });

  const created = panelWindow;

  openIpcHandler = (ipcEvent) => {
    if (!isPanelSender(ipcEvent)) return;
    hideClawCompletionPanel();
    openHandler?.();
  };
  ipcMain.on("claw-completion:open", openIpcHandler);

  dismissHandler = (ipcEvent) => {
    if (!isPanelSender(ipcEvent)) return;
    hideClawCompletionPanel();
  };
  ipcMain.on("claw-completion:dismiss", dismissHandler);

  created.webContents.once("did-finish-load", () => {
    if (created.isDestroyed()) return;
    created.webContents.send("claw-completion:show", {
      outcome: event.outcome,
      preview: event.preview,
      dark: nativeTheme.shouldUseDarkColors,
    });
    created.showInactive();
    scheduleAutoDismiss();
  });

  created.on("closed", () => {
    if (panelWindow === created) panelWindow = null;
  });

  const panelHtml = path.join(
    __dirname,
    "..",
    "..",
    "assets",
    "claw-completion.html",
  );
  created.loadFile(panelHtml).catch((error) => {
    log.error("[ClawCompletion] Failed to load panel HTML:", error);
    fallbackToNotification(event);
  });
}
