// Incoming webhook URLs carry their secret as the last path segment:
//   /api/apps/webhooks/[<provider>/]<workspaceId>/<appId>/<secret>
//   /api/automation-webhooks/<seriesId>/<secret>
const SECRET_PATH = /(\/api\/(?:apps\/webhooks|automation-webhooks)\/(?:[^/?#]+\/)+)[^/?#]+/;

// Query keys that carry OAuth codes/state, one-time tokens and verify tokens.
const SECRET_QUERY_KEY = /token|code|state|secret|password|signature|sig|key|session|auth/i;

const REDACTED = '[REDACTED]';

function redactQuery(query: string): string {
  return query
    .split('&')
    .map((pair) => {
      const eq = pair.indexOf('=');
      if (eq === -1) return pair;
      const key = pair.slice(0, eq);
      let decodedKey = key;
      try {
        decodedKey = decodeURIComponent(key);
      } catch {
        // Keep the raw key.
      }
      return SECRET_QUERY_KEY.test(decodedKey) ? `${key}=${REDACTED}` : pair;
    })
    .join('&');
}

/** URL (path or absolute) safe for logs: webhook secrets and credential query values masked, fragment dropped. */
export function logUrl(url: string | undefined | null): string {
  if (!url) return url ?? '';
  const withoutFragment = url.split('#')[0] ?? '';
  const queryStart = withoutFragment.indexOf('?');
  const path = queryStart === -1 ? withoutFragment : withoutFragment.slice(0, queryStart);
  const redactedPath = path.replace(SECRET_PATH, `$1${REDACTED}`);
  if (queryStart === -1) return redactedPath;
  return `${redactedPath}?${redactQuery(withoutFragment.slice(queryStart + 1))}`;
}
