import { Menu, Tray, nativeImage } from 'electron';
import path from 'path';
import log from 'electron-log/main';
import { getMainWindow, createMainWindow, setWindowReferences } from '../window/manager';
import {
  focusMainWindow,
  getRecordingSnapshot,
  onRecordingStateChange,
  startRecordingFromOutside,
  stopRecording,
  type RecordingSnapshot,
} from './recording-controller';
import { RECORDING_SHORTCUT } from './global-shortcuts';

let tray: Tray | null = null;
let timerInterval: ReturnType<typeof setInterval> | null = null;

function formatElapsed(startTime: number): string {
  const totalSeconds = Math.max(0, Math.floor((Date.now() - startTime) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
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
  return Menu.buildFromTemplate([
    snapshot.active
      ? {
          label: 'Stop Recording',
          accelerator: RECORDING_SHORTCUT,
          registerAccelerator: false,
          click: () => stopRecording('tray'),
        }
      : {
          label: 'Start Recording',
          accelerator: RECORDING_SHORTCUT,
          registerAccelerator: false,
          click: () => void startRecordingFromOutside('tray'),
        },
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
    const start = snapshot.startTime;
    tray.setTitle(` ${formatElapsed(start)}`, { fontType: 'monospacedDigit' });
    timerInterval = setInterval(() => {
      tray?.setTitle(` ${formatElapsed(start)}`, { fontType: 'monospacedDigit' });
    }, 1000);
  } else {
    tray.setTitle('');
  }
}

export function initTray(): void {
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
  onRecordingStateChange(syncTrayToState);

  log.info('[Tray] Menu bar icon initialized');
}
