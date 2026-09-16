import type { MainThreadAttribution } from '../types';
import { summariseTrace } from '../attribution';

/**
 * Main-thread sampling profiler, via the JS Self-Profiling API.
 *
 * This is the only thing here that can answer "what is using the main thread".
 * Long Animation Frames names the callback that *entered* the script, which for
 * anything React renders is the scheduler callback — accurate, and useless. A
 * sampling profiler captures the whole stack many times a second, so the
 * component and the function inside it show up directly.
 *
 * Requires a `Document-Policy: js-profiling` response header on the document;
 * without it the constructor throws. A document may only profile its own
 * execution, so this exposes nothing cross-origin.
 */

/** The browser clamps below ~10ms anyway; asking for less only adds overhead. */
const SAMPLE_INTERVAL_MS = 10;
/** Headroom over the expected count, so a slow-sampling browser still fits. */
const BUFFER_HEADROOM = 1.5;
/** Refuse absurd allocations if a caller asks for a very long run. */
const MAX_BUFFER_SIZE = 60_000;

export interface ProfilerFrame {
  name: string;
  resourceId?: number;
  line?: number;
  column?: number;
}

export interface ProfilerStack {
  frameId: number;
  parentId?: number;
}

export interface ProfilerSample {
  timestamp: number;
  stackId?: number;
}

export interface ProfilerTrace {
  resources: string[];
  frames: ProfilerFrame[];
  stacks: ProfilerStack[];
  samples: ProfilerSample[];
}

interface ProfilerLike {
  readonly sampleInterval: number;
  readonly stopped: boolean;
  stop: () => Promise<ProfilerTrace>;
  /** The spec makes Profiler an EventTarget; guarded in case an engine differs. */
  addEventListener?: (type: string, listener: () => void) => void;
}

type ProfilerCtor = new (options: {
  sampleInterval: number;
  maxBufferSize: number;
}) => ProfilerLike;

export interface MainThreadSampler {
  stop: () => Promise<MainThreadAttribution>;
}

function unsupported(reason: string): MainThreadAttribution {
  return {
    supported: false,
    unsupportedReason: reason,
    sampleIntervalMs: 0,
    samples: 0,
    busySamples: 0,
    busyMs: 0,
    durationMs: 0,
    frames: [],
    components: [],
    hotPath: [],
    truncated: false,
  };
}

let cachedSupport: boolean | null = null;

/**
 * Whether a profiler can actually be constructed here.
 *
 * Deliberately not a `typeof window.Profiler` check: Chrome exposes the
 * constructor regardless, and only throws NotAllowedError on construction when
 * the document was served without the policy header. Verified in Chrome — the
 * cheap check reports support on a page where profiling is disabled, which
 * would promise the user function names and deliver none.
 *
 * The probe constructs the smallest possible profiler and stops it immediately;
 * the result is cached, since a document's policy cannot change after load.
 */
export function isSelfProfilingSupported(): boolean {
  if (cachedSupport !== null) return cachedSupport;

  const ctor = (globalThis as { Profiler?: ProfilerCtor }).Profiler;
  if (typeof ctor !== 'function') {
    cachedSupport = false;
    return false;
  }

  try {
    const probe = new ctor({ sampleInterval: 1000, maxBufferSize: 1 });
    void probe.stop().catch(() => undefined);
    cachedSupport = true;
  } catch {
    cachedSupport = false;
  }
  return cachedSupport;
}

/**
 * Starts sampling. Returns null when the API is unavailable, so the caller can
 * report *why* rather than silently producing a report with no attribution in
 * it — the absence of this data is itself worth telling the user about.
 */
export function startMainThreadSampler(expectedDurationMs: number): MainThreadSampler {
  const ctor = (globalThis as { Profiler?: ProfilerCtor }).Profiler;

  if (typeof ctor !== 'function') {
    const reason = window.isSecureContext
      ? 'This browser does not provide the JS self-profiler. Chrome or the desktop app can attribute main-thread time to real function names.'
      : 'Profiling needs a secure context (HTTPS), so main-thread attribution is unavailable here.';
    return { stop: () => Promise.resolve(unsupported(reason)) };
  }

  const maxBufferSize = Math.min(
    MAX_BUFFER_SIZE,
    Math.ceil((expectedDurationMs / SAMPLE_INTERVAL_MS) * BUFFER_HEADROOM),
  );

  let profiler: ProfilerLike;
  try {
    profiler = new ctor({ sampleInterval: SAMPLE_INTERVAL_MS, maxBufferSize });
  } catch {
    // Thrown when the document was served without `Document-Policy: js-profiling`.
    return {
      stop: () =>
        Promise.resolve(
          unsupported(
            'This page was served without the profiling policy header, so main-thread time cannot be attributed to function names.',
          ),
        ),
    };
  }

  const startedAt = performance.now();
  const active = profiler;
  let truncated = false;

  const read = async (): Promise<MainThreadAttribution> => {
    if (active.stopped) {
      return unsupported('The profiler stopped early, most likely because its buffer filled.');
    }
    try {
      const trace = await active.stop();
      const summary = summariseTrace(trace, active.sampleInterval, performance.now() - startedAt);
      return { ...summary, truncated };
    } catch (error) {
      return unsupported(
        error instanceof Error ? error.message : 'The profiler could not be read.',
      );
    }
  };

  // Memoised so stopping twice is safe. The caller stops this on its normal
  // path and again during cleanup, and a profiler left sampling because an
  // error skipped its stop would keep costing the user main-thread time long
  // after the run they asked for ended.
  let settled: Promise<MainThreadAttribution> | null = null;
  const finish = (): Promise<MainThreadAttribution> => {
    settled ??= read();
    return settled;
  };

  // A full buffer means the profiler stops collecting. Reading it here keeps
  // whatever was captured up to that point; without this the run would reach
  // its end, find a stopped profiler, and report no attribution at all — losing
  // every sample precisely on the longest runs, which are the ones someone
  // chose because the problem was hard to catch.
  try {
    active.addEventListener?.('samplebufferfull', () => {
      truncated = true;
      void finish();
    });
  } catch {
    // An engine without the event still works; it just cannot warn about
    // truncation, and the headroom above makes overflow unlikely anyway.
  }

  return { stop: finish };
}
