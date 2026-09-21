import { LRUCache } from 'lru-cache';

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
    get: (key) => cache.fetch(key),
    delete: (key) => cache.delete(key),
    clear: () => cache.clear(),
  };
}
