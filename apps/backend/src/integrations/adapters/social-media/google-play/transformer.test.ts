import type { ExternalSource } from '@prisma/client';
import { EmailType, TicketPriority } from '@prisma/client';

jest.mock('@xyne/shared', () => ({
  FormFieldType: { NUMBER: 'NUMBER' },
}));

import {
  GOOGLE_PLAY_THUMBS_DOWN_FIELD,
  GOOGLE_PLAY_THUMBS_UP_FIELD,
} from './constants';
import {
  GOOGLE_PLAY_DEVELOPER_REPLY_SUFFIX,
  GooglePlayReviewsTransformer,
} from './transformer';

const source = {
  id: 'source-1',
  displayName: 'Example app',
} as ExternalSource;

describe('GooglePlayReviewsTransformer', () => {
  it('normalizes a review and developer reply for the shared integration core', async () => {
    const reviewOccurredAt = new Date('2026-07-29T10:00:00.000Z');
    const replyOccurredAt = new Date('2026-07-29T11:00:00.000Z');
    const transformer = new GooglePlayReviewsTransformer();

    const result = await transformer.transform(
      {
        reviewId: 'review-1',
        subject: '5-star Google Play review',
        body: 'Great app',
        authorName: 'Reviewer',
        rating: 5,
        thumbsUpCount: 4,
        thumbsDownCount: 1,
        clientVersionName: '1.2.1',
        clientVersionCode: '13',
        occurredAt: reviewOccurredAt,
        developerReply: {
          body: 'Thank you',
          occurredAt: replyOccurredAt,
        },
      },
      source,
    );

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(2);
    expect(result.data?.[0]).toMatchObject({
      externalId: 'source-1:review-1',
      externalThreadId: 'review-1',
      content: 'Great app',
      emailData: {
        type: EmailType.DEFAULT,
        rating: 5,
        clientVersionName: '1.2.1',
        clientVersionCode: '13',
        ticketPriority: TicketPriority.LOW,
        updateExisting: true,
      },
      metadata: {
        timestamp: reviewOccurredAt,
      },
      ticketCustomFields: [
        { fieldName: GOOGLE_PLAY_THUMBS_UP_FIELD, value: '4' },
        { fieldName: GOOGLE_PLAY_THUMBS_DOWN_FIELD, value: '1' },
      ],
    });
    expect(result.data?.[1]).toMatchObject({
      externalId: `source-1:review-1${GOOGLE_PLAY_DEVELOPER_REPLY_SUFFIX}`,
      externalThreadId: 'review-1',
      content: 'Thank you',
      emailData: {
        type: EmailType.REPLY,
      },
      metadata: {
        timestamp: replyOccurredAt,
        isReply: true,
      },
    });
  });

  it('rejects a payload when no source context is provided', async () => {
    const result = await new GooglePlayReviewsTransformer().transform({
      reviewId: 'review-1',
      subject: 'Review',
      body: 'Body',
      occurredAt: new Date(),
    });

    expect(result).toEqual({
      success: false,
      error: 'Invalid Google Play review payload',
    });
  });

  it('defaults missing Google Play vote counts to zero', async () => {
    const result = await new GooglePlayReviewsTransformer().transform(
      {
        reviewId: 'review-without-votes',
        subject: 'Review',
        body: 'Body',
        occurredAt: new Date('2026-07-29T10:00:00.000Z'),
      },
      source,
    );

    expect(result.data?.[0].ticketCustomFields).toEqual([
      expect.objectContaining({
        fieldName: GOOGLE_PLAY_THUMBS_UP_FIELD,
        value: '0',
      }),
      expect.objectContaining({
        fieldName: GOOGLE_PLAY_THUMBS_DOWN_FIELD,
        value: '0',
      }),
    ]);
  });
});
