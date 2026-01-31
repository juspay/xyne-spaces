import Bull from 'bull';
import { logger } from '@/utils/logger';
import { userStatusService } from '@/services/userStatusService';

export interface PresenceCleanupJobData {
  type: 'cleanup-inactive-users';
}

const CLEANUP_INTERVAL_MS = 300 * 1000; // 300 seconds (5 minutes) - acts as grace period before marking offline

class PresenceCleanupQueue {
  private queue: Bull.Queue<PresenceCleanupJobData> | null = null;
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

      this.queue = new Bull<PresenceCleanupJobData>('presence-cleanup', {
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
        settings: {
          lockDuration: 30000,      // Lock expires after 30s
          stalledInterval: 30000,   // Check for stalled jobs every 30s
          maxStalledCount: 2,       // Mark as failed after 2 stalls
        },
      });

      this.setupProcessor();
      this.setupEventListeners();

      // Remove any existing repeatable jobs first
      await this.removeExistingRepeatableJobs();

      // Schedule repeatable cleanup job
      await this.scheduleRepeatableJob();

      this.isInitialized = true;
      logger.info('✓ PresenceCleanupQueue initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize presence cleanup queue:', error);
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
        logger.info(`🗑️ [PRESENCE-CLEANUP] Removed existing repeatable job: ${job.name}`);
      }
    } catch (error) {
      logger.error('Error removing existing repeatable jobs:', error);
    }
  }

  private async scheduleRepeatableJob(): Promise<void> {
    if (!this.queue) return;

    await this.queue.add(
      'cleanup-inactive-users',
      { type: 'cleanup-inactive-users' },
      {
        repeat: { every: CLEANUP_INTERVAL_MS },
        jobId: 'presence-cleanup-repeatable',
      }
    );
    logger.info(`🔄 [PRESENCE-CLEANUP] Scheduled repeatable job: cleanup-inactive-users (every 5 minutes)`);
  }

  private setupProcessor(): void {
    if (!this.queue) return;

    this.queue.process('cleanup-inactive-users', async () => {
      logger.info('🧹 [PRESENCE-CLEANUP] Starting cleanup job');
      const cleanedCount = await userStatusService.cleanupInactiveUsers();
      logger.info(`✅ [PRESENCE-CLEANUP] Cleanup completed: ${cleanedCount} users marked offline`);
    });
  }

  private setupEventListeners(): void {
    if (!this.queue) return;

    this.queue.on('failed', (job, error) => {
      logger.error(`❌ [PRESENCE-CLEANUP] Job ${job.name} failed:`, error);
    });

    this.queue.on('error', (error) => {
      logger.error('❌ [PRESENCE-CLEANUP] Queue error:', error);
    });

    this.queue.on('stalled', (job) => {
      logger.warn(`⚠️ [PRESENCE-CLEANUP] Job ${job.name} stalled - will retry`);
    });

    this.queue.on('active', (job) => {
      logger.debug(`🔄 [PRESENCE-CLEANUP] Job ${job.name} started processing`);
    });

    this.queue.on('completed', (job) => {
      logger.debug(`✅ [PRESENCE-CLEANUP] Job ${job.name} completed successfully`);
    });
  }

  async close(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
      this.isInitialized = false;
      logger.info('🛑 [PRESENCE-CLEANUP] Queue closed');
    }
  }
}

export const presenceCleanupQueue = new PresenceCleanupQueue();
