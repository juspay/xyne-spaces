import { BaseAuthenticator } from '@/integrations/core/baseAuthenticator';
import type { AuthResult } from '@/integrations/core/types';
import { metaGraphClient } from '../instagram/metaGraphClient';

/** Verifies Meta's x-hub-signature-256 header; each provider supplies the app secret that signs its webhooks. */
export class MetaWebhookAuthenticator extends BaseAuthenticator {
  constructor(private readonly resolveAppSecret: () => string | undefined) {
    super();
  }

  async authenticate(
    rawBody: string,
    headers: Record<string, string | string[]>,
  ): Promise<AuthResult> {
    const sigHeader = headers['x-hub-signature-256'];
    const signature = Array.isArray(sigHeader) ? (sigHeader[0] ?? '') : (sigHeader ?? '');
    const appSecret = this.resolveAppSecret();

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
