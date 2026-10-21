import { useSyncExternalStore } from 'react';

/**
 * What a bar needs to draw an artifact app without a network round trip: its
 * title and icon, captured when the app is added to any bar and refreshed
 * whenever this device changes the icon. One map shared by every bar, so an
 * app shown in both the rail and a channel tab is stored once.
 *
 * A stale value on another device only means the old mark — the app itself is
 * always fetched fresh by ArtifactAppHost when opened.
 *
 * Held as a `Map`, not a plain object, because the keys come from parsed
 * localStorage and are therefore untrusted input. `JSON.parse` makes
 * `__proto__` an OWN property, so populating an object with `map[id] = value`
 * routes that entry to `Object.prototype`'s setter: the map's prototype is
 * replaced and every `snapshots[unknownId]` lookup then inherits a truthy
 * snapshot — a phantom app row in every bar. A Map has no prototype chain to
 * poison and no dynamic property write, so the whole class of bug is gone by
 * construction rather than by a guard someone has to remember.
 */

export const APP_SNAPSHOTS_KEY = 'xyne:bar-app-snapshots';

export interface AppSnapshot {
  title: string;
  /** Xyne icon id, or null for the fallback mark. */
  icon: string | null;
}

export type AppSnapshots = ReadonlyMap<string, AppSnapshot>;

const EMPTY: AppSnapshots = new Map();

const listeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cachedMap: AppSnapshots = EMPTY;

const isSnapshot = (value: unknown): value is AppSnapshot =>
  !!value &&
  typeof value === 'object' &&
  typeof (value as AppSnapshot).title === 'string' &&
  ((value as AppSnapshot).icon === null || typeof (value as AppSnapshot).icon === 'string');

const getSnapshot = (): AppSnapshots => {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(APP_SNAPSHOTS_KEY);
  } catch {
    return cachedMap;
  }
  if (raw === cachedRaw) return cachedMap;
  cachedRaw = raw;

  const next = new Map<string, AppSnapshot>();
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
          if (isSnapshot(value)) next.set(id, { title: value.title, icon: value.icon });
        }
      }
    } catch {
      next.clear();
    }
  }
  cachedMap = next;
  return cachedMap;
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const getServerSnapshot = (): AppSnapshots => EMPTY;

const write = (map: AppSnapshots): void => {
  try {
    localStorage.setItem(APP_SNAPSHOTS_KEY, JSON.stringify(Object.fromEntries(map)));
  } catch {
    cachedRaw = null;
    cachedMap = map;
  }
  listeners.forEach(l => l());
};

export const useAppSnapshots = (): AppSnapshots =>
  useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

export const getAppSnapshots = getSnapshot;

/** Records (or replaces) an app's snapshot. */
export const setAppSnapshot = (appId: string, snapshot: AppSnapshot): void => {
  const next = new Map(getSnapshot());
  next.set(appId, { title: snapshot.title, icon: snapshot.icon });
  write(next);
};

/** Patches an existing snapshot; no-op when the app was never recorded. */
export const updateAppSnapshot = (appId: string, patch: Partial<AppSnapshot>): void => {
  const current = getSnapshot();
  const existing = current.get(appId);
  if (!existing) return;
  const next = new Map(current);
  next.set(appId, { ...existing, ...patch });
  write(next);
};
