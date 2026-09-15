import { METRIC_SPECS, formatMetric } from './thresholds';
import type { DiagnosticsSnapshot, Finding, MetricKey } from './types';

/**
 * Local, deterministic analysis of a diagnostics snapshot.
 *
 * Each rule states the measurements that triggered it rather than only its
 * conclusion. These are correlations, not proofs — a rule that asserts a cause
 * without showing its working is one the user cannot check, and the first wrong
 * one costs the trust of every right one that follows.
 *
 * Detection only: nothing here changes app state.
 */

/** A script owning at least this share of main-thread time is worth naming. */
const DOMINANT_SCRIPT_SHARE = 0.4;
/** Below this share of the machine, Xyne is a bystander to the load. */
const BYSTANDER_SHARE = 25;
/** Forced style/layout above this share of a script's time is the real fault. */
const LAYOUT_THRASH_SHARE = 0.3;
/** Fewer buckets than this cannot establish a trend. */
const MIN_TREND_POINTS = 10;

function value(snapshot: DiagnosticsSnapshot, key: MetricKey): number | null {
  return snapshot.metrics[key].value;
}

function isBad(snapshot: DiagnosticsSnapshot, key: MetricKey): boolean {
  return snapshot.metrics[key].verdict === 'bad';
}

function isDegraded(snapshot: DiagnosticsSnapshot, key: MetricKey): boolean {
  const verdict = snapshot.metrics[key].verdict;
  return verdict === 'bad' || verdict === 'warn';
}

function show(snapshot: DiagnosticsSnapshot, key: MetricKey): string {
  return `${METRIC_SPECS[key].label}: ${formatMetric(key, value(snapshot, key))}`;
}

/**
 * True when a series rises consistently rather than merely sitting high. Uses
 * the sign of the least-squares slope across the retained buckets, which
 * tolerates the sawtooth of ordinary garbage collection.
 */
function isRising(points: { t: number; v: number }[], minRisePercent: number): boolean {
  if (points.length < MIN_TREND_POINTS) return false;

  const n = points.length;
  const meanX = points.reduce((sum, p) => sum + p.t, 0) / n;
  const meanY = points.reduce((sum, p) => sum + p.v, 0) / n;
  let covariance = 0;
  let variance = 0;
  for (const point of points) {
    covariance += (point.t - meanX) * (point.v - meanY);
    variance += (point.t - meanX) ** 2;
  }
  if (variance === 0) return false;

  const slope = covariance / variance;
  const span = (points[n - 1] as { t: number }).t - (points[0] as { t: number }).t;
  const rise = slope * span;
  return meanY > 0 && (rise / meanY) * 100 >= minRisePercent;
}

type Rule = (snapshot: DiagnosticsSnapshot) => Finding | null;

/** The machine is loaded, but not by us — worth saying before blaming the app. */
const machineBusy: Rule = snapshot => {
  const share = snapshot.cpu.appSharePercent;
  if (!isDegraded(snapshot, 'cpuPressure') || share === null || share >= BYSTANDER_SHARE) {
    return null;
  }
  return {
    id: 'machine-busy',
    title: 'Your machine is busy with something other than Xyne',
    evidence: [
      show(snapshot, 'cpuPressure'),
      `Xyne is only ${share.toFixed(0)}% of all CPU activity`,
      ...(snapshot.cpu.thermalState && snapshot.cpu.thermalState !== 'nominal'
        ? [`Thermal state: ${snapshot.cpu.thermalState}`]
        : []),
    ],
    suggestion:
      'Xyne will feel slow until the machine frees up. Closing other heavy apps will help more than anything changed here.',
    severity: isBad(snapshot, 'cpuPressure') ? 'bad' : 'warn',
    actionable: false,
  };
};

/** The headline jank rule: blocked main thread with a named culprit. */
const blockingScript: Rule = snapshot => {
  if (!isDegraded(snapshot, 'longTaskShare')) return null;

  const scripts = snapshot.scripts;
  const total = scripts.reduce((sum, script) => sum + script.totalMs, 0);
  const worst = scripts[0];
  if (!worst || total <= 0) return null;

  const share = worst.totalMs / total;
  if (share < DOMINANT_SCRIPT_SHARE) return null;

  return {
    id: 'blocking-script',
    title: `${worst.fn} is freezing the interface`,
    evidence: [
      show(snapshot, 'longTaskShare'),
      `${worst.fn} in ${worst.source} used ${worst.totalMs.toFixed(0)}ms across ${worst.count} call${worst.count === 1 ? '' : 's'}`,
      `That is ${(share * 100).toFixed(0)}% of all script time measured`,
      ...(worst.invoker ? [`Triggered by ${worst.invoker}`] : []),
    ],
    suggestion:
      'Report this function — it is a single hot path rather than general slowness, so it is usually fixable on its own.',
    severity: isBad(snapshot, 'longTaskShare') ? 'bad' : 'warn',
    actionable: true,
  };
};

/** Layout thrash is a distinct, very fixable cause of the same symptom. */
const layoutThrash: Rule = snapshot => {
  const worst = [...snapshot.scripts]
    .filter(script => script.totalMs > 0)
    .sort((a, b) => b.forcedLayoutMs - a.forcedLayoutMs)[0];
  if (!worst || worst.forcedLayoutMs <= 0) return null;
  if (worst.forcedLayoutMs / worst.totalMs < LAYOUT_THRASH_SHARE) return null;

  return {
    id: 'layout-thrash',
    title: 'The app is recalculating layout more than it needs to',
    evidence: [
      `${worst.fn} in ${worst.source} spent ${worst.forcedLayoutMs.toFixed(0)}ms of its ${worst.totalMs.toFixed(0)}ms forcing style and layout`,
    ],
    suggestion:
      'This is usually reading an element size in the middle of a loop that also writes to it. Worth reporting with the function name.',
    severity: 'warn',
    actionable: true,
  };
};

/** Directly matches "navigation feels slow". */
const slowNavigation: Rule = snapshot => {
  if (!isDegraded(snapshot, 'navigationBlockingMs')) return null;

  const worst = snapshot.scripts[0];
  return {
    id: 'slow-navigation',
    title: 'Opening a screen freezes the app',
    evidence: [
      show(snapshot, 'navigationBlockingMs'),
      ...(worst ? [`Heaviest script in this session: ${worst.fn} in ${worst.source}`] : []),
    ],
    suggestion:
      'The delay is the interface being blocked, not data still loading — those show up separately as query latency.',
    severity: isBad(snapshot, 'navigationBlockingMs') ? 'bad' : 'warn',
    actionable: true,
  };
};

/** Battery: work done while nobody is using the app. */
const idleBurn: Rule = snapshot => {
  if (!isDegraded(snapshot, 'idleCpuPercent')) return null;
  const idleFor = snapshot.idleForSeconds;

  return {
    id: 'idle-burn',
    title: 'Xyne keeps working while you are not using it',
    evidence: [
      show(snapshot, 'idleCpuPercent'),
      ...(idleFor !== null ? [`No interaction for ${Math.round(idleFor / 60)} minute(s)`] : []),
      ...(snapshot.cpu.onBatteryPower ? ['Currently running on battery'] : []),
    ],
    suggestion:
      'Sustained CPU while idle is the main way an app drains a battery in the background. Worth reporting with the script table below.',
    severity: isBad(snapshot, 'idleCpuPercent') ? 'bad' : 'warn',
    actionable: true,
  };
};

/** Dropped frames without an obvious blocking culprit still explain "laggy". */
const lowFrameRate: Rule = snapshot => {
  if (!isDegraded(snapshot, 'fps')) return null;
  return {
    id: 'low-frame-rate',
    title: 'The interface is not keeping up',
    evidence: [
      show(snapshot, 'fps'),
      ...(isDegraded(snapshot, 'longTaskShare') ? [show(snapshot, 'longTaskShare')] : []),
      `${snapshot.longTaskCount} long task(s) recorded this session`,
    ],
    suggestion:
      'Scrolling and typing will feel heavy. If a single script is named above, that is the cause; otherwise it is general load.',
    severity: isBad(snapshot, 'fps') ? 'bad' : 'warn',
    actionable: true,
  };
};

/** Memory near the ceiling causes GC pauses, which read as lag. */
const memoryPressure: Rule = snapshot => {
  if (!isDegraded(snapshot, 'heapFraction')) return null;
  const rising = isRising(snapshot.metrics.heapUsedMb.historyPoints, 20);

  return {
    id: 'memory-pressure',
    title: rising
      ? 'Memory use is climbing and near the browser limit'
      : 'Memory use is close to the browser limit',
    evidence: [
      show(snapshot, 'heapFraction'),
      show(snapshot, 'heapUsedMb'),
      ...(rising ? ['Still rising across the retained history rather than levelling off'] : []),
    ],
    suggestion: rising
      ? 'A steady climb points at something not being released. Reloading will clear it; report it if it returns.'
      : 'Pauses for garbage collection will feel like lag. Reloading frees it.',
    severity: isBad(snapshot, 'heapFraction') ? 'bad' : 'warn',
    actionable: true,
  };
};

const RULES: Rule[] = [
  machineBusy,
  blockingScript,
  slowNavigation,
  idleBurn,
  layoutThrash,
  lowFrameRate,
  memoryPressure,
];

export function analyze(snapshot: DiagnosticsSnapshot): Finding[] {
  const findings: Finding[] = [];
  for (const rule of RULES) {
    const finding = rule(snapshot);
    if (finding) findings.push(finding);
  }
  // Worst first, and a cause outside the app last — it is context, not a fault
  // the reader can act on.
  return findings.sort((a, b) => {
    if (a.actionable !== b.actionable) return a.actionable ? -1 : 1;
    if (a.severity !== b.severity) return a.severity === 'bad' ? -1 : 1;
    return 0;
  });
}
