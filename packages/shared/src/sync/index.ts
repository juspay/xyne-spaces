/**
 * Public entry point for the shared-base sync engine client. The host app calls
 * `initSyncEngine` once with a transport adapted from its existing socket; everything
 * else (the hosted IVM, the `useCachedQuery` seam) is internal to this package.
 */
export { initSyncEngine, isSyncEngineReady } from './runtime.js';
export type { SyncTransport } from './syncClient.js';
export { configureObs, configureShadow } from './obs.js';
export { noopSyncStore } from './store.js';
export type { SyncStore, RowPut, RowKeyRef, WireRow, SeededRow } from './store.js';
export type { OptimisticOp } from './ivmHost.js';
