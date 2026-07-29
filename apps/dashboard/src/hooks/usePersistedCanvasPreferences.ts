import { useSyncExternalStore, useCallback } from 'react';

export type FilterTab = 'all' | 'created_by_me';
export type ViewMode = 'grouped' | 'list';

const STORAGE_KEY = 'canvas-preferences';

interface CanvasPreferences {
  filter: FilterTab;
  viewMode: ViewMode;
  lastCanvasId: string | null;
}

const DEFAULT: CanvasPreferences = {
  filter: 'all',
  viewMode: 'grouped',
  lastCanvasId: null,
};

const isValidFilter = (value: unknown): value is FilterTab =>
  value === 'all' || value === 'created_by_me';

const isValidViewMode = (value: unknown): value is ViewMode =>
  value === 'grouped' || value === 'list';

const isValidLastCanvasId = (value: unknown): value is string | null =>
  value === null || typeof value === 'string';

const readPreferences = (): CanvasPreferences => {
  try {
    if (typeof localStorage === 'undefined') return DEFAULT;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (
        isValidFilter(parsed['filter']) &&
        isValidViewMode(parsed['viewMode']) &&
        isValidLastCanvasId(parsed['lastCanvasId'])
      ) {
        return {
          filter: parsed['filter'],
          viewMode: parsed['viewMode'],
          lastCanvasId: parsed['lastCanvasId'],
        };
      }
    }
  } catch {
    // localStorage may be unavailable in private mode or with corrupted data
  }
  return DEFAULT;
};

const writePreferences = (prefs: CanvasPreferences): void => {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore storage errors (private mode, quota exceeded, etc.)
  }
};

let preferences = readPreferences();
const subscribers = new Set<() => void>();

const subscribe = (listener: () => void): (() => void) => {
  subscribers.add(listener);

  return () => {
    subscribers.delete(listener);
  };
};

const getSnapshot = (): CanvasPreferences => preferences;

const updatePreferences = (updater: (prefs: CanvasPreferences) => CanvasPreferences): void => {
  preferences = updater(preferences);
  writePreferences(preferences);
  subscribers.forEach(listener => listener());
};

export interface CanvasPreferencesResult {
  filter: FilterTab;
  setFilter: (filter: FilterTab) => void;
  viewMode: ViewMode;
  setViewMode: (viewMode: ViewMode) => void;
  lastCanvasId: string | null;
  setLastCanvasId: (id: string | null) => void;
}

export const usePersistedCanvasPreferences = (): CanvasPreferencesResult => {
  const prefs = useSyncExternalStore(subscribe, getSnapshot);

  const setFilter = useCallback((filter: FilterTab) => {
    updatePreferences(prev => ({ ...prev, filter }));
  }, []);

  const setViewMode = useCallback((viewMode: ViewMode) => {
    updatePreferences(prev => ({ ...prev, viewMode }));
  }, []);

  const setLastCanvasId = useCallback((lastCanvasId: string | null) => {
    updatePreferences(prev => ({ ...prev, lastCanvasId }));
  }, []);

  return {
    filter: prefs.filter,
    setFilter,
    viewMode: prefs.viewMode,
    setViewMode,
    lastCanvasId: prefs.lastCanvasId,
    setLastCanvasId,
  };
};
