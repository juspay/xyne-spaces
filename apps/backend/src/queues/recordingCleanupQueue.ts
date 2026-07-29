import Bull from 'bull';
import { logger } from '@/utils/logger';
import { callRecordingService } from '@/services/callRecordingService';

export interface RecordingCleanupJobData {
  type: 'cleanup-expired-recordings';
}

// Run daily at 3 AM UTC
const DAILY_3AM_CRON = '0 3 * * *';

class RecordingCleanupQueue {
  private queue: Bull.Queue<RecordingCleanupJobData> | null = null;
  private isInitialized = false;
  private isInitializing = false;

  async initialize(): Promise<void> {
    if (this.isInitialized || this.isInitializing) {
      return;
    }

    this.isInitializing = true;

    try {
      const redisConfig = {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
        maxRetriesPerRequest: 3,
        ...(process.env.REDIS_PASSWORD && { password: process.env.REDIS_PASSWORD }),
        ...(process.env.REDIS_TLS === 'true' && {
          tls: {
            rejectUnauthorized: false,
          },
        }),
      };

      this.queue = new Bull<RecordingCleanupJobData>('recording-cleanup', {
        redis: redisConfig,
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

      this.setupProcessor();
      this.setupEventListeners();
      await this.scheduleRepeatableJob();

      this.isInitialized = true;
      logger.info('[RECORDING-CLEANUP] Queue initialized successfully');
    } catch (error) {
      logger.error('[RECORDING-CLEANUP] Failed to initialize queue:', error);
      this.isInitialized = false;
    } finally {
      this.isInitializing = false;
    }
  }

  private async scheduleRepeatableJob(): Promise<void> {
    if (!this.queue) return;

    await this.queue.add(
      'cleanup-expired-recordings',
      { type: 'cleanup-expired-recordings' },
      {
        repeat: { cron: DAILY_3AM_CRON },
        jobId: 'recording-cleanup-repeatable',
      },
    );
    logger.info('[RECORDING-CLEANUP] Scheduled daily cleanup job (3 AM UTC)');
  }

  private setupProcessor(): void {
    if (!this.queue) return;

    this.queue.process('cleanup-expired-recordings', async () => {
      logger.info('[RECORDING-CLEANUP] Processing expired recording cleanup');
      await callRecordingService.cleanupExpiredRecordings();
      logger.info('[RECORDING-CLEANUP] Expired recording cleanup completed');
    });
  }

  private setupEventListeners(): void {
    if (!this.queue) return;

    this.queue.on('failed', (job, error) => {
      logger.error(`[RECORDING-CLEANUP] Job ${job.name} failed:`, error);
    });

    this.queue.on('error', (error) => {
      logger.error('[RECORDING-CLEANUP] Queue error:', error);
    });
  }

  async close(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
      this.isInitialized = false;
      logger.info('[RECORDING-CLEANUP] Queue closed');
    }
  }
}

export const recordingCleanupQueue = new RecordingCleanupQueue();
