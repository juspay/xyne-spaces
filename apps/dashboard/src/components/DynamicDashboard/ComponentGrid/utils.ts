import { QueryVisualizationType } from '@xyne/shared';
import type { ComponentDataError } from '../../../services/DynamicDashboard/componentDataService';

export const VISUAL_TYPE_LABELS: Record<QueryVisualizationType, string> = {
  [QueryVisualizationType.KPI]: 'kpi',
  [QueryVisualizationType.KPI_COMPARE]: 'kpi compare',
  [QueryVisualizationType.BAR_CHART]: 'bar',
  [QueryVisualizationType.PIE_CHART]: 'pie',
  [QueryVisualizationType.DONUT_CHART]: 'donut',
  [QueryVisualizationType.LINE_CHART]: 'line',
  [QueryVisualizationType.AREA_CHART]: 'area',
  [QueryVisualizationType.SCATTER_CHART]: 'scatter',
  [QueryVisualizationType.DATA_TABLE]: 'table',
  [QueryVisualizationType.FUNNEL]: 'funnel',
  [QueryVisualizationType.HEATMAP]: 'heatmap',
};

export function untitledFor(visualType: QueryVisualizationType | null): string {
  if (visualType === null) return 'Untitled';
  return `Untitled ${VISUAL_TYPE_LABELS[visualType]}`;
}

export function isVisualType(v: unknown): v is QueryVisualizationType {
  return typeof v === 'string' && (Object.values(QueryVisualizationType) as string[]).includes(v);
}

export function formatFetchError(err: ComponentDataError): string {
  if (err.status === 422 && err.details?.issues?.length) {
    const first = err.details.issues[0];
    return `${err.message}: at ${(first?.path ?? []).join('.') || '<root>'} — ${first?.message}`;
  }
  return err.message;
}
