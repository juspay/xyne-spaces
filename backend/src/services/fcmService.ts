import { GoogleAuth } from 'google-auth-library';
import type { Redis } from 'ioredis';

import { config } from '@/config/env';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { redisService } from './redisService';
import { Prisma, SessionStatus } from '@prisma/client';

type CachedAccessToken = {
  accessToken: string;
  expiresAt: number;
};

const TOKEN_CACHE_KEY = 'fcm:v1:access_token';
const TOKEN_LOCK_KEY = 'fcm:v1:access_token:lock';
const RELEASE_LOCK_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
else
  return 0
end
`;

class FcmAccessTokenManager {
  private auth: GoogleAuth;
  private redis?: Redis;
  private inMemory?: CachedAccessToken;
  private refreshSkewSeconds = 600;
  private lockTtlMs = 30_000;

  constructor(opts: { redis?: Redis; serviceAccountJson?: Record<string, unknown> }) {
    this.redis = opts.redis;
    this.auth = new GoogleAuth({
      credentials: opts.serviceAccountJson,
      scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
    });
  }

  async getAccessToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const cached = await this.readCache();

    if (cached && now < cached.expiresAt - this.refreshSkewSeconds) {
      return cached.accessToken;
    }

    if (this.redis) {
      return this.refreshWithLock();
    }

    const fresh = await this.mintToken();
    await this.writeCache(fresh);
    return fresh.accessToken;
  }

  async invalidate(): Promise<void> {
    this.inMemory = undefined;
    if (this.redis) {
      await this.redis.del(TOKEN_CACHE_KEY);
    }
  }

  private async refreshWithLock(): Promise<string> {
    const cached = await this.readCache();
    const now = Math.floor(Date.now() / 1000);
    if (cached && now < cached.expiresAt - this.refreshSkewSeconds) {
      return cached.accessToken;
    }

    const lockId = `${process.pid}:${Math.random()}`;
    const acquired = await this.redis!.set(TOKEN_LOCK_KEY, lockId, 'PX', this.lockTtlMs, 'NX');

    if (!acquired) {
      await sleep(200);
      const nextCached = await this.readCache();
      if (nextCached) return nextCached.accessToken;

      await sleep(500);
      const fallbackCached = await this.readCache();
      if (fallbackCached) return fallbackCached.accessToken;

      throw new Error('Failed to acquire token refresh lock in time');
    }

    try {
      const fresh = await this.mintToken();
      await this.writeCache(fresh);
      return fresh.accessToken;
    } finally {
      try {
        await this.redis!.eval(RELEASE_LOCK_SCRIPT, 1, TOKEN_LOCK_KEY, lockId);
      } catch (error) {
        logger.warn('Failed to release FCM token refresh lock safely', { error });
      }
    }
  }

  private async mintToken(): Promise<CachedAccessToken> {
    const client = await this.auth.getClient();
    const resp = await client.getAccessToken();

    if (!resp?.token) {
      throw new Error('Failed to mint FCM access token');
    }

    const expiryMs = (
      client as {
        credentials?: {
          expiry_date?: number;
        };
      }
    ).credentials?.expiry_date;
    const expiresAt =
      typeof expiryMs === 'number'
        ? Math.floor(expiryMs / 1000)
        : Math.floor(Date.now() / 1000) + 3500;

    logger.info('FCM access token minted');

    return {
      accessToken: resp.token,
      expiresAt,
    };
  }

  private async readCache(): Promise<CachedAccessToken | undefined> {
    if (!this.redis) {
      return this.inMemory;
    }

    const raw = await this.redis.get(TOKEN_CACHE_KEY);
    if (!raw) return undefined;

    try {
      return JSON.parse(raw) as CachedAccessToken;
    } catch {
      return undefined;
    }
  }

  private async writeCache(token: CachedAccessToken): Promise<void> {
    if (!this.redis) {
      this.inMemory = token;
      return;
    }

    const now = Math.floor(Date.now() / 1000);
    const ttlSeconds = Math.max(60, token.expiresAt - now + 60);
    await this.redis.set(TOKEN_CACHE_KEY, JSON.stringify(token), 'EX', ttlSeconds);
  }
}

export type MobilePushRegistration = {
  fcmToken: string;
  voipToken?: string;
  platform?: string;
  deviceId?: string;
  sessionId: string;
};

export type FcmNotificationPayload = {
  title: string;
  message: string;
  type: string;
  notificationId?: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
  actionUrl?: string;
  metadata?: Record<string, unknown>;
};

type SessionPushTarget = {
  sessionId: string;
  userId: string;
  token: string;
  platform: string;
  deviceId?: string | null;
};

class FcmPushService {
  private accessTokenManager?: FcmAccessTokenManager;
  private redis?: Redis;
  private projectId?: string;
  private sendEnabled = false;

  constructor() {
    try {
      this.redis = redisService.getClient();
    } catch {
      this.redis = undefined;
    }

    this.projectId = config.fcm.projectId || undefined;
    const serviceAccount = this.loadServiceAccount();

    if (!this.projectId) {
      logger.warn('FCM push disabled: FCM_PROJECT_ID not configured');
      return;
    }

    this.accessTokenManager = new FcmAccessTokenManager({
      redis: this.redis,
      serviceAccountJson: serviceAccount,
    });

    this.sendEnabled = true;
    logger.info('FCM push service initialized');
  }

  isSendEnabled(): boolean {
    return this.sendEnabled && !!this.projectId && !!this.accessTokenManager;
  }

  async registerToken(userId: string, payload: MobilePushRegistration): Promise<void> {
    const fcmTokenPreview = payload.fcmToken
      ? `${payload.fcmToken.slice(0, 10)}...${payload.fcmToken.slice(-8)}`
      : null;
    const voipTokenPreview = payload.voipToken
      ? `${payload.voipToken.slice(0, 10)}...${payload.voipToken.slice(-8)}`
      : null;

    logger.info('[FCM] registerToken step=enter', {
      userId,
      sessionId: payload.sessionId,
      platform: payload.platform ?? null,
      deviceId: payload.deviceId ?? null,
      fcmTokenPresent: !!payload.fcmToken,
      fcmTokenPreview,
      voipTokenPresent: !!payload.voipToken,
      voipTokenPreview,
    });

    if (!payload.fcmToken) {
      logger.warn('[FCM] registerToken step=missing_token', {
        userId,
        sessionId: payload.sessionId,
        platform: payload.platform ?? null,
        deviceId: payload.deviceId ?? null,
      });
      return;
    }

    logger.info('[FCM] registerToken step=find_session', {
      userId,
      requestedSessionId: payload.sessionId,
      fcmTokenPreview,
    });
    const sessionEntry = await db.userSession.findFirst({
      where: { id: payload.sessionId, userId },
      select: {
        id: true,
        deviceId: true,
      },
    });

    if (!sessionEntry) {
      logger.warn('[FCM] registerToken step=session_not_found', {
        userId,
        sessionId: payload.sessionId,
        fcmTokenPreview,
        voipTokenPreview,
      });
      return;
    }

    logger.info('[FCM] registerToken step=session_resolved', {
      userId,
      requestedSessionId: payload.sessionId,
      resolvedSessionId: sessionEntry.id,
      sessionDeviceId: sessionEntry.deviceId ?? null,
    });

    const composedToken = this.composeStoredToken(payload.platform, payload.fcmToken);
    const composedVoipToken = payload.voipToken
      ? this.composeStoredToken(payload.platform, payload.voipToken)
      : null;

    const composedTokenPreview = `${composedToken.slice(0, 10)}...${composedToken.slice(-8)}`;
    const composedVoipTokenPreview = composedVoipToken
      ? `${composedVoipToken.slice(0, 10)}...${composedVoipToken.slice(-8)}`
      : null;

    logger.info('[FCM] registerToken step=compose_tokens', {
      userId,
      sessionId: sessionEntry.id,
      platform: payload.platform ?? null,
      fcmTokenPreview,
      composedTokenPreview,
      voipTokenPreview,
      composedVoipTokenPreview,
    });

    const nextDeviceId = payload.deviceId ?? sessionEntry.deviceId ?? null;

    logger.info('[FCM] registerToken step=update_target_session', {
      userId,
      sessionId: sessionEntry.id,
      nextDeviceId,
      composedTokenPreview,
      composedVoipTokenPreview,
    });
    await db.userSession.update({
      where: { id: sessionEntry.id },
      data: {
        fcmToken: composedToken,
        voipToken: composedVoipToken,
        deviceId: nextDeviceId,
        updatedAt: new Date(),
      },
    });

    const duplicateConditions: Prisma.UserSessionWhereInput[] = [{ fcmToken: composedToken }];

    if (composedVoipToken) {
      logger.info('[FCM] registerToken step=add_duplicate_condition_voip', {
        userId,
        sessionId: sessionEntry.id,
        composedVoipTokenPreview,
      });
      duplicateConditions.push({ voipToken: composedVoipToken });
    }

    logger.info('[FCM] registerToken step=clear_duplicates', {
      userId,
      sessionId: sessionEntry.id,
      duplicateConditionCount: duplicateConditions.length,
      nextDeviceId,
      composedTokenPreview,
      composedVoipTokenPreview,
    });
    const duplicateCleanupResult = await db.userSession.updateMany({
      where: {
        userId,
        id: { not: sessionEntry.id },
        OR: duplicateConditions,
      },
      data: {
        fcmToken: null,
        voipToken: null,
        deviceId: null,
      },
    });

    logger.info('[FCM] registerToken step=complete', {
      userId,
      sessionId: sessionEntry.id,
      nextDeviceId,
      duplicateConditionCount: duplicateConditions.length,
      duplicateCleanupCount: duplicateCleanupResult.count,
      composedTokenPreview,
      composedVoipTokenPreview,
    });
  }

  async unregisterToken(userId: string, token: string, sessionId?: string): Promise<void> {
    if (!token) return;

    this.buildTokenCandidates(token);

    await db.userSession.updateMany({
      where: {
        userId,
        ...(sessionId ? { id: sessionId } : {}),
        OR: [
          { fcmToken: token },
          { fcmToken: { endsWith: `:${token}` } },
          { voipToken: token },
          { voipToken: { endsWith: `:${token}` } },
        ],
      },
      data: {
        fcmToken: null,
        voipToken: null,
        deviceId: null,
      },
    });
  }

  async unregisterUserTokens(userId: string): Promise<void> {
    await db.userSession.updateMany({
      where: { userId },
      data: {
        fcmToken: null,
        voipToken: null,
        deviceId: null,
      },
    });
  }

  async hasActiveTokens(userId: string): Promise<boolean> {
    const activeCount = await db.userSession.count({
      where: {
        userId,
        status: SessionStatus.ACTIVE,
        refreshTokenExpiry: { gt: new Date() },
        OR: [{ fcmToken: { not: null } }, { voipToken: { not: null } }],
      },
    });
    return activeCount > 0;
  }

  async sendNotification(userId: string, payload: FcmNotificationPayload): Promise<void> {
    if (!this.isSendEnabled()) {
      return;
    }

    const sessions = await db.userSession.findMany({
      where: {
        userId,
        status: SessionStatus.ACTIVE,
        refreshTokenExpiry: { gt: new Date() },
        fcmToken: { not: null },
      },
      select: {
        id: true,
        userId: true,
        fcmToken: true,
        deviceId: true,
      },
      orderBy: { updatedAt: 'desc' },
    });

    const targets = sessions
      .map((session) => {
        const parsed = this.parseStoredToken(session.fcmToken);
        if (!parsed) {
          return null;
        }
        return {
          sessionId: session.id,
          userId: session.userId,
          token: parsed.token,
          platform: parsed.platform,
          deviceId: session.deviceId,
        } as SessionPushTarget;
      })
      .filter((target): target is SessionPushTarget => target !== null);

    if (targets.length === 0) {
      return;
    }

    const successfulSessionIds: string[] = [];

    await Promise.all(
      targets.map(async (target) => {
        const delivered = await this.sendToSession(target, payload);
        if (delivered) {
          successfulSessionIds.push(target.sessionId);
        }
      })
    );

    if (successfulSessionIds.length > 0) {
      await db.userSession.updateMany({
        where: { id: { in: successfulSessionIds } },
        data: { updatedAt: new Date() },
      });
    }
  }

  private async sendToSession(
    target: SessionPushTarget,
    payload: FcmNotificationPayload
  ): Promise<boolean> {
    try {
      await this.dispatchToFcm(target.token, payload);
      return true;
    } catch (error) {
      const errorCode = extractFcmErrorCode(error);
      const status =
        typeof error === 'object' && error && 'status' in error
          ? (error as { status?: string }).status
          : undefined;
      const responseBody =
        typeof error === 'object' && error && 'responseBody' in error
          ? (error as { responseBody?: string }).responseBody
          : undefined;
      const message =
        error instanceof Error ? error.message : typeof error === 'string' ? error : undefined;

      logger.warn('FCM delivery failure', {
        platform: target.platform,
        errorCode,
        status,
        responseBody,
        message,
      });

      const invalidTokenErrorCodes: Array<string | undefined> = [
        'UNREGISTERED',
        'INVALID_ARGUMENT',
        'UNSPECIFIED',
        'NOT_FOUND',
      ];

      if (invalidTokenErrorCodes.includes(errorCode)) {
        try {
          await this.clearSessionPushToken(target.sessionId);
        } catch (cleanupError) {
          logger.debug('Failed to clear session token after delivery failure', {
            sessionId: target.sessionId,
            cleanupError,
          });
        }
      }

      return false;
    }
  }

  private async dispatchToFcm(token: string, payload: FcmNotificationPayload): Promise<void> {
    if (!this.accessTokenManager || !this.projectId) {
      throw new Error('FCM access token manager not initialized');
    }

    const webpush = payload.actionUrl
      ? {
        fcm_options: {
          link: payload.actionUrl,
        },
      }
      : undefined;

    const apns = this.buildApnsPayload(payload);
    const requestBody = {
      message: {
        token,
        data: this.buildDataPayload(payload),
        android: {
          priority: 'high',
          ttl: '86400s',
        },
        ...(webpush ? { webpush } : {}),
        ...(apns ? { apns } : {}),
      },
    };

    const url = `https://fcm.googleapis.com/v1/projects/${this.projectId}/messages:send`;

    const doRequest = async () => {
      const accessToken = await this.accessTokenManager!.getAccessToken();
      return fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });
    };

    let response = await doRequest();

    if (response.status === 401 || response.status === 403) {
      await this.accessTokenManager.invalidate();
      response = await doRequest();
    }

    if (!response.ok) {
      const errorText = await response.text();
      const error = new Error(
        `FCM send failed: ${response.status} ${response.statusText} - ${errorText}`
      ) as Error & { status?: number; responseBody?: string };
      error.status = response.status;
      error.responseBody = errorText;
      throw error;
    }
  }

  private buildDataPayload(payload: FcmNotificationPayload): Record<string, string> {
    const data: Record<string, string> = {
      type: payload.type,
      msg_title: payload.title,
      msg_body: payload.message,
      category: payload.type,
    };

    if (payload.notificationId) data.notificationId = payload.notificationId;
    if (payload.actionUrl) data.actionUrl = payload.actionUrl;
    if (payload.actionUrl) data.deeplink = payload.actionUrl;
    if (payload.relatedEntityType) data.relatedEntityType = payload.relatedEntityType;
    if (payload.relatedEntityId) data.relatedEntityId = payload.relatedEntityId;
    if (payload.metadata) data.metadata = JSON.stringify(payload.metadata);
    // TODO: add image support once native clients need rich media notifications.

    return data;
  }

  private buildApnsPayload(payload: FcmNotificationPayload): {
    headers: Record<string, string>;
    payload: { aps: Record<string, unknown> };
  } {
    return {
      headers: {
        'apns-priority': '10',
      },
      payload: {
        aps: {
          alert: {
            title: payload.title,
            body: payload.message,
          },
          sound: 'default',
          'mutable-content': 1,
        },
      },
    };
  }

  private composeStoredToken(platform: string | undefined, token: string): string {
    const normalized = this.normalizePlatformName(platform);
    return `${normalized}:${token}`;
  }

  private normalizePlatformName(platform?: string): 'ios' | 'android' | 'unknown' {
    switch ((platform ?? '').toLowerCase()) {
      case 'ios':
        return 'ios';
      case 'android':
        return 'android';
      default:
        return 'unknown';
    }
  }

  private parseStoredToken(stored?: string | null): { platform: string; token: string } | null {
    if (!stored || stored.trim().length === 0) {
      return null;
    }

    const delimiterIndex = stored.indexOf(':');
    if (delimiterIndex === -1) {
      return {
        platform: this.normalizePlatformName(undefined),
        token: stored,
      };
    }

    const platform = stored.slice(0, delimiterIndex) || this.normalizePlatformName(undefined);
    const token = stored.slice(delimiterIndex + 1);

    if (!token) {
      return null;
    }

    return { platform, token };
  }

  private buildTokenCandidates(token: string): string[] {
    const trimmed = token.trim();
    if (trimmed.length === 0) {
      return [];
    }
    return ['ios', 'android', 'unknown'].map((platform) => `${platform}:${trimmed}`);
  }

  async clearSessionPushToken(sessionId: string): Promise<void> {
    try {
      await db.userSession.update({
        where: { id: sessionId },
        data: { fcmToken: null, voipToken: null, deviceId: null },
      });
    } catch (error) {
      logger.debug('Failed to clear session push token', { sessionId, error });
    }
  }

  /**
   * Get active sessions with FCM tokens for a user
   * Used by notification service to queue mobile push jobs
   */
  async getActiveSessionsWithTokens(
    userId: string
  ): Promise<Array<{ id: string; token: string; voipToken?: string; platform: string }>> {
    const sessions = await db.userSession.findMany({
      where: {
        userId,
        status: SessionStatus.ACTIVE,
        refreshTokenExpiry: { gt: new Date() },
        OR: [{ fcmToken: { not: null } }, { voipToken: { not: null } }],
      },
      select: { id: true, fcmToken: true, voipToken: true },
      orderBy: { updatedAt: 'desc' },
    });

    const results: Array<{ id: string; token: string; voipToken?: string; platform: string }> = [];

    for (const session of sessions) {
      const parsedFcm = session.fcmToken ? this.parseStoredToken(session.fcmToken) : null;
      const parsedVoip = session.voipToken ? this.parseStoredToken(session.voipToken) : null;

      if (!parsedFcm) continue;

      results.push({
        id: session.id,
        token: parsedFcm?.token || '',
        voipToken: parsedVoip?.token,
        platform: parsedFcm?.platform || parsedVoip?.platform || 'unknown',
      });
    }

    return results;
  }
  /**
   * Direct dispatch to FCM - exposed for worker usage
   * @throws Error if FCM call fails
   */
  async dispatchToFcmDirect(token: string, payload: FcmNotificationPayload): Promise<void> {
    return this.dispatchToFcm(token, payload);
  }

  private loadServiceAccount(): Record<string, unknown> | undefined {
    try {
      const base64Json = config.fcm.serviceAccountBase64;
      if (base64Json) {
        const decoded = Buffer.from(base64Json, 'base64').toString('utf8');
        return JSON.parse(decoded);
      }
    } catch (error) {
      logger.error('Failed to load FCM service account', error);
    }

    return undefined;
  }
}

function extractFcmErrorCode(error: unknown): string | undefined {
  if (!error) return undefined;

  if (typeof error === 'object') {
    const withBody = error as { responseBody?: string };
    if (withBody.responseBody) {
      try {
        const parsed = JSON.parse(withBody.responseBody);
        const details = parsed?.error?.details;
        if (Array.isArray(details)) {
          for (const detail of details) {
            if (detail?.errorCode) {
              return detail.errorCode as string;
            }
          }
        }
        return parsed?.error?.status;
      } catch {
        return undefined;
      }
    }
  }

  return undefined;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const fcmPushService = new FcmPushService();
