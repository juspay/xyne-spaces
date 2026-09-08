// GCS, S3 and Azure Blob through @xyne/storage, the same adapters the backend
// uses. Each SDK resolves its own credentials (Application Default
// Credentials, the AWS default provider chain, DefaultAzureCredential), so
// Workload Identity, IRSA, managed identity, mounted keys and environment
// variables all work unchanged.
import { createStorageService, type StorageConfig, type StorageService } from '@xyne/storage';

import type { Config } from '../config.js';
import type { Origin } from './types.js';

function storageConfigFor(cfg: Config['storage'], bucketName: string): StorageConfig {
  switch (cfg.backend) {
    case 's3':
      return {
        provider: 's3',
        s3: {
          region: cfg.awsRegion ?? process.env.AWS_DEFAULT_REGION ?? 'us-east-1',
          bucketName,
          ...(cfg.endpoint ? { endpoint: cfg.endpoint } : {}),
        },
      };
    case 'azure': {
      const endpoint =
        cfg.endpoint ??
        (cfg.azureAccount ? `https://${cfg.azureAccount}.blob.core.windows.net` : undefined);
      if (!endpoint) {
        throw new Error(
          'AZURE_STORAGE_ACCOUNT or STORAGE_ENDPOINT is required for STORAGE_BACKEND=azure',
        );
      }
      const sasToken = cfg.auth === 'sas' ? (cfg.azureSasToken ?? '').replace(/^\?/, '') : '';
      if (cfg.auth === 'sas' && !sasToken) {
        throw new Error('AZURE_STORAGE_SAS_TOKEN is required for STORAGE_AUTH=sas');
      }
      return {
        provider: 'azure',
        azure: {
          containerName: bucketName,
          endpoint,
          ...(sasToken ? { sasToken } : {}),
          ...(cfg.auth === 'none' ? { anonymous: true } : {}),
        },
      };
    }
    default:
      return {
        provider: 'gcs',
        gcs: {
          bucketName,
          ...(cfg.gcpProject ? { projectId: cfg.gcpProject } : {}),
          ...(cfg.endpoint ? { apiEndpoint: cfg.endpoint } : {}),
        },
      };
  }
}

export function createStorageOrigin(cfg: Config['storage']): Origin {
  const bucketName = cfg.bucket as string;
  const storageConfig = storageConfigFor(cfg, bucketName);
  const service: StorageService = createStorageService(storageConfig, bucketName);

  const endpoint =
    storageConfig.azure?.endpoint ??
    cfg.endpoint ??
    (cfg.backend === 's3' ? 'aws default' : 'https://storage.googleapis.com');

  return {
    kind: cfg.backend,
    describe: () => ({
      backend: cfg.backend,
      bucket: bucketName,
      endpoint,
      auth: cfg.auth,
      ...(cfg.backend === 's3' ? { region: storageConfig.s3?.region } : {}),
    }),
    head: (key) => service.headObject(key),
    get: (key) => service.getObject(key),
  };
}
