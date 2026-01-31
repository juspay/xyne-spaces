import Bull from 'bull';
import { logger } from '@/utils/logger';
import { messageCountService } from '@/services/messageCountService';
import { userCountService } from '@/services/userCountService';
import { callCountService } from '@/services/callCountService';

export type MetricsSyncJobType = 
  | 'message-count-today'
  | 'user-count-today'
  | 'call-count-today'
  | 'call-duration-today'
  | 'message-count-all-time'
  | 'user-count-all-time'
  | 'call-count-all-time'
  | 'call-duration-all-time';

export interface MetricsSyncJobData {
  type: MetricsSyncJobType;
}

// Sync intervals
const ONE_HOUR_MS = 60 * 60 * 1000;
const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;

class MetricsSyncQueue {
  private queue: Bull.Queue<MetricsSyncJobData> | null = null;
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
            rejectUnauthorized: false
          }
        })
      };

      this.queue = new Bull<MetricsSyncJobData>('metrics-sync', {
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

      // Remove any existing repeatable jobs first to avoid duplicates
      await this.removeExistingRepeatableJobs();

      // Schedule all repeatable jobs
      await this.scheduleRepeatableJobs();

      this.isInitialized = true;
      logger.info('✓ MetricsSyncQueue initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize metrics sync queue:', error);
      this.isInitialized = false;
    } finally {
      this.isInitializing = false;
    }
  }

  private async removeExistingRepeatableJobs(): Promise<void> {
    if (!this.queue) return;

    try {
      const repeatableJobs = await this.queue.getRepeatableJobs();
      for (const job of repeatableJobs) {
        await this.queue.removeRepeatableByKey(job.key);
        logger.info(`🗑️ [METRICS-SYNC] Removed existing repeatable job: ${job.name}`);
      }
    } catch (error) {
      logger.error('Error removing existing repeatable jobs:', error);
    }
  }

  private async scheduleRepeatableJobs(): Promise<void> {
    if (!this.queue) return;

    // Schedule hourly sync for today's counts
    const todayJobs: MetricsSyncJobType[] = [
      'message-count-today',
      'user-count-today',
      'call-count-today',
      'call-duration-today',
    ];
    for (const jobType of todayJobs) {
      await this.queue.add(
        jobType,
        { type: jobType },
        {
          repeat: { every: ONE_HOUR_MS },
          jobId: `${jobType}-repeatable`,
        }
      );
      logger.info(`🔄 [METRICS-SYNC] Scheduled repeatable job: ${jobType} (every 1 hour)`);
    }

    // Schedule 48-hour sync for all-time counts
    const allTimeJobs: MetricsSyncJobType[] = [
      'message-count-all-time',
      'user-count-all-time',
      'call-count-all-time',
      'call-duration-all-time',
    ];
    for (const jobType of allTimeJobs) {
      await this.queue.add(
        jobType,
        { type: jobType },
        {
          repeat: { every: FORTY_EIGHT_HOURS_MS },
          jobId: `${jobType}-repeatable`,
        }
      );
      logger.info(`🔄 [METRICS-SYNC] Scheduled repeatable job: ${jobType} (every 48 hours)`);
    }
  }

  private setupProcessor(): void {
    if (!this.queue) return;

    // Process all job types
    this.queue.process('message-count-today', async () => {
      logger.info('🔄 [METRICS-SYNC] Processing message-count-today sync job');
      await messageCountService.syncWithDatabase();
      logger.info('✅ [METRICS-SYNC] message-count-today sync completed');
    });

    this.queue.process('user-count-today', async () => {
      logger.info('🔄 [METRICS-SYNC] Processing user-count-today sync job');
      await userCountService.syncWithDatabase();
      logger.info('✅ [METRICS-SYNC] user-count-today sync completed');
    });

    this.queue.process('call-count-today', async () => {
      logger.info('🔄 [METRICS-SYNC] Processing call-count-today sync job');
      await callCountService.syncWithDatabase();
      logger.info('✅ [METRICS-SYNC] call-count-today sync completed');
    });

    this.queue.process('call-duration-today', async () => {
      logger.info('🔄 [METRICS-SYNC] Processing call-duration-today sync job');
      await callCountService.syncDurationWithDatabase();
      logger.info('✅ [METRICS-SYNC] call-duration-today sync completed');
    });

    this.queue.process('message-count-all-time', async () => {
      logger.info('🔄 [METRICS-SYNC] Processing message-count-all-time sync job');
      await messageCountService.syncAllTimeWithDatabase();
      logger.info('✅ [METRICS-SYNC] message-count-all-time sync completed');
    });

    this.queue.process('user-count-all-time', async () => {
      logger.info('🔄 [METRICS-SYNC] Processing user-count-all-time sync job');
      await userCountService.syncAllTimeWithDatabase();
      logger.info('✅ [METRICS-SYNC] user-count-all-time sync completed');
    });

    this.queue.process('call-count-all-time', async () => {
      logger.info('🔄 [METRICS-SYNC] Processing call-count-all-time sync job');
      await callCountService.syncAllTimeWithDatabase();
      logger.info('✅ [METRICS-SYNC] call-count-all-time sync completed');
    });

    this.queue.process('call-duration-all-time', async () => {
      logger.info('🔄 [METRICS-SYNC] Processing call-duration-all-time sync job');
      await callCountService.syncAllTimeDurationWithDatabase();
      logger.info('✅ [METRICS-SYNC] call-duration-all-time sync completed');
    });
  }

  private setupEventListeners(): void {
    if (!this.queue) return;

    this.queue.on('failed', (job, error) => {
      logger.error(`❌ [METRICS-SYNC] Job ${job.name} failed:`, error);
    });

    this.queue.on('error', (error) => {
      logger.error('❌ [METRICS-SYNC] Queue error:', error);
    });

    this.queue.on('stalled', (job) => {
      logger.warn(`⚠️ [METRICS-SYNC] Job ${job.name} stalled`);
    });
  }

  /**
   * Run initial sync for all metrics (called on startup)
   */
  async runInitialSync(): Promise<void> {
    logger.info('🔄 [METRICS-SYNC] Running initial sync for all metrics...');

    try {
      // Run all syncs in parallel
      await Promise.all([
        messageCountService.syncWithDatabase(),
        userCountService.syncWithDatabase(),
        callCountService.syncWithDatabase(),
        callCountService.syncDurationWithDatabase(),
        messageCountService.syncAllTimeWithDatabase(),
        userCountService.syncAllTimeWithDatabase(),
        callCountService.syncAllTimeWithDatabase(),
        callCountService.syncAllTimeDurationWithDatabase(),
      ]);
      logger.info('✅ [METRICS-SYNC] Initial sync completed successfully');
    } catch (error) {
      logger.error('❌ [METRICS-SYNC] Initial sync failed:', error);
      // Don't throw - we still want the queue to run periodic syncs
    }
  }

  /**
   * Gracefully close the queue
   */
  async close(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
      this.isInitialized = false;
      logger.info('🛑 [METRICS-SYNC] Queue closed');
    }
  }
}

// Export singleton instance
export const metricsSyncQueue = new MetricsSyncQueue();
