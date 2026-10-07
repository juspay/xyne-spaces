import type { TestPayloadResult } from '@/integrations/core/types';
import { config } from '@/config/env';

/** Meta's webhook subscription handshake: echo hub.challenge when hub.verify_token matches ours. */
export function verifyMetaWebhookSubscription(
  query: Record<string, string | undefined>,
): TestPayloadResult {
  if (query['hub.mode'] !== 'subscribe') return { isTest: false };

  const verifyToken = query['hub.verify_token'];
  const challenge = query['hub.challenge'];
  const configuredToken = config.META_WEBHOOK_VERIFY_TOKEN;

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
