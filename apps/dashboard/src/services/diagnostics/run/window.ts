import { isHiddenTabDisconnect } from '../store';
import { verdictFor } from '../thresholds';
import { percentile } from './stats';
import type {
  ApiDrain,
  ElectronProcessSample,
  MetricKey,
  Point,
  ScriptDrain,
  ZeroConnectionEvent,
  ZeroOpStat,
} from '../types';
import type { ProcessWindowStat, RunEvent, WindowSummary } from './types';

/**
 * Collects raw, timestamped events for exactly one run window.
 *
 * Kept deliberately separate from `DiagnosticsStore`: the store aggregates for a
 * whole session and cannot answer a question scoped to thirty seconds, while
 * this holds raw events and can. The store forwards to it and is otherwise
 * unaffected, so a run never disturbs the live panel.
 */

/** 30s of heavy activity is well under this; the cap only bounds a pathological run. */
const MAX_EVENTS = 30_000;

/**
 * Derived metrics whose stored value is a rolling p95 over the *session's*
 * buffer, not a fresh measurement. Recording them as window samples would carry
 * pre-run history inside the window, so the window recomputes them from the raw
 * per-call events instead.
 */
const DERIVED_KEYS = new Set<MetricKey>([
  'apiLatencyP95',
  'zeroQueryP95',
  'zeroMutationP95',
  'zeroDisconnectsPerHour',
]);

export class RunWindow {
  readonly startedAt: number;
  private endedAt: number | null = null;
  private readonly events: RunEvent[] = [];
  private dropped = 0;
  private hidden = false;

  constructor(startedAt: number = Date.now()) {
    this.startedAt = startedAt;
  }

  push(event: RunEvent): void {
    if (this.endedAt !== null) return;
    if (event.kind === 'metric' && DERIVED_KEYS.has(event.key)) return;
    if (this.events.length >= MAX_EVENTS) {
      this.dropped += 1;
      return;
    }
    this.events.push(event);
  }

  /** The tab going hidden invalidates frame-rate and idle measurements for the run. */
  noteHidden(): void {
    this.hidden = true;
  }

  close(at: number = Date.now()): void {
    if (this.endedAt === null) this.endedAt = at;
  }

  get closed(): boolean {
    return this.endedAt !== null;
  }

  get droppedEvents(): number {
    return this.dropped;
  }

  summarize(): WindowSummary {
    const endedAt = this.endedAt ?? Date.now();
    const durationMs = Math.max(0, endedAt - this.startedAt);

    const samples: Partial<Record<MetricKey, Point[]>> = {};
    const longTasks: { t: number; durationMs: number }[] = [];
    const scripts = new Map<string, ScriptDrain>();
    const api = new Map<string, { row: ApiDrain; durations: number[] }>();
    const queries = new Map<string, OpAccumulator>();
    const mutations = new Map<string, OpAccumulator>();
    const connectionEvents: ZeroConnectionEvent[] = [];
    const processes = new Map<number, ProcessAccumulator>();

    let blockedMs = 0;
    let longestBlockMs = 0;
    let scriptTotalMs = 0;
    let interactions = 0;
    let processSampleCount = 0;
    let disconnects = 0;
    let hiddenDisconnects = 0;

    for (const event of this.events) {
      switch (event.kind) {
        case 'metric': {
          const bucket = samples[event.key] ?? [];
          bucket.push({ t: event.t, v: event.v });
          samples[event.key] = bucket;
          break;
        }
        case 'longTask': {
          longTasks.push({ t: event.t, durationMs: event.durationMs });
          blockedMs += event.durationMs;
          if (event.durationMs > longestBlockMs) longestBlockMs = event.durationMs;
          break;
        }
        case 'script': {
          const key = `${event.source}::${event.fn}`;
          const existing = scripts.get(key);
          if (existing) {
            existing.totalMs += event.totalMs;
            existing.count += 1;
            existing.forcedLayoutMs += event.forcedLayoutMs;
          } else {
            scripts.set(key, {
              source: event.source,
              fn: event.fn,
              invoker: event.invoker,
              totalMs: event.totalMs,
              count: 1,
              forcedLayoutMs: event.forcedLayoutMs,
            });
          }
          scriptTotalMs += event.totalMs;
          break;
        }
        case 'api': {
          const existing = api.get(event.endpoint);
          if (existing) {
            existing.row.count += 1;
            existing.row.totalMs += event.durationMs;
            existing.row.transferKb += event.transferBytes / 1024;
            existing.durations.push(event.durationMs);
          } else {
            api.set(event.endpoint, {
              row: {
                endpoint: event.endpoint,
                count: 1,
                totalMs: event.durationMs,
                p95Ms: event.durationMs,
                transferKb: event.transferBytes / 1024,
              },
              durations: [event.durationMs],
            });
          }
          break;
        }
        case 'zeroOp': {
          const map = event.op === 'query' ? queries : mutations;
          accumulateOp(map, event.name, event.durationMs, event.error);
          break;
        }
        case 'connection': {
          connectionEvents.push({ t: event.t, name: event.name, reason: event.reason });
          if (event.name !== 'connected' && event.name !== 'connecting') {
            if (isHiddenTabDisconnect(event.reason)) hiddenDisconnects += 1;
            else disconnects += 1;
          }
          break;
        }
        case 'processes': {
          processSampleCount += 1;
          for (const sample of event.samples) accumulateProcess(processes, sample);
          break;
        }
        case 'interaction': {
          interactions += 1;
          break;
        }
      }
    }

    const apiDurations: number[] = [];
    for (const entry of api.values()) {
      entry.row.p95Ms = percentile(entry.durations, 95) ?? entry.row.totalMs / entry.row.count;
      apiDurations.push(...entry.durations);
    }

    return {
      startedAt: this.startedAt,
      endedAt,
      durationMs,
      samples,
      longTasks,
      blockedMs,
      longestBlockMs,
      scripts: [...scripts.values()].sort((a, b) => b.totalMs - a.totalMs).slice(0, 20),
      scriptTotalMs,
      api: [...api.values()]
        .map(entry => entry.row)
        .sort((a, b) => b.totalMs - a.totalMs)
        .slice(0, 20),
      apiDurations,
      zeroQueries: buildOpStats(queries, 'zeroQueryP95'),
      zeroQueryDurations: collectDurations(queries),
      zeroMutations: buildOpStats(mutations, 'zeroMutationP95'),
      zeroMutationDurations: collectDurations(mutations),
      connectionEvents,
      disconnects,
      hiddenDisconnects,
      processes: [...processes.values()]
        .map(toProcessStat)
        .sort((a, b) => b.avgCpuPercent - a.avgCpuPercent),
      processSampleCount,
      // Filled by the runner, which is what can read the store at close time.
      outstandingQueries: [],
      interactions,
      wasHidden: this.hidden,
    };
  }
}

interface OpAccumulator {
  name: string;
  count: number;
  errors: number;
  maxMs: number;
  durations: number[];
}

function accumulateOp(
  map: Map<string, OpAccumulator>,
  name: string,
  durationMs: number | null,
  error: boolean,
): void {
  let row = map.get(name);
  if (!row) {
    row = { name, count: 0, errors: 0, maxMs: 0, durations: [] };
    map.set(name, row);
  }
  if (error) row.errors += 1;
  if (durationMs !== null && Number.isFinite(durationMs)) {
    row.count += 1;
    row.durations.push(durationMs);
    if (durationMs > row.maxMs) row.maxMs = durationMs;
  }
}

function buildOpStats(
  map: Map<string, OpAccumulator>,
  key: 'zeroQueryP95' | 'zeroMutationP95',
): ZeroOpStat[] {
  return [...map.values()]
    .map(row => {
      const p95 = percentile(row.durations, 95) ?? 0;
      return {
        name: row.name,
        count: row.count,
        p50Ms: percentile(row.durations, 50) ?? 0,
        p95Ms: p95,
        maxMs: row.maxMs,
        errors: row.errors,
        verdict: row.errors > 0 ? 'bad' : verdictFor(key, row.durations.length ? p95 : null),
      } satisfies ZeroOpStat;
    })
    .sort((a, b) => b.p95Ms - a.p95Ms)
    .slice(0, 25);
}

function collectDurations(map: Map<string, OpAccumulator>): number[] {
  const out: number[] = [];
  for (const row of map.values()) out.push(...row.durations);
  return out;
}

interface ProcessAccumulator {
  pid: number;
  type: string;
  name: string;
  cpuTotal: number;
  cpuPeak: number;
  memTotal: number;
  wakeupPeak: number;
  samples: number;
}

function accumulateProcess(
  map: Map<number, ProcessAccumulator>,
  sample: ElectronProcessSample,
): void {
  let row = map.get(sample.pid);
  if (!row) {
    row = {
      pid: sample.pid,
      type: sample.type,
      name: sample.name,
      cpuTotal: 0,
      cpuPeak: 0,
      memTotal: 0,
      wakeupPeak: 0,
      samples: 0,
    };
    map.set(sample.pid, row);
  }
  row.cpuTotal += sample.cpuPercent;
  row.memTotal += sample.workingSetMb;
  row.samples += 1;
  if (sample.cpuPercent > row.cpuPeak) row.cpuPeak = sample.cpuPercent;
  if (sample.idleWakeupsPerSecond > row.wakeupPeak) row.wakeupPeak = sample.idleWakeupsPerSecond;
}

function toProcessStat(row: ProcessAccumulator): ProcessWindowStat {
  const divisor = row.samples || 1;
  return {
    pid: row.pid,
    type: row.type,
    name: row.name,
    avgCpuPercent: row.cpuTotal / divisor,
    peakCpuPercent: row.cpuPeak,
    avgWorkingSetMb: row.memTotal / divisor,
    peakIdleWakeupsPerSecond: row.wakeupPeak,
    samples: row.samples,
  };
}
