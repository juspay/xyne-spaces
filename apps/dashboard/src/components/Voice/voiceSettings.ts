import { useSyncExternalStore } from 'react';

export interface VoiceSettings {
  /** null for the server's default; see pickVoice for when it is no longer offered. */
  voiceId: string | null;
  speakReplies: boolean;
  micId: string | null;
}

const STORAGE_KEY = 'xyne:voice-settings';

function load(): VoiceSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<VoiceSettings>;
    return {
      voiceId: typeof saved.voiceId === 'string' ? saved.voiceId : null,
      speakReplies: saved.speakReplies !== false,
      micId: typeof saved.micId === 'string' ? saved.micId : null,
    };
  } catch {
    return { voiceId: null, speakReplies: true, micId: null };
  }
}

let settings = load();
const listeners = new Set<() => void>();

export function updateVoiceSettings(patch: Partial<VoiceSettings>): void {
  settings = { ...settings, ...patch };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage unavailable: the choice still holds for this session.
  }
  listeners.forEach(listener => listener());
}

export const getVoiceSettings = (): VoiceSettings => settings;

export const subscribeVoiceSettings = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return (): void => {
    listeners.delete(listener);
  };
};

export const useVoiceSettings = (): VoiceSettings =>
  useSyncExternalStore(subscribeVoiceSettings, getVoiceSettings);
