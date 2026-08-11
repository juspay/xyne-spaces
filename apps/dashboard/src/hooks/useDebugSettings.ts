import { useSyncExternalStore } from 'react';

const DEBUG_STORAGE_KEY = 'xyne-debug-settings';

export interface DebugSettings {
  showSendIndicators: boolean;
  /** Gate for "Debug automations". `null` (unset) is treated as off. */
  debugAutomations: boolean | null;
}

const DEFAULT_DEBUG_SETTINGS: DebugSettings = {
  showSendIndicators: true,
  debugAutomations: null,
};

// Module-level store (same pattern as useSearchMode) so every consumer shares
// one source of truth instead of independent state that lags until remount.
const listeners = new Set<() => void>();

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const getSnapshot = (): string => localStorage.getItem(DEBUG_STORAGE_KEY) ?? '';

function parseSettings(raw: string): DebugSettings {
  if (!raw) return DEFAULT_DEBUG_SETTINGS;
  try {
    return { ...DEFAULT_DEBUG_SETTINGS, ...(JSON.parse(raw) as Partial<DebugSettings>) };
  } catch {
    return DEFAULT_DEBUG_SETTINGS;
  }
}

function writeSettings(next: DebugSettings): void {
  localStorage.setItem(DEBUG_STORAGE_KEY, JSON.stringify(next));
  listeners.forEach(l => l());
}

export const useDebugSettings = () => {
  const raw = useSyncExternalStore(subscribe, getSnapshot);
  const settings = parseSettings(raw);

  const toggleSendIndicators = (): void => {
    writeSettings({ ...settings, showSendIndicators: !settings.showSendIndicators });
  };

  const toggleDebugAutomations = (): void => {
    writeSettings({ ...settings, debugAutomations: !settings.debugAutomations });
  };

  return { settings, toggleSendIndicators, toggleDebugAutomations };
};

/** Shorthand for entry points that only need the gate, not the full settings object. */
export function useDebugAutomationsEnabled(): boolean {
  return useDebugSettings().settings.debugAutomations === true;
}
