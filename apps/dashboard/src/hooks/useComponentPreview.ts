import { useMemo } from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { QueryVisualizationType, type TableData } from '@xyne/shared';
import {
  previewQueryPlan,
  type PreviewResponse,
} from '../services/DynamicDashboard/previewService';
import {
  fetchDataSourceSchema,
  type DataSourceColumn,
} from '../services/DynamicDashboard/dataSourceSchemaService';
import {
  retryOnServerError,
  type ComponentDataError,
} from '../services/DynamicDashboard/componentDataService';
import type { ComponentTileData } from '../components/DynamicDashboard/ComponentGrid/ComponentTile';

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

export function getInvolvedTables(storedPlan?: Record<string, unknown>): InvolvedTable[] {
  if (!storedPlan) return [];
  const model = typeof storedPlan['model'] === 'string' ? storedPlan['model'] : null;
  if (!model) return [];
  const schema = typeof storedPlan['schema'] === 'string' ? storedPlan['schema'] : undefined;
  const tables: InvolvedTable[] = [{ model, ...(schema ? { schema } : {}) }];
  const joins = Array.isArray(storedPlan['joins']) ? storedPlan['joins'] : [];
  for (const j of joins) {
    const jm = (j as { model?: unknown }).model;
    const js = (j as { schema?: unknown }).schema;
    const jSchema = typeof js === 'string' ? js : schema;
    if (typeof jm === 'string' && !tables.some(t => t.model === jm)) {
      tables.push({ model: jm, ...(jSchema ? { schema: jSchema } : {}) });
    }
  }
  return tables;
}

export function getDataSourceId(storedPlan?: Record<string, unknown>): string | null {
  const direct = storedPlan?.['dataSourceId'];
  return typeof direct === 'string' && direct.length > 0 ? direct : null;
}

export type ColumnRole = 'dimension' | 'measure' | 'filter' | 'sort' | 'join';

function bareColumn(ref: unknown): string | null {
  let col: string | null = null;
  if (typeof ref === 'string') col = ref;
  else if (
    ref &&
    typeof ref === 'object' &&
    typeof (ref as { column?: unknown }).column === 'string'
  ) {
    col = (ref as { column: string }).column;
  }
  if (!col || col === '*') return null;
  const dot = col.lastIndexOf('.');
  return (dot >= 0 ? col.slice(dot + 1) : col).toLowerCase();
}

function addRole(map: Map<string, Set<ColumnRole>>, col: string | null, role: ColumnRole): void {
  if (!col) return;
  const set = map.get(col) ?? new Set<ColumnRole>();
  set.add(role);
  map.set(col, set);
}

function collectWhere(node: unknown, map: Map<string, Set<ColumnRole>>): void {
  if (!node || typeof node !== 'object') return;
  const n = node as Record<string, unknown>;
  if (n['filter'] && typeof n['filter'] === 'object') {
    addRole(map, bareColumn(n['filter']), 'filter');
  }
  if (typeof n['column'] === 'string') addRole(map, bareColumn(n), 'filter');
  for (const key of ['AND', 'OR'] as const) {
    const arr = n[key];
    if (Array.isArray(arr)) arr.forEach(c => collectWhere(c, map));
  }
  if (n['NOT']) collectWhere(n['NOT'], map);
}

function collectExpr(node: unknown, map: Map<string, Set<ColumnRole>>): void {
  if (!node || typeof node !== 'object') return;
  const n = node as Record<string, unknown>;
  if (typeof n['column'] === 'string') {
    addRole(map, bareColumn(n), 'measure');
    if (n['filter']) collectWhere(n['filter'], map);
    return;
  }
  if (n['left']) collectExpr(n['left'], map);
  if (n['right']) collectExpr(n['right'], map);
}

function collectMeasure(m: unknown, map: Map<string, Set<ColumnRole>>): void {
  if (!m || typeof m !== 'object') return;
  const mm = m as Record<string, unknown>;
  if (mm['expr']) {
    collectExpr(mm['expr'], map);
    return;
  }
  addRole(map, bareColumn(mm), 'measure');
  if (mm['filter']) collectWhere(mm['filter'], map);
}

function computeUsed(
  plan: Record<string, unknown> | null,
  map: Map<string, Set<ColumnRole>>,
): void {
  if (!plan) return;
  const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  arr(plan['groupBy']).forEach(c => addRole(map, bareColumn(c), 'dimension'));
  arr(plan['select']).forEach(c => addRole(map, bareColumn(c), 'dimension'));
  arr(plan['measures']).forEach(m => collectMeasure(m, map));
  arr(plan['orderBy']).forEach(o => addRole(map, bareColumn(o), 'sort'));
  arr(plan['joins']).forEach(j => {
    const on = (j as { on?: { from?: unknown; to?: unknown } }).on;
    if (on) {
      addRole(map, bareColumn(on.from), 'join');
      addRole(map, bareColumn(on.to), 'join');
    }
  });
  collectWhere(plan['where'], map);
}

export function getUsedColumns(storedPlan?: Record<string, unknown>): Map<string, ColumnRole[]> {
  const map = new Map<string, Set<ColumnRole>>();
  if (!storedPlan) return new Map();
  computeUsed(storedPlan, map);
  const out = new Map<string, ColumnRole[]>();
  for (const [col, roles] of map) out.set(col, Array.from(roles));
  return out;
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
    retry: retryOnServerError,
  });
}

/** Preview the shaped result of a component's stored plan. */
export function useComponentResultPreview(args: {
  component: ComponentTileData;
  enabled: boolean;
}): UseQueryResult<TableData, ComponentDataError> {
  const { component, enabled } = args;
  return useQuery<TableData, ComponentDataError>({
    queryKey: ['dashboard-preview-result', component.id, component.updatedAt],
    queryFn: async ({ signal }) => {
      const res: PreviewResponse = await previewQueryPlan(
        { plan: component.storedPlan ?? {}, visualType: component.visualType },
        signal,
      );
      return rowsToTableData(res.rows);
    },
    enabled: enabled && Boolean(component.storedPlan),
    staleTime: 60 * 1000,
    retry: retryOnServerError,
  });
}

interface CompiledSql {
  sql: string | null;
  params: unknown[];
}

/** Compile a stored plan into SQL (and its inlined params) without running side effects. */
export function useCompiledSql(args: {
  plan: Record<string, unknown> | null;
  enabled: boolean;
}): UseQueryResult<CompiledSql, ComponentDataError> {
  const { plan, enabled } = args;
  const hasSource = !!plan && typeof plan['dataSourceId'] === 'string';
  const planKey = useMemo(() => (plan ? JSON.stringify(plan) : null), [plan]);
  return useQuery<CompiledSql, ComponentDataError>({
    queryKey: ['dashboard-preview-sql', planKey],
    queryFn: async ({ signal }) => {
      const res: PreviewResponse = await previewQueryPlan(
        { plan, visualType: QueryVisualizationType.DATA_TABLE },
        signal,
      );
      return { sql: res.debug?.sql ?? null, params: res.debug?.params ?? [] };
    },
    enabled: enabled && hasSource,
    staleTime: 60 * 1000,
    retry: retryOnServerError,
  });
}

/** Resolve the column metadata (types, keys) for a table from its data source schema. */
export function useTableColumnsMeta(args: {
  dataSourceId: string | null;
  table: InvolvedTable | null;
  enabled: boolean;
}): { columns: DataSourceColumn[]; isLoading: boolean } {
  const { dataSourceId, table, enabled } = args;
  const query = useQuery({
    queryKey: ['dashboard-preview-schema', dataSourceId],
    queryFn: ({ signal }) => fetchDataSourceSchema(dataSourceId as string, signal),
    enabled: enabled && Boolean(dataSourceId),
    staleTime: 5 * 60 * 1000,
  });
  const columns = useMemo<DataSourceColumn[]>(() => {
    if (!query.data || !table) return [];
    const match = query.data.tables.find(
      t => t.tableName === table.model && (!table.schema || t.schemaName === table.schema),
    );
    return match?.columns ?? [];
  }, [query.data, table]);
  return { columns, isLoading: query.isLoading };
}
