import type { ExternalSource } from '@prisma/client';
import { EmailType, FormFieldType } from '@xyne/shared';
import { BaseTransformer } from '@/integrations/core/baseTransformer';
import type { NormalizedData, ParseResult } from '@/integrations/core/types';
import { SOCIAL_MEDIA_INTERACTION_TYPES } from '@/integrations/social-media/constants';
import { ExternalMessageRepository } from '@/database/repositories/externalMessageRepository';
import {
  INSTAGRAM_COMMENT_ID_FIELD,
  INSTAGRAM_MEDIA_ID_FIELD,
  INSTAGRAM_MESSAGE_ID_FIELD,
  INSTAGRAM_SENDER_FIELD,
} from './constants';
import { metaDmBody, toDownloadableMetaAttachments } from '../shared/metaDmAttachments';
import { resolveMetaDmThread } from '../shared/metaDmThread';
import type { InstagramWebhookComment, InstagramWebhookMessaging } from './types';

export class InstagramTransformer extends BaseTransformer<unknown, NormalizedData[]> {
  private externalMessageRepo = new ExternalMessageRepository();

  async transform(
    payload: unknown,
    source?: ExternalSource
  ): Promise<ParseResult<NormalizedData[]>> {
    // Handle mention/comment events (Cases 1, 2, 3) — discriminated by `type` field
    const maybeComment = payload as InstagramWebhookComment;
    if (maybeComment?.type === 'mention' || maybeComment?.type === 'comment') {
      return this.transformComment(maybeComment, source);
    }

    const messaging = payload as InstagramWebhookMessaging;

    if (!source || !messaging?.message?.mid || !messaging?.sender?.id) {
      return { success: false, error: 'Invalid Instagram DM payload' };
    }

    const igsid = messaging.sender.id;
    const senderName = messaging.sender.username ?? igsid;
    const mid = messaging.message.mid;
    const rawAttachments = messaging.message.attachments ?? [];
    const attachments = toDownloadableMetaAttachments(rawAttachments);
    const text = metaDmBody(messaging.message.text, rawAttachments, attachments.length, 'Instagram');

    // For content updates (customer edited a sent message), find the existing
    // thread by the mid and update the email body in-place — no window logic needed.
    if (messaging.isContentUpdate) {
      const existing = await this.externalMessageRepo.findByExternalId(
        source.id,
        `${source.id}:${mid}`
      );
      // The original was never ingested (sent before the account was connected). Failing here
      // would 500 the whole webhook and make Meta redeliver it forever, so drop the edit.
      if (!existing?.externalThreadId) {
        return { success: true, data: [] };
      }
      const result: NormalizedData = {
        externalId: `${source.id}:${mid}`,
        externalThreadId: existing.externalThreadId,
        author: { name: senderName, externalId: igsid },
        content: text,
        emailData: {
          // Omit subject and from: updateExternalInteraction falls back to existingEmail values
          // via `?? existingEmail.field`. Setting them here would overwrite the stored @username
          // with a raw IGSID string (no username is fetched for edit events).
          to: [],
          type: EmailType.DEFAULT,
          skipBlockingCheck: true,
          updateExisting: true,
        },
        metadata: {
          eventType: SOCIAL_MEDIA_INTERACTION_TYPES.DM,
          timestamp: new Date(messaging.timestamp),
          source: 'social-media',
        },
      };
      return { success: true, data: [result] };
    }

    // A DM more than 24h after the customer's last one starts a new thread, so a new ticket.
    const { externalThreadId, windowExpired } = await resolveMetaDmThread(
      this.externalMessageRepo,
      source.id,
      igsid,
      messaging.timestamp,
    );

    const result: NormalizedData = {
      externalId: `${source.id}:${mid}`,
      externalThreadId,
      author: {
        name: senderName,
        externalId: igsid,
      },
      content: text,
      ...(attachments.length > 0 && { attachments }),
      emailData: {
        subject: `Instagram DM from ${senderName}`,
        from: senderName,
        // Show which IG business account received this DM so agents can see it in the desk UI.
        to: source.displayName ? [`@${source.displayName}`] : [],
        type: EmailType.DEFAULT,
        skipBlockingCheck: true,
      },
      metadata: {
        eventType: SOCIAL_MEDIA_INTERACTION_TYPES.DM,
        timestamp: new Date(messaging.timestamp),
        source: 'social-media',
        windowExpired: windowExpired.toString(),
        fromEmailAddress: senderName,
      },
      ticketCustomFields: [
        {
          fieldName: INSTAGRAM_SENDER_FIELD,
          fieldType: FormFieldType.STRING,
          value: igsid,
        },
        {
          fieldName: INSTAGRAM_MESSAGE_ID_FIELD,
          fieldType: FormFieldType.STRING,
          value: mid,
        },
      ],
    };

    return { success: true, data: [result] };
  }

  // Cases 1, 2 (mention in comment/caption) and Case 3 (comment on own post)
  private transformComment(
    comment: InstagramWebhookComment,
    source?: ExternalSource
  ): ParseResult<NormalizedData[]> {
    if (!source) {
      return { success: false, error: 'Missing source for comment/mention transform' };
    }

    const isCaption = comment.type === 'mention' && !comment.commentId && !comment.mid;
    // Each mention/comment is its own ticket — use comment:/media:/mention: prefix so
    // replySender can tell them apart from DM threads (which use igsid:timestamp).
    // For replies: rawCommentId is the actual reply ID (unique per reply) — use it for
    // externalId to prevent duplicate ingestion. commentId is the parent's ID — use it
    // for externalThreadId so replies append to the parent's thread instead of creating a
    // new ticket.
    const idForDedup = comment.rawCommentId ?? comment.commentId ?? comment.mediaId ?? comment.mid;
    const externalId = `${source.id}:${comment.type}:${idForDedup}`;
    const externalThreadId = comment.commentId
      ? `comment:${comment.commentId}`
      : comment.mediaId
        ? `media:${comment.mediaId}`
        : `mention:${comment.mid}`;

    const senderDisplay = `@${comment.senderUsername}`;
    const subjectVerb =
      comment.type === 'comment' ? 'comment' : isCaption ? 'caption mention' : 'mention';

    const result: NormalizedData = {
      externalId,
      externalThreadId,
      author: {
        name: senderDisplay,
        externalId: comment.senderId || undefined,
      },
      content: comment.text,
      emailData: {
        subject: `Instagram ${subjectVerb} by ${senderDisplay}`,
        from: senderDisplay,
        to: source.displayName ? [`@${source.displayName}`] : [],
        type: EmailType.DEFAULT,
        skipBlockingCheck: true,
      },
      metadata: {
        eventType: SOCIAL_MEDIA_INTERACTION_TYPES.MENTION,
        timestamp: new Date(comment.timestamp),
        source: 'social-media',
        fromEmailAddress: comment.senderUsername,
        ...(comment.commentId ? { commentId: comment.commentId } : {}),
        ...(comment.mediaId ? { mediaId: comment.mediaId } : {}),
        ...(comment.mid ? { mid: comment.mid } : {}),
      },
      ticketCustomFields: [
        ...(comment.commentId
          ? [
              {
                fieldName: INSTAGRAM_COMMENT_ID_FIELD,
                fieldType: FormFieldType.STRING,
                value: comment.commentId,
              },
            ]
          : []),
        ...(comment.mediaId
          ? [
              {
                fieldName: INSTAGRAM_MEDIA_ID_FIELD,
                fieldType: FormFieldType.STRING,
                value: comment.mediaId,
              },
            ]
          : []),
      ],
    };

    return { success: true, data: [result] };
  }
}
