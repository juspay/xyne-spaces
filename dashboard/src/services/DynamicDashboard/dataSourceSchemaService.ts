import { apiInstance } from '../clients/apiClient';

export interface DataSourceColumn {
  id: string;
  columnName: string;
  dataTypeNative: string;
  dataTypeCanonical:
    | 'numeric'
    | 'text'
    | 'boolean'
    | 'temporal'
    | 'json'
    | 'array'
    | 'binary'
    | 'unknown';
  isNullable: boolean;
  isPrimaryKey: boolean;
  cardinality: 'categorical' | 'high_card' | null;
}

export interface DataSourceTable {
  id: string;
  schemaName: string;
  tableName: string;
  columns: DataSourceColumn[];
}

export interface DataSourceRelationship {
  id: string;
  cardinality: 'one_to_one' | 'one_to_many';
  fromSchema: string;
  fromTable: string;
  fromColumn: string;
  toSchema: string;
  toTable: string;
  toColumn: string;
}

export interface DataSourceSchema {
  dataSourceId: string;
  name: string;
  sourceType: string;
  tables: DataSourceTable[];
  relationships?: DataSourceRelationship[];
}

export async function fetchDataSourceSchema(
  dataSourceId: string,
  signal?: AbortSignal,
): Promise<DataSourceSchema> {
  const res = await apiInstance.get<DataSourceSchema>(
    `/dashboard/datasource/${dataSourceId}/schema`,
    signal ? { signal } : undefined,
  );
  return res.data;
}
