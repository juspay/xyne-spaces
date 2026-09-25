import crypto from 'crypto';
import axios from 'axios';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';

const IG_API_VERSION = 'v25.0';
const IG_REQUEST_TIMEOUT_MS = 10_000;
const IG_BASE_URL = `https://graph.instagram.com/${IG_API_VERSION}`;
const IG_TOKEN_URL = 'https://api.instagram.com/oauth/access_token';
const IG_LONG_LIVED_URL = 'https://graph.instagram.com/access_token';
const IG_REFRESH_URL = 'https://graph.instagram.com/refresh_access_token';

export interface SendDMResult {
  message_id: string;
  recipient_id: string;
}

export interface RefreshTokenResult {
  access_token: string;
  token_type: string;
  expires_in: number; // seconds
}

export interface IgUserProfile {
  name: string;
  username?: string;
  profile_pic?: string; // valid field for customer IGSID nodes; profile_picture_url is not
  id: string;
}

export interface ExchangeTokenResult {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export const metaGraphClient = {
  // Send a DM from the business IG account to a customer.
  // IG Login approach: POST /{senderIgsid}/messages with Bearer token.
  // senderIgsid must be the app-scoped IGSID (from GET /me as `id`), NOT the real igUserId —
  // Meta rejects the real user ID on this endpoint.
  async sendDM(
    accessToken: string,
    senderIgsid: string,
    recipientIgsid: string,
    text: string,
  ): Promise<SendDMResult> {
    const response = await axios.post<SendDMResult>(
      `${IG_BASE_URL}/${senderIgsid}/messages`,
      {
        recipient: { id: recipientIgsid },
        message: { text },
        messaging_type: 'RESPONSE',
      },
      { headers: { Authorization: `Bearer ${accessToken}` }, timeout: IG_REQUEST_TIMEOUT_MS },
    );
    return response.data;
  },

  // Refresh a long-lived IG User token (valid 60 days; can refresh after 24h).
  async refreshToken(accessToken: string): Promise<RefreshTokenResult> {
    const response = await axios.get<RefreshTokenResult>(IG_REFRESH_URL, {
      params: {
        grant_type: 'ig_refresh_token',
        access_token: accessToken,
      },
      timeout: IG_REQUEST_TIMEOUT_MS,
    });
    return response.data;
  },

  // Exchange the authorization code for a short-lived IG User token (1 hour).
  async exchangeCodeForToken(
    code: string,
    redirectUri: string,
    codeVerifier?: string,
  ): Promise<ExchangeTokenResult> {
    const params: Record<string, string> = {
      client_id: config.META_IG_APP_ID || config.META_APP_ID,
      client_secret: config.META_IG_APP_SECRET || config.META_APP_SECRET,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
      code,
    };
    if (codeVerifier) params.code_verifier = codeVerifier;
    const response = await axios.post<ExchangeTokenResult>(
      IG_TOKEN_URL,
      new URLSearchParams(params).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: IG_REQUEST_TIMEOUT_MS },
    );
    return response.data;
  },

  // Exchange a short-lived token for a long-lived IG User token (60 days).
  async getLongLivedToken(shortLivedToken: string): Promise<ExchangeTokenResult> {
    const response = await axios.get<ExchangeTokenResult>(IG_LONG_LIVED_URL, {
      params: {
        grant_type: 'ig_exchange_token',
        client_secret: config.META_IG_APP_SECRET || config.META_APP_SECRET,
        access_token: shortLivedToken,
      },
      timeout: IG_REQUEST_TIMEOUT_MS,
    });
    return response.data;
  },

  // Fetch identity for the authenticated IG user.
  // Returns igUserId (real user ID, matches webhook entry.id), igsid (app-scoped, for API calls), username.
  async getMe(accessToken: string): Promise<{ igUserId: string; igsid: string; username: string }> {
    const response = await axios.get<{ id: string; user_id?: string; username?: string }>(
      `${IG_BASE_URL}/me`,
      {
        params: { fields: 'id,user_id,username' },
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: IG_REQUEST_TIMEOUT_MS,
      },
    );
    // id      = IGSID (app-scoped) — required for all Meta Graph API calls (/{igsid}/messages etc.)
    // user_id = real Instagram user ID — matches webhook entry.id; only present when `user_id` is in fields
    const { id, user_id, username } = response.data;
    if (!user_id) {
      // Should not happen when user_id is in the fields param, but fall back defensively.
      logger.warn('[metaGraphClient] getMe: user_id absent — igUserId will equal igsid; webhook entry.id matching may fail', { id });
    }
    const igsid = id;                  // always app-scoped; use for API calls
    const igUserId = user_id || id;    // real user ID when present; defensive fallback to igsid
    logger.debug('[metaGraphClient] getMe result', { igsid, igUserId, username });
    return { igUserId, igsid, username: username ?? '' };
  },

  // Fetch a message by mid — needed when webhook only delivers message_edit (num_edit>0).
  // mid format from Meta is alphanumeric with underscores/hyphens (e.g. "mid.GabcXYZ1234567").
  // Validate before use to prevent path traversal in the URL.
  async getMessage(accessToken: string, mid: string): Promise<{
    id: string;
    message?: string;
    from?: { id: string; username?: string };
    to?: { data: Array<{ id: string }> };
  } | null> {
    if (!/^[a-zA-Z0-9._-]{1,128}$/.test(mid)) {
      logger.warn('[IG getMessage] Rejecting mid with unexpected format', { mid });
      return null;
    }
    try {
      const response = await axios.get(
        `${IG_BASE_URL}/${mid}`,
        {
          params: { fields: 'id,message,from,to' },
          headers: { Authorization: `Bearer ${accessToken}` },
          timeout: IG_REQUEST_TIMEOUT_MS,
        },
      );
      return response.data;
    } catch (err) {
      logger.error('[IG getMessage] failed', { mid, error: err });
      return null;
    }
  },

  async getUserProfile(accessToken: string, igUserId: string): Promise<IgUserProfile> {
    const response = await axios.get<IgUserProfile>(
      `${IG_BASE_URL}/${igUserId}`,
      {
        params: { fields: 'name,username,profile_pic' },
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: IG_REQUEST_TIMEOUT_MS,
      },
    );
    return response.data;
  },

  // In-process cache so we don't call Meta's profile API on every single DM.
  // Key: `${businessIgsid}:${senderIgsid}`, value: { username, expiresAt }. Capped at 500 entries.
  // Eviction is approximate LRU: Map preserves insertion order; on a cache hit we
  // delete + re-insert so the entry moves to the tail (most-recently-used). On overflow
  // we delete the head (least-recently-used).
  // TTL is 24h so a username change is picked up on the next DM after expiry.
  _usernameCache: new Map<string, { username: string; expiresAt: number }>(),
  _usernameCacheMaxSize: 500,
  _usernameCacheTtlMs: 24 * 60 * 60 * 1000,

  async getSenderUsername(accessToken: string, businessIgsid: string, senderIgsid: string): Promise<string | null> {
    const cacheKey = `${businessIgsid}:${senderIgsid}`;
    const cached = this._usernameCache.get(cacheKey);
    if (cached !== undefined && cached.expiresAt > Date.now()) {
      // Refresh LRU position: move to tail so this entry is the last evicted.
      this._usernameCache.delete(cacheKey);
      this._usernameCache.set(cacheKey, cached);
      return cached.username;
    }
    try {
      const profile = await this.getUserProfile(accessToken, senderIgsid);
      const username = profile.username ?? null;
      if (username) {
        if (this._usernameCache.size >= this._usernameCacheMaxSize) {
          // Evict least-recently-used (head of Map iteration order).
          const firstKey = this._usernameCache.keys().next().value;
          if (firstKey !== undefined) this._usernameCache.delete(firstKey);
        }
        this._usernameCache.set(cacheKey, { username, expiresAt: Date.now() + this._usernameCacheTtlMs });
      }
      return username;
    } catch {
      return null;
    }
  },

  // Subscribe the IG account to receive DM webhook events.
  // Requires the app-level webhook to be configured in Meta App Dashboard first.
  // igsid must be the app-scoped IGSID (not the real igUserId — Meta rejects it here).
  async subscribeToWebhook(accessToken: string, igsid: string): Promise<void> {
    await axios.post(
      `${IG_BASE_URL}/${igsid}/subscribed_apps`,
      null,
      {
        params: { subscribed_fields: 'messages,message_edits' },
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: IG_REQUEST_TIMEOUT_MS,
      },
    );
  },

  // Remove the app's webhook subscription for the IG account.
  // Call on disconnect so Meta stops delivering events for this account.
  async unsubscribeFromWebhook(accessToken: string, igsid: string): Promise<void> {
    await axios.delete(
      `${IG_BASE_URL}/${igsid}/subscribed_apps`,
      { headers: { Authorization: `Bearer ${accessToken}` }, timeout: IG_REQUEST_TIMEOUT_MS },
    );
  },

  // Verify which app(s) the IG account is subscribed to.
  // After subscribeToWebhook, call this to confirm our app is the active subscriber.
  // igsid must be the app-scoped IGSID (not the real igUserId — Meta rejects it here).
  async getSubscribedApps(accessToken: string, igsid: string): Promise<unknown> {
    const response = await axios.get(
      `${IG_BASE_URL}/${igsid}/subscribed_apps`,
      { headers: { Authorization: `Bearer ${accessToken}` }, timeout: IG_REQUEST_TIMEOUT_MS },
    );
    return response.data;
  },

  verifySignedRequest(signedRequest: string, appSecret: string): { user_id?: string } | null {
    const parts = signedRequest.split('.');
    if (parts.length !== 2) return null;
    const [sigB64, payloadB64] = parts as [string, string];
    const expected = crypto
      .createHmac('sha256', appSecret)
      .update(payloadB64)
      .digest('base64url');
    const expectedBuf = Buffer.from(expected);
    const sigBuf = Buffer.from(sigB64);
    if (expectedBuf.length !== sigBuf.length) return null;
    if (!crypto.timingSafeEqual(expectedBuf, sigBuf)) return null;
    try {
      return JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as {
        user_id?: string;
      };
    } catch {
      return null;
    }
  },

  verifyWebhookSignature(rawBody: string, signature: string, appSecret: string): boolean {
    if (!signature.startsWith('sha256=')) return false;
    const expected = crypto
      .createHmac('sha256', appSecret)
      .update(rawBody)
      .digest('hex');
    const received = signature.slice('sha256='.length);
    const expectedBuf = Buffer.from(expected);
    const receivedBuf = Buffer.from(received);
    if (expectedBuf.length !== receivedBuf.length) return false;
    return crypto.timingSafeEqual(expectedBuf, receivedBuf);
  },
};
