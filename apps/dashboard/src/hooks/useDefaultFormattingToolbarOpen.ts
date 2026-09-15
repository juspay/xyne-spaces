import { useSyncExternalStore } from 'react';

export const DEFAULT_FORMATTING_TOOLBAR_OPEN_KEY = 'xyne:default-formatting-toolbar-open';

const listeners = new Set<() => void>();

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const getSnapshot = (): boolean => {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(DEFAULT_FORMATTING_TOOLBAR_OPEN_KEY) === 'true';
};

const getServerSnapshot = (): boolean => false;

const saveDefaultFormattingToolbarOpen = (value: boolean): void => {
  localStorage.setItem(DEFAULT_FORMATTING_TOOLBAR_OPEN_KEY, String(value));
  listeners.forEach(listener => listener());
};

export const useDefaultFormattingToolbarOpen = (): {
  defaultFormattingToolbarOpen: boolean;
  setDefaultFormattingToolbarOpen: (value: boolean) => void;
} => {
  const defaultFormattingToolbarOpen = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  return {
    defaultFormattingToolbarOpen,
    setDefaultFormattingToolbarOpen: saveDefaultFormattingToolbarOpen,
  };
};
