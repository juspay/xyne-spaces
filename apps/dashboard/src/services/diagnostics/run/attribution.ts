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
/**
 * Generous, because runs of framework frames are collapsed before this applies.
 * The first version capped at 12 and React's scheduler-to-reconciler chain is
 * itself twelve frames deep, so the path ended one step before the app code it
 * existed to find.
 */
const MAX_HOT_PATH = 40;

/**
 * Vite serves app sources from `/src/` and pre-bundles dependencies into
 * `.vite/deps/chunk-*.js`, which separates them cleanly in development. A
 * production bundle mixes both into one chunk, so the name list below carries
 * the classification there instead.
 */
const FRAMEWORK_RESOURCE =
  /node_modules|\.vite\/deps|\/chunk-[A-Za-z0-9_-]+\.js|react[-_]|scheduler/i;
const APP_RESOURCE = /\/src\//;

/**
 * React's own frames, by name. Needed because a minified production bundle
 * puts React and the app in the same file, leaving the resource URL useless.
 * Deliberately a list of exact internals rather than a loose pattern — a false
 * "framework" label hides real app code from the table that matters most.
 */
const FRAMEWORK_FRAMES = new Set([
  'performWorkUntilDeadline',
  'performWorkOnRootViaSchedulerTask',
  'performWorkOnRoot',
  'performSyncWorkOnRoot',
  'performUnitOfWork',
  'beginWork',
  'completeWork',
  'completeUnitOfWork',
  'commitRoot',
  'commitRootWhenReady',
  'commitRootImpl',
  'commitMutationEffects',
  'commitMutationEffectsOnFiber',
  'commitLayoutEffects',
  'commitPassiveMountEffects',
  'commitPassiveUnmountEffects',
  'commitDeletionEffectsOnFiber',
  'flushSpawnedWork',
  'flushSyncWorkAcrossRoots_impl',
  'flushPassiveEffects',
  'renderRootSync',
  'renderRootConcurrent',
  'workLoopSync',
  'workLoopConcurrent',
  'renderWithHooks',
  'runWithFiberInDEV',
  'updateFunctionComponent',
  'reconcileChildFibers',
  'reconcileChildren',
  'jsxDEV',
  'jsxWithValidation',
  'react_stack_bottom_frame',
]);

function classifyOrigin(name: string, resource: string): 'app' | 'framework' | 'unknown' {
  if (FRAMEWORK_FRAMES.has(name)) return 'framework';
  if (resource) {
    if (APP_RESOURCE.test(resource)) return 'app';
    if (FRAMEWORK_RESOURCE.test(resource)) return 'framework';
  }
  return 'unknown';
}

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
  /**
   * Time charged to the deepest app frame on each stack. The thread is almost
   * never inside app code at the instant it is sampled — it is inside React,
   * doing what the app asked — so self time alone can never say which component
   * is expensive. This rolls the framework's work up to whoever caused it.
   */
  const attributedSamples = new Float64Array(frameCount);
  // Generation marker: which sample last counted this frame, so a recursive
  // function is counted once per sample without allocating a Set each time.
  const seenInSample = new Int32Array(frameCount).fill(-1);

  // Origin per canonical frame, resolved once.
  const origins: ('app' | 'framework' | 'unknown')[] = Array.from(
    { length: frameCount },
    () => 'unknown' as const,
  );
  for (let i = 0; i < frameCount; i++) {
    const frame = trace.frames[i];
    if (!frame) continue;
    const resource =
      frame.resourceId === undefined ? '' : (trace.resources[frame.resourceId] ?? '');
    origins[i] = classifyOrigin(frame.name, resource);
  }

  const leafSamples = new Map<number, number>();
  let busySamples = 0;
  let frameworkOnlySamples = 0;

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
    let deepestApp = -1;
    while (cursor !== undefined && guard < 1024) {
      guard += 1;
      const stack: { frameId: number; parentId?: number } | undefined = trace.stacks[cursor];
      if (!stack) break;
      const id = canonical[stack.frameId];
      if (id !== undefined) {
        if (seenInSample[id] !== index) {
          seenInSample[id] = index;
          totalSamples[id] = (totalSamples[id] ?? 0) + 1;
        }
        // Leaf-to-root walk, so the first app frame seen is the deepest one.
        if (deepestApp === -1 && origins[id] === 'app') deepestApp = id;
      }
      cursor = stack.parentId;
    }

    if (deepestApp === -1) frameworkOnlySamples += 1;
    else attributedSamples[deepestApp] = (attributedSamples[deepestApp] ?? 0) + 1;
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
      origin: origins[i] ?? 'unknown',
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

  // Charged time replaces self time for the app view: a component whose own
  // code is trivial but whose render costs 300ms of reconciliation is the thing
  // worth reporting, and its self time would be nearly zero.
  const appFrames: HotFrame[] = [];
  for (let i = 0; i < frameCount; i++) {
    if (canonical[i] !== i || origins[i] !== 'app') continue;
    const charged = (attributedSamples[i] ?? 0) * interval;
    if (charged < MIN_REPORTED_MS) continue;
    const frame = frames.find(
      candidate =>
        candidate.name === (trace.frames[i]?.name || '(anonymous)') &&
        candidate.line === (trace.frames[i]?.line ?? null),
    );
    if (!frame) continue;
    appFrames.push({
      ...frame,
      selfMs: charged,
      selfSharePercent: busyMs > 0 ? (charged / busyMs) * 100 : 0,
    });
  }
  appFrames.sort((a, b) => b.selfMs - a.selfMs);
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
    appFrames: appFrames.slice(0, MAX_ROWS),
    frameworkOnlyMs: frameworkOnlySamples * interval,
    components,
    hotPath: buildHotPath(trace, leafSamples, interval, origins, canonical),
    // Both set by the caller, which knows the build mode and whether the
    // sample buffer filled.
    truncated: false,
    devBuild: false,
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
  origins: ('app' | 'framework' | 'unknown')[],
  canonical: Int32Array,
): { name: string; totalMs: number; collapsed?: number }[] {
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

  const path: { name: string; totalMs: number; collapsed?: number }[] = [];
  let cursor = heaviest(roots);
  let steps = 0;

  while (cursor !== undefined && steps < MAX_HOT_PATH) {
    steps += 1;
    const stack = trace.stacks[cursor];
    if (!stack) break;

    const canonicalId = canonical[stack.frameId];
    const origin = canonicalId === undefined ? 'unknown' : (origins[canonicalId] ?? 'unknown');
    const frame = trace.frames[stack.frameId];
    const totalMs = (subtree.get(cursor) ?? 0) * interval;

    // Consecutive framework frames become one entry. React's scheduler and
    // reconciler are a dozen frames on their own, and listing each pushes the
    // app's own code past any sane display limit.
    const previous = path[path.length - 1];
    if (origin === 'framework' && previous?.collapsed !== undefined) {
      previous.collapsed += 1;
      previous.totalMs = totalMs;
    } else if (origin === 'framework') {
      path.push({ name: frame?.name || '(anonymous)', totalMs, collapsed: 1 });
    } else {
      path.push({ name: frame?.name || '(anonymous)', totalMs });
    }

    cursor = heaviest(children.get(cursor) ?? []);
  }

  return path;
}
