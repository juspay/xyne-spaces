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

let host: IvmHost | null = null;
let client: SyncClient | null = null;
let ready = false;
const readyListeners = new Set<() => void>();
const servingListeners = new Set<() => void>();

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
  const h = host;
  host.startReconcileSweep();
  // Route Zero's authoritative per-mutation server result into the host (drives overlay retirement).
  // LAZY dynamic import: the `#zero-client/*` deep-import target is a node_modules file path that raw
  // Node/tsx rejects (ERR_INVALID_PACKAGE_TARGET; only the app bundler resolves it). Only the dashboard
  // calls initSyncEngine, so keeping this OUT of the module's top-level imports means the backend —
  // which pulls this file transitively via @xyne/shared/zero → mutators → mutatorSync → runtime — never
  // RESOLVES the specifier. Fire-and-forget (the hook is a passive observer; nothing awaits it); a
  // resolution/shape failure degrades to fan-out-echo-only retirement, never breaks boot or a mutation.
  void import('#zero-client/client/mutation-tracker.js')
    .then((mod) => hookMutationTrackerPrototype((mod as { MutationTracker?: { prototype?: unknown } }).MutationTracker?.prototype, h))
    .catch(() => {
      /* internal moved / unresolved outside a bundler — echo path still retires overlays */
    });
  client = new SyncClient(host, transport, store);
  // Fan the client's connection-level serving flag (`sync:unavailable` ↔ `sync:ready`) out to the
  // module-level subscribers, so a component that subscribed BEFORE init is still notified when the
  // server later refuses this principal (guest) — mirroring how readiness is made reactive above.
  client.onServingChange(() => {
    for (const listener of servingListeners) listener();
  });
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

/**
 * Whether the server has refused to serve this principal via the shared engine (`sync:unavailable`
 * — a guest/unknown role). When true, `useQuery` routes shared queries to native Zero and never
 * engages the engine. Defaults to `false` before init / before the server has spoken.
 */
export function isSyncUnavailable(): boolean {
  return client?.isUnavailable() ?? false;
}

/** Subscribe to serving-availability changes (for `useSyncExternalStore`). */
export function subscribeSyncServing(onChange: () => void): () => void {
  servingListeners.add(onChange);
  return () => {
    servingListeners.delete(onChange);
  };
}
