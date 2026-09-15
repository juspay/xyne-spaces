import { diagnosticsStore } from '../store';
import { PRESSURE_STATES } from '../thresholds';
import { logger, Event } from '../../../utils/logger';
import { currentRouteTemplate } from '../../otel/perfMetrics';

/**
 * Periodic CPU snapshot to the bridge log.
 *
 * Nothing else in the pipeline carries CPU at all: `long_task_slow` reports
 * blocking without cause, and there is no metric for OS pressure, frame rate, or
 * the app's share of the machine. Riding the bridge logger means each entry
 * inherits `emailId`, `clientSessionId`, `pageUrl` and `platformName`, so an
 * agent can pull one user's CPU history without any extra join.
 *
 * 60s — half the rate of the existing heap snapshot, since CPU is read as a
 * trend rather than a spike detector (spikes arrive as `client_script_drain`).
 */
const SNAPSHOT_INTERVAL_MS = 60_000;

export function startCpuTelemetry(): () => void {
  const emit = (): void => {
    // A hidden tab gets no frames, so its numbers describe nothing.
    if (typeof document !== 'undefined' && document.hidden) return;

    const snapshot = diagnosticsStore.getSnapshot();
    const metrics = snapshot.metrics;
    const pressure = metrics.cpuPressure.value;

    const payload: Record<string, unknown> = {
      route: currentRouteTemplate(),
      fps: round(metrics.fps.value),
      mainThreadBlockedPercent: round(metrics.longTaskShare.value),
      longTaskCount: snapshot.longTaskCount,
    };

    if (pressure !== null) {
      payload['cpuPressure'] = PRESSURE_STATES[Math.round(pressure)] ?? 'unknown';
    }
    // Desktop only — the browser cannot see per-process or machine-wide CPU.
    if (snapshot.cpu.appCpuPercent !== null) {
      payload['appCpuPercent'] = round(snapshot.cpu.appCpuPercent);
      payload['systemCpuPercent'] = round(snapshot.cpu.systemCpuPercent);
      payload['appSharePercent'] = round(snapshot.cpu.appSharePercent);
      payload['coreCount'] = snapshot.cpu.coreCount;
      if (snapshot.cpu.thermalState) payload['thermalState'] = snapshot.cpu.thermalState;
    }

    logger.info(Event.CLIENT_CPU_SNAPSHOT, payload);
  };

  const timer = setInterval(emit, SNAPSHOT_INTERVAL_MS);
  return () => clearInterval(timer);
}

function round(value: number | null): number | null {
  return value === null ? null : Math.round(value);
}
