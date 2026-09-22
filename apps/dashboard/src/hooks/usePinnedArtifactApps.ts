import { useSyncExternalStore } from 'react';

/**
 * Artifact apps the user has pinned to the sidebar rail.
 *
 * Mirrors `useToolbarItems`: a module-level listener set plus a cached snapshot,
 * so every hook instance shares one store and `useSyncExternalStore` gets a
 * stable reference until localStorage actually changes. Without the cache,
 * getSnapshot would return a fresh array each call and loop forever.
 *
 * Local-only by design for now — pinning is a per-device preference, so there is
 * nothing to sync server-side yet.
 */

export const PINNED_ARTIFACT_APPS_KEY = 'xyne:pinned-artifact-apps';

/** Cap the rail so a pinning spree cannot push the nav off-screen. */
export const MAX_PINNED_ARTIFACT_APPS = 8;

export interface PinnedArtifactApp {
  id: string;
  title: string;
  /** Snapshot of the app's icon at pin time, refreshed whenever this device
   *  changes it. A stale value on another device only means the old mark. */
  icon?: string | null;
}

const listeners = new Set<() => void>();

let cachedRaw: string | null = null;
let cachedList: PinnedArtifactApp[] = [];

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const getSnapshot = (): PinnedArtifactApp[] => {
  const raw = localStorage.getItem(PINNED_ARTIFACT_APPS_KEY);
  if (raw === cachedRaw) return cachedList;
  cachedRaw = raw;

  let next: PinnedArtifactApp[] = [];
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        next = parsed.filter(
          (a): a is PinnedArtifactApp =>
            !!a &&
            typeof a === 'object' &&
            typeof (a as PinnedArtifactApp).id === 'string' &&
            typeof (a as PinnedArtifactApp).title === 'string',
        );
      }
    } catch {
      next = [];
    }
  }

  cachedList = next.slice(0, MAX_PINNED_ARTIFACT_APPS);
  return cachedList;
};

/** SSR / no-storage fallback — never touches localStorage. */
const getServerSnapshot = (): PinnedArtifactApp[] => [];

const write = (apps: PinnedArtifactApp[]): void => {
  localStorage.setItem(PINNED_ARTIFACT_APPS_KEY, JSON.stringify(apps));
  listeners.forEach(l => l());
};

export const usePinnedArtifactApps = (): {
  pinnedApps: PinnedArtifactApp[];
  isPinned: (id: string) => boolean;
  pinApp: (app: PinnedArtifactApp) => void;
  unpinApp: (id: string) => void;
  togglePin: (app: PinnedArtifactApp) => void;
  /** Refresh a pinned app's snapshot (e.g. after its icon changes). No-op if not pinned. */
  updatePinnedApp: (id: string, patch: Partial<Omit<PinnedArtifactApp, 'id'>>) => void;
  isFull: boolean;
} => {
  const pinnedApps = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const isPinned = (id: string): boolean => pinnedApps.some(a => a.id === id);

  const pinApp = (app: PinnedArtifactApp): void => {
    const current = getSnapshot();
    if (current.some(a => a.id === app.id)) return;
    if (current.length >= MAX_PINNED_ARTIFACT_APPS) return;
    write([...current, { id: app.id, title: app.title, ...(app.icon ? { icon: app.icon } : {}) }]);
  };

  const updatePinnedApp = (id: string, patch: Partial<Omit<PinnedArtifactApp, 'id'>>): void => {
    const current = getSnapshot();
    if (!current.some(a => a.id === id)) return;
    write(current.map(a => (a.id === id ? { ...a, ...patch } : a)));
  };

  const unpinApp = (id: string): void => {
    const current = getSnapshot();
    if (!current.some(a => a.id === id)) return;
    write(current.filter(a => a.id !== id));
  };

  const togglePin = (app: PinnedArtifactApp): void => {
    if (getSnapshot().some(a => a.id === app.id)) unpinApp(app.id);
    else pinApp(app);
  };

  return {
    pinnedApps,
    isPinned,
    pinApp,
    unpinApp,
    togglePin,
    updatePinnedApp,
    isFull: pinnedApps.length >= MAX_PINNED_ARTIFACT_APPS,
  };
};
