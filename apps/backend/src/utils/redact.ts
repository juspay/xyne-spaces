// Some ingest URLs carry their only credential as a path segment. Strip that
// segment before any URL reaches the logs (request logger, morgan access log,
// error handler).
//
// Every route whose path contains a secret must be listed here. Patterns do not
// require the `/api` prefix so they also match router-relative URLs.
const SECRET_BEARING_ROUTES: readonly RegExp[] = [
  // /api/automation-webhooks/<seriesId>/<secret>
  /(\/automation-webhooks\/[^/?#]+\/)([^/?#]+)/g,
  // /api/apps/webhooks/<workspaceId>/<installedAppId>/<secret>
  // /api/apps/webhooks/{sentinel,sns,pingdom,gcp}/<workspaceId>/<installedAppId>/<secret>
  /(\/apps\/webhooks\/(?:(?:sentinel|sns|pingdom|gcp)\/)?[^/?#]+\/[^/?#]+\/)([^/?#]+)/g,
];

export const REDACTED_VALUE = '[REDACTED]';

export function redactSensitiveUrl(url: string | undefined | null): string {
  if (!url) return url ?? '';
  return SECRET_BEARING_ROUTES.reduce(
    (current, pattern) => current.replace(pattern, (_match, prefix: string) => `${prefix}${REDACTED_VALUE}`),
    url,
  );
}

// Structured log metadata keys whose values are credentials. Matched on the
// key name with case, `_` and `-` ignored, so `client_state`, `clientState`
// and `Client-State` all match. Exact names only: `tokenCount` or `hasToken`
// are left alone.
const SENSITIVE_KEYS = new Set(
  [
    'secret',
    'password',
    'passwd',
    'token',
    'accessToken',
    'refreshToken',
    'idToken',
    'authorization',
    'cookie',
    'apiKey',
    'clientSecret',
    'clientState',
    'channelToken',
    'webhookSecret',
    'privateKey',
  ].map((key) => normalizeKey(key)),
);

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[_-]/g, '');
}

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(normalizeKey(key));
}

const MAX_REDACTION_DEPTH = 8;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Returns `value` with every sensitive key's value replaced by `[REDACTED]`,
 * at any depth (up to MAX_REDACTION_DEPTH). Copy-on-write: the input is never
 * mutated, and the same reference is returned when nothing needed redacting.
 */
export function redactSensitiveFields<T>(value: T, depth = 0, seen: WeakSet<object> = new WeakSet()): T {
  if (depth > MAX_REDACTION_DEPTH) return value;
  if (!Array.isArray(value) && !isPlainObject(value)) return value;
  if (seen.has(value as object)) return value;
  seen.add(value as object);

  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map((item) => {
      const next = redactSensitiveFields(item, depth + 1, seen);
      if (next !== item) changed = true;
      return next;
    });
    return (changed ? out : value) as T;
  }

  const record = value as Record<string, unknown>;
  let out: Record<string, unknown> | undefined;
  for (const key of Object.keys(record)) {
    const item = record[key];
    let next: unknown;
    if (isSensitiveKey(key) && item !== undefined && item !== null && item !== '') {
      next = REDACTED_VALUE;
    } else {
      next = redactSensitiveFields(item, depth + 1, seen);
    }
    if (next !== item) {
      out ??= { ...record };
      out[key] = next;
    }
  }
  return (out ?? value) as T;
}
