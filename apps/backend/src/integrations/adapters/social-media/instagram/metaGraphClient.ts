import crypto from 'crypto';
import axios from 'axios';
import { config } from '@/config/env';

const IG_API_VERSION = 'v25.0';
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
  profile_picture_url?: string;
  id: string;
}

export interface ExchangeTokenResult {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export const metaGraphClient = {
  // Send a DM from the business IG account (igUserId) to a customer (recipientIgsid).
  // IG Login approach: POST /{igUserId}/messages with Bearer token.
  async sendDM(
    accessToken: string,
    igUserId: string,
    recipientIgsid: string,
    text: string,
  ): Promise<SendDMResult> {
    const response = await axios.post<SendDMResult>(
      `${IG_BASE_URL}/${igUserId}/messages`,
      {
        recipient: { id: recipientIgsid },
        message: { text },
        messaging_type: 'RESPONSE',
      },
      { headers: { Authorization: `Bearer ${accessToken}` } },
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
      client_id: config.META_APP_ID,
      client_secret: config.META_APP_SECRET,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
      code,
    };
    if (codeVerifier) params.code_verifier = codeVerifier;
    // Use Instagram App credentials (separate from Facebook App ID/Secret)
    params.client_id = config.META_IG_APP_ID || config.META_APP_ID;
    params.client_secret = config.META_IG_APP_SECRET || config.META_APP_SECRET;
    const response = await axios.post<ExchangeTokenResult>(
      IG_TOKEN_URL,
      new URLSearchParams(params).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
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
    });
    return response.data;
  },

  // Fetch identity for the authenticated IG user.
  // Returns the real user_id (matches webhook entry[0].id), the app-scoped id, and username.
  async getMe(accessToken: string): Promise<{ igUserId: string; username: string }> {
    const response = await axios.get<{ id: string; user_id?: string; username?: string }>(
      `${IG_BASE_URL}/me`,
      {
        params: { fields: 'id,user_id,username' },
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    // user_id is the real Instagram user ID (matches entry[0].id in webhooks).
    // id is app-scoped. We prefer user_id so source name matches the webhook.
    const igUserId = response.data.user_id || response.data.id;
    const username = response.data.username ?? '';
    return { igUserId, username };
  },

  // Kept for backward compatibility — callers that only need the ID.
  async getIgUserId(accessToken: string): Promise<string> {
    const { igUserId } = await this.getMe(accessToken);
    return igUserId;
  },

  // Fetch a message by mid — needed when webhook only delivers message_edit (num_edit=0).
  async getMessage(accessToken: string, mid: string): Promise<{
    id: string;
    message?: string;
    from?: { id: string; username?: string };
    to?: { data: Array<{ id: string }> };
  } | null> {
    try {
      const response = await axios.get(
        `${IG_BASE_URL}/${mid}`,
        {
          params: { fields: 'id,message,from,to' },
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      );
      return response.data;
    } catch (err) {
      console.error('[IG getMessage] failed for mid=%s:', mid, err);
      return null;
    }
  },

  async getUserProfile(accessToken: string, igUserId: string): Promise<IgUserProfile> {
    const response = await axios.get<IgUserProfile>(
      `${IG_BASE_URL}/${igUserId}`,
      {
        params: { fields: 'name,username,profile_picture_url' },
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    return response.data;
  },

  // In-process cache so we don't call Meta's profile API on every single DM.
  // Key: `${igUserId}:${igsid}`, value: username string.
  _usernameCache: new Map<string, string>(),

  async getSenderUsername(accessToken: string, businessIgUserId: string, senderIgsid: string): Promise<string | null> {
    const cacheKey = `${businessIgUserId}:${senderIgsid}`;
    const cached = this._usernameCache.get(cacheKey);
    if (cached !== undefined) return cached;
    try {
      const profile = await this.getUserProfile(accessToken, senderIgsid);
      const username = profile.username ?? null;
      if (username) this._usernameCache.set(cacheKey, username);
      return username;
    } catch {
      return null;
    }
  },

  // Subscribe the IG account to receive DM webhook events.
  // Requires the app-level webhook to be configured in Meta App Dashboard first.
  async subscribeToWebhook(accessToken: string, igUserId: string): Promise<void> {
    await axios.post(
      `${IG_BASE_URL}/${igUserId}/subscribed_apps`,
      null,
      {
        params: { subscribed_fields: 'messages' },
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
  },

  // Verify which app(s) the IG account is subscribed to.
  // After subscribeToWebhook, call this to confirm our app is the active subscriber.
  async getSubscribedApps(accessToken: string, igUserId: string): Promise<unknown> {
    const response = await axios.get(
      `${IG_BASE_URL}/${igUserId}/subscribed_apps`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
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
    if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sigB64))) return null;
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
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received));
  },
};
