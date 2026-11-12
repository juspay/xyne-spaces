/**
 * Execution queue for conversational flows — the user-facing half of
 * `@xyne/workflow-sdk`.
 *
 * The same shape as `workflowsQueue`: one job = one pass over an execution,
 * `jobId` carries single-writer. What differs is everything about *waiting*. A
 * conversational pass is a person's next message being answered, so it is short,
 * it is latency-critical, and when a worker dies mid-pass the person is sitting
 * there looking at nothing. An async run is the opposite on all three counts.
 *
 * Those are queue-level settings in Bull, not per-job — `lockDuration` and
 * `stalledInterval` belong to the queue — which is why this is a second queue
 * rather than a second job name on the first one. A conversation's 60-second
 * lock and a document pipeline's fifteen minutes cannot share a stalled-checker
 * without one of them being wrong.
 *
 * The cost of the split: two queues are two `jobId` keyspaces, so a run must not
 * change lanes part-way through its life. The lane comes from the workflow's
 * `metadata.kind`, which is set at creation and never rewritten — see
 * `BullQueueAdapter.enqueue`.
 */
import Bull from 'bull';
import { logger } from '@/utils/logger';
import { redisService } from '@/services/redisService';
import { config } from '@/config/env';

export const CONVERSATIONAL_FLOW_QUEUE_NAME = 'conversational-flow-execution';
export const CONVERSATIONAL_FLOW_JOB_NAME = 'run-conversational-flow';

export interface ConversationalFlowJobData {
  executionId: string;
}

/**
 * Short, because a conversational pass is short and the person is waiting: a
 * worker lost mid-pass costs them this long, not the fifteen minutes an async
 * run is allowed. The SDK's floor is 60s (`WORKFLOWS_LOCK_DURATION_MS`), and
 * that floor is the right answer here.
 */
const LOCK_DURATION_MS = config.workflows.conversationalFlow.lockDurationMs;

class ConversationalFlowQueue {
  private queue: Bull.Queue<ConversationalFlowJobData> | null = null;
  private isInitialized = false;
  private isInitializing = false;

  async initialize(): Promise<void> {
    if (this.isInitialized || this.isInitializing) return;
    this.isInitializing = true;

    try {
      this.queue = new Bull<ConversationalFlowJobData>(CONVERSATIONAL_FLOW_QUEUE_NAME, {
        redis: {
          ...redisService.getRedisConfig(),
          lazyConnect: false,
        },
        defaultJobOptions: {
          // As on the execution queue: the SDK owns retry policy, and BOTH
          // removeOn flags must stay true or `jobId` wedges the execution — Bull
          // refuses to add a job whose id already exists, in any state.
          attempts: 1,
          removeOnComplete: true,
          removeOnFail: true,
        },
        settings: {
          lockDuration: LOCK_DURATION_MS,
          stalledInterval: LOCK_DURATION_MS,
          maxStalledCount: 1,
        },
      });

      this.setupEventListeners();
      this.isInitialized = true;
      logger.info(
        `[CONVERSATIONAL-FLOW-QUEUE] Initialized (lockDuration ${String(LOCK_DURATION_MS)}ms)`,
      );
    } catch (error) {
      logger.error('[CONVERSATIONAL-FLOW-QUEUE] Failed to initialize:', error);
      this.isInitialized = false;
    } finally {
      this.isInitializing = false;
    }
  }

  private setupEventListeners(): void {
    if (!this.queue) return;

    this.queue.on('failed', (job, err) => {
      logger.error(
        `[CONVERSATIONAL-FLOW-QUEUE] Job ${String(job.id)} failed — execution ${job.data.executionId}`,
        err,
      );
    });

    // On this queue a stall is also somebody's chat hanging, so it is worth
    // saying loudly: the lock expired mid-pass and a second worker may now be
    // walking the same conversation.
    this.queue.on('stalled', (job) => {
      logger.warn(
        `[CONVERSATIONAL-FLOW-QUEUE] Job ${String(job.id)} stalled — execution ${job.data.executionId} exceeded lockDuration`,
      );
    });

    this.queue.on('error', (err) => {
      logger.error('[CONVERSATIONAL-FLOW-QUEUE] Queue error:', err);
    });
  }

  getQueue(): Bull.Queue<ConversationalFlowJobData> {
    if (!this.queue) {
      throw new Error('[CONVERSATIONAL-FLOW-QUEUE] Queue not initialized — call initialize() first');
    }
    return this.queue;
  }

  get isReady(): boolean {
    return this.isInitialized && this.queue !== null;
  }

  async close(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
      this.isInitialized = false;
      logger.info('[CONVERSATIONAL-FLOW-QUEUE] Closed');
    }
  }
}

export const conversationalFlowQueue = new ConversationalFlowQueue();
