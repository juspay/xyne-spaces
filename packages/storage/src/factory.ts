import { GCSService } from './gcsService.js';
import { GCSAdapter } from './gcsAdapter.js';
import { S3StorageService } from './s3StorageService.js';
import type { StorageConfig, StorageService } from './types.js';

export function createStorageService(cfg: StorageConfig, bucketName?: string): StorageService {
  if (cfg.provider === 's3') {
    if (!cfg.s3) throw new Error('StorageConfig.provider is "s3" but no s3 config was provided');
    return new S3StorageService(cfg.s3, bucketName);
  }
  if (!cfg.gcs) throw new Error('StorageConfig.provider is "gcs" but no gcs config was provided');
  return new GCSAdapter(new GCSService(cfg.gcs, bucketName));
}
