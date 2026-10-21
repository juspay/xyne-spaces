import { LRUCache } from 'lru-cache';

/** lru-cache's per-read status record: `fetch` is 'hit' | 'stale' | 'miss' | 'inflight'. */
export type CacheStatus<K extends {}, V extends {}> = LRUCache.Status<K, V>;

export type CacheOptions<K extends {}, V extends {}> = {
  /** Maximum number of entries; the least recently used one is evicted first. */
  max: number;
  /**
   * Entry lifetime. After it, reads still return the stale entry while `fetch`
   * refreshes it in the background, so callers never wait on the source.
   */
  ttlMs: number;
  /** Loads one entry from the source of truth. Concurrent misses share one call. */
  fetch: (key: K) => Promise<V | undefined>;
  /** Called with lru-cache's status record on every `get`; use it to count hits, misses and stale serves. */
  onStatus?: (status: CacheStatus<K, V>) => void;
};

export type Cache<K extends {}, V extends {}> = {
  get(key: K): Promise<V | undefined>;
  delete(key: K): boolean;
  clear(): void;
};

export function createCache<K extends {}, V extends {}>(options: CacheOptions<K, V>): Cache<K, V> {
  const cache = new LRUCache<K, V>({
    max: options.max,
    ttl: options.ttlMs,
    allowStale: true, // serve the stale entry while a refresh runs
    noDeleteOnFetchRejection: true, // a failed refresh keeps the last-good entry; a failed first fetch rejects
    fetchMethod: (key) => options.fetch(key),
  });
  return {
    get: (key) => {
      const status: CacheStatus<K, V> = {};
      const value = cache.fetch(key, { status });
      options.onStatus?.(status);
      return value;
    },
    delete: (key) => cache.delete(key),
    clear: () => cache.clear(),
  };
}
