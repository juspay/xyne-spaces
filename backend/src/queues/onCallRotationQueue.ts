import Bull from 'bull';
import { RotationInterval } from '@xyne/shared';
import { logger } from '@/utils/logger';
import { redisService } from '@/services/redisService';
import { DatabaseClient } from '@/database/client';
import {
  getTotalSets,
  getIntervalDays,
  calculateActiveSet,
  applyRotationForSet,
} from '@/utils/rotationEngine';

// Job Types
export type OnCallRotationJobType = 'on-call-rotations';

// PRODUCTION CONFIGURATION
const MIDNIGHT_CRON = '0 0 * * *';
const MS_PER_DAY = 24 * 60 * 60 * 1000;

class OnCallRotationQueue {
  private queue: Bull.Queue<{ type: OnCallRotationJobType }> | null = null;
  private isInitialized = false;
  private isInitializing = false;

  async initialize(): Promise<void> {
    if (this.isInitialized || this.isInitializing) {
      return;
    }

    this.isInitializing = true;

    try {
      const redisConfig = { ...redisService.getRedisConfig(), lazyConnect: false };

      this.queue = new Bull<{ type: OnCallRotationJobType }>('on-call-rotation', {
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

      // Schedule the repeatable job to run at midnight
      await this.scheduleRepeatableJob();

      this.isInitialized = true;
      logger.info('[ON-CALL-ROTATION] Queue initialized successfully');
    } catch (error) {
      logger.error('[ON-CALL-ROTATION] Failed to initialize queue:', error);
      this.isInitialized = false;
    } finally {
      this.isInitializing = false;
    }
  }

  private async scheduleRepeatableJob(): Promise<void> {
    if (!this.queue) return;

    // Remove any existing repeatable jobs to ensure the new cron takes effect
    const repeatableJobs = await this.queue.getRepeatableJobs();
    for (const job of repeatableJobs) {
      await this.queue.removeRepeatableByKey(job.key);
    }

    // Schedule repeatable job to run at midnight
    await this.queue.add(
      'on-call-rotations',
      { type: 'on-call-rotations' },
      {
        repeat: { cron: MIDNIGHT_CRON },
        jobId: 'on-call-rotation-check-repeatable',
      }
    );
    logger.info('[ON-CALL-ROTATION] Scheduled repeatable job: on-call-rotations (midnight daily)');
  }

  private setupProcessor(): void {
    if (!this.queue) return;

    // Use named processor - matches working queues like etaDeadlineQueue
    this.queue.process('on-call-rotations', async (job) => {
      logger.info(`[ON-CALL-ROTATION] Processing job ${job.id}`);
      await this.checkAndApplyRotations();
      logger.info(`[ON-CALL-ROTATION] Job ${job.id} completed`);
    });
  }

  private setupEventListeners(): void {
    if (!this.queue) return;

    this.queue.on('failed', (job, error) => {
      logger.error(`[ON-CALL-ROTATION] Job ${job.id} failed:`, error);
    });

    this.queue.on('error', (error) => {
      logger.error('[ON-CALL-ROTATION] Queue error:', error);
    });

    this.queue.on('stalled', (job) => {
      logger.warn(`[ON-CALL-ROTATION] Job ${job.id} stalled`);
    });

    this.queue.on('active', (job) => {
      logger.info(`[ON-CALL-ROTATION] Job ${job.id} started processing`);
    });

    this.queue.on('completed', (job) => {
      logger.info(`[ON-CALL-ROTATION] Job ${job.id} completed`);
    });
  }

  /**
   * Check all user groups with auto-rotation enabled and apply rotations
   * where the interval has been reached
   */
  private async checkAndApplyRotations(): Promise<void> {
    const prisma = DatabaseClient.getInstance();
    const now = new Date();

    try {
      // Get all user groups with auto-rotation enabled
      const groups = await prisma.userGroup.findMany({
        where: {
          autoRotationEnabled: true,
          rotationStartDate: { not: null },
        },
      });


      for (const group of groups) {
        if (!group.rotationStartDate || !group.rotationInterval) continue;

        const daysElapsed = Math.round((now.getTime() - group.rotationStartDate.getTime()) / MS_PER_DAY);
        if (daysElapsed < 0) continue;

        const intervalDays = getIntervalDays(group.rotationInterval as RotationInterval);

        if (daysElapsed % intervalDays === 0) {
          logger.info(`[ON-CALL-ROTATION] Rotating group ${group.id} (${group.name})`);
          await this.applyRotationForGroup(group.id, group.rotationStartDate, group.rotationInterval as RotationInterval, daysElapsed);
        }
      }
    } catch (error) {
      logger.error('[ON-CALL-ROTATION] Error checking rotations:', error);
      throw error;
    }
  }

  /**
   * Apply rotation for a specific user group.
   * Only updates onCall field, never mutates isActiveForAssignment.
   */
  private async applyRotationForGroup(
    userGroupId: string,
    rotationStartDate: Date,
    interval: RotationInterval,
    daysElapsed?: number
  ): Promise<void> {
    try {
      const totalSets = await getTotalSets(userGroupId);
      const activeSet = calculateActiveSet(rotationStartDate, totalSets, interval, daysElapsed);
      const updatedCount = await applyRotationForSet(userGroupId, activeSet);

      logger.info(`[ON-CALL-ROTATION] Applied rotation for group ${userGroupId}: ${updatedCount} users updated`);
    } catch (error) {
      logger.error(`[ON-CALL-ROTATION] Error applying rotation for group ${userGroupId}:`, error);
      throw error;
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
      logger.info('[ON-CALL-ROTATION] Queue closed');
    }
  }
}

// Export singleton instance
export const onCallRotationQueue = new OnCallRotationQueue();