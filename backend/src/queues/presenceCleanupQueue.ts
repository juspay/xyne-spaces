import Bull from 'bull';
import { logger } from '@/utils/logger';
import { userStatusService } from '@/services/userStatusService';

export interface PresenceCleanupJobData {
  type: 'cleanup-inactive-users' | 'mark-user-offline';
  userId?: string;
}

// Cleanup interval - catches users whose disconnect didn't fire properly (default: 10 minutes)
const CLEANUP_INTERVAL_MS = parseInt(process.env.PRESENCE_CLEANUP_INTERVAL_MS || '600000', 10);

// Grace period before marking user offline after disconnect (default: 5 minutes)
const OFFLINE_GRACE_PERIOD_MS = parseInt(process.env.PRESENCE_OFFLINE_GRACE_PERIOD_MS || '300000', 10);

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
          lockDuration: 30000,
          stalledInterval: 30000,
          maxStalledCount: 2,
        },
      });

      this.setupProcessor();
      this.setupEventListeners();

      // Remove any existing repeatable jobs first, then schedule fresh
      await this.removeExistingRepeatableJobs();
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
    logger.info(`[PRESENCE-CLEANUP] Scheduled cleanup job every ${CLEANUP_INTERVAL_MS / 1000}s`);
  }

  private setupProcessor(): void {
    if (!this.queue) return;

    // Periodic cleanup for users whose TTL expired (handles server restarts, network issues, etc.)
    this.queue.process('cleanup-inactive-users', async () => {
      logger.info(`[PRESENCE-CLEANUP] Running cleanup job...`);
      const cleanedCount = await userStatusService.cleanupInactiveUsers();
      logger.info(`[PRESENCE-CLEANUP] Cleanup complete, cleaned ${cleanedCount} inactive users`);
    });

    // Delayed job for graceful offline after disconnect
    this.queue.process('mark-user-offline', async (job) => {
      const { userId } = job.data;
      if (!userId) {
        logger.warn('[PRESENCE-CLEANUP] mark-user-offline job missing userId');
        return;
      }
      
      logger.info(`[PRESENCE-CLEANUP] Grace period expired, marking user ${userId} offline`);
      await userStatusService.markUserOffline(userId);
    });
  }

  private setupEventListeners(): void {
    if (!this.queue) return;

    this.queue.on('failed', (job, error) => {
      logger.error(`[PRESENCE-CLEANUP] Job ${job.name} failed:`, error);
    });

    this.queue.on('error', (error) => {
      logger.error('[PRESENCE-CLEANUP] Queue error:', error);
    });
  }

  async close(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
      this.isInitialized = false;
      logger.info('[PRESENCE-CLEANUP] Queue closed');
    }
  }

  /**
   * Schedule a delayed job to mark user offline after grace period.
   * If user reconnects before grace period expires, cancel with cancelOfflineJob().
   */
  async scheduleOfflineJob(userId: string): Promise<void> {
    if (!this.queue) {
      logger.warn('[PRESENCE-CLEANUP] Queue not initialized, cannot schedule offline job');
      return;
    }

    const jobId = `mark-offline-${userId}`;
    
    // Remove any existing job for this user first
    const existingJob = await this.queue.getJob(jobId);
    if (existingJob) {
      await existingJob.remove();
    }

    await this.queue.add(
      'mark-user-offline',
      { type: 'mark-user-offline', userId },
      {
        delay: OFFLINE_GRACE_PERIOD_MS,
        jobId,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: true,
        removeOnFail: false,
      }
    );
    logger.info(`[PRESENCE-CLEANUP] Scheduled offline job for user ${userId} in ${OFFLINE_GRACE_PERIOD_MS / 1000}s`);
  }

  /**
   * Cancel a pending offline job if user reconnects within grace period.
   */
  async cancelOfflineJob(userId: string): Promise<boolean> {
    if (!this.queue) {
      return false;
    }

    const jobId = `mark-offline-${userId}`;
    const job = await this.queue.getJob(jobId);
    
    if (job) {
      await job.remove();
      logger.info(`[PRESENCE-CLEANUP] Cancelled offline job for user ${userId} (reconnected within grace period)`);
      return true;
    }
    
    return false;
  }
}

export const presenceCleanupQueue = new PresenceCleanupQueue();
