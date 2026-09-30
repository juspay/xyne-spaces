import { useCallback, useSyncExternalStore } from 'react';

const STORAGE_KEY = 'xyne-ask-ai-auto';

const readStored = (): boolean => {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
};

let current = readStored();
const listeners = new Set<() => void>();

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const setAuto = (next: boolean): void => {
  if (next === current) return;
  current = next;
  try {
    if (next) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, 'off');
  } catch {
    // Storage unavailable: the choice holds for this session only.
  }
  for (const listener of listeners) listener();
};

export const useAskAIAuto = (): { isAuto: boolean; setAuto: (next: boolean) => void } => {
  const isAuto = useSyncExternalStore(
    subscribe,
    () => current,
    () => true,
  );
  return { isAuto, setAuto: useCallback(setAuto, []) };
};
