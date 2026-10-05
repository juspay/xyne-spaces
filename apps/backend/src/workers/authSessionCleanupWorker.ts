import { logger } from '@/utils/logger';
import { cleanupExpiredSessions } from '@/bypassAcl/authSessionServices';

const TAG = '[AUTH_SESSION_CLEANUP]';

const DEFAULT_BATCH_SIZE = 500;
/** 200 x 500 = 100k rows per run; anything beyond that waits for the next cron tick. */
const DEFAULT_MAX_BATCHES = 200;

export interface AuthSessionCleanupTotals {
  sessionsExpired: number;
  grantsExpired: number;
  legacyExpired: number;
  batches: number;
  /** True when the run stopped on the batch cap with work still outstanding. */
  capped: boolean;
}

export interface AuthSessionCleanupOptions {
  batchSize?: number;
  maxBatches?: number;
  now?: Date;
}

/**
 * Expires `auth_sessions` past `absoluteExpiry` (cascading to their grants), grants past
 * `expiresAt`, and legacy `workflow.user_sessions` past `refreshTokenExpiry`, in bounded batches.
 * All three live in one bypassAcl call (`cleanupExpiredSessions`); this worker only loops it
 * until a batch reports nothing left or the cap is hit.
 */
export class AuthSessionCleanupWorker {
  async run(options: AuthSessionCleanupOptions = {}): Promise<AuthSessionCleanupTotals> {
    const batchSize = options.batchSize && options.batchSize > 0 ? Math.floor(options.batchSize) : DEFAULT_BATCH_SIZE;
    const maxBatches =
      options.maxBatches && options.maxBatches > 0 ? Math.floor(options.maxBatches) : DEFAULT_MAX_BATCHES;
    const now = options.now ?? new Date();
    const startedAt = Date.now();

    const totals: AuthSessionCleanupTotals = {
      sessionsExpired: 0,
      grantsExpired: 0,
      legacyExpired: 0,
      batches: 0,
      capped: false,
    };

    logger.info(`${TAG} started`, { batchSize, maxBatches, now: now.toISOString() });

    for (let batch = 1; batch <= maxBatches; batch += 1) {
      const result = await cleanupExpiredSessions(batchSize, now);
      totals.batches = batch;
      totals.sessionsExpired += result.sessionsExpired;
      totals.grantsExpired += result.grantsExpired;
      totals.legacyExpired += result.legacyExpired;

      const touched = result.sessionsExpired + result.grantsExpired + result.legacyExpired;
      logger.debug(`${TAG} batch #${batch}`, { ...result });
      if (touched === 0) break;
      if (batch === maxBatches) totals.capped = true;
    }

    logger.info(`${TAG} finished`, { ...totals, durationMs: Date.now() - startedAt });
    if (totals.capped) {
      logger.warn(`${TAG} stopped on the batch cap with rows still expiring; the next run continues`, {
        maxBatches,
        batchSize,
      });
    }
    return totals;
  }
}

export const authSessionCleanupWorker = new AuthSessionCleanupWorker();
