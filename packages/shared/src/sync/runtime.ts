/**
 * Process-wide sync-engine singletons. The host app initializes them once with its
 * socket transport (dashboard: socket.io via websocketService; mobile: its own socket);
 * before that the shared queries fall back to Zero. See `initSyncEngine`.
 *
 * Readiness is reactive: `initSyncEngine` may run *after* the first render (it's called
 * from a provider effect), so components subscribe to `subscribeSyncEngineReady` to
 * re-evaluate once the engine comes up — otherwise a query mounted on reload would
 * memoize "not shared" and never route through the engine.
 */
import { IvmHost } from './ivmHost.js';
import { SyncClient, type SyncTransport } from './syncClient.js';
import { noopSyncStore, type SyncStore } from './store.js';
import { hookMutationTrackerPrototype } from './confirmedMutations.js';
// Deep-import Zero's compiled internal (same mechanism as ivmHost's `#zql/*`, resolved by the app
// bundler): the MutationTracker is the only place that correlates a mutation's server result to its id.
import { MutationTracker } from '#zero-client/client/mutation-tracker.js';

let host: IvmHost | null = null;
let client: SyncClient | null = null;
let ready = false;
const readyListeners = new Set<() => void>();

/**
 * Initialize the client sync engine with the app's socket transport. Idempotent. Optimistic-overlay
 * retirement is driven by SERVER confirmation, not Zero's optimistic `lastMutationID()`: we hook Zero's
 * MutationTracker (installConfirmedMutationHook) to feed each mutation's server result into the host,
 * and a periodic sweep (started here) is the fallback for effects that never echo through a subscribed
 * instance.
 */
export function initSyncEngine(
  transport: SyncTransport,
  store: SyncStore = noopSyncStore,
): void {
  if (client) return;
  host = new IvmHost();
  host.startReconcileSweep();
  // Route Zero's authoritative per-mutation server result into the host (drives overlay retirement).
  try {
    hookMutationTrackerPrototype((MutationTracker as unknown as { prototype: unknown }).prototype, host);
  } catch {
    /* internal shape changed — overlays still retire via the fan-out echo path */
  }
  client = new SyncClient(host, transport, store);
  // NOTE: don't call client.start() here — this runs from a mount effect that can fire
  // before the socket exists, and the dashboard transport's `on` no-ops on a null socket.
  // start() is called lazily on the first subscribe (socket present by then); its
  // listeners then persist across socket.io auto-reconnects.
  ready = true;
  for (const listener of readyListeners) listener();
}

export function getSyncHost(): IvmHost | null {
  return host;
}

export function getSyncClient(): SyncClient | null {
  return client;
}

export function isSyncEngineReady(): boolean {
  return ready;
}

/** Subscribe to the engine becoming ready (for `useSyncExternalStore`). */
export function subscribeSyncEngineReady(onChange: () => void): () => void {
  readyListeners.add(onChange);
  return () => {
    readyListeners.delete(onChange);
  };
}
