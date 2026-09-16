import type { ProfilerFrame, ProfilerTrace } from './probes/sampler';
import type { HotFrame, MainThreadAttribution } from './types';

/**
 * Turns a raw profiler trace into "where the main thread actually went".
 *
 * Two numbers per function, and the difference between them is the whole point:
 * *self* time is the thread sitting inside that function's own code, *total*
 * time is that plus everything it called. A component with large total and tiny
 * self is not slow — something beneath it is. Reporting only one of the two is
 * how a profiler gets read as blaming the wrong thing.
 */

/** Rows below this contribute nothing a reader can act on. */
const MIN_REPORTED_MS = 1;
const MAX_ROWS = 25;
const MAX_HOT_PATH = 12;

/**
 * React's own convention is the only signal available for telling a component
 * from an ordinary function: components are capitalised, hooks begin with
 * `use`. React's internals ship pre-minified, so the frames around a component
 * cannot corroborate it. Treated as a labelling hint, never as a fact the
 * verdict depends on.
 */
function classify(name: string): HotFrame['kind'] {
  if (!name) return 'anonymous';
  if (/^use[A-Z]/.test(name)) return 'hook';
  if (/^[A-Z]/.test(name)) return 'component';
  return 'function';
}

function shortenResource(url: string | undefined): string {
  if (!url) return '';
  try {
    const parsed = new URL(url, window.location.href);
    const file = parsed.pathname.split('/').filter(Boolean).pop();
    return file || parsed.hostname;
  } catch {
    return url.length > 60 ? `…${url.slice(-60)}` : url;
  }
}

/** Identity for merging: the same function can appear as several frame entries. */
function frameKey(frame: ProfilerFrame): string {
  return `${frame.name}@${frame.resourceId ?? -1}:${frame.line ?? 0}:${frame.column ?? 0}`;
}

export function summariseTrace(
  trace: ProfilerTrace,
  sampleIntervalMs: number,
  durationMs: number,
): MainThreadAttribution {
  const interval = sampleIntervalMs > 0 ? sampleIntervalMs : 10;

  // Everything below is indexed by frame number rather than keyed by string.
  // The walk to the root runs once per sample and a deep React stack is ~40
  // frames, so a three-minute run visits on the order of a million frames —
  // building a key string at each one made the analysis step itself a visible
  // freeze, which is not a thing a performance tool gets to do.
  const frameCount = trace.frames.length;
  const canonical = new Int32Array(frameCount);
  const canonicalByKey = new Map<string, number>();
  for (let i = 0; i < frameCount; i++) {
    const frame = trace.frames[i];
    if (!frame) {
      canonical[i] = i;
      continue;
    }
    const key = frameKey(frame);
    const existing = canonicalByKey.get(key);
    if (existing === undefined) {
      canonicalByKey.set(key, i);
      canonical[i] = i;
    } else {
      canonical[i] = existing;
    }
  }

  const selfSamples = new Float64Array(frameCount);
  const totalSamples = new Float64Array(frameCount);
  // Generation marker: which sample last counted this frame, so a recursive
  // function is counted once per sample without allocating a Set each time.
  const seenInSample = new Int32Array(frameCount).fill(-1);

  const leafSamples = new Map<number, number>();
  let busySamples = 0;

  for (let index = 0; index < trace.samples.length; index++) {
    const sample = trace.samples[index];
    if (!sample || sample.stackId === undefined) continue;
    busySamples += 1;
    leafSamples.set(sample.stackId, (leafSamples.get(sample.stackId) ?? 0) + 1);

    const leafStack = trace.stacks[sample.stackId];
    if (!leafStack) continue;
    const leafCanonical = canonical[leafStack.frameId];
    if (leafCanonical !== undefined) {
      selfSamples[leafCanonical] = (selfSamples[leafCanonical] ?? 0) + 1;
    }

    let cursor: number | undefined = sample.stackId;
    let guard = 0;
    while (cursor !== undefined && guard < 1024) {
      guard += 1;
      const stack: { frameId: number; parentId?: number } | undefined = trace.stacks[cursor];
      if (!stack) break;
      const id = canonical[stack.frameId];
      if (id !== undefined && seenInSample[id] !== index) {
        seenInSample[id] = index;
        totalSamples[id] = (totalSamples[id] ?? 0) + 1;
      }
      cursor = stack.parentId;
    }
  }

  const busyMs = busySamples * interval;

  const frames: HotFrame[] = [];
  for (let i = 0; i < frameCount; i++) {
    if (canonical[i] !== i) continue;
    const self = (selfSamples[i] ?? 0) * interval;
    const total = (totalSamples[i] ?? 0) * interval;
    if (self < MIN_REPORTED_MS && total < MIN_REPORTED_MS) continue;

    const frame = trace.frames[i];
    if (!frame) continue;
    frames.push({
      name: frame.name || '(anonymous)',
      kind: classify(frame.name),
      resource: shortenResource(
        frame.resourceId === undefined ? undefined : trace.resources[frame.resourceId],
      ),
      line: frame.line ?? null,
      column: frame.column ?? null,
      selfMs: self,
      totalMs: total,
      selfSharePercent: busyMs > 0 ? (self / busyMs) * 100 : 0,
      totalSharePercent: busyMs > 0 ? (total / busyMs) * 100 : 0,
    });
  }

  const bySelf = [...frames].sort((a, b) => b.selfMs - a.selfMs).slice(0, MAX_ROWS);
  const components = frames
    .filter(frame => frame.kind === 'component')
    .sort((a, b) => b.totalMs - a.totalMs)
    .slice(0, MAX_ROWS);

  return {
    supported: true,
    unsupportedReason: '',
    sampleIntervalMs: interval,
    samples: trace.samples.length,
    busySamples,
    busyMs,
    durationMs,
    frames: bySelf,
    components,
    hotPath: buildHotPath(trace, leafSamples, interval),
    // Set by the caller, which is what knows whether the buffer filled.
    truncated: false,
  };
}

/**
 * The heaviest root-to-leaf path through the call tree — the single chain the
 * thread spent most of its time inside. A ranked list says which functions are
 * expensive; this says how the app got to them, which is usually the part that
 * tells you what to change.
 */
function buildHotPath(
  trace: ProfilerTrace,
  leafSamples: Map<number, number>,
  interval: number,
): { name: string; totalMs: number }[] {
  if (leafSamples.size === 0) return [];

  // Samples anywhere beneath each stack node, by propagating leaf counts up.
  const subtree = new Map<number, number>();
  for (const [stackId, count] of leafSamples) {
    let cursor: number | undefined = stackId;
    let guard = 0;
    while (cursor !== undefined && guard < 1024) {
      guard += 1;
      subtree.set(cursor, (subtree.get(cursor) ?? 0) + count);
      cursor = trace.stacks[cursor]?.parentId;
    }
  }

  const children = new Map<number, number[]>();
  const roots: number[] = [];
  trace.stacks.forEach((stack, index) => {
    if (stack.parentId === undefined) {
      roots.push(index);
      return;
    }
    const siblings = children.get(stack.parentId) ?? [];
    siblings.push(index);
    children.set(stack.parentId, siblings);
  });

  const heaviest = (candidates: number[]): number | undefined =>
    candidates.reduce<number | undefined>((best, candidate) => {
      if (best === undefined) return candidate;
      return (subtree.get(candidate) ?? 0) > (subtree.get(best) ?? 0) ? candidate : best;
    }, undefined);

  const path: { name: string; totalMs: number }[] = [];
  let cursor = heaviest(roots);
  while (cursor !== undefined && path.length < MAX_HOT_PATH) {
    const stack = trace.stacks[cursor];
    if (!stack) break;
    const frame = trace.frames[stack.frameId];
    path.push({
      name: frame?.name || '(anonymous)',
      totalMs: (subtree.get(cursor) ?? 0) * interval,
    });
    cursor = heaviest(children.get(cursor) ?? []);
  }

  return path;
}
