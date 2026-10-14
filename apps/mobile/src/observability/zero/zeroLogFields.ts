import type { ZeroOperationStage } from '../metrics/metrics';

const UNKNOWN = 'unknown';

export function readStringField(fields: object | undefined, key: string): string {
  if (fields == null || !(key in fields)) {
    return UNKNOWN;
  }

  const value = (fields as Record<string, unknown>)[key];
  return typeof value === 'string' && value.length > 0 ? value : UNKNOWN;
}

export function readBooleanField(
  fields: Record<string, unknown> | undefined,
  key: string,
): boolean {
  return fields?.[key] === true;
}

export function readRowCount(fields: Record<string, unknown> | undefined): number {
  const value = fields?.['rowCount'];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * Shared Zero hooks send `latency` on queries and `duration` on mutate/run.
 * Parse any of those names (or mobile `durationMs`) into milliseconds.
 */
export function readDurationMs(fields: Record<string, unknown> | undefined): number | undefined {
  const durationMs = fields?.['durationMs'];
  if (typeof durationMs === 'number' && Number.isFinite(durationMs)) {
    return Math.round(durationMs);
  }

  const latency = fields?.['latency'];
  if (typeof latency === 'number' && Number.isFinite(latency)) {
    return Math.round(latency);
  }

  const duration = fields?.['duration'];
  if (typeof duration === 'number' && Number.isFinite(duration)) {
    return Math.round(duration);
  }

  return undefined;
}

export function readDurationMsOrZero(fields: Record<string, unknown> | undefined): number {
  return readDurationMs(fields) ?? 0;
}

export function readErrorField(fields: Record<string, unknown> | undefined): unknown {
  return fields?.['error'] ?? UNKNOWN;
}

export function readOperationStage(
  attributes: Record<string, string> | undefined,
): ZeroOperationStage {
  const stage = attributes?.['stage'];
  if (stage === 'start' || stage === 'success' || stage === 'error') {
    return stage;
  }

  return 'start';
}
