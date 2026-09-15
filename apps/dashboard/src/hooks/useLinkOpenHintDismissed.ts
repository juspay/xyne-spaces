import { useSyncExternalStore } from 'react';

export const LINK_OPEN_HINT_DISMISSED_KEY = 'xyne:link-open-hint-dismissed';

const listeners = new Set<() => void>();

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const getSnapshot = (): string => localStorage.getItem(LINK_OPEN_HINT_DISMISSED_KEY) ?? '';
const getServerSnapshot = (): string => '';

export const useLinkOpenHintDismissed = (): {
  hintDismissed: boolean;
  dismissHint: () => void;
} => {
  const raw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  return {
    hintDismissed: raw === 'true',
    dismissHint: (): void => {
      localStorage.setItem(LINK_OPEN_HINT_DISMISSED_KEY, 'true');
      listeners.forEach(l => l());
    },
  };
};
