/**
 * Per-device "Frequently Used" emoji tracker.
 *
 * `emoji-picker-react` ships its own suggested category, but it only counts emojis clicked
 * *inside* the picker and it resolves entries through the unicode dataset, so custom emojis
 * never appear. Reactions in Spaces are applied from several surfaces (hover toolbar, mobile
 * drawer, message actions drawer) and may be custom, so usage is tracked here instead, keyed
 * by the exact token the reaction layer stores: a unicode char, or `custom:<emojiId>:<name>`.
 *
 * Storage is localStorage, partitioned per workspace+user: custom emoji ids are workspace
 * scoped, so an unpartitioned ranking would surface workspace A's emojis in workspace B and
 * react with an id that renders as a broken `:name:`. A server-side counter would need a new
 * table and a mutator; this keeps the first cut cheap and reversible.
 */

import {
  FREQUENT_EMOJIS_STORAGE_KEY_PREFIX,
  FREQUENT_EMOJIS_MAX_TRACKED,
} from '../constants/settings';

export interface FrequentEmojiEntry {
  /** Reaction token — unicode char, or `custom:<emojiId>:<name>`. */
  emoji: string;
  count: number;
  lastUsedAt: number;
}

/**
 * Identifies whose ranking this is. Built by `useFrequentEmojiScope` from the active
 * workspace and user; falls back to `anonymous` before either is known.
 */
export type FrequentEmojiScope = string;

export const ANONYMOUS_FREQUENT_EMOJI_SCOPE: FrequentEmojiScope = 'anonymous';

export const buildFrequentEmojiScope = (
  workspaceId: string | null | undefined,
  userId: string | null | undefined,
): FrequentEmojiScope =>
  workspaceId && userId ? `${workspaceId}:${userId}` : ANONYMOUS_FREQUENT_EMOJI_SCOPE;

const EMPTY: readonly FrequentEmojiEntry[] = Object.freeze([]);

const storageKey = (scope: FrequentEmojiScope): string =>
  `${FREQUENT_EMOJIS_STORAGE_KEY_PREFIX}:${scope}`;

/** One parsed list per scope. `useSyncExternalStore` needs a stable reference between writes. */
const cacheByScope = new Map<FrequentEmojiScope, readonly FrequentEmojiEntry[]>();
const listeners = new Set<() => void>();

const isEntry = (value: unknown): value is FrequentEmojiEntry => {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<FrequentEmojiEntry>;
  return (
    typeof entry.emoji === 'string' &&
    entry.emoji.length > 0 &&
    Number.isFinite(entry.count) &&
    Number.isFinite(entry.lastUsedAt)
  );
};

/** Most used first; ties broken by most recently used so a new favourite can climb. */
const byUsage = (a: FrequentEmojiEntry, b: FrequentEmojiEntry): number =>
  b.count - a.count || b.lastUsedAt - a.lastUsedAt;

const read = (scope: FrequentEmojiScope): readonly FrequentEmojiEntry[] => {
  const cached = cacheByScope.get(scope);
  if (cached) return cached;

  let parsed: readonly FrequentEmojiEntry[] = EMPTY;
  try {
    const raw = window.localStorage.getItem(storageKey(scope));
    const value: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(value)) parsed = value.filter(isEntry).sort(byUsage);
  } catch {
    // Private mode, quota, or corrupted JSON — the row is a convenience, never a hard failure.
    parsed = EMPTY;
  }

  cacheByScope.set(scope, parsed);
  return parsed;
};

const emit = (): void => listeners.forEach(listener => listener());

/**
 * Counts one use of `emoji` for `scope`. Safe to call on every reaction add — writes are
 * tiny and failures are swallowed.
 */
export const recordEmojiUse = (
  scope: FrequentEmojiScope,
  emoji: string | null | undefined,
): void => {
  if (!emoji) return;

  const existing = read(scope);
  const now = Date.now();
  const current = existing.find(entry => entry.emoji === emoji);
  const updated: FrequentEmojiEntry = current
    ? { ...current, count: current.count + 1, lastUsedAt: now }
    : { emoji, count: 1, lastUsedAt: now };

  // Evict from the others, never from the emoji just used: capping after the sort would drop
  // every newcomer on the spot (it enters at count 1, sorts last) so it could never climb.
  const others = existing
    .filter(entry => entry.emoji !== emoji)
    .sort(byUsage)
    .slice(0, FREQUENT_EMOJIS_MAX_TRACKED - 1);
  const next = [...others, updated].sort(byUsage);

  cacheByScope.set(scope, next);
  try {
    window.localStorage.setItem(storageKey(scope), JSON.stringify(next));
  } catch {
    // Keep the in-memory ranking even when persistence fails.
  }
  emit();
};

/** Every tracked emoji for `scope`, most used first. Callers slice to what they display. */
export const getFrequentEmojis = (scope: FrequentEmojiScope): readonly FrequentEmojiEntry[] =>
  read(scope);

/** Subscribe for `useSyncExternalStore`. Cross-tab writes are picked up by one shared listener. */
export const subscribeToFrequentEmojis = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return (): void => {
    listeners.delete(listener);
  };
};

const onStorage = (event: StorageEvent): void => {
  if (event.key !== null && !event.key.startsWith(FREQUENT_EMOJIS_STORAGE_KEY_PREFIX)) return;
  // Another tab reacted: drop the parsed copies and let subscribers re-read.
  cacheByScope.clear();
  emit();
};

if (typeof window !== 'undefined') {
  window.addEventListener('storage', onStorage);
}

/** Test seam — resets the in-memory copies without touching listeners. */
export const resetFrequentEmojiCacheForTests = (): void => cacheByScope.clear();
