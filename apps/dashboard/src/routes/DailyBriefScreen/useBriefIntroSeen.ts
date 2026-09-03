import { useCallback, useSyncExternalStore } from 'react';

const STORAGE_KEY = 'daily-brief-intro-seen';

const read = (): boolean => {
  try {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    // localStorage may be unavailable in private mode or with corrupted data
    return false;
  }
};

const write = (): void => {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, '1');
  } catch {
    // Ignore storage errors (private mode, quota exceeded, etc.)
  }
};

let seen = read();
const subscribers = new Set<() => void>();

const subscribe = (listener: () => void): (() => void) => {
  subscribers.add(listener);
  return () => {
    subscribers.delete(listener);
  };
};

const getSnapshot = (): boolean => seen;

export interface BriefIntroSeenResult {
  introSeen: boolean;
  markIntroSeen: () => void;
}

/**
 * Whether the Daily Brief intro banner has already been shown on this device.
 * Read through `useSyncExternalStore` so every mounted copy — the brief screen
 * and the panel webview — flips together the moment it is dismissed.
 */
export const useBriefIntroSeen = (): BriefIntroSeenResult => {
  const introSeen = useSyncExternalStore(subscribe, getSnapshot);

  const markIntroSeen = useCallback(() => {
    if (seen) return;
    seen = true;
    write();
    subscribers.forEach(listener => listener());
  }, []);

  return { introSeen, markIntroSeen };
};
