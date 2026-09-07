import Bull from 'bull';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { redisService } from '@/services/redisService';

export interface RadarExecutionJobData {
  conversationId: string;
}

/** Per-thread quiet period before a window is parsed: how fast Radar reacts,
 *  and how many messages one parse covers. */
const DEBOUNCE_MS = config.radar.debounceMs;

export function isRadarExecutionEnabled(): boolean {
  return config.radar.enabled;
}

class RadarExecutionQueue {
  private queue: Bull.Queue<RadarExecutionJobData> | null = null;
  private isInitialized = false;
  private isInitializing = false;

  async initialize(): Promise<void> {
    if (this.isInitialized || this.isInitializing) return;
    this.isInitializing = true;

    try {
      this.queue = new Bull<RadarExecutionJobData>('radar-execution', {
        redis: {
          ...redisService.getRedisConfig(),
          lazyConnect: false,
        },
        defaultJobOptions: {
          attempts: 2,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: true,
          // Deviates from the repo's removeOnFail:false convention on purpose:
          // jobId is a stable, reused conversationId, so a retained failed job
          // would silently block that thread's enqueues forever (Bull ignores
          // adds whose jobId exists in any state). Failures are logged by the
          // 'failed' listener below instead.
          removeOnFail: true,
        },
        settings: {
          lockDuration: 2 * 60 * 1000,
          stalledInterval: 60 * 1000,
          maxStalledCount: 1,
        },
      });

      this.setupEventListeners();
      this.isInitialized = true;
      logger.info('[RADAR-EXECUTION-QUEUE] Initialized');
    } catch (error) {
      logger.error('[RADAR-EXECUTION-QUEUE] Failed to initialize:', error);
      this.isInitialized = false;
    } finally {
      this.isInitializing = false;
    }
  }

  /**
   * Enqueue a "something happened in this thread" signal. Fire-and-forget by
   * contract: never throws, so the chat write path can never be blocked.
   *
   * jobId = conversationId + delay gives per-thread debounce: while a job for
   * this thread is delayed/waiting/active, further adds are no-ops, and the
   * worker reads everything above the thread's watermark when the job runs.
   */
  async enqueueThread(conversationId: string): Promise<void> {
    if (!isRadarExecutionEnabled()) return;

    try {
      if (!this.isInitialized) {
        await this.initialize();
      }
      if (!this.queue) return;

      await this.queue.add(
        { conversationId },
        { jobId: conversationId, delay: DEBOUNCE_MS },
      );
    } catch (error) {
      logger.error('[RADAR-EXECUTION-QUEUE] Failed to enqueue thread:', {
        conversationId,
        error,
      });
    }
  }

  private setupEventListeners(): void {
    if (!this.queue) return;

    this.queue.on('failed', (job, err) => {
      logger.error(
        `[RADAR-EXECUTION-QUEUE] Job ${job.id} failed — conversation ${job.data.conversationId}:`,
        err,
      );
    });

    this.queue.on('stalled', job => {
      logger.warn(`[RADAR-EXECUTION-QUEUE] Job ${job.id} stalled — conversation ${job.data.conversationId}`);
    });

    this.queue.on('error', err => {
      logger.error('[RADAR-EXECUTION-QUEUE] Queue error:', err);
    });
  }

  getQueue(): Bull.Queue<RadarExecutionJobData> {
    if (!this.queue) {
      throw new Error('[RADAR-EXECUTION-QUEUE] Queue not initialized — call initialize() first');
    }
    return this.queue;
  }

  get isReady(): boolean {
    return this.isInitialized && this.queue !== null;
  }

  async close(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
      this.isInitialized = false;
      logger.info('[RADAR-EXECUTION-QUEUE] Closed');
    }
  }
}

export const radarExecutionQueue = new RadarExecutionQueue();
