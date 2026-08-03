import type { ContextSelections } from '../components/ContextPickerPanel';

let pendingSeed: ContextSelections | null = null;
let seedVersion = 0;
const listeners = new Set<() => void>();

export function setPendingContextSeed(selections: ContextSelections): void {
  pendingSeed = selections;
  seedVersion += 1;
  listeners.forEach(listener => listener());
}

export function consumePendingContextSeed(): ContextSelections | null {
  const seed = pendingSeed;
  pendingSeed = null;
  return seed;
}

export function subscribePendingContextSeed(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPendingContextSeedVersion(): number {
  return seedVersion;
}
