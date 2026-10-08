import { EmailType } from '@xyne/shared';
import {
  BaseInteractionReplySender,
  InteractionReplyContext,
  InteractionReplyValidationError,
} from '@/integrations/core/baseInteractionReplySender';
import type { NormalizedData } from '@/integrations/core/types';
import { SOCIAL_MEDIA_INTERACTION_TYPES } from '@/integrations/social-media/constants';
import { decrypt } from '@/services/encryptionService';
import { metaGraphClient } from './metaGraphClient';
import type { InstagramCredentials } from './types';
import { INSTAGRAM_MAX_REPLY_LENGTH } from './constants';
import { getMetaReplyWindowState } from '../shared/metaDmThread';
import { onMetaTokenRejected } from '../shared/metaTokenRejection';

const onTokenRejected = (sourceId: string) =>
  onMetaTokenRejected(
    sourceId,
    "Instagram no longer accepts this account's connection, so it has been disconnected. Reconnect the account in desk settings, then try again.",
  );

export class InstagramReplySender extends BaseInteractionReplySender {
  async sendReply(context: InteractionReplyContext): Promise<NormalizedData> {
    const { source, externalThreadId, subject, body, userId, authorName } = context;

    // Meta enforces a 1000 UTF-8 byte limit (not character count); multi-byte chars count more.
    if (Buffer.byteLength(body, 'utf8') > INSTAGRAM_MAX_REPLY_LENGTH) {
      throw new InteractionReplyValidationError(
        `Reply exceeds Instagram ${INSTAGRAM_MAX_REPLY_LENGTH}-byte limit`
      );
    }

    if (!source.channelId) {
      throw new InteractionReplyValidationError('Instagram source is not bound to a channel');
    }

    if (!source.credentials) {
      throw new InteractionReplyValidationError(
        'Instagram account is disconnected — please reconnect'
      );
    }
    let credentials: InstagramCredentials;
    try {
      credentials = JSON.parse(decrypt(source.credentials)) as InstagramCredentials;
    } catch {
      throw new InteractionReplyValidationError(
        'Instagram account credentials are invalid — please reconnect'
      );
    }

    const igUsername = credentials.username || source.displayName;
    const fromName = igUsername ? `@${igUsername}` : authorName;

    // Comment reply (Cases 1 & 3) — externalThreadId is "comment:{commentId}"
    // No 24h window restriction; replies go as public Instagram comment replies.
    if (externalThreadId.startsWith('comment:')) {
      const commentId = externalThreadId.slice('comment:'.length);
      const result = await metaGraphClient
        .replyToComment(credentials.accessToken, commentId, body)
        .catch(onTokenRejected(source.id));
      return {
        externalId: `${source.id}:comment-reply:${result.id}`,
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
      };
    }

    // Caption mention (Case 2) — no comment to reply to; agent must act on Instagram directly.
    if (externalThreadId.startsWith('media:')) {
      throw new InteractionReplyValidationError(
        "Can't reply to a mention in a caption — please respond directly on Instagram"
      );
    }

    // Mention-via-messages (IG Login) — no comment_id available, can't reply as comment.
    if (externalThreadId.startsWith('mention:')) {
      throw new InteractionReplyValidationError(
        "Can't reply to this mention — please respond directly on Instagram"
      );
    }

    // DM reply — enforce 24h reply window (Meta hard rule).
    const replyWindow = await getMetaReplyWindowState(source.id, externalThreadId);
    if (replyWindow === 'no-inbound') {
      throw new InteractionReplyValidationError('No inbound DM found for this thread');
    }
    if (replyWindow === 'expired') {
      throw new InteractionReplyValidationError(
        'Instagram reply window expired — you can only reply within 24 hours of the last inbound message'
      );
    }

    // externalThreadId is "igsid" or "igsid:timestamp"; Meta's DM API needs just the IGSID
    const recipientIgsid = externalThreadId.split(':')[0];
    // Use credentials.igsid (app-scoped) for the sender path — the real igUserId is rejected by the API.
    const senderIgsid = credentials.igsid ?? credentials.igUserId;
    const result = await metaGraphClient
      .sendDM(credentials.accessToken, senderIgsid, recipientIgsid, body)
      .catch(onTokenRejected(source.id));

    return {
      externalId: `${source.id}:${result.message_id}`,
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
    };
  }
}
