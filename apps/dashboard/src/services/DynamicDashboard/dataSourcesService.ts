import { apiInstance } from '../clients/apiClient';

export interface DataSourceListItem {
  id: string;
  name: string;
  description?: string | null;
  sourceType: 'postgres' | 'clickhouse';
  healthStatus: string;
  ingestionStatus: string;
}

export async function listDataSources(): Promise<DataSourceListItem[]> {
  const response = await apiInstance.get<{ dataSources: DataSourceListItem[] }>(
    '/dashboard/datasource/list',
  );
  return response.data.dataSources ?? [];
}
