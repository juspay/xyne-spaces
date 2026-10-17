import type { LogEntry, LogLevel } from '../types';
import {
  REMOTE_LOG_SCHEMA_VERSION,
  type RemoteLogBatch,
  type RemoteLogLevel,
  type RemoteLogRecord,
} from './RemoteLogRecord';
import { getRemoteOnlyLogFields } from './remoteOnlyLogFields';

const REMOTE_LEVEL_BY_LOG_LEVEL: Readonly<Record<LogLevel, RemoteLogLevel>> = {
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARN',
  error: 'ERROR',
};

export function toRemoteLogRecord(entry: LogEntry): RemoteLogRecord {
  return {
    ...entry.fields,
    ...(getRemoteOnlyLogFields(entry) ?? {}),
    schemaVersion: REMOTE_LOG_SCHEMA_VERSION,
    timestamp: entry.timestamp,
    level: REMOTE_LEVEL_BY_LOG_LEVEL[entry.level],
    event: entry.event,
  };
}

export function toRemoteLogBatch(entries: readonly LogEntry[]): RemoteLogBatch {
  return entries.map(entry => toRemoteLogRecord(entry));
}
