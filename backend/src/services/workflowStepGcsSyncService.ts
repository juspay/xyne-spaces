import GCSServiceFactory from './gcsServiceFactory';
import { redisService } from './redisService';
import { logger } from '@/utils/logger';
import { config } from '@/config/env';
import { WORKFLOW_KEYS_SET, parseWorkflowStepKey } from '@/workflows/utils/workflowStepKeys';

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
  private gcsService = GCSServiceFactory.getService(config.gcs.workflowStepsBucketName);

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

    await this.gcsService.uploadFileV2(buffer, {
      path: gcsPath,
      contentType: 'application/json',
      metadata
    });

    logger.info(`[GCS-SYNC] Synced ${steps.length} steps for ${redisKey} to GCS: ${gcsPath}`);
  }
}

export const workflowStepGcsSyncService = new WorkflowStepGcsSyncService();
