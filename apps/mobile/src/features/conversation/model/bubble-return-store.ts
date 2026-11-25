/**
 * A thread card opened from a bubble (or the bubble list) is leaving: the
 * bubbles were showing under it, so they come back as its exit starts rather
 * than once the route is gone and the shell has its focus back.
 */
let returning = false;
const listeners = new Set<() => void>();

export function setBubblesReturning(next: boolean): void {
  if (next === returning) return;
  returning = next;
  listeners.forEach(listener => listener());
}

export function getBubblesReturning(): boolean {
  return returning;
}

export function subscribeBubblesReturning(listener: () => void): () => void {
  listeners.add(listener);
  return (): void => {
    listeners.delete(listener);
  };
}
