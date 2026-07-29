import { schema } from '@xyne/shared';
import type { SchemaDataMap, SubApp } from '@/vespa/src/types';
import { DeleteID, InsertValue, UpdateValue, UpsertValue } from '@rocicorp/zero';

/**
 * Job types for Vespa ingestion
 */
export type VespaJobType = 'feed' | 'update' | 'delete';

/**
 * Configuration for a single Vespa job to be queued
 * Minimal payload - all processing happens in the worker
 */
export interface VespaJobConfig<S extends keyof SchemaDataMap> {
  schema: S;
  jobType: VespaJobType;
  docId: string;
  userId?: string; // For error logging and data fetching
  workspaceId?: string;
  orgId?: string;
  app?: SubApp; // when schema can belong to multiple sub-applications
  data?: SchemaDataMap[S] | Partial<SchemaDataMap[S]>;
  fields?: string[]; // when jobType is 'update', restrict the Vespa write to just these document fields
  // Scope modifier on a 'feed' job for the `file` schema: when true, insert only
  // the file's metadata (name, mime, size, permissions, …) with empty chunks —
  // skipping the slow GCS-download + content-parse step. Makes the file
  // searchable by name in cmd+K within seconds; a second full feed enriches the
  // same docId with content later.
  nameOnly?: boolean;
}

export type VespaQueueHandler = VespaJobConfig<keyof SchemaDataMap>
export type VespaJob = VespaJobConfig<keyof SchemaDataMap>
/**
 * Table names from the schema
 */
export type TableName = keyof typeof schema.tables;

/**
 * Accumulator array for collecting Vespa jobs during a transaction
 */
type AnyTableSchema =
  (typeof schema.tables)[keyof typeof schema.tables];
export type VespaPayload =
  | InsertValue<AnyTableSchema>
  | UpdateValue<AnyTableSchema>
  | UpsertValue<AnyTableSchema>
  | DeleteID<AnyTableSchema>;

export type VespaJobsAccumulator = VespaQueueHandler[];