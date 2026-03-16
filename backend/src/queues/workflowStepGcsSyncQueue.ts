import Bull from 'bull';
import { logger } from '@/utils/logger';
import { redisService } from '@/services/redisService';
import { workflowStepGcsSyncService } from '@/services/workflowStepGcsSyncService';
import { sessionRecordingSyncService } from '@/services/sessionRecordingSyncService';

export type WorkflowStepGcsSyncJobType = 'sync-workflow-steps-to-gcs';

export interface WorkflowStepGcsSyncJobData {
  type: WorkflowStepGcsSyncJobType;
}

// Run every 5 minutes (300,000 milliseconds)
const SYNC_INTERVAL_MS = 300000;

class WorkflowStepGcsSyncQueue {
  private queue: Bull.Queue<WorkflowStepGcsSyncJobData> | null = null;
  private isInitialized = false;
  private isInitializing = false;

  async initialize(): Promise<void> {
    if (this.isInitialized || this.isInitializing) {
      return;
    }

    this.isInitializing = true;

    try {
      this.queue = new Bull<WorkflowStepGcsSyncJobData>('workflow-step-gcs-sync', {
        redis: {
          ...redisService.getRedisConfig(),
          lazyConnect: false
        },
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000
          },
          removeOnComplete: true,
          removeOnFail: false
        }
      });

      this.setupProcessor();
      this.setupEventListeners();

      await this.scheduleRepeatableJob();

      this.isInitialized = true;
      logger.info('[WORKFLOW-STEP-GCS-SYNC] Queue initialized successfully');
    } catch (error) {
      logger.error('[WORKFLOW-STEP-GCS-SYNC] Failed to initialize queue:', error);
      this.isInitialized = false;
    } finally {
      this.isInitializing = false;
    }
  }

  private async scheduleRepeatableJob(): Promise<void> {
    if (!this.queue) return;

    await this.queue.add(
      'sync-workflow-steps-to-gcs',
      { type: 'sync-workflow-steps-to-gcs' },
      {
        repeat: { every: SYNC_INTERVAL_MS },
        jobId: 'workflow-step-gcs-sync-repeatable'
      }
    );

    logger.info(`[WORKFLOW-STEP-GCS-SYNC] Scheduled repeatable job: sync-workflow-steps-to-gcs (every ${SYNC_INTERVAL_MS / 1000} seconds)`);
  }

  private setupProcessor(): void {
    if (!this.queue) return;

    this.queue.process('sync-workflow-steps-to-gcs', async () => {
      logger.info('[WORKFLOW-STEP-GCS-SYNC] Processing workflow step GCS sync job');
      try {
        // Sync workflow steps
        await workflowStepGcsSyncService.syncAllWorkflowSteps();
        logger.info('[WORKFLOW-STEP-GCS-SYNC] Workflow step GCS sync completed');

        // Sync session recordings
        await sessionRecordingSyncService.syncAllSessionRecordings();
        logger.info('[WORKFLOW-STEP-GCS-SYNC] Session recording sync completed');
      } catch (error) {
        logger.error('[WORKFLOW-STEP-GCS-SYNC] Workflow step GCS sync failed:', error);
        throw error;
      }
    });
  }

  private setupEventListeners(): void {
    if (!this.queue) return;

    this.queue.on('failed', (job, error) => {
      logger.error(`[WORKFLOW-STEP-GCS-SYNC] Job ${job.name} failed:`, error);
    });

    this.queue.on('error', (error) => {
      logger.error('[WORKFLOW-STEP-GCS-SYNC] Queue error:', error);
    });

    this.queue.on('stalled', (job) => {
      logger.warn(`[WORKFLOW-STEP-GCS-SYNC] Job ${job.name} stalled`);
    });
  }

  async close(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
      this.isInitialized = false;
      logger.info('[WORKFLOW-STEP-GCS-SYNC] Queue closed');
    }
  }
}

export const workflowStepGcsSyncQueue = new WorkflowStepGcsSyncQueue();
