/**
 * Consumer side of conversational flows. Runs in its own worker process.
 *
 * Deliberately not part of `workflowsWorker`: the two want opposite settings and
 * opposite deployments. This one is sized for passes that a person is waiting
 * on — many at once, each short, mostly waiting on a model or the database — and
 * it must not share a process with anything that can hold the event loop or the
 * memory it needs. `WORKFLOW_TYPE` co-tenancy is what it exists to escape.
 *
 * Concurrency is high because the work is I/O-bound, not because the box is big:
 * what bounds it is the connection pool and the event loop, not cores. Size for
 * headroom rather than capacity — queueing delay is near zero while slots are
 * free and explodes once they are not, and "free slot" is the whole definition
 * of an immediate reply.
 */
import type Bull from 'bull';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { workspaceForExecution } from '@/bypassAcl/workflowServices';
import { runExecutionUnderServiceActor } from '@/bypassAcl/workflowOperations';
import {
  CONVERSATIONAL_FLOW_JOB_NAME,
  conversationalFlowQueue,
  type ConversationalFlowJobData,
} from '@/queues/conversationalFlowQueue';
import { initWorkflows } from '@/workflowsV2/runtime';

const CONCURRENCY = config.workflows.conversationalFlow.workerConcurrency;

class ConversationalFlowWorker {
  private isStarted = false;

  async start(): Promise<void> {
    if (this.isStarted) return;

    await initWorkflows();

    conversationalFlowQueue
      .getQueue()
      .process(CONVERSATIONAL_FLOW_JOB_NAME, CONCURRENCY, (job: Bull.Job<ConversationalFlowJobData>) =>
        this.runExecution(job.data.executionId),
      );

    this.isStarted = true;
    logger.info(`[CONVERSATIONAL-FLOW-WORKER] Started (concurrency ${String(CONCURRENCY)})`);
  }

  /**
   * One pass over a conversation — the same call the execution worker makes, in
   * the same service-actor context. Nothing about running a pass differs; only
   * where and how many.
   */
  private async runExecution(executionId: string): Promise<void> {
    const workspaceId = await workspaceForExecution(executionId);
    if (!workspaceId) {
      logger.info(
        `[CONVERSATIONAL-FLOW-WORKER] execution ${executionId} not found or not an SDK run — skipping`,
      );
      return;
    }

    const result = await runExecutionUnderServiceActor(executionId, workspaceId);
    logger.info(
      `[CONVERSATIONAL-FLOW-WORKER] execution ${executionId} → ${result.status}` +
        ('reason' in result && result.reason ? ` (${result.reason})` : ''),
    );
  }

  /**
   * Stop taking new passes and let the ones in flight finish — `close()` waits
   * for active jobs. This is what makes a rolling deploy cost a person nothing:
   * without it their turn is killed mid-pass and nothing re-drives it until the
   * lock expires.
   */
  async stop(): Promise<void> {
    if (!this.isStarted) return;
    await conversationalFlowQueue.close();
    this.isStarted = false;
    logger.info('[CONVERSATIONAL-FLOW-WORKER] Stopped');
  }
}

export const conversationalFlowWorker = new ConversationalFlowWorker();
