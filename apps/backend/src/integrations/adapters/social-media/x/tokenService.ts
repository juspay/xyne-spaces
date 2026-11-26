import type { ExternalSource } from '@prisma/client';
import { db } from '@/database/client';
import { decrypt, encrypt } from '@/services/encryptionService';
import { acquireLock, releaseLock } from '@/utils/distributedLock';
import { logger } from '@/utils/logger';
import { disconnectDeskSourceBySystem } from '@/integrations/core/deskSourceDisconnect';
import { isXAuthRejected, xApiClient, type XApiClient, type XTokenResponse } from './client';
import { X_TOKEN_REFRESH_SKEW_MS } from './constants';
import type { XCredentials } from './types';
import { xchatService, type XChatAccount } from './xchat';

const TAG = '[XTokenService]';

/**
 * Every change to an X source's credentials takes this lock: refresh tokens are single-use, so a
 * write based on an older read would put back a token X has already rotated away.
 */
const credentialsLockKey = (sourceId: string) => `lock:x-token-refresh:${sourceId}`;
const CREDENTIALS_LOCK = { ttlSeconds: 30, waitTimeoutMs: 20_000 };

/** The account's X connection is dead and the source has been marked disconnected. */
export class XConnectionLostError extends Error {
  constructor(readonly sourceId: string) {
    super('X no longer accepts this account connection — reconnect it in desk settings');
    this.name = 'XConnectionLostError';
  }
}

export function parseXCredentials(encrypted: string): XCredentials {
  const creds = JSON.parse(decrypt(encrypted)) as XCredentials;
  if (!creds?.app?.clientId || !creds?.tokens?.accessToken || !creds?.xUserId) {
    throw new Error('Malformed X credentials');
  }
  return creds;
}

/** App keys only — works for a disconnected source whose tokens were blanked. */
export function parseXAppCredentials(encrypted: string): Pick<XCredentials, 'app' | 'xUserId' | 'username'> | null {
  if (!encrypted) return null;
  try {
    const creds = JSON.parse(decrypt(encrypted)) as Partial<XCredentials>;
    return creds.app?.clientId && creds.xUserId ? { app: creds.app, xUserId: creds.xUserId, username: creds.username ?? '' } : null;
  } catch {
    return null;
  }
}

/** Credentials with the dead user tokens blanked and the XChat keys deleted; app keys kept for reconnect. */
export function withoutUserSecrets(creds: XCredentials): XCredentials {
  return { ...creds, xchat: undefined, tokens: { accessToken: '', refreshToken: '', expiresAt: 0 } };
}

export function credentialsWithTokens(creds: XCredentials, res: XTokenResponse, now = Date.now()): XCredentials {
  return {
    ...creds,
    tokens: {
      accessToken: res.access_token,
      // X rotates refresh tokens; keep the old one only if (unexpectedly) none came back.
      refreshToken: res.refresh_token ?? creds.tokens.refreshToken,
      expiresAt: now + res.expires_in * 1000,
      scope: res.scope ?? creds.tokens.scope,
    },
  };
}

export class XTokenService {
  constructor(private readonly client: XApiClient = xApiClient) {}

  /**
   * A valid user access token for the source, refreshing it when it is close to expiry.
   *
   * Refresh tokens are single-use, so two concurrent refreshes would leave one caller holding a
   * dead token. The refresh runs under a per-source lock that waits, and re-reads the row after
   * acquiring it so a caller that queued behind another refresh just uses the new token.
   */
  async getAccessToken(source: Pick<ExternalSource, 'id' | 'credentials'>, opts: { force?: boolean } = {}): Promise<string> {
    const creds = parseXCredentials(source.credentials);
    if (!opts.force && creds.tokens.expiresAt - Date.now() > X_TOKEN_REFRESH_SKEW_MS) {
      return creds.tokens.accessToken;
    }

    const lock = await acquireLock(credentialsLockKey(source.id), CREDENTIALS_LOCK);
    if (!lock) throw new Error(`Timed out waiting for X token refresh lock (source ${source.id})`);
    try {
      const fresh = await db.externalSource.findUnique({
        where: { id: source.id },
        select: { credentials: true, isActive: true },
      });
      if (!fresh?.isActive || !fresh.credentials) throw new XConnectionLostError(source.id);
      const current = parseXCredentials(fresh.credentials);
      // Someone refreshed while we waited.
      if (current.tokens.accessToken !== creds.tokens.accessToken && current.tokens.expiresAt - Date.now() > X_TOKEN_REFRESH_SKEW_MS) {
        return current.tokens.accessToken;
      }

      let res: XTokenResponse;
      try {
        res = await this.client.refreshUserToken(current.app, current.tokens.refreshToken);
      } catch (error) {
        if (isXAuthRejected(error)) {
          logger.warn(`${TAG} Refresh rejected — disconnecting source`, { sourceId: source.id });
          // Already holding the credentials lock: write directly.
          await db.externalSource.update({
            where: { id: source.id },
            data: { credentials: encrypt(JSON.stringify(withoutUserSecrets(current))) },
          });
          await this.connectionLost(source.id, current);
        }
        throw error;
      }

      const next = credentialsWithTokens(current, res);
      await db.externalSource.update({ where: { id: source.id }, data: { credentials: encrypt(JSON.stringify(next)) } });
      logger.info(`${TAG} Refreshed X user token`, { sourceId: source.id, expiresInS: res.expires_in });
      return next.tokens.accessToken;
    } finally {
      await releaseLock(lock);
    }
  }

  /** Runs `fn` with a user token; on a 401 forces one refresh and retries once. */
  async withUserToken<T>(source: Pick<ExternalSource, 'id' | 'credentials'>, fn: (token: string) => Promise<T>): Promise<T> {
    const token = await this.getAccessToken(source);
    try {
      return await fn(token);
    } catch (error) {
      if (!isXAuthRejected(error)) throw error;
      const retryToken = await this.getAccessToken(source, { force: true });
      try {
        return await fn(retryToken);
      } catch (retryError) {
        if (isXAuthRejected(retryError)) {
          const dropped = await updateXCredentials(source.id, (current) => withoutUserSecrets(current));
          await this.connectionLost(source.id, dropped ?? parseXCredentials(source.credentials));
        }
        throw retryError;
      }
    }
  }

  /**
   * X no longer accepts the account: the same cleanup as a user disconnect, so nothing outlives it.
   * Stops X delivery (and billing) using the app keys, forgets XChat keys in memory, and marks the
   * source disconnected. The caller has already blanked the tokens and deleted the stored XChat keys.
   */
  private async connectionLost(sourceId: string, creds: Pick<XCredentials, 'app' | 'xUserId'>): Promise<never> {
    try {
      await this.client.removeXyneSubscriptions(creds.app, creds.xUserId);
    } catch (error) {
      logger.warn(`${TAG} Could not remove X subscriptions after connection loss`, { sourceId, error: String(error) });
    }
    xchatService.forget(sourceId);
    await disconnectDeskSourceBySystem(sourceId, { clearCredentials: false });
    throw new XConnectionLostError(sourceId);
  }
}

export const xTokenService = new XTokenService();

/** The source's XChat context, or null when XChat decryption is not enabled for it. */
export function xchatAccountFor(source: Pick<ExternalSource, 'id' | 'credentials'>, tokens: XTokenService = xTokenService): XChatAccount | null {
  const creds = parseXCredentials(source.credentials);
  if (!creds.xchat?.keys) return null;
  return {
    sourceId: source.id,
    xUserId: creds.xUserId,
    keys: creds.xchat,
    withToken: (fn) => tokens.withUserToken(source, fn),
  };
}

/**
 * Replaces a source's credentials under the refresh lock. `build` gets the previous credentials as
 * stored, even when their tokens were blanked by a disconnect (null if the column is empty or
 * unreadable), so a reconnect can carry fields such as the XChat keys forward.
 */
export async function replaceXCredentials(
  sourceId: string,
  build: (previous: XCredentials | null) => XCredentials | Promise<XCredentials>,
): Promise<XCredentials> {
  const lock = await acquireLock(credentialsLockKey(sourceId), CREDENTIALS_LOCK);
  if (!lock) throw new Error(`Timed out waiting for X credentials lock (source ${sourceId})`);
  try {
    const row = await db.externalSource.findUnique({ where: { id: sourceId }, select: { credentials: true } });
    let previous: XCredentials | null = null;
    try {
      previous = row?.credentials ? (JSON.parse(decrypt(row.credentials)) as XCredentials) : null;
    } catch {
      previous = null;
    }
    const next = await build(previous);
    await db.externalSource.update({ where: { id: sourceId }, data: { credentials: encrypt(JSON.stringify(next)) } });
    return next;
  } finally {
    await releaseLock(lock);
  }
}

/**
 * Read-modify-write of a source's credentials under the refresh lock, on a fresh read. `change`
 * must not call X with the user token (a refresh would wait on this same lock); do network work
 * before, and merge its result here. Returns null, writing nothing, when the source has no usable
 * credentials (already torn down) or `change` returns null.
 */
export async function updateXCredentials(
  sourceId: string,
  change: (current: XCredentials) => XCredentials | null | Promise<XCredentials | null>,
): Promise<XCredentials | null> {
  const lock = await acquireLock(credentialsLockKey(sourceId), CREDENTIALS_LOCK);
  if (!lock) throw new Error(`Timed out waiting for X credentials lock (source ${sourceId})`);
  try {
    const row = await db.externalSource.findUnique({ where: { id: sourceId }, select: { credentials: true } });
    if (!row?.credentials) return null;
    let current: XCredentials;
    try {
      current = parseXCredentials(row.credentials);
    } catch {
      return null;
    }
    const next = await change(current);
    if (!next) return null;
    await db.externalSource.update({ where: { id: sourceId }, data: { credentials: encrypt(JSON.stringify(next)) } });
    return next;
  } finally {
    await releaseLock(lock);
  }
}
