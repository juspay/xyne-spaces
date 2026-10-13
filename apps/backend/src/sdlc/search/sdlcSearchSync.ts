import { logger } from '@/utils/logger';
import { vespaQueue } from '@/queues/vespaQueue';
import type { SdlcSearchSyncTarget } from '@/zero/vespa-injection/core/types';

export type { SdlcSearchSyncTarget };

/**
 * Asks for an SDLC hub's search entries to be refreshed after a change in it. See
 * sdlcHubSync.ts for what a sync does.
 *
 * A request names the hub, or an item whose hub the worker resolves (a Zero mutation or a
 * delete often knows only the item). It is queued on the Vespa ingestion queue
 * (vespaQueue.addSdlcSearchSync), debounced per target, and run by the Vespa worker
 * (runSdlcSearchSync), which queues the hub's document jobs like any other Vespa job.
 */
const TAG = '[SDLC-SEARCH-SYNC]';

function syncKey(target: SdlcSearchSyncTarget): string {
  if ('hubId' in target) return `hub-${target.hubId}`;
  if ('containerId' in target) return `container-${target.containerId}`;
  if ('canvasId' in target) return `canvas-${target.canvasId}`;
  return `repo-${target.repoId}`;
}

/** Fire-and-forget: indexing must never fail the write that triggered it. */
export function requestSdlcSearchSync(target: SdlcSearchSyncTarget, reason?: string): void {
  void (async () => {
    // Any process that writes SDLC rows can ask; one that has not started the queue starts it.
    if (!vespaQueue.isReady) await vespaQueue.initialize();
    await vespaQueue.addSdlcSearchSync({ ...target, ...(reason ? { reason } : {}) }, syncKey(target));
  })().catch(err => {
    logger.warn(`${TAG} Failed to queue sync ${syncKey(target)}:`, err);
  });
}
