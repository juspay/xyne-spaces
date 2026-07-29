import { useSyncExternalStore } from 'react';

export type SearchMode = 'popup' | 'screen';

export const SEARCH_MODE_KEY = 'xyne:search-mode';

const listeners = new Set<() => void>();

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const getSnapshot = (): SearchMode =>
  (localStorage.getItem(SEARCH_MODE_KEY) as SearchMode | null) ?? 'popup';

export const useSearchMode = (): {
  searchMode: SearchMode;
  setSearchMode: (mode: SearchMode) => void;
} => {
  const searchMode = useSyncExternalStore(subscribe, getSnapshot);

  const setSearchMode = (mode: SearchMode): void => {
    localStorage.setItem(SEARCH_MODE_KEY, mode);
    listeners.forEach(l => l());
  };

  return { searchMode, setSearchMode };
};
