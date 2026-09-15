import { SOCIAL_MEDIA_INTERACTION_TYPES } from '@/integrations/social-media/constants';
import { BaseTransformer } from '@/integrations/core/baseTransformer';
import type { NormalizedData, ParseResult } from '@/integrations/core/types';
import type { ExternalSource } from '@prisma/client';
import { EmailType, FormFieldType } from '@xyne/shared';
import type { NormalizedAppStoreReview } from './client';
import {
  APP_STORE_APP_FIELD,
  APP_STORE_BUNDLE_ID_FIELD,
  APP_STORE_RESPONSE_STATE_FIELD,
  APP_STORE_TERRITORY_FIELD,
} from './constants';

export const APP_STORE_DEVELOPER_RESPONSE_SUFFIX = ':developer-response';

function starGlyphs(rating?: number): string {
  if (!rating || !Number.isFinite(rating)) return '';
  const filled = Math.max(0, Math.min(5, Math.round(rating)));
  return `${'★'.repeat(filled)}${'☆'.repeat(5 - filled)} `;
}

export function readBundleId(source: ExternalSource): string | undefined {
  const metadata = source.externalMetadata as { bundleId?: unknown } | null;
  return typeof metadata?.bundleId === 'string' ? metadata.bundleId : undefined;
}

export class AppStoreReviewsTransformer extends BaseTransformer<unknown, NormalizedData[]> {
  async transform(
    payload: unknown,
    source?: ExternalSource,
  ): Promise<ParseResult<NormalizedData[]>> {
    const review = payload as Partial<NormalizedAppStoreReview>;
    if (!source || !review.reviewId || !review.body || !(review.occurredAt instanceof Date)) {
      return { success: false, error: 'Invalid App Store review payload' };
    }

    const author = review.reviewerNickname ?? source.displayName;
    // Synthetic, like Play's. The customer's own title must never reach the subject: the subject
    // feeds derivePriorityFromSubject, so a review titled "urgent" would self-assign priority + SLA.
    const subject = `${starGlyphs(review.rating)}${source.displayName} review from ${author}`;
    const body = review.title ? `${review.title}\n\n${review.body}` : review.body;
    const bundleId = readBundleId(source);

    const interactions: NormalizedData[] = [
      {
        externalId: `${source.id}:${review.reviewId}`,
        externalThreadId: review.reviewId,
        author: { name: author },
        content: body,
        emailData: {
          subject,
          from: author,
          to: [],
          type: EmailType.DEFAULT,
          rating: review.rating,
          updateExisting: true,
        },
        metadata: {
          eventType: SOCIAL_MEDIA_INTERACTION_TYPES.REVIEW,
          timestamp: review.occurredAt,
          source: 'social-media',
        },
        ticketCustomFields: [
          {
            fieldName: APP_STORE_APP_FIELD,
            fieldType: FormFieldType.STRING,
            value: source.displayName,
          },
          {
            fieldName: APP_STORE_BUNDLE_ID_FIELD,
            fieldType: FormFieldType.STRING,
            value: bundleId ?? source.externalIdentifier ?? source.name,
          },
          {
            fieldName: APP_STORE_TERRITORY_FIELD,
            fieldType: FormFieldType.STRING,
            value: review.territory ?? '',
          },
          {
            fieldName: APP_STORE_RESPONSE_STATE_FIELD,
            fieldType: FormFieldType.STRING,
            value: review.developerResponse?.state ?? '',
          },
        ],
      },
    ];

    if (review.developerResponse) {
      interactions.push({
        externalId: `${source.id}:${review.reviewId}${APP_STORE_DEVELOPER_RESPONSE_SUFFIX}`,
        externalThreadId: review.reviewId,
        author: { name: source.displayName },
        content: review.developerResponse.body,
        emailData: {
          subject: `Developer response to ${subject}`,
          from: source.displayName,
          to: [],
          type: EmailType.REPLY,
          updateExisting: true,
        },
        metadata: {
          eventType: SOCIAL_MEDIA_INTERACTION_TYPES.REPLY,
          timestamp: review.developerResponse.occurredAt,
          source: 'social-media',
          isReply: true,
          responseState: review.developerResponse.state,
        },
      });
    }

    return { success: true, data: interactions };
  }
}
