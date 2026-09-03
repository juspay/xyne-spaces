/**
 * Gmail Watch Renewal Queue
 *
 * Brute-force daily renewal of every active Google ExternalSource's Gmail
 * watch. Gmail watches expire in ≤7 days; without periodic renewal, Pub/Sub
 * notifications for that mailbox stop arriving. `users.watch()` is idempotent
 * — re-calling on a healthy watch just resets its expiration, so re-calling
 * daily for every source is safe and cheap.
 *
 * Schedule: GMAIL_WATCH_RENEWAL_CRON (default '0 3 * * *' = daily 03:00 UTC).
 * Multi-pod safe via BullMQ/Redis distributed locks — exactly one pod picks
 * up each scheduled fire.
 */

import Bull from 'bull';
import { redisService } from '@/services/redisService';
import { ExternalSourceRepository } from '@/database/repositories/externalSourceRepository';
import { GoogleService } from '@/services/googleService';
import { ExternalSourcePlatform } from '@/integrations/core/types';
import { logger } from '@/utils/logger';

const TAG = '[GmailWatchRenewal]';
const GMAIL_WATCH_RENEWAL_CRON =
  process.env.GMAIL_WATCH_RENEWAL_CRON || '0 3 * * *';

// Process N sources concurrently per batch. Gmail's per-user quota is
// generous; keep this modest so one slow source doesn't stall the cycle.
const BATCH_SIZE = 10;

// Same "permanent auth failure" detection used by the manual refetch flow
// (external-source-sync.ts:174). Seeing one of these means the refresh token
// has been revoked and there's no way to recover from a background job —
// deactivate so we stop pounding a dead credential.
const PERMANENT_AUTH_ERROR = /invalid_grant|unauthorized_client|invalid_token/i;

const externalSourceRepo = new ExternalSourceRepository();

type RenewResult =
  | { status: 'renewed'; expiration: string; historyId: string }
  | { status: 'deactivated'; reason: string }
  | { status: 'failed'; reason: string };

async function renewSource(source: {
  id: string;
  name: string;
  credentials: string;
}): Promise<RenewResult> {
  try {
    const svc = GoogleService.fromEncryptedCredentials(source.credentials, source.id);
    const result = await svc.renewGmailWatch();
    logger.info(`${TAG} renewed`, {
      sourceName: source.name,
      historyId: result.historyId,
      expiration: result.expiration,
    });
    return { status: 'renewed', expiration: result.expiration, historyId: result.historyId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (PERMANENT_AUTH_ERROR.test(message)) {
      try {
        await externalSourceRepo.update(source.id, { isActive: false });
        logger.error(`${TAG} deactivated source due to bad credentials`, {
          sourceName: source.name,
          error: message,
        });
      } catch (deactivateErr) {
        logger.error(`${TAG} failed to deactivate source`, {
          sourceName: source.name,
          error: deactivateErr,
        });
      }
      return { status: 'deactivated', reason: message };
    }
    logger.warn(`${TAG} renewal failed (transient)`, {
      sourceName: source.name,
      error: message,
    });
    return { status: 'failed', reason: message };
  }
}

async function renewAllGmailWatches(): Promise<void> {
  const startedAt = Date.now();
  const sources = await externalSourceRepo.findAll({
    sourceType: { in: [ExternalSourcePlatform.GOOGLE, 'google-channel-email'] },
    isActive: true,
  });

  logger.info(`${TAG} cycle started`, { total: sources.length });

  let renewed = 0;
  let failed = 0;
  let deactivated = 0;

  for (let i = 0; i < sources.length; i += BATCH_SIZE) {
    const batch = sources.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map(renewSource));
    for (const r of results) {
      if (r.status === 'renewed') renewed++;
      else if (r.status === 'deactivated') deactivated++;
      else failed++;
    }
  }

  logger.info(`${TAG} cycle complete`, {
    total: sources.length,
    renewed,
    failed,
    deactivated,
    durationMs: Date.now() - startedAt,
  });
}

class GmailWatchRenewalQueue {
  private queue: Bull.Queue | null = null;
  private workerInitialized = false;

  private async ensureQueue(): Promise<Bull.Queue> {
    if (this.queue) return this.queue;

    this.queue = new Bull('gmail-watch-renewal', {
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

    queue.process('renew-all', async () => {
      await renewAllGmailWatches();
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
      if (job.name === 'renew-all') {
        await queue.removeRepeatableByKey(job.key);
      }
    }

    await queue.add(
      'renew-all',
      {},
      {
        repeat: { cron: GMAIL_WATCH_RENEWAL_CRON },
        jobId: 'gmail-watch-renewal-repeatable',
      },
    );

    // Enqueue a delayed one-off run so we don't wait up to 24h after a deploy
    // for the first renewal — but give the app ~30s to finish boot first so
    // the renewal doesn't race with DB/Redis/queue init. renewGmailWatch is
    // idempotent, so this is safe to schedule on every restart.
    await queue.add('renew-all', {}, { delay: 30_000 });

    this.workerInitialized = true;
    logger.info(
      `${TAG} Queue initialized (${GMAIL_WATCH_RENEWAL_CRON}), immediate first run enqueued`,
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

export const gmailWatchRenewalQueue = new GmailWatchRenewalQueue();
