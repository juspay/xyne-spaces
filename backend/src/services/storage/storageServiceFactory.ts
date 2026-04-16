import { config } from '../../config/env';
import { logger } from '../../utils/logger';
import { GCSService } from '../gcsService';
import { GCSAdapter } from './gcsAdapter';
import { S3StorageService } from './s3StorageService';
import type { StorageService } from './types';

const cache = new Map<string, StorageService>();
let defaultService: StorageService | null = null;
let initPromise: Promise<void> | null = null;

function createService(provider: string, bucketName?: string): StorageService {
  if (provider === 's3') return new S3StorageService(bucketName);
  return new GCSAdapter(new GCSService(bucketName));
}

/**
 * Ensure the default storage bucket exists.
 * In dev/test with fake-gcs-server, buckets aren't pre-created.
 */
export async function initStorage(): Promise<void> {
  if (!initPromise) {
    initPromise = getStorageService().ensureBucketExists().catch(err => {
      logger.error('[StorageServiceFactory] Failed to ensure bucket exists:', err);
      initPromise = null; // allow retry
    });
  }
  return initPromise;
}

/**
 * Get a storage service instance based on current config (STORAGE_PROVIDER).
 * Instances are cached per bucket.
 */
export function getStorageService(bucketName?: string | null): StorageService {
  if (!bucketName) {
    if (!defaultService) {
      defaultService = createService(config.fileStorage.provider);
      logger.info(`[StorageServiceFactory] Created default ${config.fileStorage.provider} service`);
    }
    return defaultService;
  }

  const key = `${config.fileStorage.provider}:${bucketName}`;
  if (!cache.has(key)) {
    cache.set(key, createService(config.fileStorage.provider, bucketName));
    logger.info(`[StorageServiceFactory] Created ${config.fileStorage.provider} service for bucket: ${bucketName}`);
  }
  return cache.get(key)!;
}

/** Convenience: default singleton based on config */
export const storageService: StorageService = getStorageService();
