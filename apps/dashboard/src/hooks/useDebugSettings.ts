import { useSyncExternalStore } from 'react';

const DEBUG_STORAGE_KEY = 'xyne-debug-settings';

export interface DebugSettings {
  showSendIndicators: boolean;
  /** Gate for the "Debug automations" action on messages, mails, and tickets. */
  debugAutomations: boolean;
}

const DEFAULT_DEBUG_SETTINGS: DebugSettings = {
  showSendIndicators: true,
  debugAutomations: false,
};

// Module-level store (same pattern as useSearchMode) so every consumer shares
// one source of truth instead of independent state that lags until remount.
const listeners = new Set<() => void>();

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

// Storage can throw outright (Safari private mode, blocked storage in an embedded
// webview). This hook renders per message bubble, so a throw here would take down
// the whole list — fall back to defaults instead.
const getSnapshot = (): string => {
  try {
    return localStorage.getItem(DEBUG_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
};

// useSyncExternalStore calls getSnapshot at least twice per render, and consumers
// render per message/email row — so parse once per distinct raw value, not per call.
let parsedRaw: string | null = null;
let parsedSettings: DebugSettings = DEFAULT_DEBUG_SETTINGS;

function parseSettings(raw: string): DebugSettings {
  if (raw === parsedRaw) return parsedSettings;
  parsedRaw = raw;
  if (!raw) {
    parsedSettings = DEFAULT_DEBUG_SETTINGS;
    return parsedSettings;
  }
  try {
    parsedSettings = { ...DEFAULT_DEBUG_SETTINGS, ...(JSON.parse(raw) as Partial<DebugSettings>) };
  } catch {
    parsedSettings = DEFAULT_DEBUG_SETTINGS;
  }
  return parsedSettings;
}

function writeSettings(next: DebugSettings): void {
  try {
    localStorage.setItem(DEBUG_STORAGE_KEY, JSON.stringify(next));
  } catch {
    return; // storage unavailable — keep the last committed state rather than desyncing
  }
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
  return useDebugSettings().settings.debugAutomations;
}
