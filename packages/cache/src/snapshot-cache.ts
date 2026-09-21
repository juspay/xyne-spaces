import { attempt } from './attempt.js';
import { systemClock, type Clock } from './clock.js';
import type { CacheEvent, RefreshTrigger } from './events.js';
import { createScheduler } from './scheduler.js';
import { singleFlight } from './single-flight.js';
import { createSlot } from './slot.js';

/**
 * A keyed map that always holds the WHOLE set from its source.
 *
 * - `load` returns every entry; each successful load replaces the snapshot
 *   (never merges), so a row deleted at the source disappears here too.
 * - Loaded once by `init()` (throws, so boot fails loudly), then refreshed in
 *   the background every `refreshEveryMs`. Readers get a synchronous snapshot
 *   and never wait on the source.
 * - A failed refresh keeps the last-good snapshot and emits `refresh-failed`.
 * - No eviction: a miss means "not in the source", so evicting would lie.
 * - Invalidation is time-based plus local `refreshNow()`. Cross-process
 *   invalidation is the consumer's transport, if it ever needs one.
 */
export type SnapshotCacheOptions<K, V> = {
  /** Appears in every event and error message. */
  name: string;
  /** ALL entries. The result replaces the current snapshot. */
  load: () => Promise<Iterable<readonly [K, V]>>;
  refreshEveryMs: number;
  /** Defaults to the real clock. Inject a fake one in tests. */
  clock?: Clock;
  /** Defaults to a no-op. Wire your logger or metrics here. */
  onEvent?: (event: CacheEvent) => void;
};

export type SnapshotCache<K, V> = {
  /** First load and timer start. Idempotent; a failed init can be retried. */
  init(): Promise<void>;
  /** Synchronous. Throws if `init()` has not completed. */
  get(key: K): V | undefined;
  /** Synchronous. Throws if `init()` has not completed. */
  snapshot(): ReadonlyMap<K, V>;
  /** Reload now. Joins an in-flight load. Resolves `true` on success, never throws. */
  refreshNow(): Promise<boolean>;
  /** Stops the timer and drops the snapshot. `init()` may be called again. */
  stop(): void;
};

export function createSnapshotCache<K, V>(options: SnapshotCacheOptions<K, V>): SnapshotCache<K, V> {
  const { name, load, refreshEveryMs } = options;
  const clock = options.clock ?? systemClock;
  const emit = options.onEvent ?? (() => {});
  const slot = createSlot<ReadonlyMap<K, V>>();

  const loadAndSwap = async (): Promise<number> => {
    const next = new Map(await load());
    slot.swap(next);
    return next.size;
  };

  const refresh = singleFlight(async (trigger: RefreshTrigger) => {
    const outcome = await attempt(clock, loadAndSwap);
    const event: CacheEvent = outcome.ok
      ? { type: 'refresh', name, size: outcome.value, durationMs: outcome.durationMs, trigger }
      : { type: 'refresh-failed', name, error: outcome.error, durationMs: outcome.durationMs, trigger };
    emit(event);
    return outcome;
  });

  const scheduler = createScheduler({
    everyMs: refreshEveryMs,
    clock,
    run: () => void refresh('interval'),
  });

  let initPromise: Promise<void> | null = null;
  const init = (): Promise<void> => {
    initPromise ??= refresh('init').then((outcome) => {
      if (outcome.ok) {
        scheduler.start();
        return;
      }
      initPromise = null;
      throw outcome.error;
    });
    return initPromise;
  };

  const current = (): ReadonlyMap<K, V> => {
    const value = slot.current();
    if (value === undefined) {
      throw new Error(`[@xyne/cache] "${name}" not initialised: call init() first`);
    }
    return value;
  };

  return {
    init,
    get: (key) => current().get(key),
    snapshot: current,
    refreshNow: () => refresh('manual').then((outcome) => outcome.ok),
    stop: () => {
      scheduler.stop();
      slot.clear();
      initPromise = null;
      emit({ type: 'stop', name });
    },
  };
}
