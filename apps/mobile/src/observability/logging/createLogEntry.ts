import type { LogEntry, LogLevel, NormalizedLogFields } from './types';

export function createLogEntry(
  level: LogLevel,
  event: string,
  fields: NormalizedLogFields,
  occurredAt: Date,
): LogEntry {
  return {
    timestamp: occurredAt.toISOString(),
    level,
    event,
    fields: { ...fields },
  };
}
