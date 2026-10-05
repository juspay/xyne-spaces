import { EmailType } from '@xyne/shared';
import {
  BaseInteractionReplySender,
  InteractionReplyContext,
  InteractionReplyValidationError,
} from '@/integrations/core/baseInteractionReplySender';
import type { NormalizedData } from '@/integrations/core/types';
import { SOCIAL_MEDIA_INTERACTION_TYPES } from '@/integrations/social-media/constants';
import { decrypt } from '@/services/encryptionService';
import { facebookGraphClient } from './facebookGraphClient';
import type { FacebookCredentials } from './types';
import { FACEBOOK_MAX_REPLY_LENGTH } from './constants';
import { getMetaReplyWindowState } from '../shared/metaDmThread';

export class FacebookReplySender extends BaseInteractionReplySender {
  async sendReply(context: InteractionReplyContext): Promise<NormalizedData> {
    const { source, externalThreadId, subject, body, userId, authorName } = context;

    if (body.length > FACEBOOK_MAX_REPLY_LENGTH) {
      throw new InteractionReplyValidationError(
        `Reply exceeds Facebook ${FACEBOOK_MAX_REPLY_LENGTH}-character limit`,
      );
    }

    if (!source.channelId) {
      throw new InteractionReplyValidationError('Facebook Page is not bound to a channel');
    }

    if (!source.credentials) {
      throw new InteractionReplyValidationError('Facebook Page is disconnected — please reconnect');
    }
    let credentials: FacebookCredentials;
    try {
      credentials = JSON.parse(decrypt(source.credentials)) as FacebookCredentials;
    } catch {
      throw new InteractionReplyValidationError(
        'Facebook Page credentials are invalid — please reconnect',
      );
    }

    const fromName = credentials.pageName || source.displayName || authorName;
    const reply = (externalId: string): NormalizedData => ({
      externalId,
      externalThreadId,
      author: { name: fromName },
      content: body,
      emailData: {
        subject: `Re: ${subject}`,
        from: fromName,
        to: [],
        type: EmailType.REPLY,
        sentByUserId: userId,
        skipBlockingCheck: true,
      },
      metadata: {
        eventType: SOCIAL_MEDIA_INTERACTION_TYPES.REPLY,
        timestamp: new Date(),
        source: 'social-media',
        isReply: true,
      },
    });

    // Comment threads: public reply under the comment, no 24h window.
    if (externalThreadId.startsWith('comment:')) {
      const commentId = externalThreadId.slice('comment:'.length);
      const result = await facebookGraphClient.replyToComment(
        credentials.pageAccessToken,
        commentId,
        body,
      );
      return reply(`${source.id}:comment-reply:${result.id}`);
    }

    if (externalThreadId.startsWith('post:')) {
      throw new InteractionReplyValidationError(
        "Can't reply to a mention in a post — please respond directly on Facebook",
      );
    }

    // DM reply — Meta only allows it within 24h of the customer's last message.
    const replyWindow = await getMetaReplyWindowState(source.id, externalThreadId);
    if (replyWindow === 'no-inbound') {
      throw new InteractionReplyValidationError('No inbound message found for this thread');
    }
    if (replyWindow === 'expired') {
      throw new InteractionReplyValidationError(
        'Facebook reply window expired — you can only reply within 24 hours of the last inbound message',
      );
    }

    // externalThreadId is "psid:windowStart"; the Send API needs just the PSID.
    const recipientPsid = externalThreadId.split(':')[0];
    const result = await facebookGraphClient.sendMessage(
      credentials.pageAccessToken,
      credentials.pageId,
      recipientPsid,
      body,
    );
    return reply(`${source.id}:${result.message_id}`);
  }
}
