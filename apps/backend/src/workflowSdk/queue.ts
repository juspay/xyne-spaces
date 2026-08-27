// Bull queue for the workflow-sdk engine. One queue, two named job types:
//   'execute'   {executionId} — one engine pass over an execution
//   'cron-tick' {workflowId}  — a CRON trigger firing (repeatable job)
// The API process only enqueues; the worker process (initWorkflowSdkWorkers)
// registers the processors.

import Bull from 'bull';
import { logger } from '@/utils/logger';
import { redisService } from '@/services/redisService';
import type { QueueAdapter } from '@xyne/workflow-sdk';

const WORKFLOW_SDK_QUEUE = 'workflow-sdk-execution';

export type WorkflowSdkJobData = { executionId: string } | { workflowId: string };

class WorkflowSdkBullQueue {
  private queue: Bull.Queue<WorkflowSdkJobData> | null = null;

  getQueue(): Bull.Queue<WorkflowSdkJobData> {
    if (this.queue) return this.queue;
    this.queue = new Bull<WorkflowSdkJobData>(WORKFLOW_SDK_QUEUE, {
      redis: {
        ...redisService.getRedisConfig(),
        lazyConnect: false,
      },
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: true,
      },
      settings: {
        lockDuration: 120000,
        stalledInterval: 60000,
        maxStalledCount: 2,
      },
    });
    this.queue.on('error', err => {
      logger.error('[WORKFLOW-SDK-QUEUE] Queue error:', err);
    });
    this.queue.on('stalled', job => {
      logger.warn(`[WORKFLOW-SDK-QUEUE] Job ${job.id} stalled`);
    });
    logger.info('[WORKFLOW-SDK-QUEUE] Initialized');
    return this.queue;
  }
}

export const workflowSdkQueue = new WorkflowSdkBullQueue();

export class BullQueueAdapter implements QueueAdapter {
  async enqueue(data: {
    executionId: string;
    delay?: number;
    singletonKey?: string;
  }): Promise<void> {
    const queue = workflowSdkQueue.getQueue();
    // `singletonKey` is deliberately IGNORED (as the reference pg-boss adapter
    // also does). It cannot be mapped to a Bull `jobId`: Bull *drops* an add()
    // for an id that already exists rather than queueing it behind the running
    // one, and the runtime re-enqueues an execution from inside its own pass
    // ("gate payload arrived mid-pass", workflow-runtime.js:1115) while that
    // job is still active — so the follow-up pass would be silently discarded
    // and the execution would sit in EXTERNAL_WAIT forever.
    await queue.add(
      'execute',
      { executionId: data.executionId },
      {
        ...(data.delay && data.delay > 0 ? { delay: data.delay } : {}),
      },
    );
  }
}
