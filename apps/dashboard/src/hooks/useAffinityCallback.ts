import { useSyncExternalStore } from 'react';
import { affinityService } from '../services/affinityService';

/**
 * Shared "affinity weights have loaded" signal.
 *
 * `affinityService` is the real singleton (weights + fetch + inflight/TTL dedup). Affinity-ranked
 * memos read weights imperatively via `getChannelWeight`/`getUserWeight`, so a fetch that resolves
 * after mount is invisible until something re-renders. This module is a single, app-wide store that
 * fires the initial `prefetch()` once and bumps a shared version when the weights land — every
 * subscriber (GlobalCommandMenu, ChannelCommandMenu, …) re-renders together, driven by one source
 * of truth rather than one `useEffect`/`useState` per component.
 *
 * One-shot by design: it signals the initial load, not every hourly TTL refetch. To also react to
 * refetches, `affinityService.fetch()` would need to call back into `notify()` (a shared-package
 * change); that isn't needed for the load-once case.
 */
let version = 0;
let started = false;
const listeners = new Set<() => void>();

function notify(): void {
  version += 1;
  listeners.forEach(listener => listener());
}

function ensureLoaded(): void {
  if (started) return;
  started = true;
  // `fetch()` swallows its own errors and resolves, so this fires on success and failure alike
  // (failure just leaves weights empty → graceful recency fallback); no unhandled rejection.
  void affinityService.prefetch().then(notify);
}

function subscribe(listener: () => void): () => void {
  ensureLoaded();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): number {
  return version;
}

/**
 * Re-renders the caller once when the shared affinity weights finish loading. Add the returned value
 * to an affinity-ranked memo's dependency array so it recomputes with the loaded weights.
 */
export function useAffinityCallback(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
