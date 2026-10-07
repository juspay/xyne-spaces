/**
 * Pure helpers for recognising X (Twitter) post links. No I/O, so they are cheap to call on
 * every message and easy to unit test.
 */

const X_HOSTS = new Set([
  'x.com',
  'www.x.com',
  'mobile.x.com',
  'twitter.com',
  'www.twitter.com',
  'mobile.twitter.com',
]);

/** Handle = 1–15 word chars. `i` (checked first) is X's handle-less form: x.com/i/status/<id>. */
const STATUS_PATH = /^\/(?:i(?:\/web)?|([A-Za-z0-9_]{1,15}))\/status(?:es)?\/(\d{1,25})(?:\/|$)/;

export interface ParsedXPostUrl {
  /** Canonical https://x.com/... URL (query string and hash dropped). */
  url: string;
  postId: string;
  /** Handle from the URL, when present. The fetched post's author wins over this. */
  handle?: string;
}

/**
 * Returns the post id for x.com / twitter.com status links, or null for anything else
 * (profiles, search, lists, look-alike hosts such as x.com.evil.example).
 */
export function parseXPostUrl(raw: string): ParsedXPostUrl | null {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  if (!X_HOSTS.has(parsed.hostname.toLowerCase())) return null;

  const match = STATUS_PATH.exec(parsed.pathname);
  if (!match) return null;

  const handle = match[1];
  const postId = match[2]!;
  return {
    url: `https://x.com/${handle ?? 'i'}/status/${postId}`,
    postId,
    ...(handle ? { handle } : {}),
  };
}

/**
 * Token X's public embed (syndication) endpoint expects alongside the post id. This is the
 * same derivation the official embed widget and `react-tweet` use; it is not a secret.
 */
export function syndicationToken(postId: string): string {
  return ((Number(postId) / 1e15) * Math.PI).toString(6 ** 2).replace(/(0+|\.)/g, '');
}
