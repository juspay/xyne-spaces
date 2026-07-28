export type { StorageAdapter } from './storage.js';
export type { AuthAdapter, AuthContextValues } from './auth.js';
export type { TelemetryProvider } from './telemetry.js';
export {
  registerSyncStorage,
  getSyncStorage,
  type SyncKeyValueStorage,
} from './syncStorage.js';
