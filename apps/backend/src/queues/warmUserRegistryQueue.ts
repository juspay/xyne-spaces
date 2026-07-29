/**
 * Warm User Registry Queue
 *
 * Pre-computes the STT hint-name list (bot users, then active users on our own
 * domain) once a day and caches it in Redis, so the transcription agent's
 * /api/transcriptionAgent/user-names endpoint is a fast cache read instead of
 * a live query on every transcription request.
 *
 * Schedule: WARM_USER_REGISTRY_CRON (default '0 3 * * *' = daily 03:00 UTC).
 * Multi-pod safe via Bull/Redis distributed locks — exactly one pod picks
 * up each scheduled fire.
 */

import Bull from 'bull';
import { UserStatus, UserType } from '@prisma/client';
import { redisService } from '@/services/redisService';
import { DatabaseClient } from '@/database/client';
import { logger } from '@/utils/logger';

const TAG = '[WarmUserRegistry]';
const WARM_USER_REGISTRY_CRON = process.env.WARM_USER_REGISTRY_CRON || '0 3 * * *';

export const STT_HINT_NAMES_REDIS_KEY = 'voiceInput:sttHintNames';
// Refresh window is 24h; expire the cache a bit past that so a stalled cron
// self-heals to "no cache" (the controller falls back to a live query) instead
// of serving indefinitely stale names.
const STT_HINT_NAMES_TTL_SECONDS = 26 * 60 * 60;

/**
 * STT hint-name priority (highest first, ahead of the agent's own hardcoded
 * hot words): bot users (all of them), then active human users on our own
 * domain. Bots are queried unconditionally; the second tier excludes bots so
 * a name can't appear in both groups. Deduplicated case-insensitively.
 */
export async function computeSttHintNames(): Promise<string[]> {
  const db = DatabaseClient.getInstance();

  const [botUsers, activeJuspayUsers] = await Promise.all([
    db.user.findMany({
      where: { userType: UserType.BOT },
      select: { name: true },
      orderBy: { name: 'asc' },
    }),
    db.user.findMany({
      where: {
        status: UserStatus.ACTIVE,
        userType: { not: UserType.BOT },
        email: { endsWith: '@juspay.in', mode: 'insensitive' },
      },
      select: { name: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  const seen = new Set<string>();
  const names: string[] = [];
  for (const u of [...botUsers, ...activeJuspayUsers]) {
    const name = (u.name || '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }

  logger.info(
    `${TAG} Computed ${names.length} STT hint names (bots=${botUsers.length}, activeJuspay=${activeJuspayUsers.length})`
  );
  return names;
}

async function warmUserRegistry(): Promise<void> {
  const names = await computeSttHintNames();
  await redisService.set(STT_HINT_NAMES_REDIS_KEY, JSON.stringify(names), STT_HINT_NAMES_TTL_SECONDS);
  logger.info(`${TAG} Cached ${names.length} names to Redis`);
}

class WarmUserRegistryQueue {
  private queue: Bull.Queue | null = null;
  private workerInitialized = false;

  private async ensureQueue(): Promise<Bull.Queue> {
    if (this.queue) return this.queue;

    this.queue = new Bull('warm-user-registry', {
      redis: {
        ...redisService.getRedisConfig(),
        lazyConnect: false,
      },
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    });

    return this.queue;
  }

  async initialize(): Promise<void> {
    const queue = await this.ensureQueue();
    if (this.workerInitialized) return;

    queue.process('warm', async () => {
      await warmUserRegistry();
    });

    queue.on('failed', (job, err) => {
      logger.error(`${TAG} Job failed`, {
        jobName: job.name,
        jobId: job.id,
        error: err.message,
      });
    });

    queue.on('error', err => {
      logger.error(`${TAG} Queue error`, err);
    });

    // Re-register the repeatable cleanly across restarts. If the cron is
    // changed via env between deploys, this ensures the new schedule wins.
    const repeatableJobs = await queue.getRepeatableJobs();
    for (const job of repeatableJobs) {
      if (job.name === 'warm') {
        await queue.removeRepeatableByKey(job.key);
      }
    }

    await queue.add(
      'warm',
      {},
      {
        repeat: { cron: WARM_USER_REGISTRY_CRON },
        jobId: 'warm-user-registry-repeatable',
      },
    );

    // Enqueue a delayed one-off run so the cache isn't empty for up to 24h
    // after a fresh deploy/Redis flush — give the app ~30s to finish boot
    // first so it doesn't race with DB/Redis/queue init. Fixed jobId so a
    // multi-pod rollout (every pod runs this on boot) dedupes to one job
    // instead of N concurrent full-table scans + Redis writes.
    await queue.add('warm', {}, { delay: 30_000, jobId: 'warm-user-registry-boot' });

    this.workerInitialized = true;
    logger.info(
      `${TAG} Queue initialized (${WARM_USER_REGISTRY_CRON}), immediate first run enqueued`,
    );
  }

  async close(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
    }
    this.workerInitialized = false;
  }
}

export const warmUserRegistryQueue = new WarmUserRegistryQueue();
