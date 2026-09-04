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

let host: IvmHost | null = null;
let client: SyncClient | null = null;
let ready = false;
const readyListeners = new Set<() => void>();

/** Initialize the client sync engine with the app's socket transport. Idempotent. */
export function initSyncEngine(transport: SyncTransport): void {
  if (client) return;
  host = new IvmHost();
  client = new SyncClient(host, transport);
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
