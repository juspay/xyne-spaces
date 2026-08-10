import type { ExternalSource } from '@prisma/client';
import { BaseFlow } from '@/integrations/core/baseFlow';
import type { IngestionOptions } from '@/integrations/core/types';
import { getGooglePlayReviewLastModifiedAt, googlePlayClient } from './client';
import {
  GOOGLE_PLAY_INITIAL_SYNC_LOOKBACK_MS,
  GOOGLE_PLAY_SYNC_OVERLAP_MS,
} from './constants';

function getAutomaticSyncCutoff(source: ExternalSource, now: Date): number {
  let cutoff = now.getTime() - GOOGLE_PLAY_INITIAL_SYNC_LOOKBACK_MS;
  const cursor = source.lastSyncCursor ? Date.parse(source.lastSyncCursor) : Number.NaN;
  if (Number.isFinite(cursor)) cutoff = cursor - GOOGLE_PLAY_SYNC_OVERLAP_MS;

  // Automatic polling must not import reviews from before this source was connected.
  return Math.max(cutoff, source.createdAt.getTime());
}

export class GooglePlayReviewsFlow extends BaseFlow {
  async preprocess(
    _rawPayload: unknown,
    source?: ExternalSource,
    options?: IngestionOptions,
  ): Promise<unknown[]> {
    if (!source) throw new Error('Google Play source is required');
    const syncStartedAt = new Date();
    if (options?.ignoreSyncCursor) return googlePlayClient.listReviews(source.id);

    const cutoff = getAutomaticSyncCutoff(source, syncStartedAt);
    const reviews = await googlePlayClient.listReviews(source.id, new Date(cutoff));
    return reviews.filter(
      (review) => getGooglePlayReviewLastModifiedAt(review) >= cutoff,
    );
  }
}
