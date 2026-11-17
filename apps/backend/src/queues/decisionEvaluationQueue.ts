import Bull from 'bull';
import { z } from 'zod';
import { logger } from '@/utils/logger';
import { redisService } from '@/services/redisService';
import {
  DECISION_ENGINES,
  QUESTION_FEATURES,
  TASK_FEATURES,
  type ComparedAnswer,
  type DecisionAnswer,
  type DecisionEngine,
  type DecisionQuestion,
  type QuestionFeature,
  type TaskFeature,
  type TaskInput,
} from '@/services/decision/types';

export const COMPARE_JOB = 'compare-xor';
export const EVALUATE_JOB = 'evaluate-task';

/** A job not run within this long is dropped: its content must not linger in Redis. */
export const JOB_TTL_MS = 60 * 60 * 1000;

/** A decision on typed questions, to put to the engines that did not answer it. */
export interface CompareJob {
  feature: QuestionFeature;
  workspaceId: string;
  liveEngine: DecisionEngine;
  state: string | Record<string, unknown>;
  questions: Record<string, DecisionQuestion>;
  liveAnswers: Record<string, DecisionAnswer> | null;
}

/** A decided task, to put to the engines that did not answer it live. */
export interface EvaluateJob {
  feature: TaskFeature;
  workspaceId: string;
  input: TaskInput;
  /** In the order they ran; the last is the answer users got. */
  liveAnswers: ComparedAnswer[];
}

const MAX_CONTENT_CHARS = 60_000;
const MAX_QUESTIONS = 20;

const boundedJson = (value: unknown): boolean => {
  try {
    return JSON.stringify(value).length <= MAX_CONTENT_CHARS;
  } catch {
    return false;
  }
};

const QuestionShape = z.looseObject({ type: z.enum(['noul', 'choice', 'score']) });

const CompareJobSchema = z.object({
  feature: z.enum(QUESTION_FEATURES),
  workspaceId: z.string().min(1).max(64),
  liveEngine: z.enum(DECISION_ENGINES),
  state: z.union([z.string().max(MAX_CONTENT_CHARS), z.record(z.string(), z.unknown())]).refine(boundedJson),
  questions: z
    .record(z.string().max(64), QuestionShape)
    .refine((q) => Object.keys(q).length > 0 && Object.keys(q).length <= MAX_QUESTIONS)
    .refine(boundedJson),
  liveAnswers: z.record(z.string(), z.unknown()).nullable().refine(boundedJson),
});

const EvaluateJobSchema = z.object({
  feature: z.enum(TASK_FEATURES),
  workspaceId: z.string().min(1).max(64),
  input: z.object({
    channelId: z.string().min(1).max(64),
    emailSubject: z.string().max(2_000),
    emailBody: z.string().max(MAX_CONTENT_CHARS),
    emailMetadata: z.record(z.string(), z.unknown()).optional().refine(boundedJson),
    modelName: z.string().max(200),
  }),
  liveAnswers: z
    .array(
      z.object({
        engine: z.enum(DECISION_ENGINES),
        label: z.string().max(500).nullable(),
        confidence: z.number().optional(),
        model: z.string().max(200).optional(),
      }),
    )
    .max(DECISION_ENGINES.length),
});

/** A queued job is only content in Redis: null unless it has the shape this module enqueues. */
export const parseCompareJob = (data: unknown): CompareJob | null => {
  const parsed = CompareJobSchema.safeParse(data);
  return parsed.success ? (data as CompareJob) : null;
};

export const parseEvaluateJob = (data: unknown): EvaluateJob | null => {
  const parsed = EvaluateJobSchema.safeParse(data);
  return parsed.success ? (data as EvaluateJob) : null;
};

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
