import type { QueryContext } from '../acl/core/types';
import type { SideEffectJobConfig, SideEffectJobsAccumulator } from './types';
import { SideEffectHandlerFactory } from './handler-factory';
import {logger} from '@/utils/logger';

export async function processSideEffectJobs(
  jobs: SideEffectJobsAccumulator,
  context: QueryContext
): Promise<void> {
  if (jobs.length === 0) {
    return;
  }

  await Promise.allSettled(
    jobs.map(async (job: SideEffectJobConfig) => {
      try {
        await processSideEffectJob(job, context);
      } catch (err) {
        logger.error(
          `[SideEffectProcessor] Failed to process ${job.operation} on ${job.entityType}/${job.entityId}:`,
          err instanceof Error ? err.message : String(err)
        );
      }
    })
  );
}

async function processSideEffectJob(
  job: SideEffectJobConfig,
  context: QueryContext
): Promise<void> {
  const handler = SideEffectHandlerFactory.getHandler(job.entityType, context);

  switch (job.operation) {
    case 'insert':
      await handler.onInsert(job);
      break;
    case 'update':
      await handler.onUpdate(job);
      break;
    case 'delete':
      await handler.onDelete(job);
      break;
    case 'upsert':
      await handler.onUpsert(job);
      break;
    default:
      logger.warn(`[SideEffectProcessor] Unknown operation: ${(job as any).operation}`);
  }
}
