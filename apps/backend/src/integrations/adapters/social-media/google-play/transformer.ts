import { SOCIAL_MEDIA_INTERACTION_TYPES } from '@/integrations/social-media/constants';
import { BaseTransformer } from '@/integrations/core/baseTransformer';
import type { NormalizedData, ParseResult } from '@/integrations/core/types';
import {
  EmailType,
  type ExternalSource,
  TicketPriority,
} from '@prisma/client';
import { FormFieldType } from '@xyne/shared';
import type { NormalizedGooglePlayReview } from './client';
import {
  GOOGLE_PLAY_THUMBS_DOWN_FIELD,
  GOOGLE_PLAY_THUMBS_UP_FIELD,
} from './constants';
export const GOOGLE_PLAY_DEVELOPER_REPLY_SUFFIX = ':developer-reply';

function priorityForRating(rating?: number): TicketPriority {
  if (rating == null || rating >= 4) return TicketPriority.LOW;
  if (rating === 3) return TicketPriority.MEDIUM;
  if (rating === 2) return TicketPriority.HIGH;
  return TicketPriority.CRITICAL;
}

export class GooglePlayReviewsTransformer extends BaseTransformer<unknown, NormalizedData[]> {
  async transform(
    payload: unknown,
    source?: ExternalSource,
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
          ticketPriority: priorityForRating(review.rating),
          updateExisting: true,
          syncTicketOnUpdate: true,
          skipBlockingCheck: true,
        },
        metadata: {
          eventType: SOCIAL_MEDIA_INTERACTION_TYPES.REVIEW,
          timestamp: review.occurredAt,
          source: 'social-media',
        },
        ticketCustomFields: [
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
          skipBlockingCheck: true,
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
