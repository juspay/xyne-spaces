/**
 * Flag runtime: storage, the pinned snapshot, and applying a change.
 *
 * The snapshot is read once and pinned for the process. Expo is explicit that
 * changing the route tree under a live navigator remounts it and drops its
 * state, so a flag that could change mid-session would mean a visible swap, a
 * lost navigation stack and lost scroll positions. Reading synchronously at
 * first access is also what removes the flash — the first frame already renders
 * the right shell
 *
 * A change is applied by `applyFlagChanges()`, which re-reads storage and bumps
 * a generation that `(protected)/_layout.tsx` uses as a remount key.
 */
import { useSyncExternalStore } from 'react';

import { getBoolean, lotusStorage, setBoolean } from '@/src/services/localStorage';

import { FLAGS, FLAG_KEYS, parentFlag, type FlagKey, type ResolvedFlags } from './registry';

const STORAGE_PREFIX = '@lotus_flags:';

function storageKey(key: FlagKey): string {
  return `${STORAGE_PREFIX}${key}`;
}

/** What storage holds, ignoring the `requires` rule. The Beta screen's switch position. */
export function storedFlag(key: FlagKey): boolean {
  return getBoolean(storageKey(key)) ?? FLAGS[key].default;
}

function buildSnapshot(): ResolvedFlags {
  const values: Record<string, boolean> = {};

  for (const key of FLAG_KEYS) {
    values[key] = storedFlag(key);
  }

  // A flag whose parent is off stays off, whatever storage holds. Turning the
  // parent back off would otherwise strand the child in a combination that was
  // never meant to ship — the new DMs screen inside the old shell has no search
  // tab, so search becomes unreachable.
  for (const key of FLAG_KEYS) {
    const parent = parentFlag(key);
    if (parent !== undefined && values[parent] !== true) {
      values[key] = false;
    }
  }

  return values as ResolvedFlags;
}

let snapshot: ResolvedFlags | null = null;

/** Read a flag. Safe anywhere, but should only be called at a seam. */
export function isFlagOn(key: FlagKey): boolean {
  snapshot ??= buildSnapshot();
  return snapshot[key];
}

/** The whole pinned set. For the Beta screen. */
export function flagSnapshot(): ResolvedFlags {
  snapshot ??= buildSnapshot();
  return snapshot;
}

export function setFlag(key: FlagKey, on: boolean): void {
  setBoolean(storageKey(key), on);
}

/**
 * Flags storage currently holds as on.
 *
 * Reads storage rather than the pinned snapshot: the snapshot applies the
 * `requires` rule, so a child forced off by its parent would look untouched
 * here when the user did in fact turn it on. Revocation is about what the
 * user asked for, not what is currently rendering.
 */
export function enabledFlagKeys(): FlagKey[] {
  return FLAG_KEYS.filter(key => getBoolean(storageKey(key)) === true);
}

/**
 * Forgets a flag entirely, so it falls back to its registry default.
 *
 * Not `setFlag(key, false)`: that writes an explicit `false`, which reads as
 * "the user turned this off". Someone whose access is restored later should
 * find the switch where the registry puts it, not where a revocation left it.
 */
export function clearFlag(key: FlagKey): void {
  lotusStorage.remove(storageKey(key));
}

export function resetFlags(): void {
  for (const key of FLAG_KEYS) {
    lotusStorage.remove(storageKey(key));
  }
}

// --- applying a change -------------------------------------------------------

const listeners = new Set<() => void>();
let generation = 0;
let pending: ReturnType<typeof setTimeout> | null = null;

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

/**
 * Re-pin and remount. Debounced, so flipping three switches in a row rebuilds
 * once rather than three times, and so the caller's toast lands first.
 */
export function applyFlagChanges(delayMs = 450): void {
  if (pending !== null) {
    clearTimeout(pending);
  }

  pending = setTimeout((): void => {
    pending = null;
    snapshot = buildSnapshot();
    generation += 1;
    emit();
  }, delayMs);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return (): void => {
    listeners.delete(listener);
  };
}

function getGeneration(): number {
  return generation;
}

/** Remount key for the protected tree. */
export function useFlagGeneration(): number {
  return useSyncExternalStore(subscribe, getGeneration, getGeneration);
}

// --- react ------------------------------------------------------------------

/**
 * Constant for the lifetime of the tree, since the snapshot is pinned. A hook
 * purely so call sites read like every other seam.
 */
export function useFlag(key: FlagKey): boolean {
  return isFlagOn(key);
}

/** Tests only. */
export function resetFlagSnapshotForTest(): void {
  snapshot = null;
}
