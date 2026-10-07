import { EmailType } from '@xyne/shared';
import {
  BaseInteractionReplySender,
  InteractionReplyContext,
  InteractionReplyValidationError,
} from '@/integrations/core/baseInteractionReplySender';
import type { NormalizedData } from '@/integrations/core/types';
import { SOCIAL_MEDIA_INTERACTION_TYPES } from '@/integrations/social-media/constants';
import { decrypt } from '@/services/encryptionService';
import { facebookGraphClient, isFacebookTokenRejected } from './facebookGraphClient';
import type { FacebookCredentials } from './types';
import { disconnectSourceWithDeadToken } from './flow';
import { FACEBOOK_HUMAN_AGENT_WINDOW_MS, FACEBOOK_MAX_REPLY_LENGTH } from './constants';
import { getLastInboundAt, META_REPLY_WINDOW_MS } from '../shared/metaDmThread';

// A reply is often the first thing to hit a dead Page token: mark the Page disconnected so desk
// settings offer Reconnect, and tell the agent.
const onTokenRejected =
  (sourceId: string) =>
  async (error: unknown): Promise<never> => {
    if (!isFacebookTokenRejected(error)) throw error;
    await disconnectSourceWithDeadToken(sourceId);
    throw new InteractionReplyValidationError(
      "Facebook no longer accepts this Page's connection, so it has been disconnected. Reconnect the Page in desk settings, then try again.",
    );
  };

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
      const result = await facebookGraphClient
        .replyToComment(credentials.pageAccessToken, commentId, body)
        .catch(onTokenRejected(source.id));
      return reply(`${source.id}:comment-reply:${result.id}`);
    }

    if (externalThreadId.startsWith('post:')) {
      throw new InteractionReplyValidationError(
        "Can't reply to a mention in a post — please respond directly on Facebook",
      );
    }

    // DM reply. Within 24h of the customer's last message it is a standard response; from then
    // until 7 days it goes out under Meta's Human Agent tag; after that Meta allows nothing.
    const lastInboundAt = await getLastInboundAt(source.id, externalThreadId);
    if (!lastInboundAt) {
      throw new InteractionReplyValidationError('No inbound message found for this thread');
    }
    const sinceLastInbound = Date.now() - lastInboundAt.getTime();
    if (sinceLastInbound > FACEBOOK_HUMAN_AGENT_WINDOW_MS) {
      throw new InteractionReplyValidationError(
        'Facebook reply window expired — you can only reply within 7 days of the last inbound message',
      );
    }
    const humanAgent = sinceLastInbound > META_REPLY_WINDOW_MS;

    // externalThreadId is "psid:windowStart"; the Send API needs just the PSID.
    const recipientPsid = externalThreadId.split(':')[0];
    const result = await facebookGraphClient
      .sendMessage(credentials.pageAccessToken, credentials.pageId, recipientPsid, body, humanAgent)
      .catch(onTokenRejected(source.id))
      .catch((error: unknown) => {
        // Meta refuses the tag when the app does not have the Human Agent feature approved.
        if (humanAgent && !(error instanceof InteractionReplyValidationError)) {
          const metaMessage = (error as { response?: { data?: { error?: { message?: string } } } })
            ?.response?.data?.error?.message;
          throw new InteractionReplyValidationError(
            `Facebook did not accept a reply sent more than 24 hours after the customer's last message. Replies up to 7 days need the Human Agent feature approved for the Meta app.${metaMessage ? ` (Facebook: ${metaMessage})` : ''}`,
          );
        }
        throw error;
      });
    return reply(`${source.id}:${result.message_id}`);
  }
}
