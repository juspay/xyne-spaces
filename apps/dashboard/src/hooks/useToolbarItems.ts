import { useSyncExternalStore } from 'react';
import {
  DEFAULT_TOOLBAR_PATHS,
  REQUIRED_TOOLBAR_PATHS,
  isRequiredToolbarPath,
} from '../components/AppSidebar/navigationConfig';

export const TOOLBAR_ITEMS_KEY = 'xyne:toolbar-items';

// Module-level subscriber set — all hook instances share this store
const listeners = new Set<() => void>();

// Cache the parsed snapshot so useSyncExternalStore gets a stable reference
// until the underlying localStorage value actually changes.
let cachedRaw: string | null = null;
let cachedSet = new Set(DEFAULT_TOOLBAR_PATHS);

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const getSnapshot = (): Set<string> => {
  const raw = localStorage.getItem(TOOLBAR_ITEMS_KEY);
  if (raw === cachedRaw) return cachedSet;
  cachedRaw = raw;

  let paths: string[] = DEFAULT_TOOLBAR_PATHS;
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        paths = parsed.filter((p): p is string => typeof p === 'string');
      }
    } catch {
      paths = DEFAULT_TOOLBAR_PATHS;
    }
  }

  // Required items are always present, regardless of stored state.
  cachedSet = new Set([...paths, ...REQUIRED_TOOLBAR_PATHS]);
  return cachedSet;
};

export const useToolbarItems = (): {
  toolbarPaths: Set<string>;
  setInToolbar: (path: string, inToolbar: boolean) => void;
} => {
  const toolbarPaths = useSyncExternalStore(subscribe, getSnapshot);

  const setInToolbar = (path: string, inToolbar: boolean): void => {
    // Required items cannot be removed from the toolbar.
    if (!inToolbar && isRequiredToolbarPath(path)) return;
    const next = new Set(getSnapshot());
    if (inToolbar) next.add(path);
    else next.delete(path);
    localStorage.setItem(TOOLBAR_ITEMS_KEY, JSON.stringify([...next]));
    listeners.forEach(l => l());
  };

  return { toolbarPaths, setInToolbar };
};
