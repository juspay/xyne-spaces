import { app, BrowserWindow, globalShortcut } from 'electron';
import log from 'electron-log/main';
import { toggleRecording } from './recording-controller';

export const RECORDING_SHORTCUT = 'CommandOrControl+Alt+X';

function registerRecordingShortcut(): void {
  if (globalShortcut.isRegistered(RECORDING_SHORTCUT)) return;

  const registered = globalShortcut.register(RECORDING_SHORTCUT, () => {
    log.info('[GlobalShortcuts] Recording shortcut pressed');
    toggleRecording('shortcut');
  });

  if (!registered) {
    log.warn(`[GlobalShortcuts] Failed to register ${RECORDING_SHORTCUT}`);
    return;
  }

  log.info(`[GlobalShortcuts] Registered ${RECORDING_SHORTCUT} to toggle recording`);
}

function unregisterRecordingShortcut(): void {
  if (!globalShortcut.isRegistered(RECORDING_SHORTCUT)) return;
  globalShortcut.unregister(RECORDING_SHORTCUT);
  log.info(`[GlobalShortcuts] Unregistered ${RECORDING_SHORTCUT} while Xyne is focused`);
}

function syncShortcutRegistration(): void {
  if (BrowserWindow.getFocusedWindow()) {
    unregisterRecordingShortcut();
  } else {
    registerRecordingShortcut();
  }
}

export function registerGlobalShortcuts(): void {
  const handleWindowFocus = (): void => unregisterRecordingShortcut();
  const handleWindowBlur = (): void => {
    setTimeout(syncShortcutRegistration, 0);
  };

  app.on('browser-window-focus', handleWindowFocus);
  app.on('browser-window-blur', handleWindowBlur);
  syncShortcutRegistration();

  app.once('will-quit', () => {
    app.removeListener('browser-window-focus', handleWindowFocus);
    app.removeListener('browser-window-blur', handleWindowBlur);
    unregisterRecordingShortcut();
  });
}
