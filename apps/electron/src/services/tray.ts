import { Menu, Tray, nativeImage } from 'electron';
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
import { RECORDING_SHORTCUT } from './global-shortcuts';

const PAUSED_TITLE = ' Paused';

const trayStore = new Store({ name: 'tray' });
const VISIBLE_KEY = 'trayVisible';

let tray: Tray | null = null;
let timerInterval: ReturnType<typeof setInterval> | null = null;
let unsubscribeRecordingState: (() => void) | null = null;

function formatElapsed(snapshot: RecordingSnapshot): string {
  const startTime = snapshot.startTime ?? Date.now();
  const until = snapshot.pauseStartedAt ?? Date.now();
  const elapsedMs = until - startTime - snapshot.accumulatedPausedMs;
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatTitle(snapshot: RecordingSnapshot): string {
  return snapshot.paused ? PAUSED_TITLE : ` ${formatElapsed(snapshot)}`;
}

async function openXyne(): Promise<void> {
  const existing = getMainWindow();
  if (!existing || existing.isDestroyed()) {
    await createMainWindow();
    setWindowReferences();
  }
  focusMainWindow();
}

function buildMenu(snapshot: RecordingSnapshot): Menu {
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

  return Menu.buildFromTemplate([
    ...template,
    { type: 'separator' },
    {
      label: 'Open Xyne',
      click: () => void openXyne(),
    },
  ]);
}

function syncTrayToState(snapshot: RecordingSnapshot): void {
  if (!tray) return;

  tray.setContextMenu(buildMenu(snapshot));

  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }

  if (process.platform !== 'darwin') return;

  if (snapshot.active && snapshot.startTime) {
    tray.setTitle(formatTitle(snapshot), { fontType: 'monospacedDigit' });
    if (snapshot.paused) return;
    timerInterval = setInterval(() => {
      tray?.setTitle(formatTitle(snapshot), { fontType: 'monospacedDigit' });
    }, 1000);
  } else {
    tray.setTitle('');
  }
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

  tray = new Tray(icon);
  tray.setToolTip('Xyne');
  if (process.platform === 'win32') {
    tray.on('click', () => void openXyne());
  }
  syncTrayToState(getRecordingSnapshot());
  unsubscribeRecordingState = onRecordingStateChange(syncTrayToState);

  log.info('[Tray] Menu bar icon initialized');
}

function destroyTray(): void {
  if (unsubscribeRecordingState) {
    unsubscribeRecordingState();
    unsubscribeRecordingState = null;
  }
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  if (!tray) return;
  tray.destroy();
  tray = null;
  log.info('[Tray] Menu bar icon removed');
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
