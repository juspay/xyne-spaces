import Bull from 'bull';
import { logger } from '@/utils/logger';

export interface BotJobData {
  executionId: string;
  conversationId: string;
  botName: string;
  input: any;
  userId: string;
}

class BotQueueService {
  private queue: Bull.Queue<BotJobData> | null = null;
  private isInitialized = false;

  constructor() {
    // Don't initialize in constructor
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return; // Already initialized
    }
    try {
      // Use the same Redis configuration as redisService
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

      this.queue = new Bull('bot-execution', {
        redis: redisConfig,
        defaultJobOptions: {
          removeOnComplete: 100, // Keep last 100 completed jobs
          removeOnFail: 50,      // Keep last 50 failed jobs
          attempts: 3,           // Retry failed jobs 3 times
          backoff: {
            type: 'exponential',
            delay: 2000,
          },
        },
        settings: {
          stalledInterval: 30 * 1000,    // 30 seconds
          maxStalledCount: 1,            // Max stalled jobs before failing
        }
      });

      // Set up event listeners
      this.queue.on('ready', () => {
        logger.info('Bot queue is ready');
      });

      this.queue.on('error', (error) => {
        logger.error('Bot queue error:', error);
      });

      this.queue.on('failed', (job, err) => {
        logger.error(`Bot job ${job.id} failed:`, err);
      });

      this.queue.on('completed', (job, result) => {
        logger.info(`Bot job ${job.id} completed:`, result);
      });

      this.queue.on('stalled', (job) => {
        logger.warn(`Bot job ${job.id} stalled`);
      });

      // Mark as initialized immediately - Bull queues are ready once created
      this.isInitialized = true;
      logger.info('Bot queue initialized successfully');

    } catch (error) {
      logger.error('Failed to initialize bot queue:', error);
      throw error;
    }
  }

  async queueBotExecution(data: BotJobData): Promise<Bull.Job<BotJobData> | null> {
    if (!this.queue || !this.isInitialized) {
      logger.error('Bot queue not initialized');
      return null;
    }

    try {
      const job = await this.queue.add('execute-bot', data, {
        jobId: data.executionId, // Use executionId as job ID for deduplication
        timeout: 2 * 60 * 60 * 1000, // 2 hours timeout
        delay: 0, // Execute immediately
      });

      logger.info(`Queued bot execution: ${data.executionId} for bot: ${data.botName}`);
      return job;
    } catch (error) {
      logger.error('Failed to queue bot execution:', error);
      return null;
    }
  }

  async getJob(executionId: string): Promise<Bull.Job<BotJobData> | null> {
    if (!this.queue) return null;
    
    try {
      return await this.queue.getJob(executionId);
    } catch (error) {
      logger.error(`Failed to get job ${executionId}:`, error);
      return null;
    }
  }

  async cancelExecution(executionId: string): Promise<boolean> {
    if (!this.queue) return false;

    try {
      const job = await this.queue.getJob(executionId);
      if (job) {
        await job.remove();
        logger.info(`Cancelled bot execution: ${executionId}`);
        return true;
      }
      return false;
    } catch (error) {
      logger.error(`Failed to cancel execution ${executionId}:`, error);
      return false;
    }
  }

  async getQueueStats(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  }> {
    if (!this.queue) {
      return { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 };
    }

    try {
      const [waiting, active, completed, failed, delayed] = await Promise.all([
        this.queue.getWaiting(),
        this.queue.getActive(),
        this.queue.getCompleted(),
        this.queue.getFailed(),
        this.queue.getDelayed(),
      ]);

      return {
        waiting: waiting.length,
        active: active.length,
        completed: completed.length,
        failed: failed.length,
        delayed: delayed.length,
      };
    } catch (error) {
      logger.error('Failed to get queue stats:', error);
      return { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 };
    }
  }

  async cleanupExpiredJobs(): Promise<void> {
    if (!this.queue) return;

    try {
      // Clean up jobs older than 24 hours
      const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
      await this.queue.clean(oneDayAgo, 'completed');
      await this.queue.clean(oneDayAgo, 'failed');
      
      logger.info('Cleaned up expired bot queue jobs');
    } catch (error) {
      logger.error('Failed to cleanup expired jobs:', error);
    }
  }

  async isHealthy(): Promise<boolean> {
    return this.isInitialized && this.queue !== null;
  }

  async shutdown(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
      logger.info('Bot queue shut down');
    }
  }

  // Get the queue instance for setting up processors
  getQueue(): Bull.Queue<BotJobData> | null {
    return this.queue;
  }
}

// Export singleton instance
export const botQueueService = new BotQueueService();