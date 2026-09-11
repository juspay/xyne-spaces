import { SOCIAL_MEDIA_INTERACTION_TYPES } from '@/integrations/social-media/constants';
import {
  BaseInteractionReplySender,
  InteractionReplyValidationError,
} from '@/integrations/core/baseInteractionReplySender';
import type { InteractionReplyContext } from '@/integrations/core/baseInteractionReplySender';
import type { NormalizedData } from '@/integrations/core/types';
import { EmailType } from '@xyne/shared';
import { googlePlayClient } from './client';
import { GOOGLE_PLAY_MAX_REPLY_LENGTH } from './constants';
import { GOOGLE_PLAY_DEVELOPER_REPLY_SUFFIX } from './transformer';

export class GooglePlayReviewsReplySender extends BaseInteractionReplySender {
  async sendReply(context: InteractionReplyContext): Promise<NormalizedData> {
    if (context.body.length > GOOGLE_PLAY_MAX_REPLY_LENGTH) {
      throw new InteractionReplyValidationError(
        `Reply cannot exceed ${GOOGLE_PLAY_MAX_REPLY_LENGTH} characters`
      );
    }
    const occurredAt = await googlePlayClient.reply(
      context.source.id,
      context.externalThreadId,
      context.body
    );
    return {
      externalId: `${context.source.id}:${context.externalThreadId}${GOOGLE_PLAY_DEVELOPER_REPLY_SUFFIX}`,
      externalThreadId: context.externalThreadId,
      author: {
        name: context.authorName,
      },
      content: context.body,
      emailData: {
        subject: `Developer response to ${context.subject}`,
        from: context.authorName,
        to: [],
        type: EmailType.REPLY,
        sentByUserId: context.userId,
        updateExisting: true,
      },
      metadata: {
        eventType: SOCIAL_MEDIA_INTERACTION_TYPES.REPLY,
        timestamp: occurredAt,
        source: 'social-media',
        isReply: true,
      },
    };
  }
}
