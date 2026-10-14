// Kept outside React: frames arrive every 100 ms, so the orb writes a CSS variable rather than re-rendering.
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
