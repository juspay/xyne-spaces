/**
 * `QueueAdapter` for `@xyne/workflow-sdk`, over Bull.
 *
 * One method, but the mapping of `singletonKey` is a real decision — see below. The Bull
 * queue itself lives in `src/queues/workflowsQueue.ts` per `docs/guidelines/JOBS.md`.
 */
import type { QueueAdapter } from '@xyne/workflow-sdk';
import { logger } from '@/utils/logger';
import {
  WORKFLOWS_JOB_NAME,
  workflowsQueue,
  type WorkflowsJobData,
} from '@/queues/workflowsQueue';

export class BullQueueAdapter implements QueueAdapter {
  /**
   * Enqueue one pass over an execution.
   *
   * **`singletonKey` → Bull `jobId`.** The runtime passes `executionId` here on both
   * resume paths so that at most one pass mutates a given execution at a time
   * (single-writer). The SDK permits hosts without singleton support to ignore it — we
   * must not. Two people approving two parallel gates a second apart, or a resume racing
   * the runtime's own mid-pass re-enqueue, would otherwise produce two concurrent walks:
   * both loading the step rows into `memo`, both writing back. That is precisely the
   * state the SDK's node-path reconciliation assumes cannot happen.
   *
   * Bull has no singleton, but `jobId` is equivalent for this purpose: adding a job whose
   * id already exists is a no-op, so while a pass is waiting or active a duplicate
   * enqueue collapses into it. This depends on `removeOnComplete`/`removeOnFail` both
   * being true — see the queue definition for why retaining finished jobs would wedge an
   * execution rather than merely litter Redis.
   *
   * The collapse is safe *because* a pass is level-triggered, not edge-triggered: it
   * re-reads every step row and acts on whatever payloads are present. A dropped
   * duplicate cannot lose a resume — the pass already in flight will see it. And for the
   * case where a payload lands after the walk read that node, `processJob` re-enqueues
   * once on its own.
   */
  async enqueue(data: {
    executionId: string;
    delay?: number;
    singletonKey?: string;
  }): Promise<void> {
    const queue = workflowsQueue.getQueue();
    const jobData: WorkflowsJobData = { executionId: data.executionId };
    const jobId = data.singletonKey ?? data.executionId;

    await queue.add(WORKFLOWS_JOB_NAME, jobData, {
      jobId,
      ...(data.delay !== undefined && data.delay > 0 ? { delay: data.delay } : {}),
    });

    logger.debug(
      `[WORKFLOWS-QUEUE] enqueued execution ${data.executionId}` +
        (data.delay ? ` (delay ${String(data.delay)}ms)` : ''),
    );
  }
}
