// Queue processors for the workflow-sdk engine — registered from the worker
// process (src/worker.ts). Two named job types on the shared Bull queue:
//   'execute'   → one engine pass over an execution (runtime.processJob)
//   'cron-tick' → a CRON trigger firing (runtime.processCronTick)
// Bull repeatables persist in Redis, so cron needs no per-process re-register;
// the boot-time reconciliation below only heals Redis flushes / config drift.

import { logger } from '@/utils/logger';
import { workflowSdkQueue } from './queue';
import { BullSchedulerAdapter } from './scheduler';
import { workflowSdkRuntime, workflowSdkPersistence } from './runtime';

const WORKER_CONCURRENCY = 3;

export const initWorkflowSdkWorkers = async (): Promise<void> => {
  const queue = workflowSdkQueue.getQueue();

  void queue.process('execute', WORKER_CONCURRENCY, async job => {
    const { executionId } = job.data as { executionId: string };
    try {
      await workflowSdkRuntime.processJob(executionId);
    } catch (err) {
      logger.error(
        `[WORKFLOW-SDK] Job for execution ${executionId} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  });

  void queue.process('cron-tick', 1, async job => {
    const { workflowId } = job.data as { workflowId: string };
    try {
      await workflowSdkRuntime.processCronTick(workflowId);
    } catch (err) {
      logger.error(
        `[WORKFLOW-SDK] Cron tick for workflow ${workflowId} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  });

  logger.info(
    `[WORKFLOW-SDK] Execution workers registered (queue: workflow-sdk-execution, concurrency: ${WORKER_CONCURRENCY})`,
  );

  // Cold-start cron reconciliation: re-register repeatable jobs for all active
  // CRON workflows. schedule() is remove-then-add, so this is idempotent.
  try {
    const scheduler = new BullSchedulerAdapter();
    const activeWorkflows = await workflowSdkPersistence.listAllActiveWorkflows();
    let cronCount = 0;
    for (const wf of activeWorkflows) {
      if (!wf.config) continue;
      let cfg: { trigger?: { type?: string; config?: { expression?: string; timezone?: string } } };
      try {
        cfg = JSON.parse(wf.config) as typeof cfg;
      } catch {
        continue;
      }
      if (cfg.trigger?.type !== 'CRON' || !cfg.trigger.config?.expression) continue;
      await scheduler.schedule(
        wf.id,
        cfg.trigger.config.expression,
        cfg.trigger.config.timezone ?? 'Asia/Kolkata',
      );
      cronCount++;
    }
    if (cronCount > 0) {
      logger.info(`[WORKFLOW-SDK] Reconciled ${cronCount} cron schedule(s)`);
    }
  } catch (err) {
    logger.error(
      `[WORKFLOW-SDK] Cron reconciliation failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
};
