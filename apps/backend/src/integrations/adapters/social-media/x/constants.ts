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

/** Code-point ranges X counts as 1 (twitter-text v3 config); everything else counts as 2. */
export const X_LIGHT_RANGES: Array<[number, number]> = [
  [0, 4351],
  [8192, 8205],
  [8208, 8223],
  [8242, 8247],
];
/** X shortens every URL to a t.co link and counts it as this many characters. */
export const X_URL_LENGTH = 23;
/**
 * What X links (and so counts as X_URL_LENGTH): http(s) and www. links, and bare domains with a
 * common TLD (X links `example.com` too). Erring towards matching only makes the count higher.
 */
export const X_URL_PATTERN =
  /(?:https?:\/\/|www\.)\S+|\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|co|in|ai|app|dev|me|ly|gg|tv|us|uk|info|biz|xyz|so|to)\b(?:\/\S*)?/gi;
/**
 * One emoji as the reader sees it: a pictograph with its variation selector, skin-tone modifier and
 * zero-width-joiner parts (e.g. a family emoji), or a flag (a regional-indicator pair). X counts
 * each as 2, however many code points it has.
 */
export const X_EMOJI_PATTERN =
  /\p{Regional_Indicator}{2}|\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})*(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})*)*/gu;
