/**
 * Metadata redaction for the notification log pipeline (SDLCT-0002).
 *
 * The lifecycle audit trail must be safe to expose to workspace admins and
 * support engineers. Notification payloads routinely carry message bodies,
 * device tokens, URLs with secrets, and PII. We therefore store an ALLOWLIST
 * of non-sensitive, low-cardinality diagnostic fields only — never the raw
 * payload. Anything not on the allowlist is dropped.
 */

/**
 * Keys that are safe to persist on a notification log event. These are
 * structural/routing fields useful for completeness analysis, not content.
 */
const ALLOWED_METADATA_KEYS = new Set<string>([
  'notificationType',
  'type',
  'platform',
  'appVersion',
  'deliveryMethod',
  'channel',
  'provider',
  'relatedEntityType',
  'relatedEntityId',
  'sessionId',
  'attempt',
  'jobId',
  'queueName',
  'reasonCode',
  'errorCode',
  'httpStatus',
  'payloadBytes',
  'truncated',
  'silent',
]);

/**
 * Substrings that, if present in a key, force the value to be dropped even if
 * the key would otherwise pass. Defense-in-depth against accidental leakage.
 */
const SENSITIVE_KEY_FRAGMENTS = [
  'token',
  'secret',
  'password',
  'authorization',
  'cookie',
  'apikey',
  'api_key',
  'credential',
  'body',
  'message',
  'title',
  'email',
  'phone',
];

const MAX_STRING_LENGTH = 256;

function isScalar(value: unknown): value is string | number | boolean {
  return (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

function keyLooksSensitive(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_KEY_FRAGMENTS.some((fragment) => lower.includes(fragment));
}

/**
 * Produce a redacted, allowlisted copy of arbitrary notification metadata.
 * Returns `undefined` when nothing safe survives, so callers can omit the
 * column entirely rather than storing an empty object.
 */
export function redactMetadata(
  input: unknown,
): Record<string, string | number | boolean> | undefined {
  if (!input || typeof input !== 'object') return undefined;

  const source = input as Record<string, unknown>;
  const out: Record<string, string | number | boolean> = {};

  for (const [key, value] of Object.entries(source)) {
    if (!ALLOWED_METADATA_KEYS.has(key)) continue;
    if (keyLooksSensitive(key)) continue;
    if (!isScalar(value)) continue;

    if (typeof value === 'string') {
      out[key] = value.length > MAX_STRING_LENGTH
        ? `${value.slice(0, MAX_STRING_LENGTH)}…`
        : value;
    } else {
      out[key] = value;
    }
  }

  return Object.keys(out).length > 0 ? out : undefined;
}
