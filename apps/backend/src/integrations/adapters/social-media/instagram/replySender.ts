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

const INSTAGRAM_REPLY_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

export class InstagramReplySender extends BaseInteractionReplySender {
  async sendReply(context: InteractionReplyContext): Promise<NormalizedData> {
    const { source, externalThreadId, subject, body, userId, authorName } = context;

    // Enforce 24h reply window — Meta hard rule for DMs
    const lastInbound = await db.email.findFirst({
      where: {
        externalThreadId,
        channelId: source.channelId ?? undefined,
        type: EmailType.DEFAULT,
      },
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

    const credentials = JSON.parse(decrypt(source.credentials)) as InstagramCredentials;
    // externalThreadId is stored as "igsid" or "igsid:timestamp"; Meta's API needs just the IGSID
    const igsid = externalThreadId.split(':')[0];
    const result = await metaGraphClient.sendDM(credentials.accessToken, credentials.igUserId, igsid, body);

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
        to: [externalThreadId],
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
