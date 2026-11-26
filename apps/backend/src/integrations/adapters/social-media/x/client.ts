import crypto from 'node:crypto';
import { X_API_BASE, X_REQUEST_TIMEOUT_MS } from './constants';
import type { XAppCredentials, XPost, XUser, XV2DmEvent } from './types';

/** An X API error with the problem-details fields X returns. */
export class XApiError extends Error {
  constructor(
    readonly status: number,
    readonly title: string | undefined,
    readonly type: string | undefined,
    readonly detail: string | undefined,
    readonly retryAfterMs?: number,
    /** `errors[].message` — X puts the specific reason here (e.g. "DuplicateSubscription: …"). */
    readonly messages: string[] = [],
  ) {
    super(`X API ${status}${title ? ` ${title}` : ''}${detail ? `: ${detail}` : ''}`);
    this.name = 'XApiError';
  }
}

/**
 * X could not be reached at all (DNS, TLS, connection reset, timeout, proxy/VPN filtering). Carries
 * the host and the low-level reason so logs say why — `fetch failed` alone does not.
 */
export class XNetworkError extends Error {
  constructor(
    readonly host: string,
    readonly reason: string,
  ) {
    super(`Cannot reach X at ${host}: ${reason}`);
    this.name = 'XNetworkError';
  }
}

export const isXNetworkError = (e: unknown): e is XNetworkError => e instanceof XNetworkError;

/** fetch() rejects with a bare TypeError("fetch failed"); the useful part is in `cause`. */
function networkReason(error: unknown): string {
  const err = error as { name?: string; message?: string; cause?: { code?: string; message?: string; cause?: unknown } };
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return `timed out after ${X_REQUEST_TIMEOUT_MS} ms`;
  const cause = err?.cause;
  const parts = [cause?.code, cause?.message].filter(Boolean);
  return parts.length ? parts.join(' ') : (err?.message ?? String(error));
}

/** Credits exhausted. Live-observed as HTTP 402 `CreditsDepleted` (the docs list no 402). */
export const isXCreditsDepleted = (e: unknown): boolean =>
  e instanceof XApiError && (e.status === 402 || e.title === 'CreditsDepleted' || !!e.type?.endsWith('/problems/credits'));

export const isXDuplicateSubscription = (e: unknown): boolean =>
  e instanceof XApiError && e.status === 400 && e.messages.some((m) => m.startsWith('DuplicateSubscription'));

export const isXRateLimited = (e: unknown): boolean => e instanceof XApiError && e.status === 429;

/** Reply not permitted: the target Post neither mentions the brand nor is authored by it. */
export const isXReplyNotPermitted = (e: unknown): boolean =>
  e instanceof XApiError && e.status === 403 && !!e.type?.endsWith('/problems/not-authorized-for-resource');

/** The user token or refresh token is dead (revoked, rotated elsewhere, app secret regenerated). */
export const isXAuthRejected = (e: unknown): boolean =>
  e instanceof XApiError && (e.status === 401 || (e.status === 400 && e.title === 'invalid_grant'));

function parseRetryAfter(res: Response): number | undefined {
  const reset = res.headers.get('x-rate-limit-reset');
  if (reset && /^\d+$/.test(reset)) return Math.max(0, Number(reset) * 1000 - Date.now());
  const after = res.headers.get('retry-after');
  if (after && /^\d+$/.test(after)) return Number(after) * 1000;
  return undefined;
}

async function toError(res: Response): Promise<XApiError> {
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    /* non-JSON error body */
  }
  const errors = Array.isArray(body.errors) ? (body.errors as Array<Record<string, unknown>>) : [];
  const firstError = errors[0];
  const messages = errors.map((e) => e.message).filter((m): m is string => typeof m === 'string');
  // OAuth endpoints return {error, error_description}; v2 endpoints return problem details.
  const title = (body.title ?? body.error ?? firstError?.title) as string | undefined;
  const detail = (body.detail ?? body.error_description ?? firstError?.message ?? firstError?.detail) as string | undefined;
  return new XApiError(res.status, title, body.type as string | undefined, detail, parseRetryAfter(res), messages);
}

const basic = (user: string, pass: string) => 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');

export interface XTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  token_type: string;
}

/** Thin, stateless X API client. Every call takes the credentials it needs; nothing is global. */
export class XApiClient {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  /** fetch with network failures turned into XNetworkError. HTTP errors are left to the caller. */
  private async send(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchImpl(url, init);
    } catch (error) {
      if (init.signal?.aborted && (init.signal.reason as { name?: string })?.name !== 'TimeoutError') throw error; // caller abort
      throw new XNetworkError(new URL(url).host, networkReason(error));
    }
  }

  async request<T>(
    method: string,
    path: string,
    token: string,
    opts: { body?: unknown; query?: Record<string, string | undefined> } = {},
  ): Promise<T> {
    const qs = opts.query
      ? new URLSearchParams(Object.entries(opts.query).filter((e): e is [string, string] => e[1] !== undefined))
      : undefined;
    const res = await this.send(`${X_API_BASE}${path}${qs?.size ? `?${qs}` : ''}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(opts.body !== undefined && { 'content-type': 'application/json' }),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(X_REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) throw await toError(res);
    return (await res.json()) as T;
  }

  private async tokenRequest(path: string, authorization: string, form: Record<string, string>): Promise<XTokenResponse> {
    const res = await this.send(`${X_API_BASE}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8', authorization },
      body: new URLSearchParams(form),
      signal: AbortSignal.timeout(X_REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) throw await toError(res);
    return (await res.json()) as XTokenResponse;
  }

  // ── OAuth 2.0 ──────────────────────────────────────────────────────────────

  exchangeCode(app: XAppCredentials, code: string, redirectUri: string, codeVerifier: string): Promise<XTokenResponse> {
    return this.tokenRequest('/2/oauth2/token', basic(app.clientId, app.clientSecret), {
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
      client_id: app.clientId,
    });
  }

  refreshUserToken(app: XAppCredentials, refreshToken: string): Promise<XTokenResponse> {
    return this.tokenRequest('/2/oauth2/token', basic(app.clientId, app.clientSecret), {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: app.clientId,
    });
  }

  async revokeToken(app: XAppCredentials, token: string, hint: 'refresh_token' | 'access_token'): Promise<void> {
    await this.tokenRequest('/2/oauth2/revoke', basic(app.clientId, app.clientSecret), {
      token,
      token_type_hint: hint,
      client_id: app.clientId,
    });
  }

  /** App-only Bearer (client-credentials grant on the consumer key/secret). Used for the activity stream. */
  async getAppBearer(app: XAppCredentials): Promise<string> {
    const auth = basic(encodeURIComponent(app.consumerKey), encodeURIComponent(app.consumerSecret));
    const res = await this.tokenRequest('/oauth2/token', auth, { grant_type: 'client_credentials' });
    return res.access_token;
  }

  // ── Users / Posts / DMs ────────────────────────────────────────────────────

  async getMe(userToken: string): Promise<XUser> {
    const res = await this.request<{ data: XUser }>('GET', '/2/users/me', userToken);
    return res.data;
  }

  async replyToPost(userToken: string, inReplyToPostId: string, text: string): Promise<{ id: string; text: string }> {
    const res = await this.request<{ data: { id: string; text: string } }>('POST', '/2/tweets', userToken, {
      body: { text, reply: { in_reply_to_tweet_id: inReplyToPostId } },
    });
    return res.data;
  }

  async sendDm(userToken: string, participantId: string, text: string): Promise<{ dmEventId: string; dmConversationId: string }> {
    const res = await this.request<{ data: { dm_event_id: string; dm_conversation_id: string } }>(
      'POST',
      `/2/dm_conversations/with/${encodeURIComponent(participantId)}/messages`,
      userToken,
      { body: { text } },
    );
    return { dmEventId: res.data.dm_event_id, dmConversationId: res.data.dm_conversation_id };
  }

  /** Mentions timeline — includes replies to the brand's Posts (live-verified). */
  getMentions(
    userToken: string,
    xUserId: string,
    opts: { sinceId?: string; startTime?: string; paginationToken?: string; maxResults?: number },
  ) {
    return this.request<{ data?: XPost[]; includes?: { users?: XUser[] }; meta: { newest_id?: string; next_token?: string } }>(
      'GET',
      `/2/users/${encodeURIComponent(xUserId)}/mentions`,
      userToken,
      {
        query: {
          max_results: String(opts.maxResults ?? 100),
          since_id: opts.sinceId,
          start_time: opts.sinceId ? undefined : opts.startTime,
          pagination_token: opts.paginationToken,
          'tweet.fields': 'created_at,conversation_id,in_reply_to_user_id,referenced_tweets,author_id',
          expansions: 'author_id',
          'user.fields': 'username,name',
        },
      },
    );
  }

  /** DM events, newest first. No time filter exists; 30-day retention; 15 calls / 15 min. */
  getDmEvents(userToken: string, opts: { paginationToken?: string; maxResults?: number }) {
    return this.request<{ data?: XV2DmEvent[]; includes?: { users?: XUser[] }; meta: { next_token?: string } }>(
      'GET',
      '/2/dm_events',
      userToken,
      {
        query: {
          max_results: String(opts.maxResults ?? 100),
          pagination_token: opts.paginationToken,
          event_types: 'MessageCreate',
          'dm_event.fields': 'created_at,sender_id,dm_conversation_id,text',
          expansions: 'sender_id',
          'user.fields': 'username,name',
        },
      },
    );
  }

  async getUser(token: string, userId: string): Promise<XUser> {
    const res = await this.request<{ data: XUser }>('GET', `/2/users/${encodeURIComponent(userId)}`, token);
    return res.data;
  }

  // ── XChat (end-to-end encrypted chat) ──────────────────────────────────────

  /** A user's XChat public-key records; for the brand itself they include `juicebox_config`. */
  async getChatPublicKeys(userToken: string, userId: string): Promise<XChatPublicKeyRecord[]> {
    const res = await this.request<{ data?: XChatPublicKeyRecord | XChatPublicKeyRecord[] }>(
      'GET',
      `/2/users/${encodeURIComponent(userId)}/public_keys`,
      userToken,
    );
    return Array.isArray(res.data) ? res.data : res.data ? [res.data] : [];
  }

  /** Encrypted events of one conversation, newest first; key changes come in meta. */
  getChatEvents(userToken: string, conversationId: string, opts: { paginationToken?: string; maxResults?: number } = {}) {
    return this.request<{
      data?: Array<{ id?: string; encoded_event?: string; sender_id?: string; created_at?: string }>;
      meta?: { conversation_key_events?: string[]; next_token?: string };
    }>('GET', `/2/chat/conversations/${encodeURIComponent(xchatPathId(conversationId))}/events`, userToken, {
      query: { max_results: String(opts.maxResults ?? 50), pagination_token: opts.paginationToken },
    });
  }

  /** The account's XChat conversations. Ordering is assumed most-recent-first (not documented). */
  listChatConversations(userToken: string, opts: { maxResults?: number; paginationToken?: string } = {}) {
    return this.request<{
      data?: Array<{ id: string; type?: string; participant_ids?: string[] }>;
      meta?: { has_more?: boolean; next_token?: string };
    }>('GET', '/2/chat/conversations', userToken, {
      query: { max_results: String(opts.maxResults ?? 30), pagination_token: opts.paginationToken },
    });
  }

  async sendChatMessage(
    userToken: string,
    conversationId: string,
    body: { message_id: string; encoded_message_create_event: string; encoded_message_event_signature: string; xdk_version?: string },
  ): Promise<void> {
    await this.request('POST', `/2/chat/conversations/${encodeURIComponent(xchatPathId(conversationId))}/messages`, userToken, { body });
  }

  // ── Activity subscriptions ─────────────────────────────────────────────────

  /** Private events must be subscribed with the brand's user token. */
  async createSubscription(userToken: string, xUserId: string, eventType: string): Promise<string> {
    const res = await this.request<{ data: { subscription: { subscription_id: string } } }>(
      'POST',
      '/2/activity/subscriptions',
      userToken,
      { body: { event_type: eventType, filter: { user_id: xUserId }, tag: `xyne:${eventType}` } },
    );
    return res.data.subscription.subscription_id;
  }

  async listSubscriptions(appBearer: string, xUserId: string) {
    const res = await this.request<{ data?: Array<{ subscription_id: string; event_type: string; tag?: string }> }>(
      'GET',
      '/2/activity/subscriptions',
      appBearer,
      { query: { user_id: xUserId } },
    );
    return res.data ?? [];
  }

  async deleteSubscription(appBearer: string, subscriptionId: string): Promise<void> {
    await this.request('DELETE', `/2/activity/subscriptions/${encodeURIComponent(subscriptionId)}`, appBearer);
  }

  /**
   * Deletes our subscriptions for an account (tagged `xyne:`, or untagged) so X stops delivering and
   * billing its events. Uses only the app keys, so it works after the user token has died.
   */
  async removeXyneSubscriptions(app: XAppCredentials, xUserId: string): Promise<void> {
    const bearer = await this.getAppBearer(app);
    const subs = await this.listSubscriptions(bearer, xUserId);
    for (const sub of subs.filter((s) => !s.tag || s.tag.startsWith('xyne:'))) {
      await this.deleteSubscription(bearer, sub.subscription_id);
    }
  }
}

export const xApiClient = new XApiClient();

/** XChat ids embed a ":" ("<a>:<b>") but the REST paths take "<a>-<b>". */
export const xchatPathId = (conversationId: string) => conversationId.replace(/:/g, '-');

export interface XChatPublicKeyRecord {
  public_key_version?: string | number;
  public_key?: string;
  signing_public_key?: string;
  identity_public_key_signature?: string;
  /** Only on the caller's own record: Juicebox realms + their auth tokens. */
  juicebox_config?: { token_map?: Array<{ key?: string; value?: { token?: string } }>; [k: string]: unknown };
}

/** Non-secret, stable key for an app — groups accounts that share one stream. */
export const xAppKey = (app: XAppCredentials): string =>
  crypto.createHash('sha256').update(app.consumerKey).digest('hex').slice(0, 16);
