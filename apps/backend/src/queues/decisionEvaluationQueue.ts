import Bull from 'bull';
import { logger } from '@/utils/logger';
import { redisService } from '@/services/redisService';
import type {
  ComparedAnswer,
  DecisionAnswer,
  DecisionEngine,
  DecisionQuestion,
  QuestionFeature,
  TaskFeature,
  TaskInput,
} from '@/services/decision/types';

export const COMPARE_JOB = 'compare-xor';
export const EVALUATE_JOB = 'evaluate-task';

/** A job not run within this long is dropped: its content must not linger in Redis. */
export const JOB_TTL_MS = 60 * 60 * 1000;

/** A decision on typed questions, to put to the engines that did not answer it. */
export interface CompareJob {
  feature: QuestionFeature;
  liveEngine: DecisionEngine;
  state: string | Record<string, unknown>;
  questions: Record<string, DecisionQuestion>;
  liveAnswers: Record<string, DecisionAnswer> | null;
}

/** A decided task, to put to the engines that did not answer it live. */
export interface EvaluateJob {
  feature: TaskFeature;
  input: TaskInput;
  /** In the order they ran; the last is the answer users got. */
  liveAnswers: ComparedAnswer[];
}

class DecisionEvaluationQueue {
  private queue: Bull.Queue | null = null;

  /** Called by the API and worker processes when DECISION_EVAL_ENABLED is on. Until then add() does nothing. */
  async initialize(): Promise<void> {
    if (this.queue) return;
    this.queue = new Bull('decision-evaluation', {
      redis: { ...redisService.getRedisConfig(), lazyConnect: false },
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: true,
        removeOnFail: true,
      },
    });
    this.queue.on('error', (error) => logger.error('[DECISION-EVALUATION] Queue error', { error: error.message }));
    logger.info('[DECISION-EVALUATION] Queue initialized');
  }

  getQueue(): Bull.Queue | null {
    return this.queue;
  }

  /** Fire and forget: never throws, and does nothing while the queue is off. */
  add(name: typeof COMPARE_JOB, data: CompareJob): void;
  add(name: typeof EVALUATE_JOB, data: EvaluateJob): void;
  add(name: string, data: CompareJob | EvaluateJob): void {
    this.queue?.add(name, data).catch((error: unknown) => {
      logger.warn('[DECISION-EVALUATION] Enqueue failed', {
        job: name,
        feature: data.feature,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  /** Bull has no per-job TTL, so jobs left waiting or awaiting a retry past it are deleted here. */
  async removeExpired(): Promise<void> {
    if (!this.queue) return;
    const [waiting, delayed] = await Promise.all([
      this.queue.clean(JOB_TTL_MS, 'wait'),
      this.queue.clean(JOB_TTL_MS, 'delayed'),
    ]);
    if (waiting.length + delayed.length > 0) {
      logger.warn('[DECISION-EVALUATION] Dropped expired jobs', { waiting: waiting.length, delayed: delayed.length });
    }
  }

  async close(): Promise<void> {
    await this.queue?.close();
    this.queue = null;
  }
}

export const decisionEvaluationQueue = new DecisionEvaluationQueue();
