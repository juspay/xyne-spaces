import type { Prisma } from '@prisma/client';
import { config } from '@/config/env';
import { DatabaseClient } from '@/database/client';
import { logger } from '@/utils/logger';
import { asSystem, asService, rawQuery } from './base';

const prisma = DatabaseClient.getInstance();

const RUN_LOG_RETENTION_DAYS = config.radar.runLogRetentionDays;
const RUN_LOG_SWEEP_BATCH_SIZE = 5_000;
const RUN_LOG_SWEEP_BATCH_PAUSE_MS = 250;
/** Bounds one sweep's work; the remainder is picked up by the next tick. */
const RUN_LOG_SWEEP_MAX_BATCHES = 40;

/**
 * Relocated from workers/radarExecutionWorker.ts's sweepRunLogs + sweepRunLogsUnscoped, merged
 * into one. execution_run_logs grows one row per drain pass and carries LLM payloads, so it is
 * swept on a timer; items and mutations are never touched. Retention spans every tenant by
 * design — runAsSystem leaves the query unfiltered and marks it intentional for the ACL
 * extension. Batched rather than one DELETE: the first sweep after a long run could match
 * millions of rows, and each batch being its own transaction keeps locks short and the work
 * interruptible.
 */
export function sweepRunLogsQuery(): Promise<void> {
  return asSystem(
    ['ExecutionRunLog'],
    'log retention spans every tenant by design, swept on a timer',
    async () => {
      const cutoff = new Date(Date.now() - RUN_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);
      let deleted = 0;
      try {
        for (let batch = 0; batch < RUN_LOG_SWEEP_MAX_BATCHES; batch++) {
          const stale = await prisma.executionRunLog.findMany({
            where: { createdAt: { lt: cutoff } },
            select: { id: true },
            take: RUN_LOG_SWEEP_BATCH_SIZE,
          });
          if (stale.length === 0) break;
          const { count } = await prisma.executionRunLog.deleteMany({
            where: { id: { in: stale.map(r => r.id) } },
          });
          deleted += count;
          // Breathe so a large backlog doesn't monopolise the pool.
          await new Promise(resolve => setTimeout(resolve, RUN_LOG_SWEEP_BATCH_PAUSE_MS));
        }
        if (deleted > 0) {
          logger.info('[RADAR-EXECUTION-WORKER] Swept run logs', {
            deleted,
            olderThanDays: RUN_LOG_RETENTION_DAYS,
          });
        }
      } catch (error) {
        // Retention must never take the worker down.
        logger.warn('[RADAR-EXECUTION-WORKER] Run-log sweep failed', { deleted, error });
      }
    },
  );
}

/**
 * Relocated from services/radar/radarApplier. Removes one actor from an execution item's
 * pendingOn array in a single statement, so two concurrent dismissals cannot write back each
 * other's removal. The workspace, conversation and status predicates are written explicitly.
 */
export async function removeExecutionItemPendingOn(tx: Prisma.TransactionClient, itemId: string, workspaceId: string, conversationId: string, actorId: string): Promise<number> {
  return rawQuery(
    ['ExecutionItem'],
    'radar: array_remove of one actor from pendingOn so two concurrent dismissals cannot write back each other\'s removal',
    () => tx.$executeRaw`
                UPDATE "non_zero"."execution_items"
                SET "pendingOn" = array_remove("pendingOn", ${actorId}),
                    "updatedAt" = NOW()
                WHERE "id" = ${itemId}
                  AND "workspaceId" = ${workspaceId}
                  AND "conversationId" = ${conversationId}
                  AND "status" = 'OPEN'
                  AND ${actorId} = ANY("pendingOn")
              `,
  );
}

/**
 * Relocated from workers/radarExecutionWorker.ts's processJob. Bull job → no HTTP tenant
 * context; opens one from the conversation's own workspaceId so the thread-processing writes
 * (execution items, thread state, messages) get workspaceId stamped.
 */
export function processRadarThreadAsServiceActor<T>(workspaceId: string, fn: () => Promise<T>): Promise<T> {
  return asService(
    ['ExecutionItem', 'ExecutionThreadState', 'Message', 'MessageAttachment', 'Channel', 'ChannelParticipant', 'User'],
    'radar execution worker: Bull job has no HTTP tenant context, writes stamped from the conversation\'s own workspaceId',
    'radar-execution-worker',
    workspaceId,
    fn,
  );
}
