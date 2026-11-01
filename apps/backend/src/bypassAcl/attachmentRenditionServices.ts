import { asService } from './base';

/**
 * Relocated from queues/heicRenditionQueue.ts's processor. Background job → no request context;
 * opens the enqueuing request's workspace so the renditions are written under its storage key.
 */
export function generateHeicRenditionsInWorkspace<T>(workspaceId: string, run: () => Promise<T>): Promise<T> {
  return asService(
    [],
    'heic rendition job: background job has no request context, renditions are written under the workspace storage key',
    'heic-rendition-worker',
    workspaceId,
    run,
  );
}
