import type { MetricKey, Verdict } from './types';

export interface MetricSpec {
  label: string;
  /** Short line explaining what the number means, shown under the tile. */
  help: string;
  unit: string;
  group: 'cpu' | 'memory' | 'latency' | 'sync';
  /** 'lower' = smaller is better (latency); 'higher' = bigger is better (fps, battery). */
  direction: 'lower' | 'higher';
  /** Value at which the metric stops being `good`. */
  warnAt: number;
  /** Value at which the metric becomes `bad`. */
  badAt: number;
  decimals: number;
  /** Renders the raw value for display; defaults to fixed-decimal + unit. */
  format?: (value: number) => string;
}

/**
 * Core Web Vitals bands are the official web.dev thresholds (75th-percentile
 * definitions), so a "good" here means the same thing it means in PageSpeed /
 * CrUX. The non-vitals bands are ours: chosen so `warn` is "a user would notice
 * on a bad day" and `bad` is "a user is complaining right now".
 */
export const METRIC_SPECS: Record<MetricKey, MetricSpec> = {
  cpuPressure: {
    label: 'CPU pressure',
    help: 'Reported by the operating system, not estimated.',
    unit: '',
    group: 'cpu',
    direction: 'lower',
    warnAt: 2,
    badAt: 3,
    decimals: 0,
    format: v => PRESSURE_STATES[Math.round(v)] ?? 'unknown',
  },
  cpuPercent: {
    label: 'Xyne CPU usage',
    help: 'Total CPU across every Xyne process, as a share of one core. 100% means one core fully busy.',
    unit: '%',
    group: 'cpu',
    direction: 'lower',
    warnAt: 80,
    badAt: 150,
    decimals: 0,
  },
  cpuSharePercent: {
    label: 'Share of machine CPU',
    help: 'How much of all CPU activity on this machine is Xyne. This is the closest honest measure of the energy Xyne is responsible for.',
    unit: '%',
    group: 'cpu',
    direction: 'lower',
    warnAt: 25,
    badAt: 45,
    decimals: 0,
  },
  fps: {
    label: 'Frame rate',
    help: 'Frames actually rendered per second. Below 30 feels choppy.',
    unit: 'fps',
    group: 'cpu',
    direction: 'higher',
    warnAt: 45,
    badAt: 30,
    decimals: 0,
  },
  longTaskShare: {
    label: 'Main thread blocked',
    help: 'Share of time the app was frozen and could not respond to you.',
    unit: '%',
    group: 'cpu',
    direction: 'lower',
    warnAt: 10,
    badAt: 25,
    decimals: 1,
  },

  navigationBlockingMs: {
    label: 'Freeze after navigating',
    help: 'How long the app was unresponsive after you last opened a screen. This is what makes navigation feel slow.',
    unit: 'ms',
    group: 'cpu',
    direction: 'lower',
    warnAt: 300,
    badAt: 1000,
    decimals: 0,
  },
  idleCpuPercent: {
    label: 'CPU while idle',
    help: 'CPU the app uses when you are not touching it. Work done while idle is what drains a battery in the background.',
    unit: '%',
    group: 'cpu',
    direction: 'lower',
    warnAt: 15,
    badAt: 40,
    decimals: 0,
  },
  heapUsedMb: {
    label: 'Memory in use',
    help: 'JavaScript memory held by the app right now.',
    unit: 'MB',
    group: 'memory',
    direction: 'lower',
    warnAt: 1200,
    badAt: 2000,
    decimals: 0,
  },
  heapFraction: {
    label: 'Memory headroom used',
    help: 'How close the app is to the browser memory ceiling. Near 100% means a crash is likely.',
    unit: '%',
    group: 'memory',
    direction: 'lower',
    warnAt: 60,
    badAt: 80,
    decimals: 0,
  },
  rssMb: {
    label: 'Total app memory',
    help: 'Real memory held by all app processes, as the OS sees it.',
    unit: 'MB',
    group: 'memory',
    direction: 'lower',
    warnAt: 2000,
    badAt: 3500,
    decimals: 0,
  },

  apiLatencyP95: {
    label: 'API latency (p95)',
    help: 'How long the slowest 5% of server requests took.',
    unit: 'ms',
    group: 'latency',
    direction: 'lower',
    warnAt: 800,
    badAt: 2000,
    decimals: 0,
  },
  zeroQueryP95: {
    label: 'Query latency (p95)',
    help: 'Time from a screen asking for data to that data being ready. Measured across every Zero query.',
    unit: 'ms',
    group: 'sync',
    direction: 'lower',
    warnAt: 1000,
    badAt: 3000,
    decimals: 0,
  },
  zeroPokeP95: {
    label: 'Update processing (p95)',
    help: 'Time spent applying each batch of live updates from the server.',
    unit: 'ms',
    group: 'sync',
    direction: 'lower',
    warnAt: 100,
    badAt: 300,
    decimals: 0,
  },
  zeroDisconnectsPerHour: {
    label: 'Reconnections',
    help: 'How often the live connection dropped and had to be re-established. Frequent drops mean data arrives late.',
    unit: '/hr',
    group: 'sync',
    direction: 'lower',
    warnAt: 3,
    badAt: 10,
    decimals: 1,
  },
  zeroMutationP95: {
    label: 'Save latency (p95)',
    help: 'Time from an action until the server confirmed it. High values mean edits look applied but are not saved yet.',
    unit: 'ms',
    group: 'sync',
    direction: 'lower',
    warnAt: 1000,
    badAt: 3000,
    decimals: 0,
  },
  zeroPendingMutations: {
    label: 'Unsent changes',
    help: 'Actions waiting for the server to confirm them. A number that keeps climbing means writes are backing up.',
    unit: '',
    group: 'sync',
    direction: 'lower',
    warnAt: 5,
    badAt: 20,
    decimals: 0,
  },
  networkRtt: {
    label: 'Network round-trip',
    help: 'Estimated latency to the network, reported by the browser.',
    unit: 'ms',
    group: 'latency',
    direction: 'lower',
    warnAt: 150,
    badAt: 400,
    decimals: 0,
  },
};

export const PRESSURE_STATES = ['nominal', 'fair', 'serious', 'critical'] as const;

export function pressureToNumber(state: string): number {
  const index = (PRESSURE_STATES as readonly string[]).indexOf(state);
  return index < 0 ? 0 : index;
}

export function verdictFor(key: MetricKey, value: number | null): Verdict {
  if (value === null || !Number.isFinite(value)) return 'unknown';
  const spec = METRIC_SPECS[key];
  if (spec.direction === 'lower') {
    if (value >= spec.badAt) return 'bad';
    if (value >= spec.warnAt) return 'warn';
    return 'good';
  }
  if (value <= spec.badAt) return 'bad';
  if (value <= spec.warnAt) return 'warn';
  return 'good';
}

export function formatMetric(key: MetricKey, value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const spec = METRIC_SPECS[key];
  if (spec.format) return spec.format(value);
  return `${value.toFixed(spec.decimals)}${spec.unit ? ` ${spec.unit}` : ''}`;
}

const VERDICT_RANK: Record<Verdict, number> = { unknown: -1, good: 0, warn: 1, bad: 2 };

export function worstVerdict(verdicts: Verdict[]): Verdict {
  let worst: Verdict = 'unknown';
  for (const v of verdicts) {
    if (VERDICT_RANK[v] > VERDICT_RANK[worst]) worst = v;
  }
  return worst;
}

/** Tailwind classes per verdict, so every surface colours the same way. */
export const VERDICT_STYLES: Record<
  Verdict,
  { text: string; bg: string; border: string; dot: string; label: string }
> = {
  good: {
    text: 'text-emerald-700 dark:text-emerald-400',
    bg: 'bg-emerald-50 dark:bg-emerald-950/40',
    border: 'border-emerald-200 dark:border-emerald-900',
    dot: 'bg-emerald-500',
    label: 'Good',
  },
  warn: {
    text: 'text-amber-700 dark:text-amber-400',
    bg: 'bg-amber-50 dark:bg-amber-950/40',
    border: 'border-amber-200 dark:border-amber-900',
    dot: 'bg-amber-500',
    label: 'Needs attention',
  },
  bad: {
    text: 'text-red-700 dark:text-red-400',
    bg: 'bg-red-50 dark:bg-red-950/40',
    border: 'border-red-200 dark:border-red-900',
    dot: 'bg-red-500',
    label: 'Poor',
  },
  unknown: {
    text: 'text-neutral-500 dark:text-neutral-400',
    bg: 'bg-neutral-50 dark:bg-neutral-900/40',
    border: 'border-neutral-200 dark:border-neutral-800',
    dot: 'bg-neutral-400',
    label: 'No data',
  },
};
