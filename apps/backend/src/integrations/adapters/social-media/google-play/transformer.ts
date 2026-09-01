import { SOCIAL_MEDIA_INTERACTION_TYPES } from '@/integrations/social-media/constants';
import { BaseTransformer } from '@/integrations/core/baseTransformer';
import type { NormalizedData, ParseResult } from '@/integrations/core/types';
import type { ExternalSource } from '@prisma/client';
import { EmailType, FormFieldType } from '@xyne/shared';
import type { NormalizedGooglePlayReview } from './client';
import {
  GOOGLE_PLAY_APP_FIELD,
  GOOGLE_PLAY_PACKAGE_FIELD,
  GOOGLE_PLAY_THUMBS_DOWN_FIELD,
  GOOGLE_PLAY_THUMBS_UP_FIELD,
} from './constants';
export const GOOGLE_PLAY_DEVELOPER_REPLY_SUFFIX = ':developer-reply';

export class GooglePlayReviewsTransformer extends BaseTransformer<unknown, NormalizedData[]> {
  async transform(
    payload: unknown,
    source?: ExternalSource
  ): Promise<ParseResult<NormalizedData[]>> {
    const review = payload as Partial<NormalizedGooglePlayReview>;
    if (
      !source ||
      !review.reviewId ||
      !review.subject ||
      !review.body ||
      !(review.occurredAt instanceof Date)
    ) {
      return { success: false, error: 'Invalid Google Play review payload' };
    }

    const interactions: NormalizedData[] = [
      {
        externalId: `${source.id}:${review.reviewId}`,
        externalThreadId: review.reviewId,
        author: {
          name: review.authorName ?? source.displayName,
        },
        content: review.body,
        emailData: {
          subject: review.subject,
          from: review.authorName ?? source.displayName,
          to: [],
          type: EmailType.DEFAULT,
          rating: review.rating,
          clientVersionName: review.clientVersionName,
          clientVersionCode: review.clientVersionCode,
          updateExisting: true,
        },
        metadata: {
          eventType: SOCIAL_MEDIA_INTERACTION_TYPES.REVIEW,
          timestamp: review.occurredAt,
          source: 'social-media',
        },
        ticketCustomFields: [
          {
            fieldName: GOOGLE_PLAY_APP_FIELD,
            fieldType: FormFieldType.STRING,
            value: source.displayName,
          },
          {
            fieldName: GOOGLE_PLAY_PACKAGE_FIELD,
            fieldType: FormFieldType.STRING,
            value: source.externalIdentifier ?? source.name,
          },
          {
            fieldName: GOOGLE_PLAY_THUMBS_UP_FIELD,
            fieldType: FormFieldType.NUMBER,
            value: String(review.thumbsUpCount ?? 0),
          },
          {
            fieldName: GOOGLE_PLAY_THUMBS_DOWN_FIELD,
            fieldType: FormFieldType.NUMBER,
            value: String(review.thumbsDownCount ?? 0),
          },
        ],
      },
    ];
    if (review.developerReply) {
      interactions.push({
        externalId: `${source.id}:${review.reviewId}${GOOGLE_PLAY_DEVELOPER_REPLY_SUFFIX}`,
        externalThreadId: review.reviewId,
        author: {
          name: source.displayName,
        },
        content: review.developerReply.body,
        emailData: {
          subject: `Developer response to ${review.subject}`,
          from: source.displayName,
          to: [],
          type: EmailType.REPLY,
          updateExisting: true,
        },
        metadata: {
          eventType: SOCIAL_MEDIA_INTERACTION_TYPES.REPLY,
          timestamp: review.developerReply.occurredAt,
          source: 'social-media',
          isReply: true,
        },
      });
    }
    return { success: true, data: interactions };
  }
}
