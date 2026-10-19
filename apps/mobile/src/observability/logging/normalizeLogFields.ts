import type { LogFields, JsonValue, NormalizedLogFields } from './types';

const NORMALIZATION_LIMITS = {
  maximumDepth: 8,
  maximumStringLength: 10_000,
  maximumCollectionItems: 100,
} as const;

const CIRCULAR_REFERENCE = '[Circular]';
const UNDEFINED_VALUE = '[Undefined]';
const UNREADABLE_PROPERTY = '[Unreadable property]';
const UNSERIALIZABLE_VALUE = '[Unserializable value]';
const INVALID_DATE = '[Invalid Date]';

function truncateString(value: string): string {
  if (value.length <= NORMALIZATION_LIMITS.maximumStringLength) {
    return value;
  }

  const omittedCharacterCount = value.length - NORMALIZATION_LIMITS.maximumStringLength;

  return (
    value.slice(0, NORMALIZATION_LIMITS.maximumStringLength) +
    `…[${omittedCharacterCount} characters omitted]`
  );
}

function normalizeNumber(value: number): JsonValue {
  if (Number.isNaN(value)) {
    return '[NaN]';
  }

  if (value === Number.POSITIVE_INFINITY) {
    return '[Infinity]';
  }

  if (value === Number.NEGATIVE_INFINITY) {
    return '[-Infinity]';
  }

  return value;
}

function isPlainObject(value: object): value is Record<string, unknown> {
  try {
    const prototype = Object.getPrototypeOf(value);

    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function isNormalizedLogFields(value: JsonValue): value is NormalizedLogFields {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function describeUnsupportedObject(value: object): string {
  try {
    const constructorName = Object.getPrototypeOf(value)?.constructor?.name;

    if (typeof constructorName === 'string' && constructorName.length > 0) {
      return `[Unsupported object: ${constructorName}]`;
    }
  } catch {
    // Fall through to the generic description.
  }

  return '[Unsupported object]';
}

function addTruncatedPropertyCount(
  target: Record<string, JsonValue>,
  omittedPropertyCount: number,
): void {
  let markerName = 'logging_truncated_properties';

  while (Object.prototype.hasOwnProperty.call(target, markerName)) {
    markerName += '_';
  }

  target[markerName] = omittedPropertyCount;
}

function normalizeError(
  error: Error,
  ancestors: WeakSet<object>,
  depth: number,
): NormalizedLogFields {
  const normalized: Record<string, JsonValue> = {};

  try {
    normalized['name'] = truncateString(error.name);
  } catch {
    normalized['name'] = UNREADABLE_PROPERTY;
  }

  try {
    normalized['message'] = truncateString(error.message);
  } catch {
    normalized['message'] = UNREADABLE_PROPERTY;
  }

  try {
    if (typeof error.stack === 'string') {
      normalized['stack'] = truncateString(error.stack);
    }
  } catch {
    normalized['stack'] = UNREADABLE_PROPERTY;
  }

  try {
    const cause = (
      error as Error & {
        cause?: unknown;
      }
    ).cause;

    if (cause !== undefined) {
      normalized['cause'] = normalizeLogValue(cause, ancestors, depth + 1);
    }
  } catch {
    normalized['cause'] = UNREADABLE_PROPERTY;
  }

  return normalized;
}

function normalizeArray(
  value: readonly unknown[],
  ancestors: WeakSet<object>,
  depth: number,
): readonly JsonValue[] {
  const normalized: JsonValue[] = [];

  const acceptedItemCount = Math.min(value.length, NORMALIZATION_LIMITS.maximumCollectionItems);

  for (let index = 0; index < acceptedItemCount; index += 1) {
    try {
      normalized.push(normalizeLogValue(value[index], ancestors, depth + 1));
    } catch {
      normalized.push(UNREADABLE_PROPERTY);
    }
  }

  const omittedItemCount = value.length - acceptedItemCount;

  if (omittedItemCount > 0) {
    normalized.push(`[${omittedItemCount} array items omitted]`);
  }

  return normalized;
}

function normalizeMap(
  value: Map<unknown, unknown>,
  ancestors: WeakSet<object>,
  depth: number,
): readonly JsonValue[] {
  const normalized: JsonValue[] = [];

  let processedEntryCount = 0;

  for (const [key, item] of value.entries()) {
    if (processedEntryCount >= NORMALIZATION_LIMITS.maximumCollectionItems) {
      normalized.push('[Additional map entries omitted]');
      break;
    }

    normalized.push({
      key: normalizeLogValue(key, ancestors, depth + 1),
      value: normalizeLogValue(item, ancestors, depth + 1),
    });

    processedEntryCount += 1;
  }

  return normalized;
}

function normalizeSet(
  value: Set<unknown>,
  ancestors: WeakSet<object>,
  depth: number,
): readonly JsonValue[] {
  const normalized: JsonValue[] = [];

  let processedItemCount = 0;

  for (const item of value.values()) {
    if (processedItemCount >= NORMALIZATION_LIMITS.maximumCollectionItems) {
      normalized.push('[Additional set items omitted]');
      break;
    }

    normalized.push(normalizeLogValue(item, ancestors, depth + 1));

    processedItemCount += 1;
  }

  return normalized;
}

function normalizePlainObject(
  value: Record<string, unknown>,
  ancestors: WeakSet<object>,
  depth: number,
): NormalizedLogFields {
  let keys: string[];

  try {
    keys = Object.keys(value);
  } catch {
    return {
      logging_normalization_error: '[Unable to enumerate object]',
    };
  }

  const normalized: Record<string, JsonValue> = {};

  const acceptedKeys = keys.slice(0, NORMALIZATION_LIMITS.maximumCollectionItems);

  for (const key of acceptedKeys) {
    try {
      normalized[key] = normalizeLogValue(value[key], ancestors, depth + 1);
    } catch {
      normalized[key] = UNREADABLE_PROPERTY;
    }
  }

  const omittedPropertyCount = keys.length - acceptedKeys.length;

  if (omittedPropertyCount > 0) {
    addTruncatedPropertyCount(normalized, omittedPropertyCount);
  }

  return normalized;
}

function normalizeLogValue(value: unknown, ancestors: WeakSet<object>, depth: number): JsonValue {
  try {
    if (value === null) {
      return null;
    }

    if (typeof value === 'string') {
      return truncateString(value);
    }

    if (typeof value === 'number') {
      return normalizeNumber(value);
    }

    if (typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'undefined') {
      return UNDEFINED_VALUE;
    }

    if (typeof value === 'bigint') {
      return `${value.toString()}n`;
    }

    if (typeof value === 'symbol') {
      return value.toString();
    }

    if (typeof value === 'function') {
      let functionName = 'anonymous';

      try {
        if (typeof value.name === 'string' && value.name.length > 0) {
          functionName = truncateString(value.name);
        }
      } catch {
        // Keep the anonymous fallback.
      }

      return `[Function: ${functionName}]`;
    }

    if (ancestors.has(value)) {
      return CIRCULAR_REFERENCE;
    }

    if (depth >= NORMALIZATION_LIMITS.maximumDepth) {
      return `[Maximum depth ` + `${NORMALIZATION_LIMITS.maximumDepth} reached]`;
    }

    ancestors.add(value);

    try {
      if (value instanceof Error) {
        return normalizeError(value, ancestors, depth);
      }

      if (value instanceof Date) {
        const time = value.getTime();

        return Number.isFinite(time) ? value.toISOString() : INVALID_DATE;
      }

      if (value instanceof RegExp) {
        return value.toString();
      }

      if (Array.isArray(value)) {
        return normalizeArray(value, ancestors, depth);
      }

      if (value instanceof Map) {
        return normalizeMap(value, ancestors, depth);
      }

      if (value instanceof Set) {
        return normalizeSet(value, ancestors, depth);
      }

      if (isPlainObject(value)) {
        return normalizePlainObject(value, ancestors, depth);
      }

      return describeUnsupportedObject(value);
    } finally {
      ancestors.delete(value);
    }
  } catch {
    return UNSERIALIZABLE_VALUE;
  }
}

export function normalizeLogFields(fields: LogFields): NormalizedLogFields {
  const normalized = normalizeLogValue(fields, new WeakSet<object>(), 0);

  if (isNormalizedLogFields(normalized)) {
    return normalized;
  }

  return {
    logging_normalization_error: '[Unable to normalize root log fields]',
  };
}
