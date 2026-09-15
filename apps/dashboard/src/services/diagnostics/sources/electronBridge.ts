import { diagnosticsStore } from '../store';

const POLL_MS = 2000;

/**
 * Polls the Electron main process for real per-process CPU and memory. In the
 * browser these numbers do not exist at all, so the matching metrics are marked
 * unsupported rather than filled with an estimate.
 */
export function startElectronBridge(): () => void {
  const api = window.electronAPI;
  if (!api?.getDiagnosticsSample) {
    diagnosticsStore.markUnsupported(
      'cpuPercent',
      'Per-process CPU is only measurable in the desktop app.',
    );
    diagnosticsStore.markUnsupported(
      'cpuSharePercent',
      'Machine-wide CPU comparison is only measurable in the desktop app.',
    );
    return () => undefined;
  }

  let disposed = false;

  const poll = (): void => {
    api
      .getDiagnosticsSample()
      .then(sample => {
        if (disposed || !sample) return;
        diagnosticsStore.setElectronProcesses(
          sample.processes.map(process => ({
            pid: process.pid,
            type: process.type,
            name: process.name,
            cpuPercent: process.cpuPercent,
            workingSetMb: process.workingSetMb,
            idleWakeupsPerSecond: process.idleWakeupsPerSecond,
          })),
        );
        diagnosticsStore.setCpuContext({
          appCpuPercent: sample.appCpuPercent,
          systemCpuPercent: sample.systemCpuPercent,
          appSharePercent: sample.appSharePercent,
          coreCount: sample.coreCount,
          thermalState: sample.thermalState,
          onBatteryPower: sample.onBatteryPower,
        });
        // Only the main process knows the installed build, and an exported
        // report is far less useful without it.
        diagnosticsStore.setAppVersion(sample.appVersion);
      })
      .catch(() => undefined);
  };

  poll();
  const timer = setInterval(poll, POLL_MS);

  return () => {
    disposed = true;
    clearInterval(timer);
  };
}
