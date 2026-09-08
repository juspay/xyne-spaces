import { BaseAuthenticator } from '@/integrations/core/baseAuthenticator';
import type { AuthResult } from '@/integrations/core/types';
import { metaGraphClient } from './metaGraphClient';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';

export class InstagramAuthenticator extends BaseAuthenticator {
  async authenticate(
    rawBody: string,
    headers: Record<string, string | string[]>,
  ): Promise<AuthResult> {
    const sigHeader = headers['x-hub-signature-256'];
    const signature = Array.isArray(sigHeader) ? (sigHeader[0] ?? '') : (sigHeader ?? '');
    // Instagram Business Login webhooks are signed with the Instagram-specific app secret.
    // Fall back to the Facebook app secret only if META_IG_APP_SECRET is absent.
    let appSecret = config.META_IG_APP_SECRET as string | undefined;
    if (!appSecret) {
      logger.warn('[InstagramAuthenticator] META_IG_APP_SECRET not set — falling back to META_APP_SECRET; set META_IG_APP_SECRET for Instagram Business Login');
      appSecret = config.META_APP_SECRET as string | undefined;
    }
    const resolvedSecret = appSecret;

    if (!resolvedSecret) {
      return { authenticated: false, reason: 'META_APP_SECRET not configured' };
    }

    if (!signature) {
      return { authenticated: false, reason: 'Missing x-hub-signature-256 header' };
    }

    if (!metaGraphClient.verifyWebhookSignature(rawBody, signature, resolvedSecret)) {
      return { authenticated: false, reason: 'Invalid webhook signature' };
    }

    return { authenticated: true };
  }
}
