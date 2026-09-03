import type { DataTypeCanonical, ColumnProfileResult } from '@/types/dataSource';

export type { ColumnProfileResult };

export interface ConnectionConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl?: boolean;
  ca?: string;
}

export interface DiscoveredTable {
  schemaName: string;
  tableName: string;
  rowCountEstimate: bigint | null;
}

export interface DiscoveredColumn {
  columnName: string;
  ordinalPosition: number;
  dataTypeNative: string;
  dataTypeCanonical: DataTypeCanonical;
  isNullable: boolean;
  isPrimaryKey: boolean;
  pkPosition: number | null;
}

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

export interface ColumnDescriptor {
  columnName: string;
  dataTypeCanonical: DataTypeCanonical;
}

export interface TableProfileOptions {
  distinctThreshold: number;
  topK: number;
  columnChunkSize: number;
  sampleRowThreshold: number;
  sampleValuesPerColumn: number;
}

export interface ScanProfileRequest {
  columns: ReadonlyArray<ColumnDescriptor>;
}

export interface ScanProfileResult {
  columns: Map<string, ColumnProfileResult>;
  sampleValues: Map<string, string[]>;
  queryCount: number;
}

export interface Connector {
  connect(): Promise<void>;
  close(): Promise<void>;
  testConnection(): Promise<TestConnectionResult>;

  listTables(): Promise<DiscoveredTable[]>;
  listAllColumns(): Promise<Map<string, DiscoveredColumn[]>>;
  listRelationships(): Promise<DiscoveredRelationship[]>;

  profileTableByScan(
    schemaName: string,
    tableName: string,
    request: ScanProfileRequest,
    rowCountEstimate: bigint | null,
    options: TableProfileOptions
  ): Promise<ScanProfileResult>;

  runQuery(sql: string, params: ReadonlyArray<unknown>): Promise<RunQueryResult>;
}

export interface RunQueryResult {
  rows: Array<Record<string, unknown>>;
  rowCount: number;
}

export type SourceType = 'postgres' | 'clickhouse';
