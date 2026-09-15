import { decryptField } from './field-decrypt.js';
import { Event } from '../logger/events.js';
import { getCryptoLogger } from './crypto-logger.js';

const MAX_ENTRIES = 10_000;

/**
 * LRU cache for decrypted field values.
 *
 * - .get(ciphertext) -> plaintext | undefined (sync read)
 * - .set(ciphertext, plaintext) -> void (with LRU eviction)
 * - .prefetch(ciphertext, key) -> Promise<void> (async decrypt + cache)
 * - .clear() -> void (on key change or disconnect)
 * - .subscribe(cb) -> unsubscribe fn (notified on new cache entries)
 * - .size -> number
 */
class DecryptionCache {
  private cache = new Map<string, string>();
  private subscribers = new Set<() => void>();

  /**
   * Sync read from cache. Returns undefined on miss.
   */
  get(ciphertext: string): string | undefined {
    const logger = getCryptoLogger();
    const value = this.cache.get(ciphertext);
    if (value !== undefined) {
      // Move to end for LRU (delete + re-insert)
      this.cache.delete(ciphertext);
      this.cache.set(ciphertext, value);
      logger.debug(Event.ENCRYPTION_CACHE_HIT, {
        message: '[encryptionlog] Cache get - hit',
        cacheSize: this.cache.size,
      });
    } else {
      logger.debug(Event.ENCRYPTION_CACHE_MISS, {
        message: '[encryptionlog] Cache get - miss',
        cacheSize: this.cache.size,
      });
    }
    return value;
  }

  /**
   * Store a decrypted value in the cache with LRU eviction.
   */
  set(ciphertext: string, plaintext: string): void {
    const logger = getCryptoLogger();
    const format = ciphertext.split('|')[0] || 'unknown';

    // If already present, delete first so re-insert goes to end
    if (this.cache.has(ciphertext)) {
      this.cache.delete(ciphertext);
    }

    // Evict oldest entry if at capacity
    if (this.cache.size >= MAX_ENTRIES) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
        logger.debug(Event.ENCRYPTION_CACHE_HIT, {
          message: '[encryptionlog] Cache eviction - LRU removed',
          cacheSize: this.cache.size,
        });
      }
    }

    this.cache.set(ciphertext, plaintext);
    logger.info(Event.ENCRYPTION_CACHE_HIT, {
      message: '[encryptionlog] Cache set - decrypted value stored',
      format,
      cacheSize: this.cache.size,
    });
    this.notifySubscribers();
  }

  /**
   * Async decrypt + cache. Used to warm the cache for a ciphertext.
   */
  async prefetch(ciphertext: string, key: CryptoKey): Promise<void> {
    const logger = getCryptoLogger();
    if (this.cache.has(ciphertext)) {
      return;
    }

    const format = ciphertext.split('|')[0] || 'unknown';

    try {
      const plaintext = await decryptField(ciphertext, key);
      this.set(ciphertext, plaintext);
      logger.info(Event.ENCRYPTION_FIELD_DECRYPT, {
        message: '[encryptionlog] Decryption successful',
        format,
        status: 'success',
      });
    } catch (error) {
      logger.error(Event.ENCRYPTION_FIELD_DECRYPT, {
        message: '[encryptionlog] Decryption failed',
        format,
        status: 'failure',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      // Decryption failed — skip caching, value will pass through
    }
  }

  /**
   * Clear all cached entries. Call on key change or WS disconnect.
   */
  clear(): void {
    const logger = getCryptoLogger();
    const previousSize = this.cache.size;
    this.cache.clear();
    logger.info(Event.ENCRYPTION_CACHE_HIT, {
      message: '[encryptionlog] Cache cleared',
      previousSize,
    });
  }

  /**
   * Subscribe to cache changes. Callback fires when a new entry is added.
   * Returns an unsubscribe function.
   */
  subscribe(cb: () => void): () => void {
    this.subscribers.add(cb);
    return () => {
      this.subscribers.delete(cb);
    };
  }

  /**
   * Number of entries currently cached.
   */
  get size(): number {
    return this.cache.size;
  }

  private notifySubscribers(): void {
    for (const cb of this.subscribers) {
      try {
        cb();
      } catch {
        /* ignore subscriber errors */
      }
    }
  }
}

/** Singleton cache instance shared across the app */
export const decryptionCache = new DecryptionCache();
