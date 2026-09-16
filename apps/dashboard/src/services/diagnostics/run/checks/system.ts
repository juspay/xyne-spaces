import { SLOW_MACHINE_SPEED_INDEX } from '../probes/cpuBenchmark';
import { maxOf, mean, minOf, slopePerMinute } from '../stats';
import {
  gradeLower,
  measurement,
  ms,
  percent,
  samplesOf,
  seriesConfidence,
  skipped,
  values,
  worstStatus,
  type Check,
} from './shared';

/**
 * Machine, memory and storage checks — the causes that sit underneath the app
 * rather than inside it. Reporting these is what stops a slow laptop, a full
 * disk or a thermally throttled machine from being filed as an app bug.
 */

const HEAP_FRACTION_WARN = 60;
const HEAP_FRACTION_BAD = 80;
/** Sustained growth at this rate over a short window is worth flagging as a leak. */
const HEAP_GROWTH_WARN_MB_PER_MIN = 20;
const HEAP_GROWTH_BAD_MB_PER_MIN = 60;

const APP_SHARE_WARN = 25;
const APP_SHARE_BAD = 45;
/** The machine is loaded; below the share above, it is not Xyne loading it. */
const SYSTEM_BUSY_PERCENT = 70;

const IDLE_CPU_WARN = 15;
const IDLE_CPU_BAD = 40;

const IDB_WRITE_WARN_MS = 400;
const IDB_WRITE_BAD_MS = 1500;
const IDB_READ_WARN_MS = 200;
const IDB_READ_BAD_MS = 800;
/** Near the quota, the browser starts refusing writes and Zero loses its cache. */
const QUOTA_USED_WARN = 80;
const QUOTA_USED_BAD = 95;

export const machineCapability: Check = context => {
  const cpu = context.probes.cpu;
  if (!cpu) {
    return skipped(
      'machine-capability',
      'Machine speed',
      'machine',
      'The CPU benchmark did not complete.',
    );
  }

  const status = cpu.speedIndex < SLOW_MACHINE_SPEED_INDEX ? 'warn' : 'pass';
  const percentOfReference = Math.round(cpu.speedIndex * 100);

  return {
    id: 'machine-capability',
    title: 'Machine speed',
    category: 'machine',
    status,
    confidence: cpu.contended ? 'low' : 'high',
    confidenceReason: cpu.contended
      ? 'Other work interfered with every benchmark slice, so this is a floor on the machine’s speed rather than a measurement of it.'
      : `Fastest of ${cpu.slices} timed slices of identical work.`,
    summary:
      status === 'pass'
        ? `This machine runs JavaScript at about ${percentOfReference}% of reference speed.`
        : `This machine runs JavaScript at about ${percentOfReference}% of reference speed, so the same work costs noticeably more here.`,
    measurements: [
      measurement(
        'Speed index',
        `${percentOfReference}%`,
        `warn < ${SLOW_MACHINE_SPEED_INDEX * 100}%`,
      ),
      measurement('Best slice', ms(cpu.bestMs, 1)),
      measurement('Median slice', ms(cpu.medianMs, 1)),
      measurement('Cores', context.device.hardwareConcurrency?.toString() ?? '—'),
    ],
    evidence: [
      'Measured by running an identical fixed workload and timing it, so it compares hardware rather than load',
      ...(cpu.contended
        ? ['Every slice ran alongside other work, so the real figure may be higher than this']
        : []),
    ],
    remediation:
      status === 'pass'
        ? ''
        : 'Nothing in the app will make this machine faster. Findings below that depend on CPU should be read with this in mind.',
    actionable: false,
  };
};

export const machineLoad: Check = context => {
  const { systemCpuPercent, thermalState } = context.cpu;
  // Averaged across the run, not read off the final sample. CPU is spiky, and
  // whichever instant the run happened to end on is not the run.
  const appSharePercent =
    mean(values(samplesOf(context, 'cpuSharePercent'))) ?? context.cpu.appSharePercent;
  const appCpuPercent = mean(values(samplesOf(context, 'cpuPercent'))) ?? context.cpu.appCpuPercent;

  if (systemCpuPercent === null || appSharePercent === null) {
    return skipped(
      'machine-load',
      'Machine load',
      'machine',
      'Machine-wide CPU is only measurable in the desktop app.',
    );
  }

  const busy = systemCpuPercent >= SYSTEM_BUSY_PERCENT;
  const throttled = Boolean(thermalState && thermalState !== 'nominal');
  const xyneIsTheLoad = appSharePercent >= APP_SHARE_WARN;

  const status =
    busy && !xyneIsTheLoad ? 'warn' : gradeLower(appSharePercent, APP_SHARE_WARN, APP_SHARE_BAD);
  const samples = context.window.processSampleCount;
  const { confidence, reason } = seriesConfidence(context, samples, 5, 12);

  return {
    id: 'machine-load',
    title: 'Machine load',
    category: 'machine',
    status,
    confidence,
    confidenceReason: reason,
    summary:
      busy && !xyneIsTheLoad
        ? `The machine is busy, but only ${percent(appSharePercent)} of that is Xyne.`
        : status === 'pass'
          ? `Xyne is using ${percent(appSharePercent)} of this machine’s CPU activity.`
          : `Xyne is responsible for ${percent(appSharePercent)} of all CPU activity on this machine.`,
    measurements: [
      measurement('Xyne share of machine', percent(appSharePercent), `warn ≥ ${APP_SHARE_WARN}%`),
      measurement('Whole machine busy', percent(systemCpuPercent)),
      measurement('Xyne CPU', percent(appCpuPercent), 'as a share of one core'),
      ...(thermalState ? [measurement('Thermal state', thermalState)] : []),
    ],
    evidence: [
      'CPU share is the closest honest measure of the energy Xyne is responsible for — no platform reports per-application power draw',
      ...(throttled
        ? [
            `The machine reports a thermal state of "${thermalState}", so it is running below full speed`,
          ]
        : []),
    ],
    remediation:
      busy && !xyneIsTheLoad
        ? 'Xyne will feel slow until the machine frees up. Closing other heavy applications will help more than any app-side change.'
        : status === 'pass'
          ? ''
          : 'Sustained share at this level is the app doing real work; the script table shows what.',
    actionable: !(busy && !xyneIsTheLoad),
  };
};

export const memoryHeadroom: Check = context => {
  const fractions = values(samplesOf(context, 'heapFraction'));
  if (fractions.length === 0) {
    return skipped(
      'memory-headroom',
      'Memory headroom',
      'memory',
      'Detailed memory reporting is only available in Chrome and the desktop app.',
    );
  }

  const peak = maxOf(fractions) ?? 0;
  const used = values(samplesOf(context, 'heapUsedMb'));
  const peakUsed = maxOf(used) ?? 0;
  const status = gradeLower(peak, HEAP_FRACTION_WARN, HEAP_FRACTION_BAD);
  const { confidence, reason } = seriesConfidence(context, fractions.length, 5, 12);

  return {
    id: 'memory-headroom',
    title: 'Memory headroom',
    category: 'memory',
    status,
    confidence,
    confidenceReason: reason,
    summary:
      status === 'pass'
        ? 'The app has comfortable memory headroom.'
        : `The app reached ${percent(peak)} of the browser memory ceiling.`,
    measurements: [
      measurement(
        'Peak of ceiling',
        percent(peak),
        `warn ≥ ${HEAP_FRACTION_WARN}%, fail ≥ ${HEAP_FRACTION_BAD}%`,
      ),
      measurement('Peak in use', `${peakUsed.toFixed(0)} MB`),
    ],
    evidence: [
      'Pauses for garbage collection get longer and more frequent as this approaches the ceiling, and read as lag',
    ],
    remediation:
      status === 'pass'
        ? ''
        : 'Reloading frees it immediately. If it returns quickly, that is worth reporting.',
    actionable: status !== 'pass',
  };
};

export const memoryGrowth: Check = context => {
  const points = samplesOf(context, 'heapUsedMb');
  if (points.length < 5 || context.window.durationMs < 20_000) {
    return skipped(
      'memory-growth',
      'Memory growth',
      'memory',
      'A longer run is needed before a growth trend means anything.',
    );
  }

  const slope = slopePerMinute(points);
  if (slope === null) {
    return skipped(
      'memory-growth',
      'Memory growth',
      'memory',
      'Memory did not vary enough to fit a trend.',
    );
  }

  // A rising slope alone is not a leak. A heap sawtooths between collections, so
  // a window that happens to end just before a collection fits a steep line
  // through entirely normal behaviour. What distinguishes a leak is the floor
  // moving: the troughs after each collection sitting higher than they did.
  const third = Math.max(1, Math.floor(points.length / 3));
  const firstTrough = minOf(values(points.slice(0, third)));
  const lastTrough = minOf(values(points.slice(points.length - third)));
  const troughRise = firstTrough === null || lastTrough === null ? null : lastTrough - firstTrough;
  const floorRising = troughRise !== null && troughRise > 0;

  const status = floorRising
    ? gradeLower(slope, HEAP_GROWTH_WARN_MB_PER_MIN, HEAP_GROWTH_BAD_MB_PER_MIN)
    : 'pass';
  const { confidence, reason } = seriesConfidence(context, points.length, 10, 20);

  return {
    id: 'memory-growth',
    title: 'Memory growth',
    category: 'memory',
    status,
    confidence,
    confidenceReason:
      status === 'pass'
        ? reason
        : `${reason} A short window can mistake normal allocation for a leak — re-run for longer to confirm.`,
    summary:
      status === 'pass'
        ? floorRising
          ? 'Memory grew during the run, but within the range of ordinary allocation.'
          : 'Memory use was stable across the run.'
        : `Memory grew by about ${slope.toFixed(0)} MB per minute and did not come back down.`,
    measurements: [
      measurement(
        'Growth rate',
        `${slope.toFixed(1)} MB/min`,
        `warn ≥ ${HEAP_GROWTH_WARN_MB_PER_MIN}, fail ≥ ${HEAP_GROWTH_BAD_MB_PER_MIN}`,
      ),
      measurement(
        'Floor moved by',
        troughRise === null ? '—' : `${troughRise >= 0 ? '+' : ''}${troughRise.toFixed(1)} MB`,
        'must rise before growth counts',
      ),
      measurement('Samples', String(points.length)),
    ],
    evidence: [
      'Least-squares slope across the run, cross-checked against the lowest point reached in its first and last thirds',
      ...(floorRising
        ? []
        : [
            'Memory returned to where it started, so the rise was ordinary allocation between collections',
          ]),
      ...(context.interactive
        ? ['The user was active during this run, so some growth is expected']
        : ['Nobody interacted during this run, so growth here is not explained by use']),
    ],
    remediation:
      status === 'pass'
        ? ''
        : 'A steady climb while idle points at something not being released. Reloading clears it; report it if it returns.',
    actionable: status !== 'pass',
  };
};

export const idleCost: Check = context => {
  if (context.interactive) {
    return skipped(
      'idle-cost',
      'Cost while idle',
      'machine',
      'The user was active during this run, so no idle period was measured.',
    );
  }
  const idle = values(samplesOf(context, 'idleCpuPercent'));
  if (idle.length === 0) {
    return skipped(
      'idle-cost',
      'Cost while idle',
      'machine',
      'Idle CPU is only measurable in the desktop app, after 30s without interaction.',
    );
  }

  const average = mean(idle) ?? 0;
  const status = gradeLower(average, IDLE_CPU_WARN, IDLE_CPU_BAD);
  const { confidence, reason } = seriesConfidence(context, idle.length, 3, 6);

  return {
    id: 'idle-cost',
    title: 'Cost while idle',
    category: 'machine',
    status,
    confidence,
    confidenceReason: reason,
    summary:
      status === 'pass'
        ? 'The app stayed quiet while nobody was using it.'
        : `The app used ${percent(average)} of a core while nobody was touching it.`,
    measurements: [
      measurement(
        'Idle CPU',
        percent(average),
        `warn ≥ ${IDLE_CPU_WARN}%, fail ≥ ${IDLE_CPU_BAD}%`,
      ),
      ...(context.cpu.onBatteryPower === null
        ? []
        : [measurement('Power source', context.cpu.onBatteryPower ? 'Battery' : 'Mains')]),
    ],
    evidence: [
      'Work done while idle is the main way an app drains a battery in the background',
      ...(context.window.processes.length
        ? [
            `Busiest process while idle: ${context.window.processes[0]?.name} at ${percent(context.window.processes[0]?.avgCpuPercent ?? 0)}`,
          ]
        : []),
    ],
    remediation:
      status === 'pass' ? '' : 'Worth reporting together with the process and script tables below.',
    actionable: status !== 'pass',
  };
};

export const storageSpeed: Check = context => {
  const storage = context.probes.storage;
  if (!storage || !storage.supported) {
    return skipped(
      'storage-speed',
      'Storage speed',
      'storage',
      storage?.unsupportedReason || 'Storage could not be measured on this device.',
    );
  }

  const status = worstStatus([
    gradeLower(storage.writeMs, IDB_WRITE_WARN_MS, IDB_WRITE_BAD_MS),
    gradeLower(storage.readMs, IDB_READ_WARN_MS, IDB_READ_BAD_MS),
  ]);

  return {
    id: 'storage-speed',
    title: 'Storage speed',
    category: 'storage',
    status,
    confidence: 'medium',
    confidenceReason:
      'One timed write-then-read of 320 KB. Enough to catch a badly slow disk, not to characterise it.',
    summary:
      status === 'pass'
        ? 'Local storage responded at a normal speed.'
        : `Writing 320 KB to local storage took ${ms(storage.writeMs)}.`,
    measurements: [
      measurement('Write 320 KB', ms(storage.writeMs), `warn ≥ ${IDB_WRITE_WARN_MS}ms`),
      measurement('Read back', ms(storage.readMs), `warn ≥ ${IDB_READ_WARN_MS}ms`),
      measurement('Throughput', `${storage.writeMbPerSecond.toFixed(1)} MB/s`),
    ],
    evidence: [
      'Live sync keeps its local cache in this storage, so slow storage presents as a slow app even when the network is fine',
    ],
    remediation:
      status === 'pass'
        ? ''
        : 'Usually a nearly full disk, an antivirus scanner inspecting browser storage, or a networked home directory.',
    actionable: false,
  };
};

export const storageQuota: Check = context => {
  const storage = context.probes.storage;
  if (!storage || storage.usageMb === null || storage.quotaMb === null || storage.quotaMb <= 0) {
    return skipped(
      'storage-quota',
      'Storage space',
      'storage',
      'This browser does not report a storage quota.',
    );
  }

  const usedPercent = (storage.usageMb / storage.quotaMb) * 100;
  const status = gradeLower(usedPercent, QUOTA_USED_WARN, QUOTA_USED_BAD);

  return {
    id: 'storage-quota',
    title: 'Storage space',
    category: 'storage',
    status,
    confidence: 'high',
    confidenceReason: 'Reported directly by the browser.',
    summary:
      status === 'pass'
        ? `Using ${storage.usageMb.toFixed(0)} MB of the ${(storage.quotaMb / 1024).toFixed(1)} GB available.`
        : `Local storage is ${percent(usedPercent)} full.`,
    measurements: [
      measurement('Used', `${storage.usageMb.toFixed(0)} MB`),
      measurement('Available', `${(storage.quotaMb / 1024).toFixed(1)} GB`),
      measurement('Full', percent(usedPercent), `warn ≥ ${QUOTA_USED_WARN}%`),
    ],
    evidence: [
      'At the quota the browser starts refusing writes, which makes the local cache unusable and forces every screen back to the network',
    ],
    remediation:
      status === 'pass'
        ? ''
        : 'Freeing disk space, or clearing site data for other sites, restores headroom.',
    actionable: false,
  };
};

export const SYSTEM_CHECKS: Check[] = [
  machineCapability,
  machineLoad,
  memoryHeadroom,
  memoryGrowth,
  idleCost,
  storageSpeed,
  storageQuota,
];
