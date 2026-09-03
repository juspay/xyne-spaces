import type Bull from 'bull';
import { logger } from '@/utils/logger';
import { repositories } from '@/database/repositories';
import { db } from '@/database/client';
import { runAsServiceActor } from '@/database/tenant/context';
import { automationQueue, type AutomationJobData } from './automation.queue';
import { automationScheduleQueue } from './automation-schedule.queue';
import { stepRegistry } from '../steps/step-registry';
import { AutomationExecutor } from '../engine/automation-executor';
import { AutomationStatus, AutomationRunStatus } from '../types/status';
import {
  isExecutableAutomationWorkflowType,
  mayDrainInFlight,
  parseAutomationConfig,
  readAutomationMeta,
} from '../types/workflow-adapter';
import { getAutomationPauseState } from '@/database/repositories/workflowExecutionStateUtils';
import { computeScheduleRunAt } from '../types/automation-config';
import { triggerRegistry } from '../triggers/trigger-registry';
import type { TriggerType } from '../types/trigger-types';

const EXECUTION_FETCH_MAX_RETRIES = 3;
const EXECUTION_FETCH_RETRY_BASE_DELAY_MS = 200;

class AutomationWorker {
  private isInitialized = false;
  private executor: AutomationExecutor | null = null;

  async start(): Promise<void> {
    if (this.isInitialized) return;

    await automationQueue.initialize();
    if (!automationQueue.isReady) {
      logger.error('[AUTOMATION-WORKER] Queue not ready — aborting start');
      return;
    }
    await automationScheduleQueue.initialize();

    this.executor = new AutomationExecutor(db, stepRegistry);

    automationQueue.getQueue().process(async (job: Bull.Job<AutomationJobData>) => {
      return this.processJob(job);
    });

    this.isInitialized = true;
    logger.info('[AUTOMATION-WORKER] Started');
  }

  private async processJob(job: Bull.Job<AutomationJobData>): Promise<void> {
    if (!this.executor) {
      throw new Error('[AUTOMATION-WORKER] Executor not initialized');
    }
    const { executionId } = job.data;
    logger.info(`[AUTOMATION-WORKER] Job ${job.id} starting — execution=${executionId}`);

    const fetchExecution = () => db.workflowExecution.findUnique({ where: { id: executionId } });
    let execution = await fetchExecution();
    for (let retry = 0; !execution && retry < EXECUTION_FETCH_MAX_RETRIES; retry++) {
      const delayMs = EXECUTION_FETCH_RETRY_BASE_DELAY_MS * 2 ** retry;
      await new Promise(resolve => setTimeout(resolve, delayMs));
      execution = await fetchExecution();
      logger.warn(
        `[AUTOMATION-WORKER-RETRY] execution=${executionId} fetch failed, retrying (${retry + 1})`,
      );
    }
    if (!execution || !isExecutableAutomationWorkflowType(execution.workflowType)) {
      logger.warn(
        `[AUTOMATION-WORKER] execution=${executionId} missing or wrong workflowType — dropping`,
      );
      return;
    }
    const acceptableStatuses: readonly string[] = [
      AutomationRunStatus.PENDING,
      'EXTERNAL_WAIT',
    ];
    if (!acceptableStatuses.includes(execution.status)) {
      logger.warn(
        `[AUTOMATION-WORKER] execution=${executionId} status=${execution.status} — no handler, skipping`,
      );
      return;
    }

    // Open a tenant scope so every Prisma write in this job (and the executor's
    // step writes) gets stamped with the owning workspaceId. Background jobs have
    // no HTTP request, so without this the stamp would leave workspaceId NULL.
    const scopeWorkflow = await db.workflow.findUnique({
      where: { id: execution.workflowId },
      select: { workspaceId: true },
    });
    const workspaceId = scopeWorkflow?.workspaceId ?? execution.workspaceId ?? undefined;
    if (!workspaceId) {
      logger.warn(
        `[AUTOMATION-WORKER] execution=${executionId} — could not resolve workspaceId, dropping`,
      );
      return;
    }

    await runAsServiceActor('automation', workspaceId, () =>
      this.runJob(job, execution),
    );
  }

  private async runJob(
    job: Bull.Job<AutomationJobData>,
    execution: NonNullable<Awaited<ReturnType<typeof db.workflowExecution.findUnique>>>,
  ): Promise<void> {
    if (!this.executor) {
      throw new Error('[AUTOMATION-WORKER] Executor not initialized');
    }
    const { executionId } = job.data;

    if (execution.status === 'EXTERNAL_WAIT') {
      await this.executor.runExecution(executionId);
      return;
    }

    const workflow = await repositories.workflows.findById(execution.workflowId);
    if (!workflow || !isExecutableAutomationWorkflowType(workflow.workflowType)) {
      logger.warn(`[AUTOMATION-WORKER] workflow ${execution.workflowId} missing — dropping`);
      return;
    }
    if (workflow.status !== AutomationStatus.ACTIVE && !mayDrainInFlight(workflow)) {
      await db.workflowExecution.update({
        where: { id: executionId },
        data: { status: AutomationRunStatus.CANCELLED },
      });
      logger.info(
        `[AUTOMATION-WORKER] workflow ${workflow.id} is ${workflow.status} (no longer live) — execution=${executionId} CANCELLED`,
      );
      return;
    }

    const stateForChain = await getAutomationPauseState(executionId);
    const upstreamChain = readAutomationMeta(stateForChain?.context ?? null).chain;
    if (upstreamChain.includes(workflow.id)) {
      await db.workflowExecution.update({
        where: { id: executionId },
        data: { status: AutomationRunStatus.CANCELLED },
      });
      logger.info(
        `[AUTOMATION-WORKER] cycle detected — workflow ${workflow.id} already in chain [${upstreamChain.join(' → ')}], execution=${executionId} CANCELLED`,
      );
      return;
    }

    const config = parseAutomationConfig(workflow.context);

    const triggerType = config.trigger.type as TriggerType;
    const triggerImpl = triggerRegistry.has(triggerType)
      ? triggerRegistry.get(triggerType)
      : null;
    const hydratedTriggerData = await this.hydrateTriggerData(executionId, triggerImpl);

    if (triggerImpl) {
      const filterConfig = (config.trigger.config ?? {}) as Record<string, unknown>;
      if (!triggerImpl.matchFilters(filterConfig, hydratedTriggerData)) {
        const hydratedTicket = (hydratedTriggerData as { ticket?: Record<string, unknown> }).ticket;
        logger.info(
          `[AUTOMATION-WORKER] filter mismatch detail — execution=${executionId} ` +
            `filterConfig=${JSON.stringify(filterConfig)} ` +
            `hydratedTicketPresent=${hydratedTicket ? 'yes' : 'no'} ` +
            `ticket.channelId=${(hydratedTicket?.channelId as string | undefined) ?? '∅'} ` +
            `ticket.boardId=${(hydratedTicket?.boardId as string | undefined) ?? '∅'} ` +
            `ticket.projectId=${(hydratedTicket?.projectId as string | undefined) ?? '∅'}`,
        );
        await db.workflowExecution.update({
          where: { id: executionId },
          data: { status: AutomationRunStatus.SKIPPED },
        });
        logger.info(
          `[AUTOMATION-WORKER] filter mismatched at intake — execution=${executionId} automation=${workflow.id}, skipping`,
        );
        return;
      }
    }

    if (config.schedule && config.schedule.type === 'SCHEDULED') {
      const handled = await this.tryDefer(executionId, config.schedule, hydratedTriggerData);
      if (handled) return;
    }

    await this.executor.runExecution(executionId);
  }

  private async hydrateTriggerData(
    executionId: string,
    triggerImpl: { hydratePayload?(p: Record<string, unknown>): Promise<Record<string, unknown>> } | null,
  ): Promise<Record<string, unknown>> {
    const state = await getAutomationPauseState(executionId);
    let triggerData: Record<string, unknown> = {};
    if (state?.context) {
      try {
        const ctx = JSON.parse(state.context) as {
          trigger?: { data?: Record<string, unknown> };
        };
        triggerData = ctx.trigger?.data ?? {};
      } catch {
        // malformed → leave as {} so downstream callers get a stable shape
      }
    }
    if (triggerImpl && typeof triggerImpl.hydratePayload === 'function') {
      try {
        return await triggerImpl.hydratePayload(triggerData);
      } catch (err) {
        logger.warn(
          `[AUTOMATION-WORKER] hydratePayload threw for execution=${executionId}, using wire payload only:`,
          err,
        );
      }
    }
    return triggerData;
  }

  private async tryDefer(
    executionId: string,
    schedule: Extract<ReturnType<typeof parseAutomationConfig>['schedule'], { type: 'SCHEDULED' }>,
    triggerData: Record<string, unknown>,
  ): Promise<boolean> {
    const runAt = computeScheduleRunAt(schedule, triggerData);
    if (runAt === null) {
      logger.warn(
        `[AUTOMATION-WORKER] schedule.field "${schedule.field}" did not resolve to a date for execution=${executionId}; firing now.`,
      );
      return false;
    }

    const delayMs = runAt - Date.now();
    if (delayMs <= 0) {
      logger.info(
        `[AUTOMATION-WORKER] schedule.runAt is in the past (delayMs=${delayMs}) — firing immediately for execution=${executionId}`,
      );
      return false;
    }

    await db.workflowExecution.update({
      where: { id: executionId },
      data: { status: AutomationRunStatus.SCHEDULED },
    });
    await automationScheduleQueue.enqueueScheduled({ executionId }, delayMs);
    logger.info(
      `[AUTOMATION-WORKER] execution=${executionId} SCHEDULED runAt=${new Date(runAt).toISOString()} delayMs=${delayMs}`,
    );
    return true;
  }
}

export const automationWorker = new AutomationWorker();
