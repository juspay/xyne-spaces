/**
 * GCS Service Factory with Global Caching
 *
 * Centralized factory for managing GCS service instances across the application.
 * Prevents resource leaks by maintaining a singleton cache of GCS service instances
 * per bucket, ensuring that multiple parts of the codebase can reuse the same
 * instances instead of creating duplicates.
 *
 * Usage:
 *   import { GCSServiceFactory } from '../services/gcsServiceFactory.js';
 *
 *   const gcs = GCSServiceFactory.getService('my-bucket');
 *   const buffer = await gcs.getFileBuffer('path/to/file.pdf');
 *
 * @module GCSServiceFactory
 */

import { GCSService } from './gcsService.js';
import { logger } from '../utils/logger.js';

class GCSServiceFactory {
  private static serviceCache = new Map<string, GCSService>();
  private static defaultService: GCSService | null = null;
  private static createdAt = new Date();
  private static callCount = 0;

  /**
   * Get a GCS service instance for a specific bucket (with caching)
   *
   * @param bucketName - The GCS bucket name, or null to use default bucket
   * @returns Cached or new GCSService instance
   *
   * @example
   * // Use default bucket
   * const gcs = GCSServiceFactory.getService(null);
   *
   * @example
   * // Use custom bucket
   * const gcs = GCSServiceFactory.getService('xyne-documents');
   */
  public static getService(bucketName: string | null): GCSService {
    this.callCount++;

    // Use default service for null/undefined bucketName
    if (!bucketName) {
      if (!this.defaultService) {
        logger.debug(`[GCSServiceFactory] Creating default GCS service instance`);
        this.defaultService = new GCSService();
      }
      return this.defaultService;
    }

    // Return cached instance if exists
    if (this.serviceCache.has(bucketName)) {
      logger.debug(`[GCSServiceFactory] Reusing cached instance for bucket: ${bucketName}`);
      return this.serviceCache.get(bucketName)!;
    }

    // Create and cache new instance
    logger.info(`[GCSServiceFactory] Creating new GCS service instance for bucket: ${bucketName}`);
    const newService = new GCSService(bucketName);
    this.serviceCache.set(bucketName, newService);
    logger.debug(`[GCSServiceFactory] Total cached buckets: ${this.serviceCache.size}`);

    return newService;
  }

  /**
   * Get cache statistics (for debugging and monitoring)
   *
   * @returns Object containing cache statistics
   */
  public static getCacheStats() {
    return {
      cachedBuckets: Array.from(this.serviceCache.keys()),
      cacheSize: this.serviceCache.size,
      hasDefaultService: this.defaultService !== null,
      totalCalls: this.callCount,
      cacheAge: Math.floor((Date.now() - this.createdAt.getTime()) / 1000),
      createdAt: this.createdAt.toISOString(),
    };
  }

  /**
   * Clear the cache (primarily for testing purposes)
   * WARNING: Only use this in tests or during controlled shutdown
   */
  public static clearCache(): void {
    logger.warn(`[GCSServiceFactory] Clearing cache - ${this.serviceCache.size} instances will be removed`);
    this.serviceCache.clear();
    this.defaultService = null;
    this.callCount = 0;
  }
}

export default GCSServiceFactory;
