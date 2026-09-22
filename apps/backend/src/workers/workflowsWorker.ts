/**
 * Consumer side of `@xyne/workflow-sdk`. Runs in the worker process only.
 *
 * The API process imports the same runtime but calls `initWorkflows()` for its producer
 * side alone — it enqueues, it never executes. This module is what registers the Bull
 * processors, so a workflow only runs where this is started.
 *
 * Two processors:
 *   execution queue → `processJob(executionId)`      one pass over a run
 *   cron queue      → `processCronTick(workflowId)`  ask a cron trigger if there is work
 */
import type Bull from 'bull';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { db } from '@/database/client';
import { runAsServiceActor, runAsSystem } from '@/database/tenant/context';
import {
  WORKFLOWS_JOB_NAME,
  workflowsQueue,
  type WorkflowsJobData,
} from '@/queues/workflowsQueue';
import {
  WORKFLOWS_CRON_JOB_NAME,
  workflowsCronQueue,
  type WorkflowsCronJobData,
} from '@/queues/workflowsCronQueue';
import { workflowRuntime, initWorkflows, persistence } from '@/workflowsV2/runtime';
import { BullSchedulerAdapter } from '@/workflowsV2/adapters/scheduler';
import { DEFAULT_CRON_TIMEZONE, WORKFLOWS_TYPE } from '@/workflowsV2/constants';

/** Inert marker for the tenant context — only `workspaceId` is read by the stamper. */
const SERVICE_ACTOR = 'workflows-worker';

const CONCURRENCY = config.workflows.workerConcurrency;

/**
 * Resolve which workspace a job acts as, BEFORE any tenant context is open.
 *
 * This is the ordering constraint that makes the whole worker correct. `db` scopes every
 * read to the ambient workspace and stamps every write with it, but a job arrives with
 * nothing but an id — the process cannot know which tenant to become until it has read a
 * row, and it cannot read that row while scoped. Hence `runAsSystem` here, and only here.
 *
 * Both rows carry `workspaceId` directly (the adapter stamps it), so this is one indexed
 * read, not a join.
 */
const workspaceForExecution = (executionId: string): Promise<string | null> =>
  runAsSystem(async () => {
    const row = await db.workflowExecution.findFirst({
      where: { id: executionId, workflowType: WORKFLOWS_TYPE },
      select: { workspaceId: true },
    });
    return row?.workspaceId ?? null;
  });

const workspaceForWorkflow = (workflowId: string): Promise<string | null> =>
  runAsSystem(async () => {
    const row = await db.workflow.findFirst({
      where: { id: workflowId, workflowType: WORKFLOWS_TYPE },
      select: { workspaceId: true },
    });
    return row?.workspaceId ?? null;
  });

const scheduler = new BullSchedulerAdapter();

class WorkflowsWorker {
  private isStarted = false;

  async start(): Promise<void> {
    if (this.isStarted) return;

    await initWorkflows();

    workflowsQueue
      .getQueue()
      .process(WORKFLOWS_JOB_NAME, CONCURRENCY, (job: Bull.Job<WorkflowsJobData>) =>
        this.runExecution(job.data.executionId),
      );

    workflowsCronQueue
      .getQueue()
      .process(WORKFLOWS_CRON_JOB_NAME, (job: Bull.Job<WorkflowsCronJobData>) =>
        this.runCronTick(job.data.workflowId),
      );

    this.isStarted = true;
    logger.info(`[WORKFLOWS-WORKER] Started (execution concurrency ${String(CONCURRENCY)})`);

    await this.recoverCronSchedules();
  }

  /**
   * One pass over an execution.
   *
   * Everything inside `runAsServiceActor` — the executor's step writes, credential
   * resolution and attachment storage all go through `db` or the adapters, and every one
   * of them reads the ambient workspace. Without this wrapper the writes would either
   * throw for want of a context or, worse, land unscoped.
   *
   * `service` rather than `user` as the actor kind: this is work done on behalf of the
   * workspace, not a member — there is no caller at execution time, which is exactly why
   * the SDK carries the tenant on the resource.
   */
  private async runExecution(executionId: string): Promise<void> {
    const workspaceId = await workspaceForExecution(executionId);
    if (!workspaceId) {
      // Not ours, or gone. Deleting an execution mid-flight is legitimate, so this is
      // informational rather than an error — and returning drops the job cleanly.
      logger.info(
        `[WORKFLOWS-WORKER] execution ${executionId} not found or not an SDK run — skipping`,
      );
      return;
    }

    await runAsServiceActor(SERVICE_ACTOR, workspaceId, async () => {
      const result = await workflowRuntime.processJob(executionId);
      logger.info(
        `[WORKFLOWS-WORKER] execution ${executionId} → ${result.status}` +
          ('reason' in result && result.reason ? ` (${result.reason})` : ''),
      );
    });
  }

  /**
   * One cron tick. Creating the execution happens inside `processCronTick`, so this needs
   * the same tenant context as a run — the row it writes is a workflow execution like any
   * other.
   */
  private async runCronTick(workflowId: string): Promise<void> {
    const workspaceId = await workspaceForWorkflow(workflowId);
    if (!workspaceId) {
      logger.info(
        `[WORKFLOWS-WORKER] cron tick for unknown workflow ${workflowId} — skipping`,
      );
      return;
    }

    await runAsServiceActor(SERVICE_ACTOR, workspaceId, async () => {
      const executionId = await workflowRuntime.processCronTick(workflowId);
      if (executionId) {
        logger.info(`[WORKFLOWS-WORKER] cron tick for ${workflowId} started ${executionId}`);
      }
    });
  }

  /**
   * Cold-start recovery.
   *
   * Bull repeatables live in Redis, so a flushed or migrated Redis loses every schedule
   * while the workflows stay ACTIVE in postgres — silently, with no error anywhere and no
   * runs. Re-registering from the database on boot makes postgres the source of truth for
   * *what* is scheduled and Redis merely the mechanism.
   *
   * `schedule()` unschedules first, so this is safe to run on every boot.
   */
  private async recoverCronSchedules(): Promise<void> {
    try {
      const active = await persistence.listAllActiveWorkflows();
      let restored = 0;

      for (const workflow of active) {
        if (!workflow.config) continue;
        let trigger: { type?: string; config?: { expression?: string } } | undefined;
        try {
          trigger = (JSON.parse(workflow.config) as { trigger?: typeof trigger }).trigger;
        } catch {
          logger.warn(`[WORKFLOWS-WORKER] workflow ${workflow.id} has unparseable config`);
          continue;
        }
        if (trigger?.type !== 'CRON' || !trigger.config?.expression) continue;

        // The scheduler adapter directly, not `activateWorkflow`: the workflow is already
        // ACTIVE in postgres and needs no re-authorization — the only thing missing is the
        // Redis entry. `activateWorkflow` would also demand a caller ctx, and a cold start
        // has none.
        try {
          await scheduler.schedule(workflow.id, trigger.config.expression, DEFAULT_CRON_TIMEZONE);
          restored++;
        } catch (err) {
          logger.error(`[WORKFLOWS-WORKER] failed to restore cron for ${workflow.id}`, err);
        }
      }

      if (restored > 0) {
        logger.info(`[WORKFLOWS-WORKER] Cold-start: restored ${String(restored)} cron schedule(s)`);
      }
    } catch (err) {
      logger.error(
        '[WORKFLOWS-WORKER] Cold-start cron recovery failed — cron workflows may not fire until the next restart',
        err,
      );
    }
  }

  async stop(): Promise<void> {
    if (!this.isStarted) return;
    await workflowsQueue.close();
    await workflowsCronQueue.close();
    this.isStarted = false;
    logger.info('[WORKFLOWS-WORKER] Stopped');
  }
}

export const workflowsWorker = new WorkflowsWorker();
