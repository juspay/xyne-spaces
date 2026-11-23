import { z } from 'zod';
import { logger } from '@/utils/logger';
import {
  XApiError,
  isXAuthRejected,
  isXDuplicateSubscription,
  xApiClient,
  type XApiClient,
} from './client';
import { X_AUTHORIZE_URL, X_OAUTH_SCOPES, X_SUPPORT_EVENT_TYPES } from './constants';
import { credentialsWithTokens } from './tokenService';
import type { XAppCredentials, XCredentials } from './types';

const TAG = '[XConnection]';

/** The four keys a tenant copies from their X Developer Console. */
export const xAppCredentialsSchema = z.object({
  clientId: z.string().trim().min(10).max(200),
  clientSecret: z.string().trim().min(10).max(200),
  consumerKey: z.string().trim().min(10).max(200),
  consumerSecret: z.string().trim().min(10).max(200),
});

/** A connect failure with a stable code the dashboard turns into a message. */
export class XConnectError extends Error {
  constructor(readonly code: XConnectErrorCode, message: string) {
    super(message);
    this.name = 'XConnectError';
  }
}

export type XConnectErrorCode =
  | 'x_invalid_api_key' // consumer key/secret rejected
  | 'x_invalid_client' // client id/secret rejected at token exchange
  | 'x_missing_scopes' // app permissions are not "Read and write and Direct message"
  | 'x_no_credits' // the tenant's X account has no credits
  | 'x_subscription_failed'
  | 'x_connection_failed';

export function buildXAuthorizeUrl(clientId: string, redirectUri: string, state: string, codeChallenge: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: X_OAUTH_SCOPES.join(' '),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  return `${X_AUTHORIZE_URL}?${params.toString()}`;
}

/** Scopes from the token response that we need but did not get. */
export function missingScopes(granted: string | undefined): string[] {
  const have = new Set((granted ?? '').split(/\s+/).filter(Boolean));
  return X_OAUTH_SCOPES.filter((s) => !have.has(s));
}

export class XConnectionService {
  constructor(private readonly client: XApiClient = xApiClient) {}

  /**
   * Checks the API key/secret before the user is sent to X, so a typo fails here rather than after
   * the login round-trip. The client id/secret can only be checked at the code exchange.
   */
  async validateAppKeys(app: XAppCredentials): Promise<void> {
    try {
      await this.client.getAppBearer(app);
    } catch (error) {
      if (error instanceof XApiError && (error.status === 401 || error.status === 403)) {
        throw new XConnectError('x_invalid_api_key', 'X rejected the API key and secret');
      }
      throw error;
    }
  }

  /**
   * Code → tokens → account. Returns credentials ready to store. Does NOT subscribe: the caller
   * first checks the account is the expected one and not already connected, then calls
   * ensureSubscriptions.
   */
  async completeAuthorization(
    app: XAppCredentials,
    code: string,
    redirectUri: string,
    codeVerifier: string,
  ): Promise<XCredentials> {
    let tokens;
    try {
      tokens = await this.client.exchangeCode(app, code, redirectUri, codeVerifier);
    } catch (error) {
      if (error instanceof XApiError && (error.status === 401 || error.title === 'unauthorized_client' || error.title === 'invalid_client')) {
        throw new XConnectError('x_invalid_client', 'X rejected the OAuth 2.0 client id and secret');
      }
      throw error;
    }

    const missing = missingScopes(tokens.scope);
    if (missing.length > 0 || !tokens.refresh_token) {
      logger.warn(`${TAG} Authorization missing scopes`, { missing, hasRefreshToken: !!tokens.refresh_token });
      throw new XConnectError(
        'x_missing_scopes',
        `The X app did not grant: ${missing.join(', ') || 'offline.access'}. Set app permissions to "Read and write and Direct message".`,
      );
    }

    const me = await this.client.getMe(tokens.access_token);
    return credentialsWithTokens(
      { app, xUserId: me.id, username: me.username, tokens: { accessToken: '', refreshToken: '', expiresAt: 0 } },
      tokens,
    );
  }

  /** Creates the support subscriptions; an existing identical one counts as success. */
  async ensureSubscriptions(creds: XCredentials): Promise<void> {
    for (const eventType of X_SUPPORT_EVENT_TYPES) {
      try {
        await this.client.createSubscription(creds.tokens.accessToken, creds.xUserId, eventType);
      } catch (error) {
        if (isXDuplicateSubscription(error)) continue;
        logger.error(`${TAG} Subscription create failed`, { eventType, xUserId: creds.xUserId, error: String(error) });
        if (isXAuthRejected(error)) throw new XConnectError('x_connection_failed', 'X rejected the account token');
        throw new XConnectError('x_subscription_failed', `Could not subscribe to ${eventType} events`);
      }
    }
  }

  /**
   * Deletes our subscriptions for the account so X stops delivering (and billing) its events.
   * Best effort: logs and returns false on failure, never throws.
   */
  async removeSubscriptions(creds: Pick<XCredentials, 'app' | 'xUserId'>): Promise<boolean> {
    try {
      const bearer = await this.client.getAppBearer(creds.app);
      const subs = await this.client.listSubscriptions(bearer, creds.xUserId);
      for (const sub of subs.filter((s) => !s.tag || s.tag.startsWith('xyne:'))) {
        await this.client.deleteSubscription(bearer, sub.subscription_id);
      }
      return true;
    } catch (error) {
      logger.warn(`${TAG} Failed to remove X subscriptions`, { xUserId: creds.xUserId, error: String(error) });
      return false;
    }
  }

  /**
   * Disconnect cleanup: stop event delivery, revoke the user's refresh token, and return
   * credentials with the tokens blanked and XChat keys removed. App keys are kept so reconnect does not ask for them again.
   */
  async teardown(creds: XCredentials): Promise<XCredentials> {
    await this.removeSubscriptions(creds);
    try {
      await this.client.revokeToken(creds.app, creds.tokens.refreshToken, 'refresh_token');
    } catch (error) {
      logger.warn(`${TAG} Token revoke failed (non-fatal)`, { xUserId: creds.xUserId, error: String(error) });
    }
    // XChat keys are the account's chat identity: never keep them past a disconnect.
    return { ...creds, xchat: undefined, tokens: { accessToken: '', refreshToken: '', expiresAt: 0 } };
  }
}

export const xConnectionService = new XConnectionService();
