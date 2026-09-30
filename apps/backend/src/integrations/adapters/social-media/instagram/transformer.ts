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
  INSTAGRAM_REPLY_WINDOW_MS,
  INSTAGRAM_SENDER_FIELD,
} from './constants';
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
    // Use a descriptive fallback when a message has attachments but no text body
    // (e.g. images, videos, audio) — prevents blank ticket bodies.
    const hasAttachments = (messaging.message.attachments?.length ?? 0) > 0;
    const text =
      messaging.message.text ||
      (hasAttachments ? '[Attachment received — open Instagram to view]' : '');

    // For content updates (customer edited a sent message), find the existing
    // thread by the mid and update the email body in-place — no window logic needed.
    if (messaging.isContentUpdate) {
      const existing = await this.externalMessageRepo.findByExternalId(
        source.id,
        `${source.id}:${mid}`
      );
      if (!existing?.externalThreadId) {
        return { success: false, error: `Cannot update message ${mid}: original not found` };
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

    // Determine which ticket/thread this message belongs to using the 24h window.
    // If the customer last messaged > 24h ago the window has expired; treat this
    // DM as the start of a new conversation so a new ticket is created.
    const latest = await this.externalMessageRepo.findLatestForIgsid(source.id, igsid);
    const latestTime = latest?.createdAt;
    // messaging.timestamp is Unix ms (Meta sends 13-digit ms timestamps, not seconds)
    const newMessageTime = messaging.timestamp;
    // Math.abs handles out-of-order delivery: late-arriving webhooks can have
    // newMessageTime < latestTime.getTime(), making the raw delta negative and
    // incorrectly skipping the expiry check.
    const windowExpired =
      !latestTime || Math.abs(newMessageTime - latestTime.getTime()) > INSTAGRAM_REPLY_WINDOW_MS;

    // A unique suffix creates a new thread (new ticket); the bare IGSID
    // appends to the existing active thread.
    // Round to the start of the current 24h window so concurrent webhooks
    // for the same customer always produce the same thread ID (avoids race-condition
    // duplicates when Meta delivers multiple events in rapid succession).
    // Anchor to the message's own timestamp so two messages sent in the same
    // 24h window always hash to the same thread ID, regardless of server time.
    const windowStart =
      Math.floor(messaging.timestamp / INSTAGRAM_REPLY_WINDOW_MS) * INSTAGRAM_REPLY_WINDOW_MS;
    const externalThreadId =
      latest && !windowExpired ? latest.externalThreadId : `${igsid}:${windowStart}`;

    const result: NormalizedData = {
      externalId: `${source.id}:${mid}`,
      externalThreadId,
      author: {
        name: senderName,
        externalId: igsid,
      },
      content: text,
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
