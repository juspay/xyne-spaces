export const DPIP_TABLE_NAMES = [
  'reports',
  'screenings',
  'cluster_external_entities',
  'external_entity_identifiers',
  'cluster_identifiers',
  'party_identifiers',
  'entities_by_customer',
] as const;

export type DpipTableName = (typeof DPIP_TABLE_NAMES)[number];

export type DpipValue = string | bigint;
export type DpipRow = Record<string, DpipValue>;

export interface DpipRowError {
  table: DpipTableName;
  row: number;
  field?: string;
  message: string;
}

export interface DpipParseResult {
  tables: Record<DpipTableName, DpipRow[]>;
  errors: DpipRowError[];
}

export interface DpipTableParseStats {
  received: number;
  duplicates: number;
  invalid: number;
}

export interface DpipDetailedParseResult extends DpipParseResult {
  parseStats: Record<DpipTableName, DpipTableParseStats>;
}

export interface DpipWriteStats {
  inserted: number;
  updated: number;
  conflicts: number;
}

export interface DpipTableSummary {
  table: DpipTableName;
  received: number;
  inserted: number;
  updated: number;
  duplicates: number;
  invalid: number;
}
