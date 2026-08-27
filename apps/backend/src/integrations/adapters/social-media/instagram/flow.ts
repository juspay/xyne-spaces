import type { ExternalSource } from '@prisma/client';
import { BaseFlow } from '@/integrations/core/baseFlow';
import type { TestPayloadResult } from '@/integrations/core/types';
import { config } from '@/config/env';
import { decrypt } from '@/services/encryptionService';
import type { InstagramCredentials, InstagramWebhookMessaging, InstagramWebhookPayload } from './types';
import { metaGraphClient } from './metaGraphClient';

export class InstagramFlow extends BaseFlow {
  async preprocess(rawPayload: unknown, source?: ExternalSource): Promise<InstagramWebhookMessaging[]> {
    const payload = rawPayload as Partial<InstagramWebhookPayload>;

    if (payload?.object !== 'instagram') return [];

    // Decrypt credentials so we can fetch message content and sender profile.
    let accessToken: string | undefined;
    let businessIgUserId: string | undefined;
    if (source?.credentials) {
      try {
        const creds = JSON.parse(decrypt(source.credentials)) as InstagramCredentials;
        accessToken = creds.accessToken;
        businessIgUserId = creds.igUserId;
      } catch { /* non-fatal */ }
    }

    const messages: InstagramWebhookMessaging[] = [];
    for (const entry of payload.entry ?? []) {
      for (const messaging of (entry.messaging ?? []) as unknown as Array<Record<string, unknown>>) {
        // Standard message event
        const msg = messaging.message as InstagramWebhookMessaging['message'] | undefined;
        if (msg?.mid) {
          if (msg.is_echo) continue;
          const built = messaging as unknown as InstagramWebhookMessaging;
          if (accessToken && businessIgUserId && built.sender.id) {
            built.sender.username = (await metaGraphClient.getSenderUsername(accessToken, businessIgUserId, built.sender.id)) ?? undefined;
          }
          messages.push(built);
          continue;
        }

        // message_edit with num_edit=0 is Meta's delivery of a new message when only
        // the message_edits webhook field is subscribed at the account level.
        const edit = messaging.message_edit as { mid?: string; num_edit?: number } | undefined;
        if (edit?.mid !== undefined) {
          const isContentUpdate = edit.num_edit !== 0;
          // Keep timestamp in seconds so transformer.ts multiplies by 1000 once,
          // consistent with the standard message path above.
          const tsRaw = (messaging.timestamp as number | undefined) ?? Math.floor(Date.now() / 1000);
          // Reuse the message already fetched by resolveMessageEditRecipient middleware (W2).
          type FetchedMessage = Awaited<ReturnType<typeof metaGraphClient.getMessage>>;
          const fetched: FetchedMessage = (entry as unknown as Record<string, unknown>)._resolvedMessage as FetchedMessage
            ?? (accessToken ? await metaGraphClient.getMessage(accessToken, edit.mid) : null);
          if (fetched?.message !== undefined && fetched.from?.id) {
            const senderId = fetched.from.id;
            // Skip messages sent by the business itself (outbound DMs)
            if (businessIgUserId && senderId === businessIgUserId) continue;
            const senderUsername = (!isContentUpdate && accessToken && businessIgUserId)
              ? (await metaGraphClient.getSenderUsername(accessToken, businessIgUserId, senderId)) ?? undefined
              : undefined;
            messages.push({
              sender: { id: senderId, username: senderUsername },
              recipient: { id: fetched.to?.data?.[0]?.id ?? entry.id },
              timestamp: tsRaw,
              message: { mid: fetched.id, text: fetched.message },
              isContentUpdate,
            });
          }
        }
      }
    }
    return messages;
  }

  getSourceNameFromDB(payload: unknown): string | undefined {
    const body = payload as Record<string, unknown>;
    const entry = (body?.entry as Array<Record<string, unknown>>)?.[0];
    // Prefer _resolvedRecipientId injected by resolveMessageEditRecipient middleware —
    // for message_edit.num_edit=0 events entry.id is the SENDER, not the recipient.
    const igUserId = (entry?._resolvedRecipientId as string | undefined) ?? (entry?.id as string | undefined);
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
