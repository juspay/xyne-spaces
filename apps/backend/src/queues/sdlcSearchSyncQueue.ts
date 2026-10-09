import Bull from 'bull';
import { logger } from '@/utils/logger';
import { redisService } from '@/services/redisService';

/**
 * Re-indexes one SDLC hub for search after a change in it. See
 * apps/backend/src/sdlc/search/sdlcHubSync.ts for what a sync does.
 *
 * A request names the hub, or an item whose hub the worker resolves (a Zero mutation or a
 * delete often knows only the item). Requests are debounced per target: a burst of changes
 * collapses into one sync a few seconds later.
 */
export type SdlcSearchSyncTarget =
  | { hubId: string }
  | { containerId: string }
  | { canvasId: string }
  | { repoId: string };

export type SdlcSearchSyncJobData = SdlcSearchSyncTarget & { reason?: string };

const TAG = '[SDLC-SEARCH-SYNC-QUEUE]';
const DEBOUNCE_MS = 3000;

function jobKey(target: SdlcSearchSyncTarget): string {
  if ('hubId' in target) return `hub-${target.hubId}`;
  if ('containerId' in target) return `container-${target.containerId}`;
  if ('canvasId' in target) return `canvas-${target.canvasId}`;
  return `repo-${target.repoId}`;
}

class SdlcSearchSyncQueue {
  private queue: Bull.Queue<SdlcSearchSyncJobData> | null = null;
  private initializing: Promise<void> | null = null;

  /** Idempotent; producers call it lazily, so any process that writes SDLC rows can enqueue. */
  initialize(): Promise<void> {
    if (this.queue) return Promise.resolve();
    if (!this.initializing) {
      this.initializing = (async () => {
        try {
          const queue = new Bull<SdlcSearchSyncJobData>('sdlc-search-sync', {
            redis: { ...redisService.getRedisConfig(), lazyConnect: false },
            defaultJobOptions: {
              attempts: 3,
              backoff: { type: 'exponential', delay: 5000 },
              // Removed on finish so the per-target job id can be reused by the next change.
              removeOnComplete: true,
              removeOnFail: 100,
            },
          });
          queue.on('failed', (job, err) => logger.error(`${TAG} Job ${job.id} failed:`, err));
          queue.on('error', err => logger.error(`${TAG} Queue error:`, err));
          this.queue = queue;
          logger.info(`${TAG} Initialized`);
        } finally {
          this.initializing = null;
        }
      })();
    }
    return this.initializing;
  }

  /**
   * Debounced per target: while a job for the same target is waiting, a new request is absorbed
   * by it. A request that arrives while that job is running gets one follow-up run, so a change
   * made during a sync is never missed.
   */
  async addJob(data: SdlcSearchSyncJobData): Promise<void> {
    await this.initialize();
    const queue = this.queue!;
    const key = jobKey(data);
    const existing = await queue.getJob(key);
    const state = existing ? await existing.getState() : null;
    if (state === 'waiting' || state === 'delayed') return;
    const jobId = state === 'active' ? `${key}-followup` : key;
    if (existing && state && state !== 'active') await existing.remove();
    await queue.add(data, { jobId, delay: DEBOUNCE_MS });
  }

  getQueue(): Bull.Queue<SdlcSearchSyncJobData> {
    if (!this.queue) throw new Error(`${TAG} Queue not initialized — call initialize() first`);
    return this.queue;
  }

  async close(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
      logger.info(`${TAG} Closed`);
    }
  }
}

export const sdlcSearchSyncQueue = new SdlcSearchSyncQueue();

/**
 * Ask for an SDLC hub's search entries to be refreshed. Fire-and-forget: indexing must never
 * fail the write that triggered it.
 */
export function requestSdlcSearchSync(target: SdlcSearchSyncTarget, reason?: string): void {
  void sdlcSearchSyncQueue.addJob({ ...target, ...(reason ? { reason } : {}) }).catch(err => {
    logger.warn(`${TAG} Failed to queue sync ${jobKey(target)}:`, err);
  });
}
