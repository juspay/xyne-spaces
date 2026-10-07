import { GoogleAuth } from 'google-auth-library';
import type { Redis } from 'ioredis';

import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { redisService } from './redisService';
import { sendLocalIosPush } from './localIosPush';
import { getNotificationFcmPayloadTruncated } from '@/services/otel';
import { recordPushTargets } from '@/services/otel/authMetrics';
import { normalizePushPlatform } from '@/auth/legacyPushToken';
import type { PushTarget, PushTargetRef, SessionRepository } from '@/auth/types';
import * as authSessionRepo from '@/bypassAcl/authSessionServices';

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

/**
 * Body of `POST /notifications/mobile/register` plus the caller's own `auth_sessions.id`.
 * Tokens are stored raw on that row (`pushPlatform` / `appVersion` are separate columns).
 */
export type MobilePushRegistration = {
  sessionId: string;
  fcmToken: string;
  voipToken?: string | null;
  platform?: string | null;
  deviceId?: string | null;
  appVersion?: string | null;
};

/** DB seam: the push subset of the auth-session repository (faked in fcmService.test.ts). */
export type FcmSessionRepo = Pick<
  SessionRepository,
  'setPushTokens' | 'clearPushTokens' | 'findPushTargetsForAccount' | 'nullLegacyPushColumns' | 'findUserById'
>;

// Late-bound so a jest.mock / spy on the module is honoured after the singleton is built.
const defaultRepo: FcmSessionRepo = {
  setPushTokens: (input) => authSessionRepo.setPushTokens(input),
  clearPushTokens: (sessionId) => authSessionRepo.clearPushTokens(sessionId),
  findPushTargetsForAccount: (accountId, now) => authSessionRepo.findPushTargetsForAccount(accountId, now),
  nullLegacyPushColumns: (legacyId) => authSessionRepo.nullLegacyPushColumns(legacyId),
  findUserById: (userId) => authSessionRepo.findUserById(userId),
};

function previewToken(token?: string | null): string | null {
  return token ? `${token.slice(0, 10)}...${token.slice(-8)}` : null;
}

export type FcmNotificationPayload = {
  title: string;
  message: string;
  type: string;
  notificationId?: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
  actionUrl?: string;
  metadata?: Record<string, unknown>;
  // Silent prefetch-only push (used for the sender's own messages so cross-platform
  // sends warm the mobile cache). Forces the silent code path AND surfaces a
  // `prefetchOnly=1` FCM data field so clients can distinguish it from other
  // silent pushes (read/edit/delete) that mutate an existing tray.
  prefetchOnly?: boolean;
};

export class FcmPushService {
  private readonly repo: FcmSessionRepo;
  private accessTokenManager?: FcmAccessTokenManager;
  private accessTokenManagerNew?: FcmAccessTokenManager;
  private redis?: Redis;
  private projectId?: string;
  private projectIdNew?: string;
  private sendEnabled = false;

  constructor(deps?: { repo?: FcmSessionRepo }) {
    this.repo = deps?.repo ?? defaultRepo;
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

    this.projectIdNew = config.fcm.projectIdNew || undefined;
    if (this.projectIdNew) {
      const serviceAccountNew = this.loadServiceAccountNew();
      if (serviceAccountNew) {
        this.accessTokenManagerNew = new FcmAccessTokenManager({
          redis: this.redis,
          serviceAccountJson: serviceAccountNew,
        });
      }
    }

    this.sendEnabled = true;
    logger.info('FCM push service initialized');
  }

  isSendEnabled(): boolean {
    return this.sendEnabled && !!this.projectId && !!this.accessTokenManager;
  }

  /**
   * Store push tokens on the caller's own `auth_sessions` row (guarded by accountId). The repo
   * nulls the same tokens on other ACTIVE rows and adopts `deviceId` as the row's deviceKey.
   */
  async registerToken(accountId: string, reg: MobilePushRegistration): Promise<void> {
    const fcmTokenPreview = previewToken(reg.fcmToken);
    const voipTokenPreview = previewToken(reg.voipToken);
    const pushPlatform = normalizePushPlatform(reg.platform);

    logger.info('[FCM] registerToken step=enter', {
      accountId,
      sessionId: reg.sessionId,
      platform: reg.platform ?? null,
      pushPlatform,
      deviceId: reg.deviceId ?? null,
      appVersion: reg.appVersion ?? null,
      fcmTokenPresent: !!reg.fcmToken,
      fcmTokenPreview,
      voipTokenPresent: !!reg.voipToken,
      voipTokenPreview,
    });

    if (!reg.fcmToken) {
      logger.warn('[FCM] registerToken step=missing_token', {
        accountId,
        sessionId: reg.sessionId,
        platform: reg.platform ?? null,
        deviceId: reg.deviceId ?? null,
      });
      return;
    }

    logger.info('[FCM] registerToken step=set_push_tokens', {
      accountId,
      sessionId: reg.sessionId,
      pushPlatform,
      deviceId: reg.deviceId ?? null,
      fcmTokenPreview,
      voipTokenPreview,
    });

    const updated = await this.repo.setPushTokens({
      sessionId: reg.sessionId,
      accountId,
      fcmToken: reg.fcmToken,
      voipToken: reg.voipToken?.trim() || null,
      pushPlatform,
      appVersion: reg.appVersion,
      deviceId: reg.deviceId,
    });

    if (!updated) {
      logger.warn('[FCM] registerToken step=session_not_found', {
        accountId,
        sessionId: reg.sessionId,
        fcmTokenPreview,
        voipTokenPreview,
      });
      return;
    }

    logger.info('[FCM] registerToken step=complete', {
      accountId,
      sessionId: reg.sessionId,
      pushPlatform,
      deviceId: reg.deviceId ?? null,
      fcmTokenPreview,
      voipTokenPreview,
    });
  }

  /** Clear both push tokens on one `auth_sessions` row (user-initiated unregister). */
  async unregisterToken(sessionId: string): Promise<void> {
    await this.repo.clearPushTokens(sessionId);
    logger.info('[FCM] unregisterToken step=complete', { sessionId });
  }

  async hasActiveTokens(userId: string): Promise<boolean> {
    return (await this.findTargets(userId)).length > 0;
  }

  /**
   * Deliverable push endpoints of the ACCOUNT behind `userId` (every workspace of the member):
   * `auth_sessions` rows with a token plus the read-only legacy fallback. Used by
   * notificationService to queue mobile push jobs; each target is a `PushTarget`.
   */
  async getActiveSessionsWithTokens(userId: string): Promise<PushTarget[]> {
    const targets = await this.findTargets(userId);
    const sessionCount = targets.filter((t) => t.source === 'session').length;
    recordPushTargets({ source: 'session', count: sessionCount });
    recordPushTargets({ source: 'legacy', count: targets.length - sessionCount });
    return targets;
  }

  /** Target lookup without metrics, so `hasActiveTokens` + `getActiveSessionsWithTokens` count once. */
  private async findTargets(userId: string): Promise<PushTarget[]> {
    const accountId = (await this.repo.findUserById(userId))?.orgMemberId;
    if (!accountId) return [];
    return this.repo.findPushTargetsForAccount(accountId);
  }

  async sendNotification(userId: string, payload: FcmNotificationPayload): Promise<void> {
    if (!this.isSendEnabled()) {
      return;
    }

    const targets = await this.getActiveSessionsWithTokens(userId);
    if (targets.length === 0) {
      return;
    }

    await Promise.all(targets.map((target) => this.sendToTarget(target, payload)));
  }

  private async sendToTarget(target: PushTarget, payload: FcmNotificationPayload): Promise<boolean> {
    try {
      await this.dispatchToFcm(target.token, payload, target.platform, target.appVersion);
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
        source: target.source,
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
        await this.clearPushToken({ id: target.id, source: target.source });
      }

      return false;
    }
  }

  /**
   * Null the push columns of the store a dead token came from: `auth_sessions` for `session`,
   * legacy `workflow.user_sessions` for `legacy` (exception (b)). Never throws.
   */
  async clearPushToken(ref: PushTargetRef): Promise<void> {
    try {
      if (ref.source === 'session') {
        await this.repo.clearPushTokens(ref.id);
      } else {
        await this.repo.nullLegacyPushColumns(ref.id);
      }
    } catch (error) {
      logger.debug('Failed to clear push token after delivery failure', { source: ref.source, error });
    }
  }

  private async dispatchToFcm(token: string, payload: FcmNotificationPayload, platform?: string, appVersion?: string): Promise<void> {
    const isSilent = payload.prefetchOnly === true || payload.type === 'THREAD_READ' || payload.type === 'CHANNEL_READ' || payload.type === 'MESSAGE_DELETED' || payload.type === 'MESSAGE_EDITED';
    if (config.env === 'development' && platform === 'ios') {
      await sendLocalIosPush(payload, this.buildDataPayload(payload, isSilent));
      return;
    }

    const useNew = platform && shouldUseNewFcmCredentials(platform, appVersion);
    const manager = useNew ? this.accessTokenManagerNew : this.accessTokenManager;
    const pid = useNew ? this.projectIdNew : this.projectId;

    if (!manager || !pid) {
      throw new Error('FCM access token manager not initialized');
    }

    const webpush = payload.actionUrl
      ? {
        fcm_options: {
          link: payload.actionUrl,
        },
      }
      : undefined;

    const apns = this.buildApnsPayload(payload, isSilent);
    const requestBody = {
      message: {
        token,
        data: this.buildDataPayload(payload, isSilent),
        android: {
          priority: isSilent ? 'normal' : 'high',
          ttl: '86400s',
        },
        ...(webpush ? { webpush } : {}),
        ...(apns ? { apns } : {}),
      },
    };

    const url = `https://fcm.googleapis.com/v1/projects/${pid}/messages:send`;

    const doRequest = async () => {
      const accessToken = await manager.getAccessToken();
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
      await manager.invalidate();
      response = await doRequest();
    }

    if (!response.ok) {
      const errorText = await response.text();

      // Diagnostic: FCM's generic `INVALID_ARGUMENT` ("Request contains an
      // invalid argument") does NOT echo the payload size, so it is impossible
      // to tell an over-4KB rejection apart from a different payload/token
      // problem from the error alone. Log the computed `data` byte size plus a
      // per-field byte breakdown so failures are classifiable in prod. We log
      // only byte SIZES (never field values) and a short token suffix (never
      // the full token) to avoid leaking message content or credentials.
      const fcmData = requestBody.message.data;
      const dataBytes = fcmDataByteSize(fcmData);
      const fieldBytes = Object.fromEntries(
        Object.entries(fcmData).map(([k, v]) => [k, Buffer.byteLength(v, 'utf8')])
      );
      logger.error('[MobilePush] FCM send rejected — payload diagnostics', {
        status: response.status,
        fcmError: truncateString(errorText, 500),
        notificationId: payload.notificationId,
        type: payload.type,
        platform: platform ?? 'unknown',
        appVersion,
        tokenSuffix: token.slice(-6),
        dataBytes,
        totalMessageBytes: Buffer.byteLength(JSON.stringify(requestBody), 'utf8'),
        fcmDataLimitBytes: FCM_DATA_HARD_LIMIT,
        overFcmDataLimit: dataBytes > FCM_DATA_HARD_LIMIT,
        hasApns: Boolean(apns),
        hasWebpush: Boolean(webpush),
        fieldBytes,
      });

      const error = new Error(
        `FCM send failed: ${response.status} ${response.statusText} - ${errorText}`
      ) as Error & { status?: number; responseBody?: string };
      error.status = response.status;
      error.responseBody = errorText;
      throw error;
    }
  }

  private buildDataPayload(payload: FcmNotificationPayload, isSilent: boolean): Record<string, string> {
    const data: Record<string, string> = {
      type: payload.type,
      category: payload.type,
    };

    if (!isSilent) {
      data.msg_title = payload.title;
      // Bound the body so one long message cannot dominate FCM's 4KB data budget.
      data.msg_body = truncateString(payload.message, MSG_BODY_MAX_CHARS);
    }
    if (payload.notificationId) data.notificationId = payload.notificationId;
    if (payload.actionUrl) data.actionUrl = payload.actionUrl;
    if (payload.actionUrl) data.deeplink = payload.actionUrl;
    if (payload.relatedEntityType) data.relatedEntityType = payload.relatedEntityType;
    if (payload.relatedEntityId) data.relatedEntityId = payload.relatedEntityId;
    if (payload.metadata) {
      // Strip heavy, client-unused blobs (notably the full `conversation` object
      // carrying initial_message_md + attachments) before serializing. The native
      // clients deep-link and render from the slim id/string fields and `msg_body`;
      // they never read `metadata.conversation`. Keeping it blows past FCM's 4KB
      // `data` limit and makes the provider reject the whole push (INVALID_ARGUMENT).
      const slimMetadata = stripHeavyMetadata(payload.metadata);
      data.metadata = JSON.stringify(slimMetadata);
    }
    if (payload.prefetchOnly) data.prefetchOnly = '1';
    // TODO: add image support once native clients need rich media notifications.

    // Defense-in-depth: guarantee the assembled data map fits FCM's 4KB limit,
    // progressively trimming the least-critical fields if anything still overflows.
    return enforceFcmByteBudget(data, payload);
  }

  private buildApnsPayload(payload: FcmNotificationPayload, isSilent: boolean): {
    headers: Record<string, string>;
    payload: { aps: Record<string, unknown> };
  } {
    const threadId = this.getApnsThreadId(payload);

    return {
      headers: {
        // iOS requires `apns-push-type` for APNs (iOS 13+). Without it,
        // background (silent) pushes may be dropped.
        'apns-push-type': isSilent ? 'background' : 'alert',
        // For silent/background pushes Apple expects low priority.
        ...(isSilent ? { 'apns-priority': '5' } : { 'apns-priority': '10' }),
      },
      payload: {
        aps: isSilent
          ? {
              'content-available': 1,
              ...(threadId ? { 'thread-id': threadId } : {}),
            }
          : {
              alert: {
                title: payload.title,
                body: payload.message,
              },
              sound: 'default',
              'mutable-content': 1,
              ...(threadId ? { 'thread-id': threadId } : {}),
            },
      },
    };
  }

  private getApnsThreadId(payload: FcmNotificationPayload): string | undefined {
    const metadata = payload.metadata ?? {};
    const isThreadReply = payload.type === 'THREAD_REPLY' || metadata.isThreadReply === true;
    const value = isThreadReply
      ? metadata.conversationId
      : metadata.channelId;

    return typeof value === 'string' && value.trim() ? value : undefined;
  }

  /**
   * Direct dispatch to FCM - exposed for worker usage
   * @throws Error if FCM call fails
   */
  async dispatchToFcmDirect(token: string, payload: FcmNotificationPayload, platform: string, appVersion?: string): Promise<void> {
    return this.dispatchToFcm(token, payload, platform, appVersion);
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

  private loadServiceAccountNew(): Record<string, unknown> | undefined {
    try {
      const base64Json = config.fcm.serviceAccountBase64New;
      if (base64Json) {
        const decoded = Buffer.from(base64Json, 'base64').toString('utf8');
        return JSON.parse(decoded);
      }
    } catch (error) {
      logger.error('Failed to load FCM service account (new)', error);
    }

    return undefined;
  }
}

// FCM/APNs hard ceiling for the `data` payload. We trim proactively at
// FCM_DATA_BYTE_BUDGET (below); this is the provider's actual reject point
// and is used only to classify rejections in diagnostics.
const FCM_DATA_HARD_LIMIT = 4096;
const FCM_DATA_BYTE_BUDGET = 3800;
const MSG_BODY_MAX_CHARS = 500;
const HEAVY_METADATA_KEYS = ['conversation'];

function truncateString(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 1))}\u2026`;
}

function stripHeavyMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const slim: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (HEAVY_METADATA_KEYS.includes(key) || value === undefined) continue;
    slim[key] = value;
  }
  return slim;
}

function fcmDataByteSize(data: Record<string, string>): number {
  let total = 0;
  for (const [key, value] of Object.entries(data)) {
    total += Buffer.byteLength(key, 'utf8') + Buffer.byteLength(value, 'utf8');
  }
  return total;
}

function enforceFcmByteBudget(
  data: Record<string, string>,
  payload: FcmNotificationPayload
): Record<string, string> {
  if (fcmDataByteSize(data) <= FCM_DATA_BYTE_BUDGET) {
    return data;
  }

  const trimmed: string[] = [];

  // 1. Drop metadata entirely — the client can refetch via notificationId/deeplink.
  if (data.metadata !== undefined) {
    delete data.metadata;
    trimmed.push('metadata');
  }

  // 2. Shorten the body further if still over budget.
  if (fcmDataByteSize(data) > FCM_DATA_BYTE_BUDGET && data.msg_body !== undefined) {
    data.msg_body = truncateString(data.msg_body, 120);
    trimmed.push('msg_body_shortened');
  }

  // 3. Last resort — drop the body; title + deeplink still render a useful push.
  if (fcmDataByteSize(data) > FCM_DATA_BYTE_BUDGET && data.msg_body !== undefined) {
    delete data.msg_body;
    trimmed.push('msg_body');
  }

  try {
    getNotificationFcmPayloadTruncated().add(1, { type: payload.type });
  } catch (err) {
    // metrics are best-effort; never let them break delivery, but surface the
    // failure at debug level so observability gaps are diagnosable in prod.
    logger.debug('Failed to emit notification_fcm_payload_truncated metric', {
      type: payload.type,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  logger.warn('FCM payload exceeded 4KB budget; trimmed before send', {
    type: payload.type,
    notificationId: payload.notificationId,
    trimmed,
    finalBytes: fcmDataByteSize(data),
  });

  return data;
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

function shouldUseNewFcmCredentials(platform: string, appVersion: string | undefined): boolean {
  if (!appVersion) return false;
  const target = platform === 'ios' ? '1.0.44' : platform === 'android' ? '1.0.37' : '';
  if (!target) return false;
  try {
    const [major, minor, patch] = appVersion.split('.').map(Number);
    const [tMajor, tMinor, tPatch] = target.split('.').map(Number);
    if (major > tMajor) return true;
    if (major < tMajor) return false;
    if (minor > tMinor) return true;
    if (minor < tMinor) return false;
    return patch >= tPatch;
  } catch {
    return false;
  }
}

export const fcmPushService = new FcmPushService();
