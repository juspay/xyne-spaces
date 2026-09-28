import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FREQUENT_EMOJIS_MAX_TRACKED,
  FREQUENT_EMOJIS_STORAGE_KEY_PREFIX,
} from '../../constants/settings';

type FrequentEmojisModule = typeof import('../frequentEmojis');

const SCOPE = 'ws_1:user_1';
const OTHER_SCOPE = 'ws_2:user_1';
const keyFor = (scope: string): string => `${FREQUENT_EMOJIS_STORAGE_KEY_PREFIX}:${scope}`;

/** Minimal localStorage + event-target stand-in; the module only needs these three methods. */
const createWindowStub = (): { store: Map<string, string> } & Record<string, unknown> => {
  const store = new Map<string, string>();
  return {
    store,
    localStorage: {
      getItem: (key: string): string | null => store.get(key) ?? null,
      setItem: (key: string, value: string): void => void store.set(key, value),
      removeItem: (key: string): void => void store.delete(key),
    },
    addEventListener: (): void => {},
    removeEventListener: (): void => {},
  };
};

let windowStub: ReturnType<typeof createWindowStub>;
let mod: FrequentEmojisModule;

const seed = (scope: string, entries: unknown): void => {
  windowStub.store.set(keyFor(scope), JSON.stringify(entries));
  mod.resetFrequentEmojiCacheForTests();
};

const tokens = (scope: string): string[] => mod.getFrequentEmojis(scope).map(entry => entry.emoji);

beforeEach(async () => {
  windowStub = createWindowStub();
  vi.stubGlobal('window', windowStub);
  vi.resetModules();
  mod = await import('../frequentEmojis');
  mod.resetFrequentEmojiCacheForTests();
});

describe('buildFrequentEmojiScope', () => {
  it('partitions by workspace and user', () => {
    expect(mod.buildFrequentEmojiScope('ws_1', 'user_1')).toBe('ws_1:user_1');
  });

  it('falls back to an anonymous scope until both ids are known', () => {
    expect(mod.buildFrequentEmojiScope(undefined, 'user_1')).toBe(
      mod.ANONYMOUS_FREQUENT_EMOJI_SCOPE,
    );
    expect(mod.buildFrequentEmojiScope('ws_1', null)).toBe(mod.ANONYMOUS_FREQUENT_EMOJI_SCOPE);
  });
});

describe('recordEmojiUse / getFrequentEmojis', () => {
  it('round-trips unicode and custom tokens through storage', () => {
    mod.recordEmojiUse(SCOPE, '👍');
    mod.recordEmojiUse(SCOPE, 'custom:emo_1:party');

    expect(tokens(SCOPE)).toContain('👍');
    expect(tokens(SCOPE)).toContain('custom:emo_1:party');

    // Re-read from storage, not the in-memory copy.
    mod.resetFrequentEmojiCacheForTests();
    expect(tokens(SCOPE).sort()).toEqual(['custom:emo_1:party', '👍']);
  });

  it('ignores an empty token', () => {
    mod.recordEmojiUse(SCOPE, '');
    mod.recordEmojiUse(SCOPE, null);
    expect(tokens(SCOPE)).toEqual([]);
  });

  it('ranks by count, most used first', () => {
    mod.recordEmojiUse(SCOPE, '👀');
    mod.recordEmojiUse(SCOPE, '🚀');
    mod.recordEmojiUse(SCOPE, '🚀');

    expect(tokens(SCOPE)).toEqual(['🚀', '👀']);
  });

  it('breaks count ties by most recent use', () => {
    seed(SCOPE, [
      { emoji: '🎉', count: 2, lastUsedAt: 100 },
      { emoji: '🚀', count: 2, lastUsedAt: 300 },
      { emoji: '👀', count: 2, lastUsedAt: 200 },
    ]);

    expect(tokens(SCOPE)).toEqual(['🚀', '👀', '🎉']);
  });

  it('keeps each workspace+user ranking separate', () => {
    mod.recordEmojiUse(SCOPE, 'custom:emo_1:party');
    mod.recordEmojiUse(OTHER_SCOPE, '👍');

    expect(tokens(SCOPE)).toEqual(['custom:emo_1:party']);
    expect(tokens(OTHER_SCOPE)).toEqual(['👍']);
  });

  it('notifies subscribers on write and stops after unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = mod.subscribeToFrequentEmojis(listener);

    mod.recordEmojiUse(SCOPE, '👍');
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    mod.recordEmojiUse(SCOPE, '👍');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('returns a stable reference between writes so useSyncExternalStore does not loop', () => {
    mod.recordEmojiUse(SCOPE, '👍');
    expect(mod.getFrequentEmojis(SCOPE)).toBe(mod.getFrequentEmojis(SCOPE));
  });
});

describe('eviction at the tracking cap', () => {
  const fill = (count: number): void => {
    seed(
      SCOPE,
      Array.from({ length: count }, (_, index) => ({
        emoji: `e${index}`,
        count: 10 + index,
        lastUsedAt: 1_000 + index,
      })),
    );
  };

  it('never grows past the cap', () => {
    fill(FREQUENT_EMOJIS_MAX_TRACKED);
    mod.recordEmojiUse(SCOPE, '🆕');

    expect(mod.getFrequentEmojis(SCOPE)).toHaveLength(FREQUENT_EMOJIS_MAX_TRACKED);
  });

  it('keeps a newcomer and drops the least used instead', () => {
    fill(FREQUENT_EMOJIS_MAX_TRACKED);
    mod.recordEmojiUse(SCOPE, '🆕');

    // e0 had the lowest count of the pre-existing entries.
    expect(tokens(SCOPE)).toContain('🆕');
    expect(tokens(SCOPE)).not.toContain('e0');
  });

  it('lets a repeatedly used newcomer climb instead of being evicted every time', () => {
    fill(FREQUENT_EMOJIS_MAX_TRACKED);

    mod.recordEmojiUse(SCOPE, '🆕');
    const rankAfterFirstUse = tokens(SCOPE).indexOf('🆕');

    for (let i = 0; i < 11; i++) mod.recordEmojiUse(SCOPE, '🆕');
    const rankAfterTwelveUses = tokens(SCOPE).indexOf('🆕');

    const entry = mod.getFrequentEmojis(SCOPE).find(item => item.emoji === '🆕');
    expect(entry?.count).toBe(12);
    // Survived every write, and each use moved it up — the old code dropped it each time.
    expect(rankAfterFirstUse).toBeGreaterThanOrEqual(0);
    expect(rankAfterTwelveUses).toBeLessThan(rankAfterFirstUse);
  });
});

describe('corrupted storage', () => {
  it('drops entries with a missing or non-finite count / lastUsedAt', () => {
    seed(SCOPE, [
      { emoji: '👍', count: 3, lastUsedAt: 10 },
      { emoji: '🚀', count: Number.NaN, lastUsedAt: 20 },
      { emoji: '🎉', count: 2 },
      { emoji: '', count: 5, lastUsedAt: 30 },
      { count: 5, lastUsedAt: 30 },
      'not-an-entry',
      null,
    ]);

    expect(tokens(SCOPE)).toEqual(['👍']);
  });

  it('recovers from unparseable JSON', () => {
    windowStub.store.set(keyFor(SCOPE), '{not json');
    mod.resetFrequentEmojiCacheForTests();

    expect(mod.getFrequentEmojis(SCOPE)).toEqual([]);
  });

  it('recovers from a non-array payload', () => {
    seed(SCOPE, { emoji: '👍', count: 1, lastUsedAt: 1 });

    expect(mod.getFrequentEmojis(SCOPE)).toEqual([]);
  });

  it('still ranks in memory when persistence throws', () => {
    windowStub['localStorage'] = {
      getItem: (): string | null => null,
      setItem: (): never => {
        throw new Error('QuotaExceededError');
      },
      removeItem: (): void => {},
    };

    expect(() => mod.recordEmojiUse(SCOPE, '👍')).not.toThrow();
    expect(tokens(SCOPE)).toEqual(['👍']);
  });
});
