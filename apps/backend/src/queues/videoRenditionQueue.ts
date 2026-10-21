import Bull from 'bull';
import { createHash } from 'crypto';
import { logger } from '@/utils/logger';
import { redisService } from '@/services/redisService';
import { storageService } from '@/services/storage';
import { generateVideoRendition } from '@/services/videoRenditionService';

const QUEUE_NAME = 'video-renditions';
const JOB_NAME = 'generate-video-rendition';

export type VideoRenditionJob = {
  storagePath: string;
};

/**
 * One ffmpeg transcode at a time per worker process: it is CPU-bound (ffmpeg
 * is capped at 2 threads) and runs in a child process, so the host event loop
 * stays free, but parallel encodes would just contend for the same cores.
 */
const WORKER_CONCURRENCY = 1;

/** Bull's stalled-job check must outlast the longest transcode timeout (30 min). */
const LOCK_DURATION_MS = 35 * 60_000;

/**
 * Compatible (H.264 SDR) video rendition generation for chat attachments.
 *
 * The API only enqueues (on `/stream?variant=compat` misses, and at upload time
 * when VIDEO_RENDITION_ON_UPLOAD is on). The consumer runs only where
 * ENABLE_VIDEO_RENDITION_WORKER=true, so ffmpeg never runs on API pods.
 */
class VideoRenditionQueue {
  private queue: Bull.Queue<VideoRenditionJob> | null = null;
  private isInitialized = false;
  private processorRegistered = false;

  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    try {
      this.queue = new Bull<VideoRenditionJob>(QUEUE_NAME, {
        redis: { ...redisService.getRedisConfig(), lazyConnect: false },
        settings: { lockDuration: LOCK_DURATION_MS, maxStalledCount: 1 },
        defaultJobOptions: {
          attempts: 1,
          removeOnComplete: true,
          removeOnFail: true,
        },
      });
      this.queue.on('error', (err) => logger.error('[VideoRenditionQueue] error:', err));
      this.isInitialized = true;
      logger.info('[VideoRenditionQueue] Initialized');
    } catch (err) {
      logger.error('[VideoRenditionQueue] Failed to initialize:', err);
    }
  }

  getQueue(): Bull.Queue<VideoRenditionJob> | null {
    return this.queue;
  }

  /**
   * Queue generation for a video original. Deduplicated by storage path while a
   * job is waiting or active, so an upload-time enqueue plus many concurrent
   * first viewers collapse into one transcode. Never throws.
   */
  async enqueue(job: VideoRenditionJob): Promise<void> {
    try {
      if (!this.isInitialized) await this.initialize();
      if (!this.queue) return;
      const jobId = createHash('sha256').update(job.storagePath).digest('hex');
      await this.queue.add(JOB_NAME, job, { jobId });
    } catch (err) {
      logger.warn('[VideoRenditionQueue] Failed to enqueue rendition job', {
        storagePath: job.storagePath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** Waiting + delayed jobs — exported for backlog alerting. */
  async getBacklog(): Promise<number> {
    if (!this.queue) return 0;
    const counts = await this.queue.getJobCounts();
    return (counts.waiting ?? 0) + (counts.delayed ?? 0);
  }

  startProcessing(concurrency: number = WORKER_CONCURRENCY): void {
    if (!this.queue || this.processorRegistered) return;
    this.processorRegistered = true;

    void this.queue.process(JOB_NAME, concurrency, async (job) => {
      const outcome = await generateVideoRendition(storageService, job.data.storagePath);
      logger.info('[VideoRenditionQueue] Job finished', { jobId: job.id, outcome });
    });

    logger.info('[VideoRenditionQueue] Processor registered', { concurrency });
  }

  async shutdown(): Promise<void> {
    if (!this.queue) return;
    await this.queue.close();
    this.queue = null;
    this.isInitialized = false;
    this.processorRegistered = false;
    logger.info('[VideoRenditionQueue] Shut down');
  }
}

export const videoRenditionQueue = new VideoRenditionQueue();
