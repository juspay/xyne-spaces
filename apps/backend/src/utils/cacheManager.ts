// Simple in-memory cache with TTL support
import {logger} from '@/utils/logger';

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

export class CacheManager {
  private cache = new Map<string, CacheEntry<any>>();
  private defaultTTL: number;

  constructor(defaultTTLSeconds: number = 60) {
    this.defaultTTL = defaultTTLSeconds * 1000; // Convert to milliseconds

    // Clean up expired entries every 30 seconds
    setInterval(() => this.cleanup(), 30000);
  }

  /**
   * Store data in cache with TTL
   */
  set<T>(key: string, data: T, ttlSeconds?: number): void {
    const ttl = ttlSeconds ? ttlSeconds * 1000 : this.defaultTTL;
    const expiresAt = Date.now() + ttl;

    this.cache.set(key, {
      data,
      expiresAt
    });
  }

  /**
   * Retrieve data from cache if not expired
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.data as T;
  }

  /**
   * Check if key exists and is not expired
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);

    if (!entry) {
      return false;
    }

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Delete specific key from cache
   */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getStats(): { size: number; keys: string[] } {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys())
    };
  }

  /**
   * Remove expired entries from cache
   */
  private cleanup(): void {
    const now = Date.now();
    const expiredKeys: string[] = [];

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        expiredKeys.push(key);
      }
    }

    expiredKeys.forEach(key => this.cache.delete(key));

    if (expiredKeys.length > 0) {
      logger.info(`Cache cleanup: removed ${expiredKeys.length} expired entries`);
    }
  }

  /**
   * Generate a cache key from ticket IDs (sorted for consistency)
   */
  static generateTicketCacheKey(ticketIds: string[], prefix: string = 'step-completion'): string {
    const sortedIds = [...ticketIds].sort();
    return `${prefix}:${sortedIds.join(',')}`;
  }

  /**
   * Handle partial cache hits for step completion data
   * Returns: { cachedData, missingTicketIds }
   */
  getPartialStepCompletion(ticketIds: string[]): {
    cachedData: Record<string, any>;
    missingTicketIds: string[];
  } {
    const cachedData: Record<string, any> = {};
    const missingTicketIds: string[] = [];

    // Check each ticket individually
    for (const ticketId of ticketIds) {
      const cacheKey = `step-completion-single:${ticketId}`;
      const cached = this.get(cacheKey);

      if (cached) {
        cachedData[ticketId] = cached;
      } else {
        missingTicketIds.push(ticketId);
      }
    }

    return { cachedData, missingTicketIds };
  }

  /**
   * Store individual ticket step completion data
   */
  setStepCompletionForTicket(ticketId: string, data: any, ttlSeconds?: number): void {
    const cacheKey = `step-completion-single:${ticketId}`;
    this.set(cacheKey, data, ttlSeconds);
  }
}

// Create singleton instance
export const cacheManager = new CacheManager(60); // 1 minute TTL

// Export for testing or different configurations
export default CacheManager;