import type Bull from 'bull';
import { logger } from '@/utils/logger';
import { db } from '@/database/client';
import { markAutomationFailed } from '@/database/repositories/workflowExecutionStateUtils';
import { createAutomationExecutionForWebhook } from '@/bypassAcl/automationServices';
import { DEFAULT_CRON_TIMEZONE } from '@/workflowsV2/constants';
import {
  automationScheduleQueue,
  CRON_TICK_PREFIX,
  type AutomationScheduleJobData,
} from './automation-schedule.queue';
import { automationQueue } from './automation.queue';
import { AutomationStatus } from '../types/status';
import {
  AUTOMATION_WORKFLOW_TYPE,
  parseAutomationConfig,
  parseAutomationMetadata,
} from '../types/workflow-adapter';
import { cronFromTrigger, SCHEDULE_EVENT } from '../triggers/schedule.trigger';

/** Re-registers ACTIVE Schedule automations after a restart. Idempotent across replicas. */
export async function recoverCronSchedules(): Promise<void> {
  try {
    const registered = await automationScheduleQueue.getQueue().getRepeatableJobs();
    const rows = await db.workflow.findMany({
      where: {
        workflowType: AUTOMATION_WORKFLOW_TYPE,
        eventType: SCHEDULE_EVENT,
        status: AutomationStatus.ACTIVE,
      },
      select: { id: true, context: true },
    });
    for (const row of rows) {
      try {
        const cron = cronFromTrigger(parseAutomationConfig(row.context).trigger.config);
        const name = `${CRON_TICK_PREFIX}${row.id}`;
        const upToDate = registered.some(
          j => j.name === name && j.cron === cron && j.tz === DEFAULT_CRON_TIMEZONE,
        );
        if (upToDate) continue;
        await automationScheduleQueue.scheduleCron(row.id, cron, DEFAULT_CRON_TIMEZONE);
        logger.info(`[AUTOMATION-SCHEDULE-WORKER] recovered cron schedule automation=${row.id}`);
      } catch (err) {
        logger.error(`[AUTOMATION-SCHEDULE-WORKER] cron recovery skipped automation=${row.id}:`, err);
      }
    }
  } catch (err) {
    logger.error('[AUTOMATION-SCHEDULE-WORKER] cron recovery failed:', err);
  }
}

export async function processCronTick(job: Bull.Job<AutomationScheduleJobData>): Promise<void> {
  const { workflowId } = job.data;
  if (!workflowId) return;
  const workflow = await db.workflow.findUnique({ where: { id: workflowId } });

  // Only a definite "no longer a live Schedule automation" answer unschedules; a DB error throws.
  if (
    !workflow ||
    workflow.workflowType !== AUTOMATION_WORKFLOW_TYPE ||
    workflow.status !== AutomationStatus.ACTIVE ||
    parseAutomationConfig(workflow.context).trigger.type !== SCHEDULE_EVENT
  ) {
    logger.info(`[AUTOMATION-SCHEDULE-WORKER] cron tick for inactive automation=${workflowId}, unscheduling`);
    await automationScheduleQueue.unscheduleCron(workflowId);
    return;
  }

  const metadata = parseAutomationMetadata(workflow.metadata);
  // IST is a fixed +05:30 (no DST), so shifting the UTC clock gives IST wall-clock fields.
  const ist = new Date(Date.now() + 5.5 * 3600_000);
  const iso = ist.toISOString();
  const fired = {
    firedAt: iso.replace('Z', '+05:30'),
    date: iso.slice(0, 10),
    time: iso.slice(11, 16),
    weekday: ist.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }),
  };
  const execution = await createAutomationExecutionForWebhook({
    workspaceId: workflow.workspaceId,
    workflowId: workflow.id,
    initialContext: {
      automation: {
        id: workflow.id,
        workspaceId: workflow.workspaceId,
        createdById: metadata.createdById,
      },
      trigger: { type: SCHEDULE_EVENT, ...fired, data: fired },
      steps: {},
      __meta: { error: null, chain: [] },
    },
  });
  try {
    await automationQueue.enqueueRun(
      { executionId: execution.id },
      metadata.priority ? { priority: 1 } : {},
    );
  } catch (err) {
    // The tick job has no executionId, so the queue's failed listener can't reconcile this row.
    await markAutomationFailed(execution.id, err instanceof Error ? err.message : String(err));
    throw err;
  }
  logger.info(
    `[AUTOMATION-SCHEDULE-WORKER] cron tick automation=${workflowId} execution=${execution.id}`,
  );
}
