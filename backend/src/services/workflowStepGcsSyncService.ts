import GCSServiceFactory from './gcsServiceFactory';
import { redisService } from './redisService';
import { logger } from '@/utils/logger';
import { config } from '@/config/env';
import { WORKFLOW_STEP_KEY_PATTERN, parseWorkflowStepKey } from '@/workflows/utils/workflowStepKeys';

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
      // Scan Redis for all workflow step keys
      const redis = redisService.getClient();
      const keys: string[] = [];

      logger.info(`[GCS-SYNC] Starting SCAN with pattern: ${WORKFLOW_STEP_KEY_PATTERN}`);

      // Use SCAN to find all keys matching pattern
      let cursor = '0';
      let scanIterations = 0;
      do {
        scanIterations++;
        const result = await redis.scan(cursor, 'MATCH', WORKFLOW_STEP_KEY_PATTERN, 'COUNT', 100);
        cursor = result[0];
        keys.push(...result[1]);
        logger.info(`[GCS-SYNC] SCAN iteration ${scanIterations}: cursor=${cursor}, found ${result[1].length} keys`);
      } while (cursor !== '0');

      logger.info(`[GCS-SYNC] Found ${keys.length} workflow step keys in Redis after ${scanIterations} iterations`);

      if (keys.length === 0) {
        // Try to get ALL keys to debug
        const allKeys = await redis.keys('*');
        logger.info(`[GCS-SYNC] DEBUG: Total keys in Redis: ${allKeys.length}`);
        logger.info(`[GCS-SYNC] DEBUG: Sample keys: ${allKeys.slice(0, 10).join(', ')}`);
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

    // Read all steps from Redis
    const redisData = await redisService.lrange(redisKey, 0, -1);

    if (redisData.length === 0) {
      logger.info(`[GCS-SYNC] No data in Redis for ${redisKey}`);
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
