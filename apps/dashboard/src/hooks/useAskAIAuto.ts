import { useSyncExternalStore } from 'react';

// Auto is the default every time the app loads; picking an agent turns it off until then.
let current = true;
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
  for (const listener of listeners) listener();
};

export const useAskAIAuto = (): { isAuto: boolean; setAuto: (next: boolean) => void } => {
  const isAuto = useSyncExternalStore(
    subscribe,
    () => current,
    () => true,
  );
  return { isAuto, setAuto };
};
