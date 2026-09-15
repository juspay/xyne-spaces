import { loadHistory, startPersistence } from './persistence';
import { startCpuSource } from './sources/cpu';
import { startIdleSource } from './sources/idle';
import { startNavigationSource } from './sources/navigation';
import { startCpuTelemetry } from './sources/cpuTelemetry';
import { startDeviceSource } from './sources/device';
import { startElectronBridge } from './sources/electronBridge';
import { startLoafSource } from './sources/loaf';
import { startMemorySource } from './sources/memory';
import { startNetworkSource } from './sources/network';
import { diagnosticsStore } from './store';

export { diagnosticsStore } from './store';
export { noteNavigation } from './sources/navigation';
export { clearHistory, flushHistory } from './persistence';
export * from './types';

let stopAll: (() => void) | null = null;

/**
 * Starts every collector. Safe to call once at app start: collection is passive
 * (observers and 1–2s timers), independent of whether the panel is open, so a
 * user who hits jank and *then* opens the panel still sees what happened.
 */
export function startDiagnostics(): () => void {
  if (stopAll) return stopAll;

  const stops = [
    startDeviceSource(),
    startCpuSource(),
    startIdleSource(),
    startNavigationSource(),
    startCpuTelemetry(),
    startLoafSource(),
    startMemorySource(),
    startNetworkSource(),
    startElectronBridge(),
    startPersistence(diagnosticsStore),
  ];

  void loadHistory().then(history => diagnosticsStore.hydrate(history));

  stopAll = () => {
    for (const stop of stops) stop();
    stopAll = null;
  };
  return stopAll;
}
