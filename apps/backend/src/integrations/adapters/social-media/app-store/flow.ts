import type { ExternalSource } from '@prisma/client';
import { db } from '@/database/client';
import { BaseFlow } from '@/integrations/core/baseFlow';
import type { IngestionOptions } from '@/integrations/core/types';
import { logger } from '@/utils/logger';
import { appStoreClient, type NormalizedAppStoreReview } from './client';
import {
  APP_STORE_INITIAL_LOOKBACK_MS,
  APP_STORE_MAX_PAGES_PER_SYNC,
  APP_STORE_PUBLICATION_LAG_MARGIN_MS,
} from './constants';
import { listExhaustedExternalIds, recordIngestOutcome } from './syncState';

const TAG = '[AppStoreReviewsFlow]';

interface RunOutcome {
  truncated: boolean;
  oldestFetchedAt: Date | null;
  attemptedExternalIds: string[];
}

/**
 * Apple sorts and filters only on createdDate, which is immutable, and publishes reviews to the API
 * on a lag. Two consequences drive everything here:
 *
 *  - The cutoff must be pure createdDate so that filter key == sort key, which is what makes the
 *    stop-paging short-circuit sound.
 *  - Coverage is a claim that must be earned. A run that stops because it ran out of pages has NOT
 *    covered its window, and must leave the cursor untouched — advancing it would step over reviews
 *    that were never fetched, and an immutable createdDate means they could never be seen again.
 */
export class AppStoreReviewsFlow extends BaseFlow {
  private runOutcomes = new Map<string, RunOutcome>();

  async preprocess(
    _rawPayload: unknown,
    source?: ExternalSource,
    options?: IngestionOptions,
  ): Promise<unknown[]> {
    if (!source) throw new Error('App Store source is required');

    const cutoff = options?.ignoreSyncCursor ? null : this.computeCutoff(source);
    const result = await appStoreClient.listReviews(
      source,
      cutoff,
      APP_STORE_MAX_PAGES_PER_SYNC,
    );

    // Bounded retries: a review that has failed too many times is skipped so the cursor is free to
    // advance past it, instead of the whole window being re-fetched every 5 minutes forever.
    const exhausted = await listExhaustedExternalIds(source.id);
    const ingestable = result.reviews.filter(
      (review) => !exhausted.has(`${source.id}:${review.reviewId}`),
    );
    if (ingestable.length < result.reviews.length) {
      logger.warn(`${TAG} Skipping reviews that exceeded the ingest attempt limit`, {
        sourceId: source.id,
        skipped: result.reviews.length - ingestable.length,
      });
    }

    this.runOutcomes.set(source.id, {
      truncated: result.truncated,
      oldestFetchedAt: result.oldestFetchedAt,
      attemptedExternalIds: ingestable.map((review) => `${source.id}:${review.reviewId}`),
    });

    if (result.truncated) {
      logger.error(`${TAG} [APP_STORE_SYNC_TRUNCATED] page budget exhausted before window covered`, {
        sourceId: source.id,
        pagesFetched: result.pagesFetched,
        oldestFetchedAt: result.oldestFetchedAt?.toISOString(),
        cutoff: cutoff?.toISOString() ?? null,
        note: 'cursor intentionally not advanced; widen the page budget or backfill this source',
      });
    }

    if (!cutoff) return ingestable;
    return this.dropAlreadySeenStragglers(source, ingestable, cutoff);
  }

  /**
   * The floor is connect time MINUS the lag margin, not connect time. Clamping to connect time
   * would permanently discard every review created shortly before connect that Apple publishes
   * shortly after it — the exact loss this margin exists to prevent.
   */
  private computeCutoff(source: ExternalSource): Date {
    const cursor = source.lastSyncCursor ? Date.parse(source.lastSyncCursor) : Number.NaN;
    const base = Number.isFinite(cursor)
      ? cursor - APP_STORE_PUBLICATION_LAG_MARGIN_MS
      : Date.now() - APP_STORE_INITIAL_LOOKBACK_MS;
    const floor = source.createdAt.getTime() - APP_STORE_PUBLICATION_LAG_MARGIN_MS;
    return new Date(Math.max(base, floor));
  }

  /**
   * Reviews below the cutoff are normally ones we already have. One that is below the cutoff and
   * NOT yet stored is a review Apple published later than our margin allows for — so ingest it
   * anyway (it is recoverable only right now) and report the observed lag.
   */
  private async dropAlreadySeenStragglers(
    source: ExternalSource,
    reviews: NormalizedAppStoreReview[],
    cutoff: Date,
  ): Promise<NormalizedAppStoreReview[]> {
    const stragglers = reviews.filter((review) => review.occurredAt.getTime() < cutoff.getTime());
    if (stragglers.length === 0) return reviews;

    const known = await db.externalMessage.findMany({
      where: {
        externalSourceId: source.id,
        externalId: { in: stragglers.map((review) => `${source.id}:${review.reviewId}`) },
      },
      select: { externalId: true },
    });
    const knownIds = new Set(known.map((row) => row.externalId));

    const lateArrivals = stragglers.filter(
      (review) => !knownIds.has(`${source.id}:${review.reviewId}`),
    );
    if (lateArrivals.length > 0) {
      const worstLagMs = Math.max(
        ...lateArrivals.map((review) => Date.now() - review.occurredAt.getTime()),
      );
      logger.warn(`${TAG} [APP_STORE_LAG_BREACH] reviews published beyond the lag margin`, {
        sourceId: source.id,
        count: lateArrivals.length,
        worstLagHours: Math.round(worstLagMs / 3_600_000),
        marginHours: Math.round(APP_STORE_PUBLICATION_LAG_MARGIN_MS / 3_600_000),
      });
    }

    return reviews.filter(
      (review) =>
        review.occurredAt.getTime() >= cutoff.getTime() ||
        !knownIds.has(`${source.id}:${review.reviewId}`),
    );
  }

  /**
   * Called with everything that failed to sync, including the empty case, so a review that starts
   * working again has its counter cleared rather than inching toward the cap across runs.
   */
  async onIngestFailures(source: ExternalSource, failedExternalIds: string[]): Promise<void> {
    const attempted = this.runOutcomes.get(source.id)?.attemptedExternalIds ?? [];
    await recordIngestOutcome(source.id, attempted, failedExternalIds);
  }

  /** Null means "leave the cursor where it is" — the only safe answer for an uncovered window. */
  resolveNextCursor(source: ExternalSource, syncStartedAt: Date): string | null {
    const outcome = this.runOutcomes.get(source.id);
    this.runOutcomes.delete(source.id);
    if (!outcome || outcome.truncated) return null;
    return syncStartedAt.toISOString();
  }
}
