import { BaseAuthenticator } from '@/integrations/core/baseAuthenticator';
import type { AuthResult } from '@/integrations/core/types';
import { metaGraphClient } from './metaGraphClient';
import { config } from '@/config/env';

export class InstagramAuthenticator extends BaseAuthenticator {
  async authenticate(
    rawBody: string,
    headers: Record<string, string | string[]>,
  ): Promise<AuthResult> {
    const sigHeader = headers['x-hub-signature-256'];
    const signature = Array.isArray(sigHeader) ? (sigHeader[0] ?? '') : (sigHeader ?? '');
    // Instagram Login app webhook is signed with the Instagram App Secret,
    // not the Facebook App Secret.
    const appSecret = (config.META_IG_APP_SECRET || config.META_APP_SECRET) as string;

    if (!appSecret) {
      return { authenticated: false, reason: 'META_APP_SECRET not configured' };
    }

    if (!signature) {
      return { authenticated: false, reason: 'Missing x-hub-signature-256 header' };
    }

    if (!metaGraphClient.verifyWebhookSignature(rawBody, signature, appSecret)) {
      return { authenticated: false, reason: 'Invalid webhook signature' };
    }

    return { authenticated: true };
  }
}
