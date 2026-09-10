import { SOCIAL_MEDIA_INTERACTION_TYPES } from '@/integrations/social-media/constants';
import {
  BaseInteractionReplySender,
  InteractionReplyValidationError,
} from '@/integrations/core/baseInteractionReplySender';
import type { InteractionReplyContext } from '@/integrations/core/baseInteractionReplySender';
import type { NormalizedData } from '@/integrations/core/types';
import { db } from '@/database/client';
import { EmailType } from '@xyne/shared';
import { appStoreClient } from './client';
import { markResponsePending } from './syncState';
import { APP_STORE_DEVELOPER_RESPONSE_SUFFIX } from './transformer';

export class AppStoreReviewsReplySender extends BaseInteractionReplySender {
  async sendReply(context: InteractionReplyContext): Promise<NormalizedData> {
    // Apple documents no maximum for responseBody, so there is nothing to validate against here.
    // Length failures come back as a 4xx whose message is surfaced to the agent verbatim.
    const externalId = `${context.source.id}:${context.externalThreadId}${APP_STORE_DEVELOPER_RESPONSE_SUFFIX}`;
    await this.assertNoForeignResponse(context, externalId);

    const { occurredAt, state } = await appStoreClient.reply(
      context.source,
      context.externalThreadId,
      context.body,
    );

    // The poll pages on createdDate and this review may long predate the window, so it will never
    // be re-fetched. Pass B is the only thing that will ever move this to PUBLISHED.
    if (state === 'PENDING_PUBLISH') {
      await markResponsePending(context.source.id, context.externalThreadId);
    }

    return {
      externalId,
      externalThreadId: context.externalThreadId,
      author: { name: context.authorName },
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
        responseState: state,
      },
    };
  }

  /**
   * POST is create-or-overwrite and Apple allows only one response per review, so sending blindly
   * would silently destroy a response somebody wrote in App Store Connect. If Apple has one and we
   * have no record of writing it, refuse and let a human decide.
   */
  private async assertNoForeignResponse(
    context: InteractionReplyContext,
    externalId: string,
  ): Promise<void> {
    const existing = await appStoreClient.getReviewResponse(
      context.source,
      context.externalThreadId,
    );
    if (!existing) return;

    const ours = await db.externalMessage.findFirst({
      where: { externalSourceId: context.source.id, externalId },
      select: { id: true },
    });
    if (ours) return;

    throw new InteractionReplyValidationError(
      'This review already has a response written outside Xyne. Sending would overwrite it — ' +
        'remove or update it in App Store Connect first.',
    );
  }
}
