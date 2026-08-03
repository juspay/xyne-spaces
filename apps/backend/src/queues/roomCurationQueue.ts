import Bull from 'bull';
import { logger } from '@/utils/logger';
import { redisService } from '@/services/redisService';
import { config } from '@/config/env';

// Job Types
export const ROOM_CURATION_TICK_JOB = 'room-curation-tick';
export const ROOM_CURATION_ROOM_JOB = 'curate-room';

export interface RoomCurationJobData {
  roomId?: string;
  force?: boolean;
}

export const ROOM_CURATION_SCHEDULER_JOB_ID = 'room-curation-scheduler-repeatable';

class RoomCurationQueue {
  private queue: Bull.Queue<RoomCurationJobData> | null = null;
  private isInitialized = false;
  private isInitializing = false;

  async initialize(): Promise<void> {
    if (this.isInitialized || this.isInitializing) return;
    this.isInitializing = true;

    try {
      this.queue = new Bull<RoomCurationJobData>('room-curation', {
        redis: {
          ...redisService.getRedisConfig(),
          lazyConnect: false,
        },
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 30_000 },
          removeOnComplete: true,
          removeOnFail: 20,
        },
        settings: {
          lockDuration: 15 * 60 * 1000,
          stalledInterval: 60 * 1000,
          maxStalledCount: 1,
        },
      });

      this.setupEventListeners();

      this.isInitialized = true;
      logger.info('[ROOM-CURATION-QUEUE] Initialized');
    } catch (error) {
      logger.error('[ROOM-CURATION-QUEUE] Failed to initialize:', error);
      this.isInitialized = false;
    } finally {
      this.isInitializing = false;
    }
  }

  /**
   * Only the worker calls this. The API process initialises the queue as a producer, and
   * scheduling the tick there would queue jobs that no process in that pod consumes.
   */
  async scheduleRepeatableJob(): Promise<void> {
    if (!this.queue) return;

    if (!config.roomCuration.enabled) {
      logger.info(
        '[ROOM-CURATION-QUEUE] Room curation is disabled (ENABLE_ROOM_CURATION_WORKER=false) — skipping repeatable job'
      );
      return;
    }

    const cron = config.roomCuration.cron;

    // Remove only our own repeatable job so a CRON change takes effect,
    // leaving any other repeatable on this queue untouched.
    try {
      const repeatableJobs = await this.queue.getRepeatableJobs();
      for (const job of repeatableJobs) {
        if (job.id === ROOM_CURATION_SCHEDULER_JOB_ID) {
          await this.queue.removeRepeatableByKey(job.key);
        }
      }
    } catch (error) {
      logger.warn('[ROOM-CURATION-QUEUE] Failed to clean up existing repeatable job:', error);
    }

    await this.queue.add(
      ROOM_CURATION_TICK_JOB,
      {},
      {
        repeat: { cron },
        jobId: ROOM_CURATION_SCHEDULER_JOB_ID,
        removeOnComplete: true,
      }
    );
    logger.info(`[ROOM-CURATION-QUEUE] Scheduled repeatable job: ${ROOM_CURATION_TICK_JOB} (${cron})`);
  }

  private setupEventListeners(): void {
    if (!this.queue) return;

    this.queue.on('failed', (job, err) => {
      const discarded =
        (job as unknown as { isDiscarded?: () => boolean }).isDiscarded?.() === true;
      const willRetry = !discarded && job.attemptsMade < (job.opts.attempts ?? 1);
      logger.error(
        `[ROOM-CURATION-QUEUE] Job ${job.id} attempt ${job.attemptsMade} failed — room ${job.data.roomId}` +
          `${willRetry ? ' (will retry)' : ''}:`,
        err
      );
      if (willRetry) return;
      logger.error(
        `[ROOM-CURATION-QUEUE] Job ${job.id} gave up after ${job.attemptsMade} attempt(s) — room ${job.data.roomId} curation failed`
      );
    });

    this.queue.on('stalled', (job) => {
      logger.warn(`[ROOM-CURATION-QUEUE] Job ${job.id} stalled`);
    });

    this.queue.on('error', (err) => {
      logger.error('[ROOM-CURATION-QUEUE] Queue error:', err);
    });
  }

  getQueue(): Bull.Queue<RoomCurationJobData> {
    if (!this.queue) {
      throw new Error('[ROOM-CURATION-QUEUE] Queue not initialized — call initialize() first');
    }
    return this.queue;
  }

  get isReady(): boolean {
    return this.isInitialized && this.queue !== null;
  }

  async enqueueRoom(roomId: string, force = false): Promise<boolean> {
    const jobId = `room-curation-${roomId}`;
    const existing = await this.getQueue().getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state === 'waiting' || state === 'active' || state === 'delayed') {
        return false;
      }
      await existing.remove();
    }
    await this.getQueue().add(ROOM_CURATION_ROOM_JOB, { roomId, force }, { jobId });
    logger.info(`[ROOM-CURATION-QUEUE] Queued curation for room ${roomId} (job ${jobId})`);
    return true;
  }

  async close(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
      this.isInitialized = false;
      logger.info('[ROOM-CURATION-QUEUE] Closed');
    }
  }
}

export const roomCurationQueue = new RoomCurationQueue();
