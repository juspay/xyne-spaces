import { app, globalShortcut } from 'electron';
import log from 'electron-log/main';
import { toggleRecording } from './recording-controller';

export const RECORDING_SHORTCUT = 'CommandOrControl+Alt+X';

export function registerGlobalShortcuts(): void {
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

  app.once('will-quit', () => {
    globalShortcut.unregister(RECORDING_SHORTCUT);
  });
}
