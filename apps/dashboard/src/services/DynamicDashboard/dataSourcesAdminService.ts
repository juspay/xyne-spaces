import { apiInstance } from '../clients/apiClient';
import type { DataSourceListItem } from './dataSourcesService';

export interface ConnectionConfigInput {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl?: boolean;
  ca?: string;
}

export interface IncludedTable {
  schemaName: string;
  tableName: string;
}

export interface DiscoveredTable {
  schemaName: string;
  tableName: string;
  rowCountEstimate: string | null;
}

export interface CreateDataSourceInput {
  name: string;
  description?: string;
  sourceType: 'postgres' | 'clickhouse';
  connectionConfig: ConnectionConfigInput;
  includedTables?: IncludedTable[];
}

export interface TestConnectionResult {
  ok: boolean;
  version?: string;
  error?: string;
}

export async function testDataSourceConnection(
  input: Pick<CreateDataSourceInput, 'sourceType' | 'connectionConfig'>,
): Promise<TestConnectionResult> {
  try {
    const res = await apiInstance.post<TestConnectionResult>('/dashboard/datasource/test', input);
    return res.data;
  } catch (err) {
    const e = err as { response?: { data?: { error?: string } }; message?: string };
    return {
      ok: false,
      error: e?.response?.data?.error ?? e?.message ?? 'Unknown error while testing connection',
    };
  }
}

export async function discoverDataSourceTables(
  input: Pick<CreateDataSourceInput, 'sourceType' | 'connectionConfig'>,
): Promise<DiscoveredTable[]> {
  const res = await apiInstance.post<{ tables: DiscoveredTable[] }>(
    '/dashboard/datasource/discover-tables',
    input,
  );
  return res.data.tables;
}

export async function createDataSource(input: CreateDataSourceInput): Promise<DataSourceListItem> {
  const res = await apiInstance.post<{
    id: string;
    status: string;
    name: string;
    sourceType: string;
    createdAt: string;
  }>('/dashboard/datasource/create', input);
  return {
    id: res.data.id,
    name: res.data.name,
    description: input.description ?? null,
    sourceType: input.sourceType,
    healthStatus: 'unknown',
    ingestionStatus: res.data.status,
  };
}

export async function deleteDataSource(id: string): Promise<void> {
  await apiInstance.delete(`/dashboard/datasource/${id}`);
}

export async function refreshDataSource(id: string): Promise<void> {
  await apiInstance.post(`/dashboard/datasource/${id}/refresh`);
}

export interface DataSourceConfig {
  ingestTableLimit: number;
}

export async function getDataSourceConfig(): Promise<DataSourceConfig> {
  const res = await apiInstance.get<DataSourceConfig>('/dashboard/datasource/config');
  return res.data;
}
