/**
 * Synchronous key-value storage abstraction.
 *
 * Used by state that must be readable synchronously at module init
 * (e.g. XState machine initial context). The async {@link StorageAdapter}
 * cannot serve those reads without a hydration round-trip.
 *
 * Dashboard: falls back to `localStorage` automatically.
 * Lotus: registers an MMKV-backed impl at app boot before `stateMachine`
 *        is first imported.
 */
export interface SyncKeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

let registered: SyncKeyValueStorage | null = null;

export function registerSyncStorage(impl: SyncKeyValueStorage): void {
  registered = impl;
}

const localStorageFallback: SyncKeyValueStorage = {
  getItem: key => {
    try {
      if (typeof localStorage !== 'undefined') return localStorage.getItem(key);
    } catch {
      /* storage unavailable */
    }
    return null;
  },
  setItem: (key, value) => {
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
    } catch {
      /* storage unavailable */
    }
  },
  removeItem: key => {
    try {
      if (typeof localStorage !== 'undefined') localStorage.removeItem(key);
    } catch {
      /* storage unavailable */
    }
  },
};

export function getSyncStorage(): SyncKeyValueStorage {
  return registered ?? localStorageFallback;
}
