import { SOCIAL_MEDIA_INTERACTION_TYPES } from '@/integrations/social-media/constants';
import { BaseInteractionReplySender } from '@/integrations/core/baseInteractionReplySender';
import type { InteractionReplyContext } from '@/integrations/core/baseInteractionReplySender';
import type { NormalizedData } from '@/integrations/core/types';
import { EmailType } from '@prisma/client';
import { googlePlayClient } from './client';
import { GOOGLE_PLAY_MAX_REPLY_LENGTH } from './constants';
import { GOOGLE_PLAY_DEVELOPER_REPLY_SUFFIX } from './transformer';

export class GooglePlayReviewsReplySender extends BaseInteractionReplySender {
  readonly maxReplyLength = GOOGLE_PLAY_MAX_REPLY_LENGTH;

  async sendReply(context: InteractionReplyContext): Promise<NormalizedData> {
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
        skipBlockingCheck: true,
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
