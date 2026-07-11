import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { QueryVisualizationType, type TableData } from '@xyne/shared';
import {
  previewQueryPlan,
  type PreviewResponse,
} from '../services/DynamicDashboard/previewService';
import type { ComponentDataError } from '../services/DynamicDashboard/componentDataService';

export const RAW_ROW_LIMIT = 5;

export interface InvolvedTable {
  model: string;
  schema?: string;
}

function rowsToTableData(rows: Array<Record<string, unknown>>): TableData {
  if (rows.length === 0) return { columns: [], rows: [] };
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const k of Object.keys(row)) {
      if (!seen.has(k)) {
        seen.add(k);
        keys.push(k);
      }
    }
  }
  return {
    columns: keys.map(k => ({ key: k, label: k })),
    rows,
  };
}

/** Preview the first rows of a raw table, straight from its data source. */
export function useRawTablePreview(args: {
  dataSourceId: string | null;
  table: InvolvedTable | null;
  enabled: boolean;
  limit?: number;
}): UseQueryResult<TableData, ComponentDataError> {
  const { dataSourceId, table, enabled, limit = RAW_ROW_LIMIT } = args;
  return useQuery<TableData, ComponentDataError>({
    queryKey: ['dashboard-preview-raw', dataSourceId, table?.schema, table?.model, limit],
    queryFn: async ({ signal }) => {
      const res: PreviewResponse = await previewQueryPlan(
        {
          plan: {
            dataSourceId,
            ...(table?.schema ? { schema: table.schema } : {}),
            model: table?.model,
            take: limit,
          },
          visualType: QueryVisualizationType.DATA_TABLE,
        },
        signal,
      );
      return rowsToTableData(res.rows);
    },
    enabled: enabled && Boolean(dataSourceId) && Boolean(table),
    staleTime: 60 * 1000,
    retry: (failureCount, error) => {
      if (error.status >= 400 && error.status < 500) return false;
      return failureCount < 2;
    },
  });
}
