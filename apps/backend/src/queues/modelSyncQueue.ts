import Bull from 'bull';
import { logger } from '@/utils/logger';
import { modelSyncService } from '@/services/modelSyncService';
import { redisService } from '@/services/redisService';

export type ModelSyncJobType = 'sync-litellm-models';

export interface ModelSyncJobData {
  type: ModelSyncJobType;
}

class ModelSyncQueue {
  private queue: Bull.Queue<ModelSyncJobData> | null = null;
  private isInitialized = false;
  private isInitializing = false;

  async initialize(): Promise<void> {
    if (this.isInitialized || this.isInitializing) {
      return;
    }

    this.isInitializing = true;

    try {
      this.queue = new Bull<ModelSyncJobData>('model-sync', {
        redis: redisService.getRedisConfig(),
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

      await this.removeExistingRepeatableJobs();
      await this.scheduleRepeatableJobs();

      this.isInitialized = true;
      logger.info('[MODEL-SYNC] ModelSyncQueue initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize model sync queue:', error);
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
        logger.info(`[MODEL-SYNC] Removed existing repeatable job: ${job.name}`);
      }
    } catch (error) {
      logger.error('[MODEL-SYNC] Error removing existing repeatable jobs:', error);
    }
  }

  private async scheduleRepeatableJobs(): Promise<void> {
    if (!this.queue) return;

    await this.queue.add(
      'sync-litellm-models',
      { type: 'sync-litellm-models' },
      {
        repeat: { 
          cron: '0 0 * * *',
        },
        jobId: 'sync-litellm-models-repeatable',
      }
    );
    logger.info('[MODEL-SYNC] Scheduled repeatable job: sync-litellm-models (daily at midnight)');
  }

  private setupProcessor(): void {
    if (!this.queue) return;

    this.queue.process('sync-litellm-models', async () => {
      logger.info('[MODEL-SYNC] Processing sync-litellm-models job');
      await modelSyncService.syncWithLiteLLM();
      logger.info('[MODEL-SYNC] sync-litellm-models completed');
    });
  }

  private setupEventListeners(): void {
    if (!this.queue) return;

    this.queue.on('failed', (job, error) => {
      logger.error(`[MODEL-SYNC] Job ${job.name} failed:`, error);
    });

    this.queue.on('error', (error) => {
      logger.error('[MODEL-SYNC] Queue error:', error);
    });

    this.queue.on('stalled', (job) => {
      logger.warn(`[MODEL-SYNC] Job ${job.name} stalled`);
    });
  }

  async runInitialSync(): Promise<void> {
    logger.info('🔄 [MODEL-SYNC] Running initial model sync...');

    try {
      await modelSyncService.syncWithLiteLLM();
      logger.info('[MODEL-SYNC] Initial sync completed successfully');
    } catch (error) {
      logger.error('[MODEL-SYNC] Initial sync failed:', error);
    }
  }

  async close(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
      this.isInitialized = false;
      logger.info('[MODEL-SYNC] Queue closed');
    }
  }
}

export const modelSyncQueue = new ModelSyncQueue();
