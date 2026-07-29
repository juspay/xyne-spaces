import { useSyncExternalStore } from 'react';

export const AI_LANDING_KEY = 'xyne:ai-landing-default';

// Module-level subscriber set — all hook instances share this store
const listeners = new Set<() => void>();

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const getSnapshot = (): boolean => localStorage.getItem(AI_LANDING_KEY) === 'true';

export const useAILandingDefault = (): {
  aiLandingDefault: boolean;
  setAiLandingDefault: (value: boolean) => void;
} => {
  const aiLandingDefault = useSyncExternalStore(subscribe, getSnapshot);

  const setAiLandingDefault = (value: boolean): void => {
    localStorage.setItem(AI_LANDING_KEY, String(value));
    listeners.forEach(l => l());
  };

  return { aiLandingDefault, setAiLandingDefault };
};
