import type { ExternalSource } from '@prisma/client';
import { BaseFlow } from '@/integrations/core/baseFlow';
import type { TestPayloadResult } from '@/integrations/core/types';
import { config } from '@/config/env';
import { decrypt } from '@/services/encryptionService';
import type { InstagramCredentials, InstagramWebhookMessaging, InstagramWebhookPayload } from './types';
import { metaGraphClient } from './metaGraphClient';
import { logger } from '@/utils/logger';

export class InstagramFlow extends BaseFlow {
  async preprocess(rawPayload: unknown, source?: ExternalSource): Promise<InstagramWebhookMessaging[]> {
    const payload = rawPayload as Partial<InstagramWebhookPayload>;

    if (payload?.object !== 'instagram') return [];

    logger.debug('[InstagramFlow] Webhook received', {
      entryCount: payload.entry?.length ?? 0,
      messagingCount: payload.entry?.reduce((n, e) => n + (e.messaging?.length ?? 0), 0) ?? 0,
    });

    // Decrypt credentials so we can fetch message content and sender profile.
    let accessToken: string | undefined;
    let businessIgUserId: string | undefined;  // real user ID — used for B2 filter (entry.id comparison)
    let businessIgsid: string | undefined;     // app-scoped IGSID — used for Meta API calls
    if (source?.credentials) {
      try {
        const creds = JSON.parse(decrypt(source.credentials)) as InstagramCredentials;
        accessToken = creds.accessToken;
        businessIgUserId = creds.igUserId;
        businessIgsid = creds.igsid ?? creds.igUserId; // fall back for older credentials
      } catch (err) {
        // Corrupt credentials: without businessIgUserId the B2 filter would be disabled,
        // meaning events from OTHER IG accounts could be mis-attributed to this source.
        // Fail closed — return empty to avoid cross-account data corruption.
        logger.error('[InstagramFlow] Failed to decrypt credentials — returning empty to preserve B2 filter', { sourceId: source.id, error: err });
        return [];
      }
    }

    const messages: InstagramWebhookMessaging[] = [];
    for (const entry of payload.entry ?? []) {
      // B2: Meta can batch entries from multiple IG accounts in one webhook POST.
      // Only process entries matching the resolved source's account to prevent
      // cross-account data corruption.
      if (businessIgUserId && entry.id !== businessIgUserId) {
        logger.warn('[InstagramFlow] Dropping batched entry for non-matching IG account', {
          sourceId: source?.id,
          expectedIgUserId: businessIgUserId,
          entryId: entry.id,
        });
        continue;
      }

      for (const messaging of (entry.messaging ?? []) as unknown as Array<Record<string, unknown>>) {
        // Standard message event — text is included directly in the payload.
        const msg = messaging.message as InstagramWebhookMessaging['message'] | undefined;
        if (msg?.mid) {
          if (msg.is_echo) continue;
          const built = messaging as unknown as InstagramWebhookMessaging;
          if (accessToken && businessIgsid && built.sender.id) {
            built.sender.username = (await metaGraphClient.getSenderUsername(accessToken, businessIgsid, built.sender.id)) ?? undefined;
          }
          messages.push(built);
          continue;
        }

        // message_edit event — fired when a customer edits a DM they previously sent.
        // num_edit=0 can arrive as a duplicate of a message event when both 'messages'
        // and 'message_edits' are subscribed; skip it to avoid double-processing.
        // num_edit > 0 is a real customer edit — update the ticket body with the new text.
        const edit = messaging.message_edit as { mid?: string; num_edit?: number; text?: string } | undefined;
        if (edit?.mid !== undefined) {
          if (edit.num_edit === 0) continue;
          // messaging.timestamp is Unix ms from Meta; fall back to Date.now() (also ms) if absent.
          const tsRaw = (messaging.timestamp as number | undefined) ?? Date.now();

          // Prefer sender + text inline from the webhook payload — the message_edit event
          // always includes sender.id and the new text. Avoid the getMessage API round-trip
          // which empirically returns {} for recently-edited messages.
          const inlineSenderId = (messaging.sender as { id?: string } | undefined)?.id;
          const inlineText = edit.text;
          if (inlineSenderId && inlineText !== undefined) {
            if (businessIgsid && inlineSenderId === businessIgsid) continue;
            messages.push({
              sender: { id: inlineSenderId },
              recipient: { id: (messaging.recipient as { id?: string } | undefined)?.id ?? entry.id },
              timestamp: tsRaw,
              message: { mid: edit.mid, text: inlineText },
              isContentUpdate: true,
            });
          } else {
            // Fallback: fetch via API when sender/text are absent from the webhook.
            type FetchedMessage = Awaited<ReturnType<typeof metaGraphClient.getMessage>>;
            const fetched: FetchedMessage = accessToken
              ? await metaGraphClient.getMessage(accessToken, edit.mid)
              : null;
            if (fetched?.message !== undefined && fetched.from?.id) {
              const senderId = fetched.from.id;
              if (businessIgsid && senderId === businessIgsid) continue;
              messages.push({
                sender: { id: senderId },
                recipient: { id: fetched.to?.data?.[0]?.id ?? entry.id },
                timestamp: tsRaw,
                message: { mid: fetched.id, text: fetched.message },
                isContentUpdate: true,
              });
            }
          }
        }
      }
    }
    return messages;
  }

  getSourceNameFromDB(payload: unknown): string | undefined {
    const body = payload as Record<string, unknown>;
    const entry = (body?.entry as Array<Record<string, unknown>>)?.[0];
    // entry.id is always the business IG account ID (the webhook subscriber) for all
    // Instagram event types — message, message_edit, reactions, etc.
    const igUserId = entry?.id as string | undefined;
    if (!igUserId) return undefined;
    return `instagram-${igUserId}`;
  }

  isTestQueryParam(query: Record<string, string | undefined>): TestPayloadResult {
    if (query['hub.mode'] !== 'subscribe') return { isTest: false };

    const verifyToken = query['hub.verify_token'];
    const challenge = query['hub.challenge'];
    const configuredToken = config.META_WEBHOOK_VERIFY_TOKEN as string;

    if (!configuredToken || verifyToken !== configuredToken || !challenge) {
      return {
        isTest: true,
        response: { status: 403, body: 'Forbidden' },
      };
    }

    return {
      isTest: true,
      response: { status: 200, body: challenge },
    };
  }
}
