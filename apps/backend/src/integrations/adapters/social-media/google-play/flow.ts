import type { ExternalSource } from '@prisma/client';
import { BaseFlow } from '@/integrations/core/baseFlow';
import { googlePlayClient } from './client';

export class GooglePlayReviewsFlow extends BaseFlow {
  async preprocess(_rawPayload: unknown, source?: ExternalSource): Promise<unknown[]> {
    if (!source) throw new Error('Google Play source is required');
    return googlePlayClient.listReviews(source.id);
  }
}
