import { schema } from '@xyne/shared';
import type { SchemaDataMap } from '@/vespa/src/types';
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
  data?: SchemaDataMap[S] | Partial<SchemaDataMap[S]>;
}

export type VespaQueueHandler = VespaJobConfig<keyof SchemaDataMap>

export type VespaJobWithPartialData<T> =
  Omit<VespaJobConfig<keyof SchemaDataMap>, "data"> & { data: Partial<T> };

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