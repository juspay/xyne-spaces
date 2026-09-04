/**
 * Public entry point for the shared-base sync engine client. The host app calls
 * `initSyncEngine` once with a transport adapted from its existing socket; everything
 * else (the hosted IVM, the `useCachedQuery` seam) is internal to this package.
 */
export { initSyncEngine, isSyncEngineReady } from './runtime.js';
export type { SyncTransport } from './syncClient.js';
export { configureObs } from './obs.js';
