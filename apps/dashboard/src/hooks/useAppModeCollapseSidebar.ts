import { useSyncExternalStore } from 'react';

export const APP_MODE_COLLAPSE_SIDEBAR_KEY = 'xyne:app-mode-collapse-sidebar';

// Module-level subscriber set — all hook instances share this store
const listeners = new Set<() => void>();

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

// Default OFF: collapsing the sidebar moves something the user positioned
// themselves, so it has to be asked for. Stored as the string 'true' when on.
const getSnapshot = (): boolean => localStorage.getItem(APP_MODE_COLLAPSE_SIDEBAR_KEY) === 'true';

/**
 * Whether App Creation mode collapses the sidebar to make room for the app pane.
 *
 * This behaviour shipped unconditionally once and was reverted: driving the
 * panel imperatively races the resize group's deferred re-layout, and a
 * one-shot `expand()` fired while the third panel unmounts is clobbered a frame
 * later — leaving the sidebar stuck shut. It is back only because it is now
 * opt-in AND applied with a settle loop (see AIShell). Do not reintroduce a
 * single imperative call.
 */
export const useAppModeCollapseSidebar = (): {
  appModeCollapseSidebar: boolean;
  setAppModeCollapseSidebar: (value: boolean) => void;
} => {
  const appModeCollapseSidebar = useSyncExternalStore(subscribe, getSnapshot);

  const setAppModeCollapseSidebar = (value: boolean): void => {
    localStorage.setItem(APP_MODE_COLLAPSE_SIDEBAR_KEY, String(value));
    listeners.forEach(l => l());
  };

  return { appModeCollapseSidebar, setAppModeCollapseSidebar };
};
