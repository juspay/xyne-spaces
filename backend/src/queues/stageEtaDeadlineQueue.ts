import Bull from 'bull';
import { logger } from '@/utils/logger';
import { redisService } from '@/services/redisService';

// Job Types
export type StageEtaDeadlineJobType = 'check-stage-eta-deadlines';

export interface StageEtaDeadlineJobData {
  type: StageEtaDeadlineJobType;
}

const THIRTY_MIN_CRON = '*/30 * * * *';


class StageEtaDeadlineQueue {
  private queue: Bull.Queue<StageEtaDeadlineJobData> | null = null;
  private isInitialized = false;
  private isInitializing = false;

  async initialize(): Promise<void> {
    if (this.isInitialized || this.isInitializing) {
      return;
    }

    this.isInitializing = true;

    try {
      this.queue = new Bull<StageEtaDeadlineJobData>('stage-eta-deadline-check', {
        redis: {
          ...redisService.getRedisConfig(),
          lazyConnect: false,
        },
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000,
          },
          removeOnComplete: true,
          removeOnFail: false,
        },
      });

      this.setupEventListeners();

      await this.scheduleRepeatableJob();

      this.isInitialized = true;
      logger.info('[STAGE-ETA-DEADLINE] Queue initialized successfully');
    } catch (error) {
      logger.error('[STAGE-ETA-DEADLINE] Failed to initialize queue:', error);
      this.isInitialized = false;
    } finally {
      this.isInitializing = false;
    }
  }

  private async scheduleRepeatableJob(): Promise<void> {
    if (!this.queue) return;

    await this.queue.add(
      'check-stage-eta-deadlines',
      { type: 'check-stage-eta-deadlines' },
      {
        repeat: { cron: THIRTY_MIN_CRON },
        jobId: 'stage-eta-deadline-check-repeatable',
      }
    );
    logger.info('[STAGE-ETA-DEADLINE] Scheduled repeatable job: check-stage-eta-deadlines (every 30 mins)');
  }

  private setupEventListeners(): void {
    if (!this.queue) return;

    this.queue.on('failed', (job, error) => {
      logger.error(`[STAGE-ETA-DEADLINE] Job ${job.name} failed:`, error);
    });

    this.queue.on('error', (error) => {
      logger.error('[STAGE-ETA-DEADLINE] Queue error:', error);
    });

    this.queue.on('stalled', (job) => {
      logger.warn(`[STAGE-ETA-DEADLINE] Job ${job.name} stalled`);
    });
  }

  getQueue(): Bull.Queue<StageEtaDeadlineJobData> {
    if (!this.queue) {
      throw new Error(
        '[STAGE-ETA-DEADLINE] Queue not initialized — call initialize() first',
      );
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
      logger.info('[STAGE-ETA-DEADLINE] Queue closed');
    }
  }
}

export const stageEtaDeadlineQueue = new StageEtaDeadlineQueue();
