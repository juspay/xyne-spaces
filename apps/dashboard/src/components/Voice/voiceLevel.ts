// Microphone loudness (0..1) kept outside React: frames arrive every 100 ms, so the orb
// subscribes and writes a CSS variable instead of re-rendering the panel that hosts it.
type LevelListener = (level: number) => void;

let current = 0;
const listeners = new Set<LevelListener>();

export const voiceLevel = {
  get: (): number => current,
  set: (next: number): void => {
    if (next === current) return;
    current = next;
    listeners.forEach(listener => listener(current));
  },
  subscribe: (listener: LevelListener): (() => void) => {
    listeners.add(listener);
    return (): void => {
      listeners.delete(listener);
    };
  },
};
