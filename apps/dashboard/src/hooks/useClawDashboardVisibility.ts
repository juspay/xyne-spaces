import { useSyncExternalStore } from 'react';

export const CLAW_DASHBOARD_VISIBILITY_KEY = 'xyne:show-claw-dashboard';

const listeners = new Set<() => void>();

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const getSnapshot = (): boolean => localStorage.getItem(CLAW_DASHBOARD_VISIBILITY_KEY) !== 'false';

export const useClawDashboardVisibility = (): {
  showClawDashboard: boolean;
  setShowClawDashboard: (value: boolean) => void;
} => {
  const showClawDashboard = useSyncExternalStore(subscribe, getSnapshot);

  const setShowClawDashboard = (value: boolean): void => {
    localStorage.setItem(CLAW_DASHBOARD_VISIBILITY_KEY, String(value));
    listeners.forEach(listener => listener());
  };

  return { showClawDashboard, setShowClawDashboard };
};
