/**
 * `SchedulerAdapter` for `@xyne/workflow-sdk`, over Bull repeatable jobs.
 *
 * Called by the runtime when a CRON-triggered workflow is activated or deactivated. It
 * only registers and removes schedules — a firing tick is consumed by the worker, which
 * hands it to `WorkflowRuntime.processCronTick()`. Same split as the execution queue:
 * the adapter puts work in, the worker takes it out.
 */
import type { SchedulerAdapter } from '@xyne/workflow-sdk';
import { logger } from '@/utils/logger';
import {
  WORKFLOWS_CRON_JOB_NAME,
  workflowsCronQueue,
  type WorkflowsCronJobData,
} from '@/queues/workflowsCronQueue';

export class BullSchedulerAdapter implements SchedulerAdapter {
  /**
   * Register (or re-register) a workflow's cron schedule.
   *
   * **Removes any existing schedule first.** `docs/guidelines/JOBS.md` calls this out, and
   * it is not merely hygiene here: `schedule()` is called on every activation, so a
   * workflow edited from `0 9 * * *` to `0 10 * * *` and re-activated would otherwise hold
   * *both* repeatables and fire twice a day. Duplicate schedules are the classic Bull
   * repeatable bug and they are invisible until someone notices double runs.
   */
  async schedule(workflowId: string, cronExpression: string, timezone?: string): Promise<void> {
    await this.unschedule(workflowId);

    const queue = workflowsCronQueue.getQueue();
    const data: WorkflowsCronJobData = { workflowId };

    await queue.add(WORKFLOWS_CRON_JOB_NAME, data, {
      repeat: {
        cron: cronExpression,
        ...(timezone ? { tz: timezone } : {}),
      },
      // Names the repeatable so `unschedule` can find it again. Bull composes its repeat
      // key from name + id + cron + tz, which is why removal below matches on our id
      // rather than reconstructing that key: the cron may have changed since.
      jobId: workflowId,
    });

    logger.info(
      `[WORKFLOWS-CRON] scheduled workflow ${workflowId}: ${cronExpression}` +
        (timezone ? ` (${timezone})` : ''),
    );
  }

  /**
   * Remove a workflow's schedule.
   *
   * Matches repeatables by **our** `jobId` and removes by Bull's own key, rather than
   * calling `removeRepeatable(name, { cron, tz })`. That form needs the *original* cron
   * and timezone to reconstruct the key, which the caller does not have on deactivation —
   * and would silently no-op if the expression had since been edited, leaving an orphaned
   * schedule firing against a deactivated workflow.
   *
   * Safe to call when nothing is scheduled: deactivate runs for every trigger type.
   */
  async unschedule(workflowId: string): Promise<void> {
    const queue = workflowsCronQueue.getQueue();
    const repeatables = await queue.getRepeatableJobs();
    const mine = repeatables.filter((job) => job.id === workflowId);

    for (const job of mine) {
      await queue.removeRepeatableByKey(job.key);
    }

    if (mine.length > 0) {
      logger.info(
        `[WORKFLOWS-CRON] unscheduled workflow ${workflowId}` +
          (mine.length > 1 ? ` (removed ${String(mine.length)} duplicate schedules)` : ''),
      );
    }
  }
}
