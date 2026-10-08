import { logger } from '@/utils/logger';
import { countTokenlessMobileSessions, expireSessions } from '@/bypassAcl/authSessionServices';
import { recordPushTokenMissing } from '@/services/otel/authMetrics';

const TAG = '[AUTH_SESSION_CLEANUP]';

const DEFAULT_BATCH_SIZE = 500;
/** 200 x 500 = 100k rows per run; anything beyond that waits for the next cron tick. */
const DEFAULT_MAX_BATCHES = 200;

export interface AuthSessionCleanupTotals {
  sessionsExpired: number;
  batches: number;
  /** True when the run stopped on the batch cap with work still outstanding. */
  capped: boolean;
  /** ACTIVE mobile sessions with no push token, as of the end of this run. */
  mobileSessionsWithoutPushToken: number;
}

export interface AuthSessionCleanupOptions {
  batchSize?: number;
  maxBatches?: number;
  now?: Date;
}

/**
 * Marks `auth_sessions` past `absoluteExpiry` as EXPIRED in bounded batches. Legacy
 * `workflow.user_sessions` rows are not touched (read-only table; they age out on their own).
 */
export class AuthSessionCleanupWorker {
  async run(options: AuthSessionCleanupOptions = {}): Promise<AuthSessionCleanupTotals> {
    const batchSize = options.batchSize && options.batchSize > 0 ? Math.floor(options.batchSize) : DEFAULT_BATCH_SIZE;
    const maxBatches =
      options.maxBatches && options.maxBatches > 0 ? Math.floor(options.maxBatches) : DEFAULT_MAX_BATCHES;
    const now = options.now ?? new Date();
    const startedAt = Date.now();
    const totals: AuthSessionCleanupTotals = { sessionsExpired: 0, batches: 0, capped: false, mobileSessionsWithoutPushToken: 0 };

    logger.info(`${TAG} started`, { batchSize, maxBatches, now: now.toISOString() });

    for (let batch = 1; batch <= maxBatches; batch += 1) {
      const expired = await expireSessions(batchSize, now);
      totals.batches = batch;
      totals.sessionsExpired += expired;
      logger.debug(`${TAG} batch #${batch}`, { expired });
      if (expired === 0) break;
      if (batch === maxBatches) totals.capped = true;
    }

    // Push-token coverage is a slowly-changing fleet property, so it is sampled once per run here
    // rather than counted per push delivery (where it tracked notification volume, not coverage).
    totals.mobileSessionsWithoutPushToken = await countTokenlessMobileSessions(now);
    if (totals.mobileSessionsWithoutPushToken > 0) {
      recordPushTokenMissing({ platform: 'MOBILE', count: totals.mobileSessionsWithoutPushToken });
    }

    logger.info(`${TAG} finished`, { ...totals, durationMs: Date.now() - startedAt });
    if (totals.capped) {
      logger.warn(`${TAG} stopped on the batch cap with rows still expiring; the next run continues`, { maxBatches, batchSize });
    }
    return totals;
  }
}

export const authSessionCleanupWorker = new AuthSessionCleanupWorker();
