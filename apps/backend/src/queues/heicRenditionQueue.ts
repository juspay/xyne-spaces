import Bull from 'bull';
import { createHash } from 'crypto';
import { logger } from '@/utils/logger';
import { redisService } from '@/services/redisService';
import { storageService } from '@/services/storage';
import { generateHeicRenditions } from '@/services/heicRenditionService';

const QUEUE_NAME = 'heic-renditions';
const JOB_NAME = 'generate-heic-renditions';

export type HeicRenditionJob = {
  storagePath: string;
};

// Bounds in-flight jobs, i.e. peak RGBA memory — not parallelism: the libheif
// WASM decode is synchronous, so concurrent jobs still decode one at a time
// on this process's single thread. That is acceptable here because this
// worker is dedicated to this queue; it was not acceptable on the API's
// request path, which is why generation moved here.
const WORKER_CONCURRENCY = 2;

/**
 * HEIC → WebP rendition generation for chat attachments.
 *
 * The API enqueues (at upload time, and on read misses as a fallback) and
 * never decodes on the request path: the synchronous WASM decode takes
 * seconds per photo and would stall the API's event loop for its whole
 * duration. Like the stitch worker, the decode blocks THIS process's event
 * loop while it runs — a busy deployment should isolate it on a dedicated
 * node that enables only ENABLE_HEIC_RENDITION_WORKER.
 */
class HeicRenditionQueue {
  private queue: Bull.Queue<HeicRenditionJob> | null = null;
  private isInitialized = false;
  private processorRegistered = false;

  /** Call once at startup, in both the API (producer) and worker (consumer) processes. */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    try {
      this.queue = new Bull<HeicRenditionJob>(QUEUE_NAME, {
        redis: { ...redisService.getRedisConfig(), lazyConnect: false },
        defaultJobOptions: {
          attempts: 1,
          removeOnComplete: true,
          removeOnFail: true,
        },
      });
      this.queue.on('error', err => logger.error('[HeicRenditionQueue] error:', err));
      this.isInitialized = true;
      logger.info('[HeicRenditionQueue] Initialized');
    } catch (err) {
      logger.error('[HeicRenditionQueue] Failed to initialize:', err);
    }
  }

  getQueue(): Bull.Queue<HeicRenditionJob> | null {
    return this.queue;
  }

  /**
   * Queue rendition generation for an HEIC original. Deduplicated by storage
   * path while a job for it is waiting or active, so upload-time enqueue plus
   * concurrent first viewers collapse into one decode.
   * Fire-and-forget safe: initializes on first use and never throws — a lost
   * enqueue only delays generation until the next read miss re-enqueues.
   */
  async enqueueRenditions(job: HeicRenditionJob): Promise<void> {
    try {
      if (!this.isInitialized) await this.initialize();
      if (!this.queue) return;
      const jobId = createHash('sha256').update(job.storagePath).digest('hex');
      await this.queue.add(JOB_NAME, job, { jobId });
    } catch (err) {
      logger.warn('[HeicRenditionQueue] Failed to enqueue rendition job', {
        storagePath: job.storagePath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** Register the consumer. Call after initialize(), in the worker process. */
  startProcessing(concurrency: number = WORKER_CONCURRENCY): void {
    if (!this.queue || this.processorRegistered) return;
    this.processorRegistered = true;

    void this.queue.process(JOB_NAME, concurrency, async job => {
      await generateHeicRenditions(storageService, job.data.storagePath);
    });

    logger.info('[HeicRenditionQueue] Processor registered', { concurrency });
  }

  async shutdown(): Promise<void> {
    if (!this.queue) return;
    // Let in-flight decodes finish rather than killing them mid-WASM-call.
    await this.queue.close();
    this.queue = null;
    this.isInitialized = false;
    this.processorRegistered = false;
    logger.info('[HeicRenditionQueue] Shut down');
  }
}

export const heicRenditionQueue = new HeicRenditionQueue();
