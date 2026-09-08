import type { ExternalSource } from '@prisma/client';
import { EmailType, FormFieldType } from '@xyne/shared';
import { BaseTransformer } from '@/integrations/core/baseTransformer';
import type { NormalizedData, ParseResult } from '@/integrations/core/types';
import { SOCIAL_MEDIA_INTERACTION_TYPES } from '@/integrations/social-media/constants';
import { ExternalMessageRepository } from '@/database/repositories/externalMessageRepository';
import { INSTAGRAM_MESSAGE_ID_FIELD, INSTAGRAM_REPLY_WINDOW_MS, INSTAGRAM_SENDER_FIELD } from './constants';
import type { InstagramWebhookMessaging } from './types';

export class InstagramTransformer extends BaseTransformer<unknown, NormalizedData[]> {
  private externalMessageRepo = new ExternalMessageRepository();

  async transform(
    payload: unknown,
    source?: ExternalSource,
  ): Promise<ParseResult<NormalizedData[]>> {
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
    const text = messaging.message.text || (hasAttachments ? '[Attachment received — open Instagram to view]' : '');

    // For content updates (customer edited a sent message), find the existing
    // thread by the mid and update the email body in-place — no window logic needed.
    if (messaging.isContentUpdate) {
      const existing = await this.externalMessageRepo.findByExternalId(source.id, `${source.id}:${mid}`);
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
    const windowExpired = !latestTime || Math.abs(newMessageTime - latestTime.getTime()) > INSTAGRAM_REPLY_WINDOW_MS;

    // A unique suffix creates a new thread (new ticket); the bare IGSID
    // appends to the existing active thread.
    // Round to the start of the current 24h window so concurrent webhooks
    // for the same customer always produce the same thread ID (avoids race-condition
    // duplicates when Meta delivers multiple events in rapid succession).
    // Anchor to the message's own timestamp so two messages sent in the same
    // 24h window always hash to the same thread ID, regardless of server time.
    const windowStart = Math.floor(messaging.timestamp / INSTAGRAM_REPLY_WINDOW_MS) * INSTAGRAM_REPLY_WINDOW_MS;
    const externalThreadId = latest && !windowExpired
      ? latest.externalThreadId
      : `${igsid}:${windowStart}`;

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
        to: [],
        type: EmailType.DEFAULT,
        skipBlockingCheck: true,
      },
      metadata: {
        eventType: SOCIAL_MEDIA_INTERACTION_TYPES.DM,
        timestamp: new Date(messaging.timestamp),
        source: 'social-media',
        windowExpired: windowExpired.toString(),
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
}
