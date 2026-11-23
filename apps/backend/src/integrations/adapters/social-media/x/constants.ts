import { config } from '@/config/env';

/**
 * X (Twitter) endpoints. Both come from env (X_API_BASE / X_AUTHORIZE_URL); an empty or
 * missing value falls back to the public X endpoints.
 */
export const X_API_BASE = config.X_API_BASE || 'https://api.x.com';
export const X_REQUEST_TIMEOUT_MS = 15_000;

/** OAuth 2.0 scopes. offline.access is required for a refresh token. */
export const X_OAUTH_SCOPES = ['tweet.read', 'tweet.write', 'users.read', 'dm.read', 'dm.write', 'offline.access'];
export const X_AUTHORIZE_URL = config.X_AUTHORIZE_URL || 'https://x.com/i/oauth2/authorize';

/** Refresh this long before expiry so a call in flight never carries a just-expired token. */
export const X_TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000;

/** Activity subscriptions a support inbox needs (live-verified 2026-11-19). */
export const X_SUPPORT_EVENT_TYPES = [
  'post.mention.create',
  'post.reply.create',
  'dm.received',
  'chat.received',
] as const;

export const X_MAX_POST_LENGTH = 280;
export const X_MAX_DM_LENGTH = 10_000;

export const X_AUTHOR_ID_FIELD = 'X Author ID';
export const X_POST_LINK_FIELD = 'X Post Link';

/** Thread-id prefixes. The reply sender branches on these. */
export const X_POST_THREAD_PREFIX = 'post:';
export const X_DM_THREAD_PREFIX = 'dm:';
