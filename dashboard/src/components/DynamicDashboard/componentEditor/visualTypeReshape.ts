import { v4 as uuidv4 } from 'uuid';
import { QueryVisualizationType } from '@xyne/shared';
import type { DataSourceColumn } from '../../../services/DynamicDashboard/dataSourceSchemaService';
import type { GroupByRow, MeasureRow } from './types';
import { isIdLikeColumn } from './queryPlanUtils';

function pickDefaultLabelColumn(columns: ReadonlyArray<DataSourceColumn>): string {
  return (
    columns.find(c => c.dataTypeCanonical === 'text' && !isIdLikeColumn(c.columnName))
      ?.columnName ??
    columns.find(c => c.dataTypeCanonical !== 'temporal' && !isIdLikeColumn(c.columnName))
      ?.columnName ??
    columns.find(c => c.dataTypeCanonical !== 'temporal')?.columnName ??
    ''
  );
}

function pickDefaultSeriesColumn(columns: ReadonlyArray<DataSourceColumn>): string {
  return (
    columns.find(c => c.dataTypeCanonical === 'text' && !isIdLikeColumn(c.columnName))
      ?.columnName ??
    columns.find(
      c =>
        c.dataTypeCanonical !== 'temporal' &&
        c.dataTypeCanonical !== 'numeric' &&
        !isIdLikeColumn(c.columnName),
    )?.columnName ??
    columns.find(c => c.dataTypeCanonical !== 'temporal' && c.dataTypeCanonical !== 'numeric')
      ?.columnName ??
    ''
  );
}

export function ensureKpiMeasures(prev: ReadonlyArray<MeasureRow>): MeasureRow[] {
  if (prev.length === 0) {
    return [{ id: uuidv4(), column: '*', op: 'count', alias: 'value' }];
  }
  return prev.map(m => ({ ...m, alias: 'value' }));
}

export function ensureKpiCompareMeasures(prev: ReadonlyArray<MeasureRow>): MeasureRow[] {
  if (prev.length === 0) {
    return [
      { id: uuidv4(), column: '*', op: 'count', alias: 'current' },
      { id: uuidv4(), column: '*', op: 'count', alias: 'previous' },
    ];
  }
  if (prev.length === 1) {
    return [
      { ...prev[0]!, alias: 'current' },
      { id: uuidv4(), column: '*', op: 'count', alias: 'previous' },
    ];
  }
  return prev.map((m, i) =>
    i === 0 ? { ...m, alias: 'current' } : i === 1 ? { ...m, alias: 'previous' } : m,
  );
}

export function ensureBarOrPieMeasures(prev: ReadonlyArray<MeasureRow>): MeasureRow[] {
  if (prev.length === 0) {
    return [{ id: uuidv4(), column: '*', op: 'count', alias: 'value' }];
  }
  return prev.map((m, i) => (i === 0 ? { ...m, alias: 'value' } : m));
}

export function ensureBarOrPieGroupBy(
  prev: ReadonlyArray<GroupByRow>,
  columns: ReadonlyArray<DataSourceColumn>,
): GroupByRow[] {
  if (prev.length === 0) {
    const col = pickDefaultLabelColumn(columns);
    return col ? [{ id: uuidv4(), column: col, alias: 'label' }] : [...prev];
  }
  return prev.map((g, i) => (i === 0 ? { ...g, alias: 'label' } : g));
}

export function ensureLineOrAreaMeasures(prev: ReadonlyArray<MeasureRow>): MeasureRow[] {
  if (prev.length === 0) {
    return [{ id: uuidv4(), column: '*', op: 'count', alias: 'y' }];
  }
  return prev.map((m, i) => (i === 0 ? { ...m, alias: 'y' } : m));
}

export function ensureScatterMeasures(
  prev: ReadonlyArray<MeasureRow>,
  columns: ReadonlyArray<DataSourceColumn>,
): MeasureRow[] {
  const firstNumeric = columns.find(c => c.dataTypeCanonical === 'numeric')?.columnName ?? '*';
  if (prev.length === 0) {
    return [
      { id: uuidv4(), column: firstNumeric, op: 'sum', alias: 'x' },
      { id: uuidv4(), column: firstNumeric, op: 'count', alias: 'y' },
    ];
  }
  if (prev.length === 1) {
    return [
      { ...prev[0]!, alias: 'x' },
      { id: uuidv4(), column: firstNumeric, op: 'count', alias: 'y' },
    ];
  }
  return prev.map((m, i) => (i === 0 ? { ...m, alias: 'x' } : i === 1 ? { ...m, alias: 'y' } : m));
}

export function ensureScatterGroupBy(
  prev: ReadonlyArray<GroupByRow>,
  columns: ReadonlyArray<DataSourceColumn>,
): GroupByRow[] {
  if (prev.length === 0) {
    const col = pickDefaultSeriesColumn(columns);
    return col ? [{ id: uuidv4(), column: col, alias: 'series' }] : [...prev];
  }
  return prev.map((g, i) => (i === 0 ? { ...g, alias: 'series' } : g));
}

export function ensureTimeBucketGroupBy(
  prev: ReadonlyArray<GroupByRow>,
  columns: ReadonlyArray<DataSourceColumn>,
): GroupByRow[] {
  if (prev.some(g => g.bucket)) return [...prev];
  const temporal = columns.find(c => c.dataTypeCanonical === 'temporal');
  if (!temporal) return [...prev];
  return [{ id: uuidv4(), column: temporal.columnName, alias: 'x', bucket: 'day' }];
}

export function defaultTableSelectCols(columns: ReadonlyArray<DataSourceColumn>): string[] {
  return columns.slice(0, 6).map(c => c.columnName);
}

export interface VisualTypeReshapeContext {
  columns: ReadonlyArray<DataSourceColumn>;
  wantsTimeBucket: boolean;
  selectColsLength: number;
}

export interface VisualTypeReshapeOps {
  setMeasures: (updater: (prev: MeasureRow[]) => MeasureRow[]) => void;
  setGroupBy: (updater: (prev: GroupByRow[]) => GroupByRow[]) => void;
  setSelectCols: (next: string[]) => void;
}

export function applyVisualTypeReshape(
  visualType: QueryVisualizationType,
  ctx: VisualTypeReshapeContext,
  ops: VisualTypeReshapeOps,
): void {
  switch (visualType) {
    case QueryVisualizationType.KPI:
      ops.setMeasures(ensureKpiMeasures);
      break;
    case QueryVisualizationType.KPI_COMPARE:
      ops.setMeasures(ensureKpiCompareMeasures);
      break;
    case QueryVisualizationType.BAR_CHART:
    case QueryVisualizationType.PIE_CHART:
      ops.setMeasures(ensureBarOrPieMeasures);
      ops.setGroupBy(prev => ensureBarOrPieGroupBy(prev, ctx.columns));
      break;
    case QueryVisualizationType.LINE_CHART:
    case QueryVisualizationType.AREA_CHART:
      ops.setMeasures(ensureLineOrAreaMeasures);
      break;
    case QueryVisualizationType.SCATTER_CHART:
      ops.setMeasures(prev => ensureScatterMeasures(prev, ctx.columns));
      ops.setGroupBy(prev => ensureScatterGroupBy(prev, ctx.columns));
      break;
    case QueryVisualizationType.DATA_TABLE:
      if (ctx.selectColsLength === 0 && ctx.columns.length > 0) {
        ops.setSelectCols(defaultTableSelectCols(ctx.columns));
      }
      break;
    default:
      break;
  }
  if (ctx.wantsTimeBucket) {
    ops.setGroupBy(prev => ensureTimeBucketGroupBy(prev, ctx.columns));
  }
}
