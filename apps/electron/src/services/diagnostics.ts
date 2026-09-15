import { app, powerMonitor } from 'electron';
import * as os from 'os';

/**
 * Real CPU accounting for the diagnostics panel.
 *
 * No desktop platform exposes per-application power draw, so CPU time is the
 * attributable signal. `app.getAppMetrics()` gives Xyne's own per-process cost;
 * diffing `os.cpus()` gives whole-machine utilisation. The ratio of the two is
 * the only defensible statement we can make about Xyne's share of the energy
 * the machine is spending.
 */

export interface ProcessSample {
  pid: number;
  type: string;
  name: string;
  cpuPercent: number;
  workingSetMb: number;
  idleWakeupsPerSecond: number;
}

export interface DiagnosticsSample {
  at: number;
  processes: ProcessSample[];
  /** Sum across Xyne processes, as a percentage of one core. */
  appCpuPercent: number;
  /** Whole-machine utilisation 0..100, or null before two samples exist. */
  systemCpuPercent: number | null;
  /** Xyne's share of all CPU activity 0..100, or null while the machine is idle. */
  appSharePercent: number | null;
  coreCount: number;
  thermalState: string | null;
  onBatteryPower: boolean | null;
  appVersion: string;
}

const SAMPLE_INTERVAL_MS = 2000;
/** Sampling stops once the panel stops asking, so an unopened panel costs nothing. */
const IDLE_STOP_MS = 30_000;
const KB_PER_MB = 1024;

interface CpuTimesSnapshot {
  busy: number;
  total: number;
}

function readCpuTimes(): CpuTimesSnapshot {
  let busy = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    const { user, nice, sys, idle, irq } = cpu.times;
    busy += user + nice + sys + irq;
    total += user + nice + sys + irq + idle;
  }
  return { busy, total };
}

let previousCpuTimes: CpuTimesSnapshot | null = null;
let latest: DiagnosticsSample | null = null;
let timer: NodeJS.Timeout | null = null;
let lastRequestedAt = 0;

function sample(): void {
  const metrics = app.getAppMetrics();

  const processes: ProcessSample[] = metrics.map((metric) => ({
    pid: metric.pid,
    type: metric.type,
    name: metric.name || metric.serviceName || metric.type,
    cpuPercent: metric.cpu?.percentCPUUsage ?? 0,
    workingSetMb: (metric.memory?.workingSetSize ?? 0) / KB_PER_MB,
    idleWakeupsPerSecond: metric.cpu?.idleWakeupsPerSecond ?? 0,
  }));

  const appCpuPercent = processes.reduce((sum, p) => sum + p.cpuPercent, 0);
  const coreCount = os.cpus().length || 1;

  const current = readCpuTimes();
  let systemCpuPercent: number | null = null;
  if (previousCpuTimes) {
    const totalDelta = current.total - previousCpuTimes.total;
    const busyDelta = current.busy - previousCpuTimes.busy;
    if (totalDelta > 0) {
      systemCpuPercent = Math.min(100, Math.max(0, (busyDelta / totalDelta) * 100));
    }
  }
  previousCpuTimes = current;

  // Both sides converted to "fraction of the whole machine" before dividing:
  // getAppMetrics is per-core, os.cpus() is across all cores.
  let appSharePercent: number | null = null;
  if (systemCpuPercent !== null && systemCpuPercent > 0.5) {
    const appFraction = appCpuPercent / (coreCount * 100);
    const systemFraction = systemCpuPercent / 100;
    appSharePercent = Math.min(100, (appFraction / systemFraction) * 100);
  }

  latest = {
    at: Date.now(),
    processes,
    appCpuPercent,
    systemCpuPercent,
    appSharePercent,
    coreCount,
    thermalState: readThermalState(),
    onBatteryPower: readOnBatteryPower(),
    appVersion: app.getVersion(),
  };

  if (Date.now() - lastRequestedAt > IDLE_STOP_MS) stopSampling();
}

function readThermalState(): string | null {
  try {
    // macOS only; other platforms throw or return 'unknown'.
    return powerMonitor.getCurrentThermalState();
  } catch {
    return null;
  }
}

function readOnBatteryPower(): boolean | null {
  try {
    return powerMonitor.onBatteryPower;
  } catch {
    return null;
  }
}

function startSampling(): void {
  if (timer) return;
  previousCpuTimes = readCpuTimes();
  sample();
  timer = setInterval(sample, SAMPLE_INTERVAL_MS);
}

function stopSampling(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
  previousCpuTimes = null;
}

/**
 * Returns the most recent sample, starting the sampler on first use. The first
 * call after an idle period returns a sample whose CPU figures are still
 * warming up — Chromium's first `getAppMetrics` reads 0 — so the panel polls.
 */
export function getDiagnosticsSample(): DiagnosticsSample | null {
  lastRequestedAt = Date.now();
  startSampling();
  return latest;
}

export function stopDiagnostics(): void {
  stopSampling();
  latest = null;
}
