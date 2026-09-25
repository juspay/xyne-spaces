import { Menu, Tray, nativeImage, nativeTheme, type NativeImage } from 'electron';
import path from 'path';
import Store from 'electron-store';
import log from 'electron-log/main';
import { getMainWindow, createMainWindow, setWindowReferences } from '../window/manager';
import {
  focusMainWindow,
  getRecordingSnapshot,
  onRecordingStateChange,
  pauseRecordingFromOutside,
  resumeRecordingFromOutside,
  startRecordingFromOutside,
  stopRecording,
  type RecordingSnapshot,
} from './recording-controller';
import { RECORDING_SHORTCUT, getClawSpotlightShortcut } from './global-shortcuts';
import { startPillRenderer, stopPillRenderer, updatePill } from './tray-pill-renderer';
import {
  repaintClawBadge,
  startClawBadgeRenderer,
  stopClawBadgeRenderer,
  updateClawBadge,
} from './claw-tray-badge';
import {
  getClawSessionSnapshot,
  onClawSessionStateChange,
  type ClawSessionSnapshot,
} from './claw-session-controller';
import { openClawSpotlight } from './claw-overlay-window';

const PAUSED_TITLE = 'Paused';

const trayStore = new Store({ name: 'tray' });
const VISIBLE_KEY = 'trayVisible';

let tray: Tray | null = null;
let idleIcon: NativeImage | null = null;
let timerInterval: ReturnType<typeof setInterval> | null = null;
let unsubscribeRecordingState: (() => void) | null = null;
let unsubscribeClawState: (() => void) | null = null;
let lastRecording: RecordingSnapshot | null = null;
let lastClaw: ClawSessionSnapshot | null = null;
let clawBadgeInterval: ReturnType<typeof setInterval> | null = null;
let themeListenerAttached = false;

const CLAW_BADGE_REPAINT_MS = 120;

function truncateLabel(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function formatElapsed(snapshot: RecordingSnapshot): string {
  const startTime = snapshot.startTime ?? Date.now();
  const until = snapshot.pauseStartedAt ?? Date.now();
  const elapsedMs = until - startTime - snapshot.accumulatedPausedMs;
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatLabel(snapshot: RecordingSnapshot): string {
  return snapshot.paused ? PAUSED_TITLE : formatElapsed(snapshot);
}

async function openXyne(): Promise<void> {
  const existing = getMainWindow();
  if (!existing || existing.isDestroyed()) {
    await createMainWindow();
    setWindowReferences();
  }
  focusMainWindow();
}

function buildClawItems(claw: ClawSessionSnapshot): Electron.MenuItemConstructorOptions[] {
  if (claw.status !== 'running' && claw.status !== 'needs-input') return [];

  const items: Electron.MenuItemConstructorOptions[] = [
    {
      label: claw.status === 'needs-input' ? 'Needs your input' : 'Working…',
      enabled: false,
    },
  ];

  if (claw.preview) {
    items.push({ label: truncateLabel(claw.preview, 52), enabled: false });
  }

  items.push({
    label: 'Open session',
    click: () => void openClawSpotlight(),
  });
  items.push({ type: 'separator' });

  return items;
}

function buildMenu(snapshot: RecordingSnapshot, claw: ClawSessionSnapshot): Menu {
  const template: Electron.MenuItemConstructorOptions[] = snapshot.active
    ? [
        {
          label: 'Stop Recording',
          accelerator: RECORDING_SHORTCUT,
          registerAccelerator: false,
          click: () => stopRecording('tray'),
        },
        snapshot.paused
          ? {
              label: 'Resume Recording',
              click: () => resumeRecordingFromOutside('tray'),
            }
          : {
              label: 'Pause Recording',
              click: () => pauseRecordingFromOutside('tray'),
            },
      ]
    : [
        {
          label: 'Start Recording',
          accelerator: RECORDING_SHORTCUT,
          registerAccelerator: false,
          click: () => void startRecordingFromOutside('tray'),
        },
      ];

  const clawShortcut = getClawSpotlightShortcut();
  const clawItems = buildClawItems(claw);

  return Menu.buildFromTemplate([
    ...template,
    { type: 'separator' },
    ...clawItems,
    {
      label: 'Open Claw',
      ...(clawShortcut ? { accelerator: clawShortcut, registerAccelerator: false } : {}),
      click: () => void openClawSpotlight(),
    },
    {
      label: 'Open Xyne',
      click: () => void openXyne(),
    },
  ]);
}

function applyTrayVisual(): void {
  if (!tray) return;

  const recording = lastRecording ?? getRecordingSnapshot();
  const claw = lastClaw ?? getClawSessionSnapshot();

  tray.setContextMenu(buildMenu(recording, claw));

  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  if (clawBadgeInterval) {
    clearInterval(clawBadgeInterval);
    clawBadgeInterval = null;
  }

  if (process.platform !== 'darwin') return;

  if (recording.active && recording.startTime) {
    stopClawBadgeRenderer();
    startPillRenderer((image) => tray?.setImage(image));
    void updatePill(formatLabel(recording), recording.paused);
    if (recording.paused) return;
    timerInterval = setInterval(() => {
      void updatePill(formatLabel(recording), recording.paused);
    }, 1000);
    return;
  }

  stopPillRenderer();

  if (claw.status === 'running' || claw.status === 'needs-input') {
    const waiting = claw.status === 'needs-input';
    startClawBadgeRenderer((image) => tray?.setImage(image));
    void updateClawBadge(waiting, nativeTheme.shouldUseDarkColors);
    if (!waiting) {
      clawBadgeInterval = setInterval(repaintClawBadge, CLAW_BADGE_REPAINT_MS);
    }
    return;
  }

  stopClawBadgeRenderer();
  if (idleIcon) tray.setImage(idleIcon);
}

function syncTrayToState(snapshot: RecordingSnapshot): void {
  lastRecording = snapshot;
  applyTrayVisual();
}

function syncTrayToClaw(snapshot: ClawSessionSnapshot): void {
  lastClaw = snapshot;
  applyTrayVisual();
}

function createTray(): void {
  if (tray) return;

  const iconPath = path.join(__dirname, '..', '..', 'assets', 'images', 'xyneMenubarTemplate.png');
  const icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) {
    log.error('[Tray] Menu bar icon missing at', iconPath);
    return;
  }
  icon.setTemplateImage(true);
  idleIcon = icon;

  tray = new Tray(icon);
  tray.setToolTip('Xyne');
  if (process.platform === 'win32') {
    tray.on('click', () => void openXyne());
  }
  lastRecording = getRecordingSnapshot();
  lastClaw = getClawSessionSnapshot();
  applyTrayVisual();
  unsubscribeRecordingState = onRecordingStateChange(syncTrayToState);
  unsubscribeClawState = onClawSessionStateChange(syncTrayToClaw);

  if (!themeListenerAttached) {
    themeListenerAttached = true;
    nativeTheme.on('updated', () => applyTrayVisual());
  }

  log.info('[Tray] Menu bar icon initialized');
}

function destroyTray(): void {
  if (unsubscribeRecordingState) {
    unsubscribeRecordingState();
    unsubscribeRecordingState = null;
  }
  if (unsubscribeClawState) {
    unsubscribeClawState();
    unsubscribeClawState = null;
  }
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  if (clawBadgeInterval) {
    clearInterval(clawBadgeInterval);
    clawBadgeInterval = null;
  }
  stopPillRenderer();
  stopClawBadgeRenderer();
  idleIcon = null;
  lastRecording = null;
  lastClaw = null;
  if (!tray) return;
  tray.destroy();
  tray = null;
  log.info('[Tray] Menu bar icon removed');
}

export function getTrayBounds(): Electron.Rectangle | null {
  if (!tray || tray.isDestroyed()) return null;
  return tray.getBounds();
}

export function isTrayVisible(): boolean {
  return trayStore.get(VISIBLE_KEY, true) as boolean;
}

export function setTrayVisible(visible: boolean): void {
  trayStore.set(VISIBLE_KEY, visible);
  if (visible) {
    createTray();
  } else {
    destroyTray();
  }
}

export function initTray(): void {
  if (!isTrayVisible()) {
    log.info('[Tray] Menu bar icon hidden by preference');
    return;
  }
  createTray();
}
