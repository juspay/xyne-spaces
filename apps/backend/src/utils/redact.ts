// The automation webhook ingest URL carries the secret as a path segment
// (/api/automation-webhooks/<seriesId>/<secret>). Strip the secret before any
// URL reaches the logs.
const WEBHOOK_SECRET_URL = /(\/api\/automation-webhooks\/[^/?#]+\/)([^/?#]+)/g;

// Query-string parameters whose VALUES are sensitive — OAuth authorization
// codes, tokens, the authenticated user's email, raw search text, and request
// signatures. Their values are replaced with [REDACTED] before the URL reaches
// the logs. Matched case-insensitively against the raw key.
const SENSITIVE_QUERY_PARAMS = new Set([
  'code',
  'state',
  'token',
  'access_token',
  'id_token',
  'refresh_token',
  'email',
  'password',
  'secret',
  'api_key',
  'apikey',
  'key',
  'sig',
  'signature',
  'auth',
  'authorization',
  'q',
  'query',
  'search',
]);

function redactQueryString(query: string): string {
  return query
    .split('&')
    .map((pair) => {
      const eq = pair.indexOf('=');
      if (eq === -1) return pair;
      const rawKey = pair.slice(0, eq);
      if (SENSITIVE_QUERY_PARAMS.has(rawKey.toLowerCase())) {
        return `${rawKey}=[REDACTED]`;
      }
      return pair;
    })
    .join('&');
}

export function redactSensitiveUrl(url: string | undefined | null): string {
  if (!url) return url ?? '';

  // 1. Strip the webhook path secret (path segment).
  const redactedPath = url.replace(
    WEBHOOK_SECRET_URL,
    (_match, prefix: string) => `${prefix}[REDACTED]`
  );

  // 2. Scrub sensitive query-string VALUES (OAuth codes, tokens, email, q, ...).
  const qIndex = redactedPath.indexOf('?');
  if (qIndex === -1) return redactedPath;

  const path = redactedPath.slice(0, qIndex);
  const afterQ = redactedPath.slice(qIndex + 1);
  const hashIndex = afterQ.indexOf('#');
  const query = hashIndex === -1 ? afterQ : afterQ.slice(0, hashIndex);
  const hash = hashIndex === -1 ? '' : afterQ.slice(hashIndex);

  return `${path}?${redactQueryString(query)}${hash}`;
}
