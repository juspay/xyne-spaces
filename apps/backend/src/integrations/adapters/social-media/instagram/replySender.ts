import { EmailType } from '@xyne/shared';
import {
  BaseInteractionReplySender,
  InteractionReplyContext,
  InteractionReplyValidationError,
} from '@/integrations/core/baseInteractionReplySender';
import type { NormalizedData } from '@/integrations/core/types';
import { SOCIAL_MEDIA_INTERACTION_TYPES } from '@/integrations/social-media/constants';
import { db } from '@/database/client';
import { decrypt } from '@/services/encryptionService';
import { metaGraphClient } from './metaGraphClient';
import type { InstagramCredentials } from './types';
import { INSTAGRAM_MAX_REPLY_LENGTH, INSTAGRAM_REPLY_WINDOW_MS } from './constants';

export class InstagramReplySender extends BaseInteractionReplySender {
  async sendReply(context: InteractionReplyContext): Promise<NormalizedData> {
    const { source, externalThreadId, subject, body, userId, authorName } = context;

    // Meta enforces a 1000 UTF-8 byte limit (not character count); multi-byte chars count more.
    if (Buffer.byteLength(body, 'utf8') > INSTAGRAM_MAX_REPLY_LENGTH) {
      throw new InteractionReplyValidationError(`Reply exceeds Instagram ${INSTAGRAM_MAX_REPLY_LENGTH}-byte limit`);
    }

    if (!source.channelId) {
      throw new InteractionReplyValidationError('Instagram source is not bound to a channel');
    }

    // Enforce 24h reply window — Meta hard rule for DMs.
    // Query externalMessage (not email) because externalMessage.createdAt is set to the
    // Meta event timestamp by core.ts, giving us the real Instagram message time.
    // email.createdAt is DB insertion time and must not be used here.
    const lastInbound = await db.externalMessage.findFirst({
      where: { externalSourceId: source.id, externalThreadId, direction: 'INCOMING' },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    if (!lastInbound) {
      throw new InteractionReplyValidationError('No inbound DM found for this thread');
    }
    const windowExpired = Date.now() - lastInbound.createdAt.getTime() > INSTAGRAM_REPLY_WINDOW_MS;
    if (windowExpired) {
      throw new InteractionReplyValidationError(
        'Instagram reply window expired — you can only reply within 24 hours of the last inbound message',
      );
    }

    if (!source.credentials) {
      throw new InteractionReplyValidationError('Instagram account is disconnected — please reconnect');
    }
    let credentials: InstagramCredentials;
    try {
      credentials = JSON.parse(decrypt(source.credentials)) as InstagramCredentials;
    } catch {
      throw new InteractionReplyValidationError('Instagram account credentials are invalid — please reconnect');
    }
    // externalThreadId is stored as "igsid" or "igsid:timestamp"; Meta's API needs just the IGSID
    const recipientIgsid = externalThreadId.split(':')[0];
    // Use credentials.igsid (app-scoped) for the sender path — the real igUserId is rejected by the API.
    // Fall back to igUserId for older credentials that predate the igsid field.
    const senderIgsid = credentials.igsid ?? credentials.igUserId;
    const result = await metaGraphClient.sendDM(credentials.accessToken, senderIgsid, recipientIgsid, body);

    return {
      externalId: `${source.id}:${result.message_id}`,
      externalThreadId,
      author: {
        name: authorName,
      },
      content: body,
      emailData: {
        subject: `Re: ${subject}`,
        from: authorName,
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
