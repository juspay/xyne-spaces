import { storageService as defaultStorageService, type StorageService } from '../services/storage';
import { logger } from './logger';

interface CleanupProxiedFileOptions {
  logPrefix?: string;
  successMessage?: string;
  failureMessage?: string;
  storage?: StorageService;
}

export async function cleanupProxiedFile(
  file?: Express.Multer.File,
  options: CleanupProxiedFileOptions = {}
): Promise<void> {
  const storagePath = file?.path;
  if (!storagePath || !storagePath.startsWith('attachments/')) {
    return;
  }

  const {
    logPrefix = 'ATTACHMENT-UPLOAD',
    successMessage = 'Cleaned up proxied file after failed request',
    failureMessage = 'Failed to clean up proxied file after failed request',
    storage = defaultStorageService,
  } = options;

  try {
    await storage.deleteFile(storagePath);
    logger.info(`[${logPrefix}] ${successMessage}`, { storagePath });
  } catch (cleanupError) {
    logger.warn(`[${logPrefix}] ${failureMessage}`, {
      storagePath,
      error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
    });
  }
}
