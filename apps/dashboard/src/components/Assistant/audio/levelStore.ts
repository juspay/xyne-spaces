/**
 * Microphone loudness (0–1) outside React state. The meter ticks every ~50 ms, so the orb
 * subscribes and writes a CSS variable instead of re-rendering the panel that hosts it.
 */
export interface VoiceLevelStore {
  get: () => number;
  set: (level: number) => void;
  subscribe: (listener: (level: number) => void) => () => void;
}

export function createVoiceLevelStore(): VoiceLevelStore {
  let level = 0;
  const listeners = new Set<(level: number) => void>();
  return {
    get: () => level,
    set: (next): void => {
      if (next === level) return;
      level = next;
      listeners.forEach(listener => listener(level));
    },
    subscribe: listener => {
      listeners.add(listener);
      return (): void => {
        listeners.delete(listener);
      };
    },
  };
}
