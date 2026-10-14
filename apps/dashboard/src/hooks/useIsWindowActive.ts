import { useSyncExternalStore } from 'react';

const subscribe = (onChange: () => void): (() => void) => {
  window.addEventListener('focus', onChange);
  window.addEventListener('blur', onChange);
  document.addEventListener('visibilitychange', onChange);
  return () => {
    window.removeEventListener('focus', onChange);
    window.removeEventListener('blur', onChange);
    document.removeEventListener('visibilitychange', onChange);
  };
};

const getSnapshot = (): boolean => document.visibilityState === 'visible' && document.hasFocus();

/** True while this window is visible and focused, i.e. the user can be looking at it. */
export const useIsWindowActive = (): boolean => useSyncExternalStore(subscribe, getSnapshot);
