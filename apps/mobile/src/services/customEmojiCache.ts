import { lotusStorage } from '@/src/services/localStorage';

export type CustomEmojiItem = {
  id: string;
  name: string;
};

const CACHE_PREFIX = '@lotus_custom_emojis';
const CACHE_VERSION = 1;
/** Drop entries older than this — list is re-fetched on next use. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

type CustomEmojiCacheEnvelope = {
  version: number;
  userId: string;
  cachedAt: number;
  emojis: CustomEmojiItem[];
};

function cacheKey(userId: string): string {
  return `${CACHE_PREFIX}:v${CACHE_VERSION}:${userId}`;
}

function isCustomEmojiItem(value: unknown): value is CustomEmojiItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<CustomEmojiItem>;
  return typeof item.id === 'string' && item.id.length > 0 && typeof item.name === 'string';
}

function isCustomEmojiCacheEnvelope(
  value: unknown,
  userId: string,
): value is CustomEmojiCacheEnvelope {
  if (!value || typeof value !== 'object') return false;

  const cache = value as Partial<CustomEmojiCacheEnvelope>;
  return (
    cache.version === CACHE_VERSION &&
    cache.userId === userId &&
    typeof cache.cachedAt === 'number' &&
    Number.isFinite(cache.cachedAt) &&
    Date.now() - cache.cachedAt <= MAX_AGE_MS &&
    Array.isArray(cache.emojis) &&
    cache.emojis.every(isCustomEmojiItem)
  );
}

export function readCustomEmojiCache(userId: string): CustomEmojiCacheEnvelope | null {
  const raw = lotusStorage.getString(cacheKey(userId));
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isCustomEmojiCacheEnvelope(parsed, userId)) {
      lotusStorage.remove(cacheKey(userId));
      return null;
    }
    return parsed;
  } catch {
    lotusStorage.remove(cacheKey(userId));
    return null;
  }
}

export function writeCustomEmojiCache(userId: string, emojis: CustomEmojiItem[]): void {
  if (emojis.length === 0) return;

  const envelope: CustomEmojiCacheEnvelope = {
    version: CACHE_VERSION,
    userId,
    cachedAt: Date.now(),
    emojis,
  };

  lotusStorage.set(cacheKey(userId), JSON.stringify(envelope));
}

export function clearCustomEmojiCache(userId: string): void {
  lotusStorage.remove(cacheKey(userId));
}
