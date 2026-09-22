import { createStorageService, setStorageLogger, type StorageConfig, type StorageService } from '@xyne/storage';
import { config } from '../../config/env';
import { logger } from '../../utils/logger';
import { withRetry } from '../../utils/retry';

setStorageLogger(logger);

function storageProvider(): StorageConfig['provider'] {
  const provider = config.fileStorage.provider;
  return provider === 's3' || provider === 'azure' ? provider : 'gcs';
}

/** Backend wiring for the shared @xyne/storage provider factory. */
function buildStorageConfig(): StorageConfig {
  const isEnvTestOrDevelopment = config.env === 'development' || config.isTestEnv;

  return {
    provider: storageProvider(),
    gcs: {
      projectId: config.gcs.projectId,
      bucketName: config.gcs.bucketName,
      ...(isEnvTestOrDevelopment && config.gcs.fakeGcsHost
        ? { apiEndpoint: `http://${config.gcs.fakeGcsHost}` }
        : {}),
    },
    s3: {
      region: config.s3.region,
      bucketName: config.s3.bucketName,
      ...(config.s3.endpoint ? { endpoint: config.s3.endpoint } : {}),
      ...(config.s3.accessKeyId
        ? { accessKeyId: config.s3.accessKeyId, secretAccessKey: config.s3.secretAccessKey }
        : {}),
    },
    azure: {
      containerName: config.azure.containerName,
      ...(config.azure.accountName ? { accountName: config.azure.accountName } : {}),
      ...(config.azure.endpoint ? { endpoint: config.azure.endpoint } : {}),
      ...(config.azure.connectionString ? { connectionString: config.azure.connectionString } : {}),
      ...(config.azure.sasToken ? { sasToken: config.azure.sasToken } : {}),
    },
  };
}

const cache = new Map<string, StorageService>();
let defaultService: StorageService | null = null;
let initPromise: Promise<void> | null = null;

/**
 * Ensure the default storage bucket exists.
 * In dev/test with fake-gcs-server, buckets aren't pre-created.
 */
export async function initStorage(): Promise<void> {
  if (!initPromise) {
    initPromise = withRetry(() => getStorageService().ensureBucketExists(), 'storage.ensureBucketExists')
      .catch(err => {
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
      defaultService = createStorageService(buildStorageConfig());
      logger.info(`[StorageServiceFactory] Created default ${config.fileStorage.provider} service`);
    }
    return defaultService;
  }

  const key = `${config.fileStorage.provider}:${bucketName}`;
  if (!cache.has(key)) {
    cache.set(key, createStorageService(buildStorageConfig(), bucketName));
    logger.info(`[StorageServiceFactory] Created ${config.fileStorage.provider} service for bucket: ${bucketName}`);
  }
  return cache.get(key)!;
}

/** Convenience: default singleton based on config */
export const storageService: StorageService = getStorageService();
