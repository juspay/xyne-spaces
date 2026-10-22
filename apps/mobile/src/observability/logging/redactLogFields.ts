import type { JsonObject, JsonValue, NormalizedLogFields } from './types';

const REDACTED_VALUE = '[Redacted]';

const SENSITIVE_FIELD_NAMES: ReadonlySet<string> = new Set([
  'authorization',
  'password',
  'passcode',
  'pin',
  'otp',
  'token',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'pushtoken',
  'apikey',
  'clientsecret',
  'cookie',
  'setcookie',
  'secret',
  'privatekey',
  'credential',
  'credentials',
  'email',
  'emailid',
]);

const SENSITIVE_STRING_PATTERNS: readonly [RegExp, string][] = [
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [Redacted]'],
  [
    /([?&](?:access_token|api[_-]?key|client_secret|id_token|refresh_token|secret|signature|token)=)[^&#\s]*/gi,
    '$1[Redacted]',
  ],
];

function normalizeFieldName(fieldName: string): string {
  return fieldName.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

export function redactLogString(value: string): string {
  return SENSITIVE_STRING_PATTERNS.reduce(
    (redacted, [pattern, replacement]) => redacted.replace(pattern, replacement),
    value,
  );
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function redactJsonObject(value: JsonObject): JsonObject {
  const redacted: Record<string, JsonValue> = {};

  for (const [fieldName, fieldValue] of Object.entries(value)) {
    const normalizedFieldName = normalizeFieldName(fieldName);

    redacted[fieldName] = SENSITIVE_FIELD_NAMES.has(normalizedFieldName)
      ? REDACTED_VALUE
      : redactJsonValue(fieldValue);
  }

  return redacted;
}

function redactJsonValue(value: JsonValue): JsonValue {
  if (typeof value === 'string') {
    return redactLogString(value);
  }

  if (Array.isArray(value)) {
    return value.map((item: JsonValue) => redactJsonValue(item));
  }

  if (isJsonObject(value)) {
    return redactJsonObject(value);
  }

  return value;
}

export function redactLogFields(fields: NormalizedLogFields): NormalizedLogFields {
  return redactJsonObject(fields);
}
