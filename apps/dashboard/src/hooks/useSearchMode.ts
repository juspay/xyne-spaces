import { useSyncExternalStore } from 'react';

export type SearchMode = 'popup' | 'screen';

export const SEARCH_MODE_KEY = 'xyne:search-mode';

const listeners = new Set<() => void>();

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

// The quick-search popup is the only supported mode. Read nothing from storage: a
// `screen` value written by an older build (the setting used to be user-facing) would
// otherwise keep routing people to the full-screen palette forever, with no UI left to
// turn it back off. Forcing it here rather than at each call site means every
// `searchMode === 'screen'` branch in the tree evaluates false from one place.
const getSnapshot = (): SearchMode => 'popup';

export const useSearchMode = (): { searchMode: SearchMode } => {
  const searchMode = useSyncExternalStore(subscribe, getSnapshot);
  return { searchMode };
};
