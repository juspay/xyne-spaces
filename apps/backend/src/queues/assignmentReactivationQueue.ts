import Bull from 'bull';
import { logger } from '@/utils/logger';
import { userAssignmentStateService } from '@/services/userAssignmentStateService';

export interface AssignmentReactivationJobData {
  type: 'reactivate-assignment';
  userId: string;
}

class AssignmentReactivationQueue {
  private queue: Bull.Queue<AssignmentReactivationJobData> | null = null;
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

      this.queue = new Bull<AssignmentReactivationJobData>('assignment-reactivation', {
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

      this.isInitialized = true;
      logger.info('✓ AssignmentReactivationQueue initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize assignment reactivation queue:', error);
      this.isInitialized = false;
    } finally {
      this.isInitializing = false;
    }
  }

  /**
   * Schedule a restoration job for a user (when assignmentUnavailableUntil expires)
   * @param userId - User ID
   * @param unavailableUntil - Timestamp when user will be available again
   */
  async scheduleReactivation(userId: string, unavailableUntil: number): Promise<void> {
    if (!this.queue) {
      throw new Error('Queue not initialized');
    }

    try {
      // Cancel any existing job first
      await this.cancelReactivation(userId);

      // Calculate delay in milliseconds
      const delay = unavailableUntil - Date.now();

      if (delay <= 0) {
        // If time has already passed, restore immediately
        logger.warn(
          `⚠️ [ASSIGNMENT-REACTIVATION] Restoration time has passed, restoring immediately for user ${userId}`
        );
        await userAssignmentStateService.setAvailableForAssignment(userId);
        return;
      }

      // Create unique job ID (one job per user)
      const jobId = `restore-assignment-${userId}`;

      await this.queue.add(
        'reactivate-assignment',
        {
          type: 'reactivate-assignment',
          userId,
        },
        {
          jobId,
          delay, // Schedule job to run at unavailableUntil
        }
      );

      logger.info(
        `⏰ [ASSIGNMENT-REACTIVATION] Scheduled restoration for user ${userId} at ${new Date(unavailableUntil).toISOString()}`
      );
    } catch (error) {
      logger.error(`❌ [ASSIGNMENT-REACTIVATION] Error scheduling restoration:`, error);
      throw error;
    }
  }

  /**
   * Cancel a scheduled restoration job
   * @param userId - User ID
   */
  async cancelReactivation(userId: string): Promise<void> {
    if (!this.queue) {
      return;
    }

    try {
      const jobId = `restore-assignment-${userId}`;
      const job = await this.queue.getJob(jobId);

      if (job) {
        await job.remove();
        logger.info(`🗑️ [ASSIGNMENT-REACTIVATION] Cancelled restoration job for user ${userId}`);
      }
    } catch (error) {
      logger.error(`❌ [ASSIGNMENT-REACTIVATION] Error cancelling restoration:`, error);
      // Don't throw - this is a cleanup operation
    }
  }

  private setupProcessor(): void {
    if (!this.queue) return;

    this.queue.process('reactivate-assignment', async (job) => {
      const { userId } = job.data;
      logger.info(`🔄 [ASSIGNMENT-REACTIVATION] Processing restoration for user ${userId}`);
      await userAssignmentStateService.setAvailableForAssignment(userId);
      logger.info(`✅ [ASSIGNMENT-REACTIVATION] Restoration completed for user ${userId}`);
    });
  }

  private setupEventListeners(): void {
    if (!this.queue) return;

    this.queue.on('failed', (job, error) => {
      logger.error(`❌ [ASSIGNMENT-REACTIVATION] Job ${job?.id} failed:`, error);
    });

    this.queue.on('error', (error) => {
      logger.error('❌ [ASSIGNMENT-REACTIVATION] Queue error:', error);
    });

    this.queue.on('stalled', (job) => {
      logger.warn(`⚠️ [ASSIGNMENT-REACTIVATION] Job ${job?.id} stalled - will retry`);
    });

    this.queue.on('active', (job) => {
      logger.debug(`🔄 [ASSIGNMENT-REACTIVATION] Job ${job.id} started processing`);
    });

    this.queue.on('completed', (job) => {
      logger.debug(`✅ [ASSIGNMENT-REACTIVATION] Job ${job.id} completed successfully`);
    });
  }

  async close(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
      this.isInitialized = false;
      logger.info('🛑 [ASSIGNMENT-REACTIVATION] Queue closed');
    }
  }
}

export const assignmentReactivationQueue = new AssignmentReactivationQueue();
