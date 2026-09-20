/**
 * Per-device "Frequently Used" emoji tracker.
 *
 * `emoji-picker-react` ships its own suggested category, but it only counts emojis clicked
 * *inside* the picker and it resolves entries through the unicode dataset, so custom emojis
 * never appear. Reactions in Spaces are applied from several surfaces (hover toolbar, mobile
 * drawer, message actions drawer) and may be custom, so usage is tracked here instead, keyed
 * by the exact token the reaction layer stores: a unicode char, or `custom:<emojiId>:<name>`.
 *
 * Storage is localStorage — per device, not synced across devices. A server-side counter would
 * need a new table and a mutator; this keeps the first cut cheap and reversible.
 */

const STORAGE_KEY = 'xyne_frequent_emojis';

/** Entries kept on disk. Beyond this the least-used tail is dropped. */
const MAX_TRACKED = 50;

/** Emojis shown in the picker's Frequently Used row. */
export const FREQUENT_EMOJI_DISPLAY_LIMIT = 8;

export interface FrequentEmojiEntry {
  /** Reaction token — unicode char, or `custom:<emojiId>:<name>`. */
  emoji: string;
  count: number;
  lastUsedAt: number;
}

const EMPTY: FrequentEmojiEntry[] = [];

let cache: FrequentEmojiEntry[] | null = null;
const listeners = new Set<() => void>();

const isEntry = (value: unknown): value is FrequentEmojiEntry => {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<FrequentEmojiEntry>;
  return typeof entry.emoji === 'string' && !!entry.emoji && typeof entry.count === 'number';
};

/** Most used first; ties broken by most recently used so a new favourite can climb. */
const byUsage = (a: FrequentEmojiEntry, b: FrequentEmojiEntry): number =>
  b.count - a.count || b.lastUsedAt - a.lastUsedAt;

const read = (): FrequentEmojiEntry[] => {
  if (cache) return cache;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    cache = Array.isArray(parsed) ? parsed.filter(isEntry).sort(byUsage) : EMPTY;
  } catch {
    // Private mode, quota, or corrupted JSON — the row is a convenience, never a hard failure.
    cache = EMPTY;
  }
  return cache;
};

const emit = (): void => listeners.forEach(listener => listener());

/**
 * Counts one use of `emoji`. Safe to call on every reaction add — writes are tiny and
 * failures are swallowed.
 */
export const recordEmojiUse = (emoji: string | null | undefined): void => {
  if (!emoji) return;

  const existing = read();
  const now = Date.now();
  const current = existing.find(entry => entry.emoji === emoji);
  const next = (
    current
      ? existing.map(entry =>
          entry.emoji === emoji ? { ...entry, count: entry.count + 1, lastUsedAt: now } : entry,
        )
      : [...existing, { emoji, count: 1, lastUsedAt: now }]
  )
    .sort(byUsage)
    .slice(0, MAX_TRACKED);

  cache = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Keep the in-memory ranking even when persistence fails.
  }
  emit();
};

/** Top `limit` emojis, most used first. Returns a stable reference between changes. */
export const getFrequentEmojis = (): FrequentEmojiEntry[] => read();

export const clearFrequentEmojis = (): void => {
  cache = EMPTY;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  emit();
};

/** Subscribe for `useSyncExternalStore`. Also follows writes made in other tabs. */
export const subscribeToFrequentEmojis = (listener: () => void): (() => void) => {
  listeners.add(listener);

  const onStorage = (event: StorageEvent): void => {
    if (event.key !== null && event.key !== STORAGE_KEY) return;
    cache = null;
    listener();
  };
  window.addEventListener('storage', onStorage);

  return (): void => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
};
