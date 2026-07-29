/**
 * Query Visualization Types and Helpers
 * Determines the best visualization for query results
 */

import { QueryVisualizationType as SharedQueryVisualizationType } from '@xyne/shared';
import {
  formatReferenceDisplayValue,
  formatUnknownValue,
  type ReferenceLabels,
} from '../../utils/referenceLabelUtils';

export type { ReferenceLabels };

// Re-export the shared enum as the default export
export const QueryVisualizationType = SharedQueryVisualizationType;
export type QueryVisualizationType =
  (typeof SharedQueryVisualizationType)[keyof typeof SharedQueryVisualizationType];

export interface QueryResult {
  data: Record<string, unknown>[] | null;
  error?: string | undefined;
}

/**
 * Analyzes query results and returns the recommended visualization type
 */
export function analyzeQueryResults(
  results: QueryResult,
  userPreference?: QueryVisualizationType,
): QueryVisualizationType {
  if (userPreference) {
    return userPreference;
  }

  if (!results.data || results.data.length === 0) {
    return QueryVisualizationType.DATA_TABLE;
  }

  // Single value = KPI
  if (results.data.length === 1 && Object.keys(results.data[0] || {}).length === 1) {
    return QueryVisualizationType.KPI;
  }

  // Check data structure for patterns
  const firstRow = results.data[0] || {};
  const keys = Object.keys(firstRow);

  // If we have exactly 2 columns and one is numeric, it's likely for a chart
  if (keys.length === 2) {
    const values = results.data.map(row => Object.values(row));
    const hasNumericSecondColumn = values.every(
      v => v[1] !== null && v[1] !== undefined && !isNaN(Number(v[1])),
    );

    if (hasNumericSecondColumn) {
      // Check if this looks like a series (many rows with same pattern)
      if (results.data.length > 10) {
        return QueryVisualizationType.LINE_CHART; // Time series
      }
      return QueryVisualizationType.BAR_CHART;
    }
  }

  // If we have 3 columns and all numeric, it might be a heatmap
  if (keys.length === 3) {
    const allNumeric = results.data.every(row => keys.slice(1).every(k => !isNaN(Number(row[k]))));
    if (allNumeric && results.data.length > 9) {
      return QueryVisualizationType.HEATMAP;
    }
  }

  // Check for funnel pattern (decreasing values)
  const dataArray = results.data;
  if (keys.length === 2 && dataArray && dataArray.length > 2 && dataArray.length < 10) {
    const key1 = keys[1];
    if (key1 === undefined) return QueryVisualizationType.DATA_TABLE;

    const isDecreasing = dataArray.every((row, i) => {
      if (i === 0) return true;
      const current = Number(row[key1]);
      const previous = Number(dataArray[i - 1]?.[key1]);
      return current <= previous;
    });
    if (isDecreasing) {
      return QueryVisualizationType.FUNNEL;
    }
  }

  // Default to data table for complex data
  return QueryVisualizationType.DATA_TABLE;
}

/**
 * Transforms data for KPI display
 */
export function transformToKPI(data: Record<string, unknown>[]): {
  value: string | number;
  label: string;
} | null {
  if (!data || data.length === 0) return null;
  if (data.length !== 1) return null;

  const row = data[0];
  if (!row) return null;
  const keys = Object.keys(row);
  if (keys.length !== 1) return null;

  const key = keys[0];
  if (!key) return null;
  const value = row[key];
  return {
    value: String(value) || '',
    label: key,
  };
}

function resolveDimensionLabel(
  fieldKey: string,
  value: unknown,
  referenceLabels?: ReferenceLabels,
): string {
  const { display } = formatReferenceDisplayValue(fieldKey, value, referenceLabels);
  return display || formatUnknownValue(value);
}

/**
 * Transforms data for bar chart
 */
export function transformToBarChart(
  data: Record<string, unknown>[],
  referenceLabels?: ReferenceLabels,
) {
  if (!data || data.length === 0) return [];

  const firstRow = data[0];
  if (!firstRow) return [];
  const keys = Object.keys(firstRow);
  if (keys.length < 2) return [];

  const key0 = keys[0];
  const key1 = keys[1];
  if (!key0 || !key1) return [];

  return data.map(row => ({
    label: resolveDimensionLabel(key0, row[key0], referenceLabels),
    value: Number(row[key1]) || 0,
  }));
}

/**
 * Transforms data for pie/donut chart
 */
export function transformToPieChart(
  data: Record<string, unknown>[],
  referenceLabels?: ReferenceLabels,
) {
  return transformToBarChart(data, referenceLabels).map(item => ({
    ...item,
    label: item.label.length > 15 ? item.label.substring(0, 15) + '...' : item.label,
  }));
}

/**
 * Transforms data for line chart
 */
export function transformToLineChart(
  data: Record<string, unknown>[],
  referenceLabels?: ReferenceLabels,
) {
  return transformToBarChart(data, referenceLabels);
}

/**
 * Transforms data for funnel
 */
export function transformToFunnel(
  data: Record<string, unknown>[],
  referenceLabels?: ReferenceLabels,
) {
  return transformToBarChart(data, referenceLabels);
}

/**
 * Transforms data for heatmap
 */
export function transformToHeatmap(
  data: Record<string, unknown>[],
  referenceLabels?: ReferenceLabels,
): Array<{
  x: string | number;
  y: string | number;
  value: number;
}> {
  if (!data || data.length === 0) return [];

  const firstRow = data[0];
  if (!firstRow) return [];
  const keys = Object.keys(firstRow);
  if (keys.length < 2) return [];

  const key0 = keys[0];
  const key1 = keys[1];
  if (!key0 || !key1) return [];

  if (keys.length >= 3) {
    const key2 = keys[2];
    if (!key2) return [];
    return data.map(row => ({
      x: resolveDimensionLabel(key0, row[key0], referenceLabels),
      y: resolveDimensionLabel(key1, row[key1], referenceLabels),
      value: Number(row[key2]) || 0,
    }));
  }

  return data.map((row, index) => ({
    x: resolveDimensionLabel(key0, row[key0], referenceLabels),
    y: `Row ${index + 1}`,
    value: Number(row[key1]) || 0,
  }));
}

/**
 * Transforms data for data table
 */
export function transformToDataTable(data: Record<string, unknown>[]): {
  columns: string[];
  rows: Record<string, unknown>[];
} {
  if (!data || data.length === 0) {
    return { columns: [], rows: [] };
  }

  const columns = Object.keys(data[0] || {});
  return { columns, rows: data };
}
