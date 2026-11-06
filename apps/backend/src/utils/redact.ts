// URLs that carry a credential as a path segment. The secret is stripped before
// any URL reaches the logs:
//   /api/automation-webhooks/<seriesId>/<secret>
//   /api/invitations/<invitationId>/(verify|accept)
const SECRET_PATH_URLS = [
  /(\/api\/automation-webhooks\/[^/?#]+\/)([^/?#]+)/g,
  /(\/api\/invitations\/)([^/?#]+)(?=\/(?:verify|accept)\b)/g,
];

// Query parameters whose values are credentials (compared lowercase, without `_`/`-`).
const SENSITIVE_QUERY_KEYS = new Set([
  'code',
  'state',
  'token',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'usercode',
  'devicecode',
  'key',
  'apikey',
  'secret',
  'clientsecret',
  'password',
  'signature',
  'sig',
  'jwt',
  'auth',
  'authorization',
  'sessionid',
  'invitationid',
  'xgoogsignature',
  'xgoogcredential',
  'xamzsignature',
  'xamzcredential',
  'xamzsecuritytoken',
]);

const normalizeKey = (key: string): string => key.toLowerCase().replace(/[_-]/g, '');

const redactQuery = (query: string): string =>
  query
    .split('&')
    .map(pair => {
      const eq = pair.indexOf('=');
      if (eq === -1) return pair;
      const rawKey = pair.slice(0, eq);
      let key = rawKey;
      try {
        key = decodeURIComponent(rawKey);
      } catch {
        // keep the raw key
      }
      return SENSITIVE_QUERY_KEYS.has(normalizeKey(key)) ? `${rawKey}=[REDACTED]` : pair;
    })
    .join('&');

export function redactSensitiveUrl(url: string | undefined | null): string {
  if (!url) return url ?? '';

  const hashIndex = url.indexOf('#');
  const withoutHash = hashIndex === -1 ? url : url.slice(0, hashIndex);
  const queryIndex = withoutHash.indexOf('?');
  const path = queryIndex === -1 ? withoutHash : withoutHash.slice(0, queryIndex);
  const query = queryIndex === -1 ? '' : withoutHash.slice(queryIndex + 1);

  const redactedPath = SECRET_PATH_URLS.reduce(
    (acc, pattern) => acc.replace(pattern, (_match, prefix: string) => `${prefix}[REDACTED]`),
    path,
  );
  return query ? `${redactedPath}?${redactQuery(query)}` : redactedPath;
}
