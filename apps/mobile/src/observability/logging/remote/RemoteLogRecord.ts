import type { JsonObject } from '../types';

export const REMOTE_LOG_SCHEMA_VERSION = 1 as const;

export type RemoteLogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface RemoteLogRecord extends JsonObject {
  readonly schemaVersion: typeof REMOTE_LOG_SCHEMA_VERSION;
  readonly timestamp: string;
  readonly level: RemoteLogLevel;
  readonly event: string;
}

export type RemoteLogBatch = readonly RemoteLogRecord[];
