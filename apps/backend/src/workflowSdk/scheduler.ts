// Cron scheduling for the workflow-sdk engine via Bull repeatable jobs on the
// shared workflow-sdk queue. Repeatables persist in Redis, so no per-process
// re-registration is needed — the single 'cron-tick' processor (worker.ts)
// handles every workflow. Removal must go by repeatable KEY, because the key
// encodes cron+tz and a changed schedule would otherwise linger as a stale
// duplicate (same pitfall as googleCalendarSyncQueue).

import { logger } from '@/utils/logger';
import type { SchedulerAdapter } from '@xyne/workflow-sdk';
import { workflowSdkQueue } from './queue';

const cronJobId = (workflowId: string): string => `wf-cron-${workflowId}`;

export class BullSchedulerAdapter implements SchedulerAdapter {
  async schedule(
    workflowId: string,
    cronExpression: string,
    timezone?: string,
  ): Promise<void> {
    // Remove-then-add: repeatables are keyed by (jobId, cron, tz), so changing
    // the expression would ADD a second schedule instead of replacing it.
    await this.unschedule(workflowId);
    const queue = await workflowSdkQueue.getQueue();
    await queue.add(
      'cron-tick',
      { workflowId },
      {
        jobId: cronJobId(workflowId),
        repeat: {
          cron: cronExpression,
          ...(timezone ? { tz: timezone } : {}),
        },
      },
    );
    logger.info(
      `[WORKFLOW-SDK-SCHEDULER] Scheduled workflow ${workflowId}: "${cronExpression}"${timezone ? ` (${timezone})` : ''}`,
    );
  }

  async unschedule(workflowId: string): Promise<void> {
    const queue = await workflowSdkQueue.getQueue();
    const repeatables = await queue.getRepeatableJobs();
    for (const job of repeatables.filter(j => j.id === cronJobId(workflowId))) {
      await queue.removeRepeatableByKey(job.key);
    }
  }
}
