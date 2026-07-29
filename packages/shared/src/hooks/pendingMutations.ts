let pendingCount = 0;
const listeners = new Set<(count: number) => void>();

function notify(): void {
  for (const listener of listeners) {
    listener(pendingCount);
  }
}

export function trackMutationStart(): void {
  pendingCount += 1;
  notify();
}

export function trackMutationSettled(): void {
  pendingCount = Math.max(0, pendingCount - 1);
  notify();
}

export function getPendingMutationCount(): number {
  return pendingCount;
}

export function subscribePendingMutations(listener: (count: number) => void): () => void {
  listeners.add(listener);
  return (): void => {
    listeners.delete(listener);
  };
}
