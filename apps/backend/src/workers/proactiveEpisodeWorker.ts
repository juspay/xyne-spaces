import type Bull from 'bull';
import { logger } from '@/utils/logger';
import { proactiveEpisodeQueue, type ProactiveEpisodeJob } from '@/queues/proactiveEpisodeQueue';
import {
  onDeadline,
  onDraft,
  onDraftTimeout,
  onMessage,
  onRecheck,
} from '@/services/proactivity/pipeline';

const CONCURRENCY = 5;

/**
 * Runs agent proactivity's jobs: new messages, returned drafts, and the delayed "look
 * again now" ones, where the pipeline reloads state, so a job that fires late or twice
 * changes nothing.
 * Idle unless a channel has proactivity on: nothing enqueues otherwise.
 */
class ProactiveEpisodeWorker {
  private started = false;

  async start(): Promise<void> {
    if (this.started) return;
    await proactiveEpisodeQueue.initialize();
    proactiveEpisodeQueue
      .getQueue()
      .process(CONCURRENCY, (job: Bull.Job<ProactiveEpisodeJob>) =>
        this.process(job.data, job.attemptsMade + 1 >= (job.opts.attempts ?? 1))
      );
    proactiveEpisodeQueue.getQueue().on('failed', (job, error) =>
      logger.error(`[PROACTIVE-EPISODE-WORKER] ${job.data.type} job failed`, {
        job: job.data,
        error,
      })
    );
    this.started = true;
    logger.info(`[PROACTIVE-EPISODE-WORKER] Started (concurrency=${CONCURRENCY})`);
  }

  private process(job: ProactiveEpisodeJob, lastTry: boolean): Promise<void> {
    switch (job.type) {
      case 'message':
        return onMessage(job.messageId);
      case 'draft':
        return onDraft(job.episodeId, job.agentSlug, job.result, job.context);
      case 'deadline':
        return onDeadline(job, lastTry);
      case 'recheck':
        return onRecheck(job.episodeId, job.agentSlug, job.content, job.context);
      case 'draftTimeout':
        return onDraftTimeout(job.episodeId, job.agentSlug, job.attempt);
    }
  }

  async shutdown(): Promise<void> {
    await proactiveEpisodeQueue.close();
    this.started = false;
  }
}

export const proactiveEpisodeWorker = new ProactiveEpisodeWorker();
