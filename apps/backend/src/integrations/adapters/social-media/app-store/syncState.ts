import { redisService } from '@/services/redisService';
import { logger } from '@/utils/logger';
import { APP_STORE_MAX_INGEST_ATTEMPTS, APP_STORE_STATE_TTL_SECONDS } from './constants';

const TAG = '[AppStoreSyncState]';

const failureKey = (sourceId: string): string => `app-store:ingest-failures:${sourceId}`;
const pendingKey = (sourceId: string): string => `app-store:pending-response:${sourceId}`;

/**
 * Redis-backed bookkeeping for two things Apple's API forces on us.
 *
 * Retries are bounded per externalId because ingest throws if any interaction fails, and the cursor
 * write happens after it — so one permanently-bad review would otherwise re-fetch the same window
 * every 5 minutes forever, burning a quota shared across every app on the desk. An attempt counter
 * bounds that deterministically; advancing the cursor cannot, because the cutoff sits a margin
 * behind it and a bad item simply stays in-window.
 *
 * Pending responses are tracked because Apple publishes them asynchronously and a replied-to review
 * can have a createdDate far outside the ingest window, so the normal poll will never revisit it.
 *
 * Redis is best-effort here: if it is unavailable we degrade to the old behaviour rather than
 * failing a sync.
 */

export async function listExhaustedExternalIds(sourceId: string): Promise<Set<string>> {
  try {
    const counts = await redisService.hgetall(failureKey(sourceId));
    return new Set(
      Object.entries(counts)
        .filter(([, attempts]) => Number(attempts) >= APP_STORE_MAX_INGEST_ATTEMPTS)
        .map(([externalId]) => externalId),
    );
  } catch (error) {
    logger.warn(`${TAG} Could not read ingest failure counts`, { sourceId, error });
    return new Set();
  }
}

/**
 * Increments the failures and clears everything else that was attempted, so a review that starts
 * working again gets a clean slate rather than inching toward the cap over unrelated runs.
 */
export async function recordIngestOutcome(
  sourceId: string,
  attemptedExternalIds: string[],
  failedExternalIds: string[],
): Promise<void> {
  if (attemptedExternalIds.length === 0) return;
  const failed = new Set(failedExternalIds);
  try {
    const counts = await redisService.hgetall(failureKey(sourceId));
    for (const externalId of attemptedExternalIds) {
      if (!failed.has(externalId)) {
        if (counts[externalId]) await redisService.hdel(failureKey(sourceId), externalId);
        continue;
      }
      const attempts = Number(counts[externalId] ?? 0) + 1;
      await redisService.hset(failureKey(sourceId), externalId, String(attempts));
      if (attempts >= APP_STORE_MAX_INGEST_ATTEMPTS) {
        logger.error(`${TAG} [APP_STORE_INGEST_ABANDONED] giving up on a review`, {
          sourceId,
          externalId,
          attempts,
          note: 'skipped from now on so the cursor can advance; investigate and clear the Redis hash to retry',
        });
      }
    }
    await redisService.expire(failureKey(sourceId), APP_STORE_STATE_TTL_SECONDS);
  } catch (error) {
    logger.warn(`${TAG} Could not record ingest failure counts`, { sourceId, error });
  }
}

export async function markResponsePending(sourceId: string, reviewId: string): Promise<void> {
  try {
    await redisService.hset(pendingKey(sourceId), reviewId, new Date().toISOString());
    await redisService.expire(pendingKey(sourceId), APP_STORE_STATE_TTL_SECONDS);
  } catch (error) {
    logger.warn(`${TAG} Could not record a pending response`, { sourceId, reviewId, error });
  }
}

export async function listPendingResponses(
  sourceId: string,
): Promise<Array<{ reviewId: string; firstSeenAt: Date }>> {
  try {
    const entries = await redisService.hgetall(pendingKey(sourceId));
    return Object.entries(entries).map(([reviewId, firstSeenAt]) => ({
      reviewId,
      firstSeenAt: new Date(Date.parse(firstSeenAt) || Date.now()),
    }));
  } catch (error) {
    logger.warn(`${TAG} Could not read pending responses`, { sourceId, error });
    return [];
  }
}

export async function clearPendingResponse(sourceId: string, reviewId: string): Promise<void> {
  try {
    await redisService.hdel(pendingKey(sourceId), reviewId);
  } catch (error) {
    logger.warn(`${TAG} Could not clear a pending response`, { sourceId, reviewId, error });
  }
}
