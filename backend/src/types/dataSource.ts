import { z } from 'zod';

export const SourceType = z.enum(['postgres', 'clickhouse']);
export type SourceType = z.infer<typeof SourceType>;

export const HealthStatus = z.enum(['healthy', 'degraded', 'unreachable', 'unknown']);
export type HealthStatus = z.infer<typeof HealthStatus>;

export const DataTypeCanonical = z.enum([
  'numeric',
  'text',
  'boolean',
  'temporal',
  'json',
  'array',
  'binary',
  'unknown',
]);
export type DataTypeCanonical = z.infer<typeof DataTypeCanonical>;

export const Cardinality = z.enum(['one_to_one', 'one_to_many', 'many_to_one', 'many_to_many']);
export type Cardinality = z.infer<typeof Cardinality>;

export const NumericStatsSchema = z.object({
  min: z.number(),
  max: z.number(),
  avg: z.number().optional(),
  stddev: z.number().optional(),
  p50: z.number().optional(),
  p95: z.number().optional(),
  p99: z.number().optional(),
});
export type NumericStats = z.infer<typeof NumericStatsSchema>;

export const TemporalStatsSchema = z.object({
  min: z.string().datetime(),
  max: z.string().datetime(),
});
export type TemporalStats = z.infer<typeof TemporalStatsSchema>;

export const ColumnValueSchema = z.object({
  value: z.string().max(512),
  frequency: z.number().int().nonnegative().optional(),
});
export type ColumnValue = z.infer<typeof ColumnValueSchema>;

export const ColumnSummarySchema = z.object({
  distinctCountApprox: z.number().int().nonnegative().optional(),
  nullCount: z.number().int().nonnegative().optional(),
  totalCount: z.number().int().nonnegative().optional(),
  numericStats: NumericStatsSchema.optional(),
  temporalStats: TemporalStatsSchema.optional(),
  topValues: z.array(ColumnValueSchema).optional(),
  valuesAreExhaustive: z.boolean().optional(),
  statsSource: z.enum(['catalog', 'scan']).optional(),
  approx: z.boolean().optional(),
  sampleValues: z.array(z.string().max(120)).optional(),
  edaFailed: z.boolean().optional(),
  edaError: z.string().optional(),
});
export type ColumnSummary = z.infer<typeof ColumnSummarySchema>;

export interface ColumnProfileResult {
  summary: ColumnSummary;
  cardinality: 'categorical' | 'high_card' | null;
}

export const dataSourceResourceName = (id: string) => `data_source:${id}` as const;
export const dataSourceTableResourceName = (id: string) => `data_source_table:${id}` as const;
export const dashboardResourceName = (id: string) => `dashboard:${id}` as const;

function jsonCodec<T>(schema: z.ZodType<T>) {
  return {
    parse: (s: string): T => schema.parse(JSON.parse(s)),
    stringify: (v: T): string => JSON.stringify(schema.parse(v)),
  };
}

export const ColumnSummaryCodec = jsonCodec(ColumnSummarySchema);

export const DashboardActivityEntityType = z.enum([
  'data_source',
  'data_source_table',
  'data_source_column',
  'data_source_relationship',
  'dashboard',
  'dashboard_component',
]);
export type DashboardActivityEntityType = z.infer<typeof DashboardActivityEntityType>;

export const DashboardActivityEventType = z.enum([
  'created',
  'updated',
  'dropped',
  'restored',
  'health_checked',
  'connected',
  'disconnected',
  'stats_refreshed',
  'schema_refreshed',
  'description_edited',
  'hidden',
  'unhidden',
]);
export type DashboardActivityEventType = z.infer<typeof DashboardActivityEventType>;
