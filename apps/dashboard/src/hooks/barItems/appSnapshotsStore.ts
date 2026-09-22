import { useSyncExternalStore } from 'react';

/**
 * What a bar needs to draw an artifact app without a network round trip: its
 * title and icon, captured when the app is added to any bar and refreshed
 * whenever this device changes the icon. One map shared by every bar, so an
 * app shown in both the rail and a channel tab is stored once.
 *
 * A stale value on another device only means the old mark — the app itself is
 * always fetched fresh by ArtifactAppHost when opened.
 */

export const APP_SNAPSHOTS_KEY = 'xyne:bar-app-snapshots';

export interface AppSnapshot {
  title: string;
  /** Xyne icon id, or null for the fallback mark. */
  icon: string | null;
}

export type AppSnapshots = Readonly<Record<string, AppSnapshot>>;

const listeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cachedMap: AppSnapshots = {};

/** Keys that would reach `Object.prototype` rather than the map itself. */
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

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

  let next: Record<string, AppSnapshot> = Object.create(null) as Record<string, AppSnapshot>;
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
          if (UNSAFE_KEYS.has(id)) continue;
          if (isSnapshot(value)) next[id] = { title: value.title, icon: value.icon };
        }
      }
    } catch {
      next = Object.create(null) as Record<string, AppSnapshot>;
    }
  }
  cachedMap = next;
  return cachedMap;
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const getServerSnapshot = (): AppSnapshots => ({});

const write = (map: AppSnapshots): void => {
  try {
    localStorage.setItem(APP_SNAPSHOTS_KEY, JSON.stringify(map));
  } catch {
    cachedRaw = null;
    cachedMap = map;
  }
  listeners.forEach(l => l());
};

export const useAppSnapshots = (): AppSnapshots =>
  useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

export const getAppSnapshots = getSnapshot;

const withEntry = (base: AppSnapshots, appId: string, snapshot: AppSnapshot): AppSnapshots => {
  const next = Object.create(null) as Record<string, AppSnapshot>;
  for (const [id, value] of Object.entries(base)) next[id] = value;
  if (!UNSAFE_KEYS.has(appId)) next[appId] = snapshot;
  return next;
};

/** Records (or replaces) an app's snapshot. */
export const setAppSnapshot = (appId: string, snapshot: AppSnapshot): void => {
  write(withEntry(getSnapshot(), appId, { title: snapshot.title, icon: snapshot.icon }));
};

/** Patches an existing snapshot; no-op when the app was never recorded. */
export const updateAppSnapshot = (appId: string, patch: Partial<AppSnapshot>): void => {
  const current = getSnapshot();
  const existing = current[appId];
  if (!existing) return;
  write(withEntry(current, appId, { ...existing, ...patch }));
};
