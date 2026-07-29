import type Bull from 'bull';
import { logger } from '@/utils/logger';
import { db } from '@/database/client';
import { runWithContext } from '@/database/tenant/context';
import { stepRegistry } from '../steps/step-registry';
import { AutomationExecutor } from '../engine/automation-executor';
import {
  automationScheduleQueue,
  type AutomationScheduleJobData,
} from './automation-schedule.queue';

class AutomationScheduleWorker {
  private isInitialized = false;
  private executor: AutomationExecutor | null = null;

  async start(): Promise<void> {
    if (this.isInitialized) return;

    await automationScheduleQueue.initialize();
    if (!automationScheduleQueue.isReady) {
      logger.error('[AUTOMATION-SCHEDULE-WORKER] queue not ready — aborting start');
      return;
    }

    this.executor = new AutomationExecutor(db, stepRegistry);

    automationScheduleQueue
      .getQueue()
      .process(async (job: Bull.Job<AutomationScheduleJobData>) => {
        return this.processJob(job);
      });

    this.isInitialized = true;
    logger.info('[AUTOMATION-SCHEDULE-WORKER] Started');
  }

  private async processJob(job: Bull.Job<AutomationScheduleJobData>): Promise<void> {
    if (!this.executor) {
      throw new Error('[AUTOMATION-SCHEDULE-WORKER] Executor not initialized');
    }
    const { executionId } = job.data;
    logger.info(
      `[AUTOMATION-SCHEDULE-WORKER] picking up scheduled run executionId=${executionId}`,
    );

    // Open a tenant scope so the executor's step writes get stamped with the
    // owning workspaceId — background jobs have no HTTP request to derive it from.
    const execution = await db.workflowExecution.findUnique({
      where: { id: executionId },
      select: { workspaceId: true, workflow: { select: { workspaceId: true } } },
    });
    const workspaceId = execution?.workflow?.workspaceId ?? execution?.workspaceId ?? undefined;
    if (!workspaceId) {
      logger.warn(
        `[AUTOMATION-SCHEDULE-WORKER] executionId=${executionId} — could not resolve workspaceId, dropping`,
      );
      return;
    }

    await runWithContext({ userId: 'automation', workspaceId }, () =>
      this.executor!.runExecution(executionId),
    );
  }
}

export const automationScheduleWorker = new AutomationScheduleWorker();
