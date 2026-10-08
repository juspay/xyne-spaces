import { logger } from '@/utils/logger';
import { requestSdlcSearchSync, sdlcSearchSyncQueue } from '@/queues/sdlcSearchSyncQueue';
import { vespaQueue } from '@/queues/vespaQueue';
import { sdlcRepositorySchema } from '@/vespa/src/types';
import { hubsOfSyncTarget, syncSdlcHub } from '@/sdlc/search/sdlcHubSync';

const TAG = '[SdlcSearchSyncWorker]';

/**
 * Runs SDLC hub search syncs. Lives in the API process, like the board config copy worker:
 * syncs are occasional and light (they only queue Vespa jobs, which the Vespa workers run).
 */
export class SdlcSearchSyncWorker {
  private isStarted = false;

  start(): void {
    if (this.isStarted) return;
    const queue = sdlcSearchSyncQueue.getQueue();
    queue.process(async job => {
      const hubIds = await hubsOfSyncTarget(job.data);
      // A repository in no hub (detached from its last one) has no hub to sync; re-feed it
      // directly so its hubIds empty out.
      if ('repoId' in job.data && hubIds.length === 0) {
        await vespaQueue.addJob({ schema: sdlcRepositorySchema, jobType: 'feed', docId: job.data.repoId });
      }
      // A request that named an item becomes a request for its hub, so a burst of writes to
      // different items of one hub collapses into that hub's one debounced sync.
      if (!('hubId' in job.data)) {
        for (const hubId of hubIds) requestSdlcSearchSync({ hubId }, job.data.reason);
        return [];
      }
      const results = [];
      for (const hubId of hubIds) {
        results.push(await syncSdlcHub(hubId));
      }
      return results;
    });
    this.isStarted = true;
    logger.info(`${TAG} Started`);
  }
}

export const sdlcSearchSyncWorker = new SdlcSearchSyncWorker();
