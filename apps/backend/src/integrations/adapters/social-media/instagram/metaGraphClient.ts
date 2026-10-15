import crypto from 'crypto';
import axios from 'axios';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { SenderNameCache } from '../shared/senderNameCache';

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

const usernameCache = new SenderNameCache();

export const metaGraphClient = {
  // Send a DM from the business IG account to a customer.
  // IG Login approach: POST /{senderIgsid}/messages with Bearer token.
  // senderIgsid must be the app-scoped IGSID (from GET /me as `id`), NOT the real igUserId —
  // Meta rejects the real user ID on this endpoint.
  async sendDM(
    accessToken: string,
    senderIgsid: string,
    recipientIgsid: string,
    text: string
  ): Promise<SendDMResult> {
    const response = await axios.post<SendDMResult>(
      `${IG_BASE_URL}/${senderIgsid}/messages`,
      {
        recipient: { id: recipientIgsid },
        message: { text },
        messaging_type: 'RESPONSE',
      },
      { headers: { Authorization: `Bearer ${accessToken}` }, timeout: IG_REQUEST_TIMEOUT_MS }
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
    codeVerifier?: string
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
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: IG_REQUEST_TIMEOUT_MS,
      }
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
  // id (igsid)  = app-scoped IGSID — used ONLY for API calls: subscribeToWebhook, sendDM, getSenderUsername
  // user_id     = real Instagram user ID — equals webhook entry.id; used for source name and routing
  async getMe(accessToken: string): Promise<{ igUserId: string; igsid: string; username: string }> {
    const response = await axios.get<{ id: string; user_id?: string; username?: string }>(
      `${IG_BASE_URL}/me`,
      {
        params: { fields: 'id,user_id,username' },
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: IG_REQUEST_TIMEOUT_MS,
      }
    );
    const { id, user_id, username } = response.data;
    const igsid = id;
    // user_id = real Instagram user ID = webhook entry.id → used for source name and routing
    // Fall back to id only if user_id is absent (should not happen for business accounts)
    const igUserId = user_id || id;
    if (!user_id) {
      logger.warn(
        '[metaGraphClient] getMe: user_id absent — falling back to igsid; webhook routing may fail',
        { id }
      );
    }
    return { igUserId, igsid, username: username ?? '' };
  },

  // Fetch a message by mid — needed when webhook only delivers message_edit (num_edit>0).
  // mid format from Meta is alphanumeric with underscores/hyphens (e.g. "mid.GabcXYZ1234567").
  // Validate before use to prevent path traversal in the URL.
  async getMessage(
    accessToken: string,
    mid: string
  ): Promise<{
    id: string;
    message?: string;
    from?: { id: string; username?: string };
    to?: { data: Array<{ id: string }> };
    attachments?: { data: Array<{ type?: string; payload?: Record<string, unknown> }> };
  } | null> {
    if (!/^[a-zA-Z0-9._-]{1,512}$/.test(mid)) {
      logger.warn('[IG getMessage] Rejecting mid with unexpected format', { mid });
      return null;
    }
    try {
      const response = await axios.get(`${IG_BASE_URL}/${mid}`, {
        params: { fields: 'id,message,from,to,attachments' },
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: IG_REQUEST_TIMEOUT_MS,
      });
      return response.data;
    } catch (err) {
      logger.error('[IG getMessage] failed', { mid, error: err });
      return null;
    }
  },

  async getUserProfile(accessToken: string, igUserId: string): Promise<IgUserProfile> {
    const response = await axios.get<IgUserProfile>(`${IG_BASE_URL}/${igUserId}`, {
      params: { fields: 'name,username,profile_pic' },
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: IG_REQUEST_TIMEOUT_MS,
    });
    return response.data;
  },

  // Cached per business account (see SenderNameCache) so the profile API is not hit on every DM.
  async getSenderUsername(
    accessToken: string,
    businessIgsid: string,
    senderIgsid: string
  ): Promise<string | null> {
    const cacheKey = `${businessIgsid}:${senderIgsid}`;
    const cached = usernameCache.get(cacheKey);
    if (cached !== undefined) return cached;
    try {
      const profile = await this.getUserProfile(accessToken, senderIgsid);
      const username = profile.username ?? null;
      if (username) usernameCache.set(cacheKey, username);
      return username;
    } catch {
      return null;
    }
  },

  // Subscribe the IG account to receive DM, mention, and comment webhook events.
  // Requires the app-level webhook to be configured in Meta App Dashboard first.
  // igsid must be the app-scoped IGSID (not the real igUserId — Meta rejects it here).
  // `mentions` fires when another account @tags this account in a comment or caption.
  // `comments` fires when someone comments on this account's own posts.
  // Both require instagram_manage_comments permission on the Meta app.
  async subscribeToWebhook(accessToken: string, igsid: string): Promise<void> {
    try {
      await axios.post(`${IG_BASE_URL}/${igsid}/subscribed_apps`, null, {
        params: { subscribed_fields: 'messages,mentions,comments' },
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: IG_REQUEST_TIMEOUT_MS,
      });
      logger.info('[metaGraphClient] subscribeToWebhook succeeded', { igsid });
    } catch (err) {
      const axiosErr = err as import('axios').AxiosError;
      logger.error('[metaGraphClient] subscribeToWebhook FAILED', {
        igsid,
        status: axiosErr.response?.status,
        responseData: axiosErr.response?.data,
        message: axiosErr.message,
      });
      throw err;
    }
  },

  // Remove the app's webhook subscription for the IG account.
  // Call on disconnect so Meta stops delivering events for this account.
  async unsubscribeFromWebhook(accessToken: string, igsid: string): Promise<void> {
    await axios.delete(`${IG_BASE_URL}/${igsid}/subscribed_apps`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: IG_REQUEST_TIMEOUT_MS,
    });
  },

  // Verify which app(s) the IG account is subscribed to.
  // After subscribeToWebhook, call this to confirm our app is the active subscriber.
  // igsid must be the app-scoped IGSID (not the real igUserId — Meta rejects it here).
  async getSubscribedApps(accessToken: string, igsid: string): Promise<unknown> {
    const response = await axios.get(`${IG_BASE_URL}/${igsid}/subscribed_apps`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: IG_REQUEST_TIMEOUT_MS,
    });
    return response.data;
  },

  // Fetch the content of a comment in which the business account was @mentioned.
  // Uses the business account's IGSID (app-scoped) in the path.
  // Returns text and timestamp; username is NOT available via this endpoint.
  async getMentionedComment(
    accessToken: string,
    igsid: string,
    commentId: string
  ): Promise<{ mentioned_comment?: { id: string; text?: string; timestamp?: string } } | null> {
    try {
      const response = await axios.get<{
        mentioned_comment?: { id: string; text?: string; timestamp?: string };
      }>(`${IG_BASE_URL}/${igsid}`, {
        params: { fields: 'mentioned_comment', comment_id: commentId },
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: IG_REQUEST_TIMEOUT_MS,
      });
      return response.data;
    } catch (err) {
      logger.error('[metaGraphClient] getMentionedComment failed', {
        igsid,
        commentId,
        error: err,
      });
      return null;
    }
  },

  // Fetch the caption/owner of a post in which the business account was @mentioned in the caption text.
  async getMentionedMedia(
    accessToken: string,
    igsid: string,
    mediaId: string
  ): Promise<{
    mentioned_media?: { id: string; caption?: string; owner?: { id: string }; timestamp?: string };
  } | null> {
    try {
      const response = await axios.get<{
        mentioned_media?: {
          id: string;
          caption?: string;
          owner?: { id: string };
          timestamp?: string;
        };
      }>(`${IG_BASE_URL}/${igsid}`, {
        params: { fields: 'mentioned_media', media_id: mediaId },
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: IG_REQUEST_TIMEOUT_MS,
      });
      return response.data;
    } catch (err) {
      logger.error('[metaGraphClient] getMentionedMedia failed', { igsid, mediaId, error: err });
      return null;
    }
  },

  // Fetch comment details including username — used to identify who wrote a mention comment.
  // Falls back gracefully when the field is unavailable (private accounts, permission gaps).
  async getCommentDetails(
    accessToken: string,
    commentId: string
  ): Promise<{ id: string; text?: string; timestamp?: string; username?: string; parent_id?: string } | null> {
    if (!/^[0-9_]{1,128}$/.test(commentId)) {
      logger.warn('[metaGraphClient] getCommentDetails: rejecting unexpected commentId format', {
        commentId,
      });
      return null;
    }
    try {
      const response = await axios.get<{
        id: string;
        text?: string;
        timestamp?: string;
        username?: string;
        parent_id?: string;
      }>(`${IG_BASE_URL}/${commentId}`, {
        params: { fields: 'id,text,timestamp,username,parent_id' },
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: IG_REQUEST_TIMEOUT_MS,
      });
      return response.data;
    } catch {
      return null;
    }
  },

  // Reply to a public Instagram comment (on any post where the business account has access).
  // Used for Cases 1 (comment mention) and 3 (comment on own post).
  async replyToComment(
    accessToken: string,
    commentId: string,
    text: string
  ): Promise<{ id: string }> {
    const response = await axios.post<{ id: string }>(
      `${IG_BASE_URL}/${commentId}/replies`,
      { message: text },
      { headers: { Authorization: `Bearer ${accessToken}` }, timeout: IG_REQUEST_TIMEOUT_MS }
    );
    return response.data;
  },

  verifySignedRequest(signedRequest: string, appSecret: string): { user_id?: string } | null {
    const parts = signedRequest.split('.');
    if (parts.length !== 2) return null;
    const [sigB64, payloadB64] = parts as [string, string];
    const expected = crypto.createHmac('sha256', appSecret).update(payloadB64).digest('base64url');
    const expectedBuf = Buffer.from(expected, 'base64url');
    const sigBuf = Buffer.from(sigB64, 'base64url');
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
    const expected = crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
    const received = signature.slice('sha256='.length);
    const expectedBuf = Buffer.from(expected);
    const receivedBuf = Buffer.from(received);
    if (expectedBuf.length !== receivedBuf.length) return false;
    return crypto.timingSafeEqual(expectedBuf, receivedBuf);
  },
};
