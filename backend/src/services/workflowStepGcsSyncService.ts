import { getStorageService } from './storage';
import { redisService } from './redisService';
import { conversationIngestQueue } from '@/queues/conversationIngestQueue';
import { logger } from '@/utils/logger';
import { config } from '@/config/env';
import { WORKFLOW_KEYS_SET, parseWorkflowStepKey } from '@/workflows/utils/workflowStepKeys';
import { db } from '@/database/client';
import { DatabaseClient } from '@/database/client';
import { SessionRecordingProcessStatus } from '@prisma/client';

export interface WorkflowStepData {
  stepId: string;
  stepName: string | null;
  data: string | null;
  type: string | null;
  stepExecutorType: string | null;
  status: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export class WorkflowStepGcsSyncService {
  private storageService = getStorageService(config.gcs.workflowStepsBucketName);

  /**
   * Sync all workflow steps from Redis to GCS.
   * Called by the cron job every 5 minutes.
   */
  async syncAllWorkflowSteps(): Promise<void> {
    try {
      // Get all workflow step keys from the global tracking set
      const keys = await redisService.smembers(WORKFLOW_KEYS_SET);

      logger.info(`[GCS-SYNC] Found ${keys.length} workflow step keys in Redis set: ${WORKFLOW_KEYS_SET}`);

      if (keys.length === 0) {
        logger.info(`[GCS-SYNC] No workflow step keys found in tracking set`);
        return;
      }

      // Process each key
      for (const key of keys) {
        try {
          await this.syncWorkflowStepsToGcs(key);
        } catch (error) {
          logger.error(`[GCS-SYNC] Failed to sync ${key}:`, error);
          // Continue with other keys
        }
      }

      logger.info(`[GCS-SYNC] Completed sync for ${keys.length} workflow keys`);
    } catch (error) {
      logger.error('[GCS-SYNC] Failed to sync workflow steps:', error);
      throw error;
    }
  }

  /**
   * Sync a single workflow execution's steps to GCS.
   * Reads from Redis and directly uploads to GCS (overwrites existing file).
   * Supports both aggregate keys (workflow:{executionId}) and per-step keys
   * (workflow:{executionId}:{stepName}) for agentic checkpoints.
   */
  private async syncWorkflowStepsToGcs(redisKey: string): Promise<void> {
    const parsed = parseWorkflowStepKey(redisKey);
    if (!parsed) {
      logger.warn(`[GCS-SYNC] Invalid Redis key format: ${redisKey}`);
      return;
    }

    const { workflowExecutionId, stepName } = parsed;

    // Read all steps from Redis atomically using Lua script
    // If list is empty, the key will be deleted and removed from tracking set
    const redisData = await redisService.fetchListAndCleanupIfEmpty(redisKey, WORKFLOW_KEYS_SET);

    if (!redisData || redisData.length === 0) {
      logger.info(`[GCS-SYNC] No data in Redis for ${redisKey}, key deleted and removed from tracking set`);
      return;
    }

    // Parse Redis data
    const steps: WorkflowStepData[] = redisData.map(item => JSON.parse(item));

    // Determine GCS path based on key type:
    // - Aggregate: workflows/{executionId}.json
    // - Per-step (agentic): workflows/{executionId}/{stepName}.json
    const gcsPath = stepName
      ? `workflows/${workflowExecutionId}/${stepName}.json`
      : `workflows/${workflowExecutionId}.json`;

    const buffer = Buffer.from(JSON.stringify(steps), 'utf-8');

    const metadata: Record<string, string> = {
      workflowExecutionId,
      stepCount: String(steps.length),
      syncedAt: new Date().toISOString()
    };
    
    if (stepName) {
      metadata.stepName = stepName;
    }

    await this.storageService.uploadFileV2(buffer, {
      path: gcsPath,
      contentType: 'application/json',
      metadata
    });

    logger.info(`[GCS-SYNC] Synced ${steps.length} steps for ${redisKey} to GCS: ${gcsPath}`);

    const gcsUri = this.storageService.buildStorageUri(gcsPath);

    let sourceId = workflowExecutionId;
    if (stepName) {
      try {
        const step = await db.workflowStep.findFirst({
          where: { workflowExecutionId, stepName },
          select: { id: true },
          orderBy: { createdAt: 'desc' },
        });
        if (step) {
          sourceId = step.id;
          logger.info(`[GCS-SYNC] Resolved sourceId=${sourceId} (WorkflowStep.id) for stepName=${stepName} executionId=${workflowExecutionId}`);
        } else {
          logger.warn(`[GCS-SYNC] WorkflowStep not found for executionId=${workflowExecutionId} stepName=${stepName}, falling back to executionId as sourceId`);
        }
      } catch (err) {
        logger.error(`[GCS-SYNC] Failed to resolve WorkflowStep.id for ${workflowExecutionId}/${stepName}:`, err);
      }
    }

    try {
      const execution = await db.workflowExecution.findUnique({
        where: { id: workflowExecutionId },
        select: { createdBy: true },
      });
      const userId = execution?.createdBy ?? '';
      const prisma = DatabaseClient.getInstance();
      await prisma.sessionRecordingFile.upsert({
        where: { sessionId: sourceId },
        create: {
          sessionId: sourceId,
          userId,
          url: gcsUri,
          status: SessionRecordingProcessStatus.PENDING,
        },
        update: {
          status: SessionRecordingProcessStatus.PENDING,
          url: gcsUri,
        },
      });
    } catch (err) {
      logger.warn(`[GCS-SYNC] Failed to upsert SessionRecordingFile for sourceId=${sourceId}:`, err);
    }

    conversationIngestQueue.addJob({
      gcsUri,
      source: 'workflowSteps',
      sourceId,
    }).catch((queueErr) => {
      logger.error(`[GCS-SYNC] Failed to enqueue ingest job for sourceId=${sourceId}:`, queueErr);
    });
  }
}

export const workflowStepGcsSyncService = new WorkflowStepGcsSyncService();
