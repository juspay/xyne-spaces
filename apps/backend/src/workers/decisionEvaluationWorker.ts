import { logger } from '@/utils/logger';
import { EmailClassificationService } from '@/services/emailClassificationService';
import { compare, evaluate } from '@/services/decision/evaluation';
import type Bull from 'bull';
import {
  COMPARE_JOB,
  EVALUATE_JOB,
  JOB_TTL_MS,
  decisionEvaluationQueue,
  type CompareJob,
  type EvaluateJob,
} from '@/queues/decisionEvaluationQueue';

/** Per job type; each job is a few LLM and Jev calls that only feed metrics. */
const CONCURRENCY = 4;
const EXPIRY_SWEEP_MS = 10 * 60 * 1000;

/** Older than the TTL, counted from when it was queued, so a late retry is dropped too. */
const isExpired = (job: Bull.Job): boolean => Date.now() - job.timestamp > JOB_TTL_MS;

const emailClassificationService = new EmailClassificationService();

/** Puts queued decisions to the engines that did not answer them live; see decision/evaluation. */
class DecisionEvaluationWorker {
  private started = false;
  private expirySweep: NodeJS.Timeout | null = null;

  async start(): Promise<void> {
    if (this.started) return;
    await decisionEvaluationQueue.initialize();
    const queue = decisionEvaluationQueue.getQueue();
    if (!queue) return;

    void queue.process(COMPARE_JOB, CONCURRENCY, async (job) => {
      if (!isExpired(job)) await compare(job.data as CompareJob);
    });
    void queue.process(EVALUATE_JOB, CONCURRENCY, async (job) => {
      if (isExpired(job)) return;
      const data = job.data as EvaluateJob;
      const task = await emailClassificationService.evaluationTask(data.feature, data.input);
      if (task) await evaluate(task, data);
    });
    // Not job.data: it is customer content.
    queue.on('failed', (job, error) =>
      logger.warn('[DECISION-EVALUATION-WORKER] Job failed', {
        job: job.name,
        feature: (job.data as CompareJob | EvaluateJob).feature,
        attempt: job.attemptsMade,
        error: error.message,
      })
    );
    this.expirySweep = setInterval(() => {
      decisionEvaluationQueue.removeExpired().catch((error: unknown) =>
        logger.warn('[DECISION-EVALUATION-WORKER] Expiry sweep failed', {
          error: error instanceof Error ? error.message : String(error),
        })
      );
    }, EXPIRY_SWEEP_MS);
    this.started = true;
    logger.info('[DECISION-EVALUATION-WORKER] Started');
  }

  async shutdown(): Promise<void> {
    if (this.expirySweep) clearInterval(this.expirySweep);
    this.expirySweep = null;
    await decisionEvaluationQueue.close();
    this.started = false;
  }
}

export const decisionEvaluationWorker = new DecisionEvaluationWorker();
