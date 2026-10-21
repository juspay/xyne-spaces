import Bull from 'bull';
import { logger, redisService } from '../../re-exports';
import { gatewayConfig } from '../../config';
import { GatewayError, isRetryable } from '../errors';
import type { GatewayHandler, GatewayJob, JobContext, ProviderId } from '../types';

const BACKOFF = 'gateway';
const RETRY_DELAYS_MS = [3_000, 60_000, 5 * 60_000, 2 * 3_600_000, 6 * 3_600_000, 12 * 3_600_000];
const FAILED_KEEP_SECONDS = 7 * 24 * 3_600;
const FAILED_SCAN_LIMIT = 1_000;

type JobRunner = (job: GatewayJob, context: JobContext) => Promise<void>;

export interface JobScope {
  workspaceId: string;
  provider: ProviderId;
}

export interface FailedJob {
  id: string;
  handler: string;
  type: string;
  refs: Record<string, string>;
  attempts: number;
  error: string;
  createdAt: Date;
  failedAt: Date | null;
}

export function inlineJobContext(): JobContext {
  const progress: Record<string, unknown> = {};
  return {
    lastAttempt: true,
    getProgress: <T>(key: string) => progress[key] as T | undefined,
    setProgress: async (key, value) => {
      progress[key] = value;
    },
  };
}

export class GatewayQueue {
  private readonly runners = new Map<string, JobRunner>();
  private readonly queues = new Map<string, Bull.Queue<GatewayJob>>();

  register(handlers: GatewayHandler[]): void {
    for (const handler of handlers) {
      if (handler.runJob) this.runners.set(handler.name, handler.runJob.bind(handler));
    }
  }

  async add(job: GatewayJob, jobId?: string): Promise<void> {
    await this.queueFor(job.handler).add(job, jobId ? { jobId } : {});
  }

  async isPending(handler: string, jobId: string): Promise<boolean> {
    const job = await this.queueFor(handler).getJob(jobId);
    return !!job && !(await job.isFailed());
  }

  startProcessing(handlers: string[]): void {
    for (const handler of handlers) {
      const run = this.runners.get(handler);
      if (!run) {
        logger.warn('[Gateway] No jobs to run for this handler', { handler });
        continue;
      }
      const queue = this.queueFor(handler);
      queue
        .process(gatewayConfig.jobConcurrency, (job) => this.run(job, run))
        .catch((error) => logger.error('[Gateway] Job processor stopped', { handler, error }));
      queue.on('failed', (job, error) => {
        const final = job.finishedOn !== undefined;
        logger[final ? 'error' : 'warn']('[Gateway] Job failed', {
          handler,
          jobId: job.id,
          type: job.data.type,
          attempt: job.attemptsMade,
          final,
          error: error.message,
        });
      });
    }
  }

  async listFailed(
    scope: JobScope,
    page: { limit: number; offset: number }
  ): Promise<{ jobs: FailedJob[]; total: number }> {
    const failed = await Promise.all(
      [...this.runners.keys()].map((handler) =>
        this.queueFor(handler).getFailed(0, FAILED_SCAN_LIMIT - 1)
      )
    );
    const matching = failed
      .flat()
      .filter((job) => inScope(job, scope))
      .sort((a, b) => (b.finishedOn ?? 0) - (a.finishedOn ?? 0));
    return {
      jobs: matching.slice(page.offset, page.offset + page.limit).map(toFailedJob),
      total: matching.length,
    };
  }

  async retryFailed(scope: JobScope, handler: string, jobId: string): Promise<void> {
    await (await this.findFailed(scope, handler, jobId)).retry();
  }

  async removeFailed(scope: JobScope, handler: string, jobId: string): Promise<void> {
    await (await this.findFailed(scope, handler, jobId)).remove();
  }

  async close(): Promise<void> {
    await Promise.all([...this.queues.values()].map((queue) => queue.close()));
    this.queues.clear();
  }

  private async run(job: Bull.Job<GatewayJob>, run: JobRunner): Promise<void> {
    const lastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    try {
      await run(job.data, this.contextFor(job, lastAttempt));
    } catch (error) {
      if (!isRetryable(error)) job.discard();
      throw error;
    }
  }

  private contextFor(job: Bull.Job<GatewayJob>, lastAttempt: boolean): JobContext {
    const progress = { ...job.data.progress };
    return {
      lastAttempt,
      getProgress: <T>(key: string) => progress[key] as T | undefined,
      setProgress: async (key, value) => {
        progress[key] = value;
        await job.update({ ...job.data, progress });
      },
    };
  }

  private async findFailed(
    scope: JobScope,
    handler: string,
    jobId: string
  ): Promise<Bull.Job<GatewayJob>> {
    const job = this.runners.has(handler) ? await this.queueFor(handler).getJob(jobId) : null;
    if (!job || !inScope(job, scope) || !(await job.isFailed())) {
      throw new GatewayError('JOB_NOT_FOUND', 'Failed job not found');
    }
    return job;
  }

  private queueFor(handler: string): Bull.Queue<GatewayJob> {
    if (!this.runners.has(handler)) {
      throw new GatewayError('VALIDATION_ERROR', `${handler} does not run jobs`);
    }
    let queue = this.queues.get(handler);
    if (!queue) {
      queue = new Bull<GatewayJob>(`gateway-${handler}`, {
        redis: { ...redisService.getRedisConfig(), lazyConnect: false },
        defaultJobOptions: {
          attempts: RETRY_DELAYS_MS.length + 1,
          backoff: { type: BACKOFF },
          removeOnComplete: true,
          removeOnFail: { age: FAILED_KEEP_SECONDS },
        },
        settings: {
          lockDuration: 60_000,
          stalledInterval: 30_000,
          maxStalledCount: 2,
          backoffStrategies: {
            [BACKOFF]: (attemptsMade: number) => RETRY_DELAYS_MS[attemptsMade - 1] ?? -1,
          },
        },
      });
      this.queues.set(handler, queue);
    }
    return queue;
  }
}

function inScope(job: Bull.Job<GatewayJob>, scope: JobScope): boolean {
  return job.data.workspaceId === scope.workspaceId && job.data.provider === scope.provider;
}

function toFailedJob(job: Bull.Job<GatewayJob>): FailedJob {
  return {
    id: String(job.id),
    handler: job.data.handler,
    type: job.data.type,
    refs: job.data.refs,
    attempts: job.attemptsMade,
    error: job.failedReason ?? '',
    createdAt: new Date(job.timestamp),
    failedAt: job.finishedOn ? new Date(job.finishedOn) : null,
  };
}
