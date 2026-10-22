import Bull from 'bull';
import { logger } from '@/utils/logger';
import { config } from '@/config/env';
import { redisService } from '@/services/redisService';
import type { DraftResult } from '@/services/proactivity/dispatch';
import type { DraftContent, DraftContext } from '@/services/proactivity/types';

/**
 * Jobs for agent proactivity, so all of its work runs in the worker, not the API pods.
 * The delayed ones are "look again at this time": the worker reloads current state and
 * decides, so a stale or duplicate job is harmless.
 *
 * - message: a new message in a channel where proactivity is on.
 * - draft: an agent's draft came back; the check before posting runs on it.
 * - deadline: an episode's wait may be over. Re-arms itself if the deadline moved.
 * - recheck: an agent's draft is waiting for someone to finish typing. It carries the
 *   draft and its state, which are stored nowhere else, and is removed once it runs.
 * - draftTimeout: one agent's draft still out after the limit is dropped.
 */
export type ProactiveEpisodeJob =
  | { type: 'message'; messageId: string }
  | {
      type: 'draft';
      episodeId: string;
      agentSlug: string;
      result: DraftResult;
      context: DraftContext;
    }
  | {
      type: 'deadline';
      channelId: string;
      senderId: string;
      scope: string;
      episodeId: string;
    }
  | {
      type: 'recheck';
      episodeId: string;
      agentSlug: string;
      content: DraftContent;
      context: DraftContext;
    }
  | { type: 'draftTimeout'; episodeId: string; agentSlug: string; attempt: number };

class ProactiveEpisodeQueue {
  private queue: Bull.Queue<ProactiveEpisodeJob> | null = null;
  private initializing: Promise<void> | null = null;

  initialize(): Promise<void> {
    this.initializing ??= (async () => {
      this.queue = new Bull<ProactiveEpisodeJob>('proactive-episode', {
        redis: { ...redisService.getRedisConfig(), lazyConnect: false },
        defaultJobOptions: {
          attempts: 2,
          backoff: { type: 'fixed', delay: 2000 },
          removeOnComplete: true,
          // The last failures stay for a look; Bull trims older ones.
          removeOnFail: 200,
        },
        settings: { lockDuration: 60_000, stalledInterval: 30_000, maxStalledCount: 1 },
      });
      this.queue.on('error', (error) =>
        logger.error('[PROACTIVE-EPISODE-QUEUE] Queue error', { error })
      );
      logger.info('[PROACTIVE-EPISODE-QUEUE] Initialized');
    })().catch((error) => {
      this.initializing = null;
      throw error;
    });
    return this.initializing;
  }

  /**
   * Run `job` at `at`. The id makes a repeat for the same moment a no-op. Never throws:
   * a lost job only means an agent stays quiet.
   */
  async schedule(job: ProactiveEpisodeJob, at: number): Promise<void> {
    // With no worker to run them, delayed jobs would only pile up in Redis.
    if (!config.enableProactivityWorker) return;
    try {
      await this.initialize();
      const id = jobId(job, at);
      await this.queue!.add(job, { jobId: id, delay: Math.max(0, at - Date.now()) });
    } catch (error) {
      logger.error('[PROACTIVE-EPISODE-QUEUE] Failed to schedule', { job, error });
    }
  }

  getQueue(): Bull.Queue<ProactiveEpisodeJob> {
    if (!this.queue) throw new Error('[PROACTIVE-EPISODE-QUEUE] not initialized');
    return this.queue;
  }

  async close(): Promise<void> {
    await this.queue?.close();
    this.queue = null;
    this.initializing = null;
  }
}

function jobId(job: ProactiveEpisodeJob, at: number): string {
  switch (job.type) {
    case 'message':
      return `message:${job.messageId}`;
    case 'draft':
      return `draft:${job.episodeId}:${job.agentSlug}:${job.context.redrafts}`;
    case 'deadline':
      // The scope too: an episode set aside keeps its deadline under a new key.
      return `deadline:${job.episodeId}:${job.scope}:${at}`;
    default:
      return `${job.type}:${job.episodeId}:${job.agentSlug}:${at}`;
  }
}

export const proactiveEpisodeQueue = new ProactiveEpisodeQueue();
