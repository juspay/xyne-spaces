/**
 * Unified Bot Framework - Tool Output Transformer
 *
 * Transforms API responses into the unified ToolOutput format.
 * Different external APIs return data in different formats, so this
 * provides a pluggable way to transform them into charts/tables.
 */

import type { ToolOutput } from '../types/index.js';

/**
 * Tool Output Transformer interface
 */
export interface IToolOutputTransformer {
  /**
   * Transform API response data to ToolOutput format
   * @param data - The parsed API response data
   * @param inputString - The original input string (for description)
   * @param toolName - The tool name that produced this output
   * @returns ToolOutput or null if data can't be transformed
   */
  transform(data: unknown, inputString?: string, toolName?: string): ToolOutput | null;
}

/**
 * Base Tool Output Transformer
 * Provides common transformation logic
 */
export class BaseToolOutputTransformer implements IToolOutputTransformer {
  /**
   * Transform data to ToolOutput
   */
  transform(data: unknown, inputString?: string, _toolName?: string): ToolOutput | null {
    // Must be array data
    if (!Array.isArray(data) || data.length === 0) {
      return null;
    }

    const id = this.generateId();
    const description = this.parseDescription(inputString) || 'Query results';

    // Check if this is time series data
    const firstRow = data[0] as Record<string, unknown>;
    const keys = Object.keys(firstRow);

    const timeKey = keys.find(
      (key) => key.toLowerCase().includes('time') || key.toLowerCase().includes('date')
    );
    const metricKeys = keys.filter(
      (key) => !key.toLowerCase().includes('time') && !key.toLowerCase().includes('date')
    );

    if (timeKey && metricKeys.length > 0) {
      return this.transformToChart(data, timeKey, metricKeys, id, description);
    }

    // Non-time series - render as table
    return {
      id,
      description,
      tableData: data as Array<Record<string, string | number>>,
    };
  }

  /**
   * Transform time series data to chart format
   */
  protected transformToChart(
    data: unknown[],
    timeKey: string,
    metricKeys: string[],
    id: string,
    description: string
  ): ToolOutput {
    // Sort by time
    const sortedData = [...data].sort((a, b) => {
      const aVal = String((a as Record<string, unknown>)[timeKey]);
      const bVal = String((b as Record<string, unknown>)[timeKey]);
      return aVal.localeCompare(bVal);
    });

    // Extract categories (x-axis values)
    const categories = sortedData.map((row) => {
      const timeValue = String((row as Record<string, unknown>)[timeKey]);
      try {
        const date = new Date(timeValue);
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      } catch {
        return timeValue.split(' ')[0];
      }
    });

    // Build series
    const series = metricKeys.map((metric) => ({
      name: metric.replace(/_/g, ' '),
      data: sortedData.map((row) => Number((row as Record<string, unknown>)[metric]) || 0),
      type: 'line' as const,
    }));

    // Create DirectHighchartsResponse format
    const directChartData = {
      chart: { type: 'line' },
      title: { text: metricKeys.map((m) => m.replace(/_/g, ' ')).join(', ') + ' Trend' },
      xAxis: {
        categories,
        title: { text: '' },
      },
      yAxis: {
        title: { text: metricKeys[0]?.replace(/_/g, ' ') || 'Value' },
        min: 0,
      },
      series,
      tooltip: {
        valueSuffix: metricKeys[0]?.toLowerCase().includes('rate') ? '%' : '',
      },
    };

    return {
      id,
      description,
      directChartData,
      tableData: sortedData as Array<Record<string, string | number>>,
    };
  }

  /**
   * Generate unique ID for the tool output
   */
  protected generateId(): string {
    return `output-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Parse input string to generate description
   */
  protected parseDescription(inputString?: string): string | null {
    if (!inputString) return null;

    try {
      const input = JSON.parse(inputString);
      return input.query || input.question || input.message || null;
    } catch {
      return inputString.length < 100 ? inputString : null;
    }
  }
}

/**
 * Genius Tool Output Transformer
 * Handles Genius API q_api output format
 */
export class GeniusToolOutputTransformer extends BaseToolOutputTransformer {
  /**
   * Transform Genius q_api output to ToolOutput
   */
  override transform(data: unknown, inputString?: string, _toolName?: string): ToolOutput | null {
    // Call base transformation
    const result = super.transform(data, inputString);

    if (!result) return null;

    // Add Genius-specific enhancements
    // For example, detect single stat outputs
    if (Array.isArray(data) && data.length === 1) {
      const row = data[0] as Record<string, unknown>;
      const keys = Object.keys(row);

      // Single row with one metric - could be a single stat
      if (keys.length === 1 || keys.length === 2) {
        const metricKey = keys.find((k) => !k.toLowerCase().includes('time')) || keys[0];
        const value = row[metricKey];

        if (typeof value === 'number' || typeof value === 'string') {
          // Return a new object with singleStat added (since ToolOutput is readonly)
          return {
            ...result,
            singleStat: {
              metric: metricKey.replace(/_/g, ' '),
              value,
            },
          };
        }
      }
    }

    return result;
  }

  /**
   * Generate Genius-specific ID
   */
  protected override generateId(): string {
    return `genius-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

/**
 * Tool Output Transformer registry
 */
class ToolOutputTransformerRegistry {
  private transformers = new Map<string, IToolOutputTransformer>();

  constructor() {
    // Register default transformers
    this.register('default', new BaseToolOutputTransformer());
    this.register('genius', new GeniusToolOutputTransformer());
  }

  /**
   * Register a transformer for a specific format
   */
  register(format: string, transformer: IToolOutputTransformer): void {
    this.transformers.set(format, transformer);
  }

  /**
   * Get a transformer for a format
   */
  get(format: string): IToolOutputTransformer {
    return this.transformers.get(format) || this.transformers.get('default')!;
  }

  /**
   * Check if a format is registered
   */
  has(format: string): boolean {
    return this.transformers.has(format);
  }
}

// Export singleton registry
export const toolOutputTransformerRegistry = new ToolOutputTransformerRegistry();
