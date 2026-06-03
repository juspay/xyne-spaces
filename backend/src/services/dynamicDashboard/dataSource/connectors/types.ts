import type {
  ColumnSummary,
  ColumnValue,
  DataTypeCanonical,
} from '@/types/dataSource';

export interface ConnectionConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl?: boolean;
}

export interface DiscoveredTable {
  schemaName: string;  tableName: string;
  rowCountEstimate: bigint | null;}

export interface DiscoveredColumn {
  columnName: string;
  ordinalPosition: number;  dataTypeNative: string;  dataTypeCanonical: DataTypeCanonical;
  isNullable: boolean;
  isPrimaryKey: boolean;
  pkPosition: number | null;}

export interface DiscoveredRelationship {
  fromSchema: string;
  fromTable: string;
  fromColumn: string;
  toSchema: string;
  toTable: string;
  toColumn: string;
  cardinality: 'one_to_one' | 'one_to_many';
}

export interface TestConnectionResult {
  ok: boolean;
  version?: string;
  error?: string;
}

export interface CategoricalProbeOptions {
  distinctThreshold: number;
  topK: number;
}

export interface CategoricalProbeResult {
  distinctCountApprox: number;
  valuesAreExhaustive: boolean;
  topValues: ColumnValue[];
}

export interface CountStatsResult {
  nullCount: number;
  totalCount: number;
}

export type NumericStats = NonNullable<ColumnSummary['numericStats']>;
export type TemporalStats = NonNullable<ColumnSummary['temporalStats']>;

export interface Connector {
  connect(): Promise<void>;
  close(): Promise<void>;
  testConnection(): Promise<TestConnectionResult>;

  listTables(): Promise<DiscoveredTable[]>;
  listColumns(schemaName: string, tableName: string): Promise<DiscoveredColumn[]>;
  listRelationships(): Promise<DiscoveredRelationship[]>;

  computeNumericStats(
    schemaName: string,
    tableName: string,
    columnName: string,
  ): Promise<NumericStats | null>;

  computeTemporalStats(
    schemaName: string,
    tableName: string,
    columnName: string,
  ): Promise<TemporalStats | null>;

  computeCategoricalProbe(
    schemaName: string,
    tableName: string,
    columnName: string,
    options: CategoricalProbeOptions,
  ): Promise<CategoricalProbeResult>;

  computeCountStats(
    schemaName: string,
    tableName: string,
    columnName: string,
  ): Promise<CountStatsResult>;

  runQuery(sql: string, params: ReadonlyArray<unknown>): Promise<RunQueryResult>;
}

export interface RunQueryResult {
  rows: Array<Record<string, unknown>>;
  rowCount: number;
}

export type SourceType = 'postgres' | 'clickhouse';
