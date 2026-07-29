import { useSyncExternalStore } from 'react';

export const CALL_JOIN_SETTINGS_KEY = 'xyne:call-join-settings';

interface CallJoinSettings {
  joinMuted: boolean;
  joinWithoutVideo: boolean;
}

export const DEFAULT_SETTINGS: CallJoinSettings = {
  joinMuted: false,
  joinWithoutVideo: true,
};

const listeners = new Set<() => void>();

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const getSnapshot = (): string => localStorage.getItem(CALL_JOIN_SETTINGS_KEY) ?? '';
const getServerSnapshot = (): string => '';

const parseSettings = (raw: string): CallJoinSettings => {
  if (!raw) return DEFAULT_SETTINGS;
  try {
    const parsed = JSON.parse(raw) as Partial<CallJoinSettings>;
    return {
      joinMuted:
        typeof parsed.joinMuted === 'boolean' ? parsed.joinMuted : DEFAULT_SETTINGS.joinMuted,
      joinWithoutVideo:
        typeof parsed.joinWithoutVideo === 'boolean'
          ? parsed.joinWithoutVideo
          : DEFAULT_SETTINGS.joinWithoutVideo,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
};

export const getCallJoinSettings = (): CallJoinSettings => {
  const raw = localStorage.getItem(CALL_JOIN_SETTINGS_KEY) ?? '';
  return parseSettings(raw);
};

const saveSettings = (settings: CallJoinSettings): void => {
  const raw = JSON.stringify(settings);
  localStorage.setItem(CALL_JOIN_SETTINGS_KEY, raw);
  listeners.forEach(l => l());
};

export const useCallJoinSettings = (): {
  joinMuted: boolean;
  joinWithoutVideo: boolean;
  setJoinMuted: (value: boolean) => void;
  setJoinWithoutVideo: (value: boolean) => void;
} => {
  const raw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const settings = parseSettings(raw);

  const setJoinMuted = (value: boolean): void => {
    saveSettings({ ...settings, joinMuted: value });
  };

  const setJoinWithoutVideo = (value: boolean): void => {
    saveSettings({ ...settings, joinWithoutVideo: value });
  };

  return {
    joinMuted: settings.joinMuted,
    joinWithoutVideo: settings.joinWithoutVideo,
    setJoinMuted,
    setJoinWithoutVideo,
  };
};
