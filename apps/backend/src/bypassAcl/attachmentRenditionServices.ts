import { storageService } from '@/services/storage';
import { generateHeicRenditions } from '@/services/heicRenditionService';
import { asService } from './base';

/**
 * Relocated from queues/heicRenditionQueue.ts's processor. Background job → no request context;
 * opens the enqueuing request's workspace so the renditions are written under its storage key.
 */
export function generateHeicRenditionsInWorkspace(workspaceId: string, storagePath: string): Promise<void> {
  return asService(
    [],
    'heic rendition job: background job has no request context, renditions are written under the workspace storage key',
    'heic-rendition-worker',
    workspaceId,
    () => generateHeicRenditions(storageService, storagePath),
  );
}
