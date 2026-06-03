import { QueryVisualizationType, type WhereClause } from '@xyne/shared';
import { v4 as uuidv4 } from 'uuid';
import { flattenWhereToFilters } from './queryPlanUtils';
import type {
  AggregationOp,
  FilterRow,
  GroupByRow,
  JoinRow,
  MeasureRow,
  OrderByRow,
  TimeBucket,
} from './types';

export interface ComponentDraft {
  visualType: QueryVisualizationType;
  title: string;
  dataSourceId: string;
  tableName: string;
  timeColumn: string;
  groupBy: GroupByRow[];
  measures: MeasureRow[];
  filters: FilterRow[];
  orderBy: OrderByRow[];
  take: string;
  joins: JoinRow[];
  selectCols: string[];
}

export interface InitialDraftInput {
  initialFromRow: {
    plan: Record<string, unknown>;
    cfg: Record<string, unknown>;
    type: QueryVisualizationType;
    title: string;
  } | null;
  defaultDataSourceId: string | undefined;
}

export type ListUpdater<T> = T[] | ((prev: T[]) => T[]);

export type ComponentDraftAction =
  | { type: 'setVisualType'; value: QueryVisualizationType }
  | { type: 'setTitle'; value: string }
  | { type: 'setDataSourceId'; value: string }
  | { type: 'setTableName'; value: string }
  | { type: 'setTimeColumn'; value: string }
  | { type: 'setTake'; value: string }
  | { type: 'setGroupBy'; updater: ListUpdater<GroupByRow> }
  | { type: 'setMeasures'; updater: ListUpdater<MeasureRow> }
  | { type: 'setFilters'; updater: ListUpdater<FilterRow> }
  | { type: 'setOrderBy'; updater: ListUpdater<OrderByRow> }
  | { type: 'setJoins'; updater: ListUpdater<JoinRow> }
  | { type: 'setSelectCols'; updater: ListUpdater<string> };

function resolve<T>(prev: T[], updater: ListUpdater<T>): T[] {
  return typeof updater === 'function' ? updater(prev) : updater;
}

export function componentDraftReducer(
  state: ComponentDraft,
  action: ComponentDraftAction,
): ComponentDraft {
  switch (action.type) {
    case 'setVisualType':
      return { ...state, visualType: action.value };
    case 'setTitle':
      return { ...state, title: action.value };
    case 'setDataSourceId':
      return { ...state, dataSourceId: action.value };
    case 'setTableName':
      return { ...state, tableName: action.value };
    case 'setTimeColumn':
      return { ...state, timeColumn: action.value };
    case 'setTake':
      return { ...state, take: action.value };
    case 'setGroupBy':
      return { ...state, groupBy: resolve(state.groupBy, action.updater) };
    case 'setMeasures':
      return { ...state, measures: resolve(state.measures, action.updater) };
    case 'setFilters':
      return { ...state, filters: resolve(state.filters, action.updater) };
    case 'setOrderBy':
      return { ...state, orderBy: resolve(state.orderBy, action.updater) };
    case 'setJoins':
      return { ...state, joins: resolve(state.joins, action.updater) };
    case 'setSelectCols':
      return { ...state, selectCols: resolve(state.selectCols, action.updater) };
    default: {
      action satisfies never;
      return state;
    }
  }
}

export function initialComponentDraft({
  initialFromRow,
  defaultDataSourceId,
}: InitialDraftInput): ComponentDraft {
  return {
    visualType: initialFromRow?.type ?? QueryVisualizationType.KPI,
    title: initialFromRow?.title ?? '',
    dataSourceId:
      typeof initialFromRow?.plan['dataSourceId'] === 'string'
        ? initialFromRow.plan['dataSourceId']
        : (defaultDataSourceId ?? ''),
    tableName:
      typeof initialFromRow?.plan['model'] === 'string' ? initialFromRow.plan['model'] : '',
    timeColumn:
      typeof initialFromRow?.cfg['timeColumn'] === 'string' ? initialFromRow.cfg['timeColumn'] : '',
    groupBy: buildGroupBy(initialFromRow?.plan['groupBy']),
    measures: buildMeasures(initialFromRow?.plan['measures']),
    filters: flattenWhereToFilters(initialFromRow?.plan['where']),
    orderBy: buildOrderBy(initialFromRow?.plan['orderBy']),
    take:
      typeof initialFromRow?.plan['take'] === 'number' ? String(initialFromRow.plan['take']) : '',
    joins: buildJoins(initialFromRow?.plan['joins']),
    selectCols: buildSelectCols(initialFromRow?.plan['select']),
  };
}

function buildGroupBy(raw: unknown): GroupByRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((g): GroupByRow => {
    if (typeof g === 'string') return { id: uuidv4(), column: g };
    const o = g as Record<string, unknown>;
    return {
      id: uuidv4(),
      column: typeof o['column'] === 'string' ? o['column'] : '',
      ...(typeof o['alias'] === 'string' ? { alias: o['alias'] } : {}),
      ...(typeof o['bucket'] === 'string' ? { bucket: o['bucket'] as TimeBucket } : {}),
    };
  });
}

function buildMeasures(raw: unknown): MeasureRow[] {
  if (Array.isArray(raw)) {
    return raw.map((m): MeasureRow => {
      const o = m as Record<string, unknown>;
      return {
        id: uuidv4(),
        column: typeof o['column'] === 'string' ? o['column'] : '*',
        op: (o['op'] as AggregationOp) ?? 'sum',
        ...(typeof o['alias'] === 'string' ? { alias: o['alias'] } : {}),
        ...(o['filter'] && typeof o['filter'] === 'object'
          ? { filter: o['filter'] as WhereClause }
          : {}),
      };
    });
  }
  return [{ id: uuidv4(), column: '*', op: 'count', alias: 'value' }];
}

function buildOrderBy(raw: unknown): OrderByRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((o): OrderByRow => {
    const r = o as Record<string, unknown>;
    return {
      id: uuidv4(),
      column: typeof r['column'] === 'string' ? r['column'] : '',
      dir: (r['dir'] as 'asc' | 'desc') ?? 'asc',
    };
  });
}

function buildJoins(raw: unknown): JoinRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((j): JoinRow => {
    const o = j as Record<string, unknown>;
    const onRaw = (o['on'] as Record<string, unknown> | undefined) ?? {};
    return {
      id: uuidv4(),
      model: typeof o['model'] === 'string' ? o['model'] : '',
      type: (o['type'] as 'inner' | 'left' | undefined) ?? 'inner',
      on: {
        from: typeof onRaw['from'] === 'string' ? onRaw['from'] : '',
        to: typeof onRaw['to'] === 'string' ? onRaw['to'] : '',
      },
      ...(typeof o['alias'] === 'string' ? { alias: o['alias'] } : {}),
    };
  });
}

function buildSelectCols(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(s => (typeof s === 'string' ? s : (s as { column: string }).column));
}
