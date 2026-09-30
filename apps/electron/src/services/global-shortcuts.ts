import { app, globalShortcut } from 'electron';
import log from 'electron-log/main';
import { toggleRecording } from './recording-controller';
import { toggleClawSpotlight } from './claw-overlay-window';

export const RECORDING_SHORTCUT = 'CommandOrControl+Alt+X';

const CLAW_SPOTLIGHT_ACCELERATORS = [
  'CommandOrControl+Alt+C',
  'CommandOrControl+Alt+Space',
  'CommandOrControl+Shift+Alt+C',
];

let clawSpotlightShortcut: string | null = null;
let cleanupRegistered = false;

export function getClawSpotlightShortcut(): string | null {
  return clawSpotlightShortcut;
}

function registerCleanupOnce(): void {
  if (cleanupRegistered) return;
  cleanupRegistered = true;

  app.once('will-quit', () => {
    globalShortcut.unregisterAll();
  });
}

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

function registerClawSpotlightShortcut(): void {
  if (clawSpotlightShortcut) return;

  for (const accelerator of CLAW_SPOTLIGHT_ACCELERATORS) {
    if (globalShortcut.isRegistered(accelerator)) continue;

    const registered = globalShortcut.register(accelerator, () => {
      log.info(`[GlobalShortcuts] Claw spotlight shortcut pressed (${accelerator})`);
      void toggleClawSpotlight();
    });

    if (registered) {
      clawSpotlightShortcut = accelerator;
      log.info(`[GlobalShortcuts] Registered ${accelerator} to toggle Claw spotlight`);
      return;
    }

    log.warn(`[GlobalShortcuts] Failed to register ${accelerator}`);
  }

  log.error('[GlobalShortcuts] No Claw spotlight accelerator could be registered');
}

export function registerGlobalShortcuts(): void {
  registerRecordingShortcut();
  registerClawSpotlightShortcut();
  registerCleanupOnce();
}
