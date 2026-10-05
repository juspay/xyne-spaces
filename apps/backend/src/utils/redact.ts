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
    'proxyAuthorization',
    'cookie',
    'setCookie',
    'apiKey',
    'xApiKey',
    'apiSecret',
    'authToken',
    'xAuthToken',
    'sessionToken',
    'bearer',
    'clientSecret',
    'clientState',
    'channelToken',
    'webhookSecret',
    'signingSecret',
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
export const TRUNCATED_VALUE = '[TRUNCATED]';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isTraversable(value: unknown): value is Record<string, unknown> | unknown[] {
  return Array.isArray(value) || isPlainObject(value);
}

function isRedactableValue(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '';
}

/**
 * True when anything reachable from `value` needs rewriting: a sensitive key
 * with a value, or a container beyond MAX_REDACTION_DEPTH (which we cannot
 * inspect, so it fails closed and gets truncated).
 */
function needsRedaction(value: unknown, depth: number, seen: WeakSet<object>): boolean {
  if (!isTraversable(value)) return false;
  if (depth > MAX_REDACTION_DEPTH) return true;
  if (seen.has(value)) return false;
  seen.add(value);

  if (Array.isArray(value)) {
    return value.some((item) => needsRedaction(item, depth + 1, seen));
  }
  return Object.keys(value).some((key) =>
    isSensitiveKey(key) ? isRedactableValue(value[key]) : needsRedaction(value[key], depth + 1, seen),
  );
}

/**
 * Deep-copies plain objects/arrays, masking sensitive keys. `copies` maps each
 * original container to its copy, and the copy is registered before its
 * children are visited, so a cycle back to an ancestor resolves to the
 * redacted copy rather than the original.
 */
function copyRedacted(value: unknown, depth: number, copies: WeakMap<object, unknown>): unknown {
  if (!isTraversable(value)) return value;
  const existing = copies.get(value);
  if (existing !== undefined) return existing;
  if (depth > MAX_REDACTION_DEPTH) return TRUNCATED_VALUE;

  if (Array.isArray(value)) {
    const out: unknown[] = [];
    copies.set(value, out);
    for (const item of value) out.push(copyRedacted(item, depth + 1, copies));
    return out;
  }

  const out: Record<string, unknown> = Object.getPrototypeOf(value) === null ? Object.create(null) : {};
  copies.set(value, out);
  for (const key of Object.keys(value)) {
    const item = value[key];
    out[key] = isSensitiveKey(key) && isRedactableValue(item) ? REDACTED_VALUE : copyRedacted(item, depth + 1, copies);
  }
  return out;
}

/**
 * Returns `value` with every sensitive key's value replaced by `[REDACTED]`,
 * at any depth. Containers nested deeper than MAX_REDACTION_DEPTH are replaced
 * by `[TRUNCATED]` (fail closed). The input is never mutated, and the same
 * reference is returned when nothing needed rewriting. Cycle-safe: no path
 * through a cycle leads back to an unredacted original.
 */
export function redactSensitiveFields<T>(value: T): T {
  if (!needsRedaction(value, 0, new WeakSet())) return value;
  return copyRedacted(value, 0, new WeakMap()) as T;
}
