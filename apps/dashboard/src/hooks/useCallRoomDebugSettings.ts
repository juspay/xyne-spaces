import { useSyncExternalStore } from 'react';

export const CALL_ROOM_DEBUG_SETTINGS_KEY = 'xyne:call-room-debug-settings';

export interface CallRoomDebugSettings {
  adaptiveStream: boolean;
  enableStartAtDesiredQuality: boolean;
}

const DEFAULT_SETTINGS: CallRoomDebugSettings = {
  adaptiveStream: true,
  enableStartAtDesiredQuality: true,
};

const listeners = new Set<() => void>();

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const getSnapshot = (): string => localStorage.getItem(CALL_ROOM_DEBUG_SETTINGS_KEY) ?? '';
const getServerSnapshot = (): string => '';

const parseSettings = (raw: string): CallRoomDebugSettings => {
  if (!raw) return DEFAULT_SETTINGS;

  try {
    const parsed = JSON.parse(raw) as Partial<CallRoomDebugSettings>;
    return {
      adaptiveStream:
        typeof parsed.adaptiveStream === 'boolean'
          ? parsed.adaptiveStream
          : DEFAULT_SETTINGS.adaptiveStream,
      enableStartAtDesiredQuality:
        typeof parsed.enableStartAtDesiredQuality === 'boolean'
          ? parsed.enableStartAtDesiredQuality
          : DEFAULT_SETTINGS.enableStartAtDesiredQuality,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
};

export const getCallRoomDebugSettings = (): CallRoomDebugSettings => {
  if (typeof localStorage === 'undefined') return DEFAULT_SETTINGS;
  return parseSettings(localStorage.getItem(CALL_ROOM_DEBUG_SETTINGS_KEY) ?? '');
};

const saveSettings = (settings: CallRoomDebugSettings): void => {
  localStorage.setItem(CALL_ROOM_DEBUG_SETTINGS_KEY, JSON.stringify(settings));
  listeners.forEach(listener => listener());
};

export const useCallRoomDebugSettings = (): CallRoomDebugSettings & {
  setAdaptiveStream: (value: boolean) => void;
  setEnableStartAtDesiredQuality: (value: boolean) => void;
} => {
  const raw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const settings = parseSettings(raw);

  const setAdaptiveStream = (value: boolean): void => {
    saveSettings({ ...settings, adaptiveStream: value });
  };

  const setEnableStartAtDesiredQuality = (value: boolean): void => {
    saveSettings({ ...settings, enableStartAtDesiredQuality: value });
  };

  return {
    ...settings,
    setAdaptiveStream,
    setEnableStartAtDesiredQuality,
  };
};
