import { useSyncExternalStore } from 'react';

/**
 * An ordered list of item ids persisted in localStorage — the model behind every
 * customizable bar (toolbar rail, Inbox menubar, channel tabs).
 *
 * Presence in the list is membership, index is render order. Ids are opaque to
 * the store: each bar decides what a built-in id means, and `app:<id>` entries
 * (see appItemId.ts) are artifact apps the user added.
 *
 * Same shape as the old useToolbarItems/usePinnedArtifactApps: a module-level
 * listener set and a cached parsed snapshot, so every hook instance shares one
 * store and `useSyncExternalStore` gets a stable reference until the raw
 * localStorage value actually changes. Without the cache, getSnapshot would
 * return a fresh array each call and loop forever.
 *
 * Local-only by design — matches the existing toolbar preference, which is a
 * per-device choice with nothing to sync server-side.
 */

export interface BarItemsStore {
  /** Ids that are always present and that `remove` refuses to drop. */
  locked: readonly string[];
  /** Subscribes the component; returns the ordered ids. */
  useItems: () => readonly string[];
  /** Non-reactive read for event handlers. */
  get: () => readonly string[];
  has: (id: string) => boolean;
  /** Appends, or inserts at `at` when given. No-op if already present. */
  add: (id: string, at?: number) => void;
  remove: (id: string) => void;
  /** Reorders by index; both must be in range or nothing happens. */
  move: (from: number, to: number) => void;
  set: (ids: readonly string[]) => void;
  /** Restores `defaults`. */
  reset: () => void;
}

interface CreateBarItemsStoreOptions {
  storageKey: string;
  defaults: readonly string[];
  /** Never removable. Re-inserted (at the front, in this order) if a stored list lacks them. */
  locked?: readonly string[];
  /**
   * Called once when `storageKey` is absent. Returning a list seeds the store
   * from older keys; returning null falls back to `defaults`. The migration
   * is responsible for clearing whatever it read.
   */
  migrate?: () => string[] | null;
}

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(v => typeof v === 'string');

const dedupe = (ids: readonly string[]): string[] => Array.from(new Set(ids));

// Locked ids stay in the list whatever localStorage says — a hand-edited or
// pre-lock value must not strip the one tab every channel opens on.
const withLocked = (ids: readonly string[], locked: readonly string[]): string[] => {
  const missing = locked.filter(id => !ids.includes(id));
  return missing.length === 0 ? dedupe(ids) : dedupe([...missing, ...ids]);
};

export const createBarItemsStore = ({
  storageKey,
  defaults,
  locked = [],
  migrate,
}: CreateBarItemsStoreOptions): BarItemsStore => {
  const listeners = new Set<() => void>();
  const normalizedDefaults = withLocked(defaults, locked);
  let cachedRaw: string | null | undefined;
  let cachedList: readonly string[] = normalizedDefaults;
  let migrated = false;

  const write = (ids: readonly string[]): void => {
    const next = withLocked(ids, locked);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // Storage full/unavailable — the in-memory snapshot below still updates
      // for this session, so the bar reflects the change until reload.
      cachedRaw = null;
      cachedList = next;
    }
    listeners.forEach(l => l());
  };

  const getSnapshot = (): readonly string[] => {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(storageKey);
    } catch {
      return cachedList;
    }

    if (raw === null && migrate && !migrated) {
      migrated = true;
      const seeded = migrate();
      if (seeded) {
        write(seeded);
        raw = JSON.stringify(dedupe(seeded));
      }
    }

    if (raw === cachedRaw) return cachedList;
    cachedRaw = raw;

    let ids: readonly string[] = normalizedDefaults;
    if (raw) {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (isStringArray(parsed)) ids = withLocked(parsed, locked);
      } catch {
        ids = normalizedDefaults;
      }
    }
    cachedList = ids;
    return cachedList;
  };

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  const getServerSnapshot = (): readonly string[] => normalizedDefaults;

  return {
    locked,
    useItems: (): readonly string[] =>
      useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot),
    get: getSnapshot,
    has: (id): boolean => getSnapshot().includes(id),
    add: (id, at): void => {
      const current = getSnapshot();
      if (current.includes(id)) return;
      const next = [...current];
      if (at === undefined || at < 0 || at > next.length) next.push(id);
      else next.splice(at, 0, id);
      write(next);
    },
    remove: (id): void => {
      if (locked.includes(id)) return;
      const current = getSnapshot();
      if (!current.includes(id)) return;
      write(current.filter(x => x !== id));
    },
    move: (from, to): void => {
      const current = getSnapshot();
      if (from === to) return;
      if (from < 0 || to < 0 || from >= current.length || to >= current.length) return;
      const next = [...current];
      const [moved] = next.splice(from, 1);
      if (moved === undefined) return;
      next.splice(to, 0, moved);
      write(next);
    },
    set: (ids): void => write(ids),
    reset: (): void => write(normalizedDefaults),
  };
};
