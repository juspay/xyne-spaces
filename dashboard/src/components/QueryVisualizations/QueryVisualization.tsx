import React, { useMemo } from 'react';
import { cn } from '../../utils/classNames';
import {
  QueryVisualizationType,
  analyzeQueryResults,
  transformToKPI,
  transformToBarChart,
  transformToPieChart,
  transformToLineChart,
  transformToFunnel,
  transformToHeatmap,
  transformToDataTable,
} from './types';
import { BarChart } from './BarChart';
import { PieChart } from './PieChart';
import { DonutChart } from './DonutChart';
import { LineChart } from './LineChart';
import { Funnel } from './Funnel';
import { Heatmap } from './Heatmap';
import { DataTable, type DataTableColumn } from './DataTable';
import { KPICard } from './KPICard';

interface QueryVisualizationProps {
  title: string;
  queryLabel?: string;
  data: Record<string, unknown>[] | null;
  isLoading?: boolean;
  error?: string | null;
  visualizationType?: QueryVisualizationType;
  onVisualizationTypeChange?: (type: QueryVisualizationType) => void;
  className?: string;
}

export const QueryVisualization: React.FC<QueryVisualizationProps> = ({
  title,
  queryLabel,
  data,
  isLoading = false,
  error,
  visualizationType: userPreference,
  className,
}) => {
  const visualizationType = useMemo(() => {
    if (isLoading || error) return QueryVisualizationType.DATA_TABLE;

    return analyzeQueryResults({ data, error: error === null ? undefined : error }, userPreference);
  }, [data, isLoading, error, userPreference]);

  if (isLoading) {
    return (
      <div
        className={cn(
          'rounded-xl border border-border/40 bg-gradient-to-br from-background to-background/95 p-8 shadow-lg',
          'backdrop-blur-sm',
          className,
        )}
      >
        <div className='flex items-center justify-center h-64'>
          <div className='flex flex-col items-center gap-3'>
            <div className='animate-spin'>
              <div className='w-8 h-8 border-4 border-gray-200 dark:border-gray-700 border-t-primary rounded-full' />
            </div>
            <span className='text-sm font-medium text-muted-foreground'>
              Loading visualization...
            </span>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={cn(
          'rounded-xl border border-red-200/50 dark:border-red-800/50 bg-gradient-to-br from-red-50/50 to-pink-50/50 dark:from-red-900/20 dark:to-pink-900/20 p-6 shadow-lg',
          'backdrop-blur-sm',
          className,
        )}
      >
        <h3 className='text-sm font-bold bg-gradient-to-r from-red-600 to-red-700 dark:from-red-400 dark:to-red-300 bg-clip-text text-transparent mb-2'>
          {title}
        </h3>
        <p className='text-sm text-red-700 dark:text-red-300 font-medium'>{error}</p>
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div
        className={cn(
          'rounded-xl border border-border/40 bg-gradient-to-br from-muted/30 to-muted/10 p-8 shadow-sm',
          'backdrop-blur-sm',
          className,
        )}
      >
        <div className='flex items-center justify-center h-64 text-muted-foreground'>
          <div className='text-center'>
            <p className='text-sm font-medium'>No data available for visualization</p>
          </div>
        </div>
      </div>
    );
  }

  // Render appropriate visualization
  switch (visualizationType) {
    case QueryVisualizationType.KPI: {
      const kpiData = transformToKPI(data);
      if (!kpiData) return null;

      return (
        <KPICard
          title={kpiData.label}
          value={kpiData.value}
          queryLabel={queryLabel ?? ''}
          className={className ?? ''}
        />
      );
    }

    case QueryVisualizationType.BAR_CHART: {
      const chartData = transformToBarChart(data);
      return (
        <BarChart
          title={title}
          data={chartData}
          queryLabel={queryLabel ?? ''}
          className={className ?? ''}
        />
      );
    }

    case QueryVisualizationType.PIE_CHART: {
      const chartData = transformToPieChart(data);
      return (
        <PieChart
          title={title}
          data={chartData}
          queryLabel={queryLabel ?? ''}
          className={className ?? ''}
        />
      );
    }

    case QueryVisualizationType.DONUT_CHART: {
      const chartData = transformToPieChart(data);
      return (
        <DonutChart
          title={title}
          data={chartData}
          queryLabel={queryLabel ?? ''}
          className={className ?? ''}
        />
      );
    }

    case QueryVisualizationType.LINE_CHART: {
      const chartData = transformToLineChart(data);
      return (
        <LineChart
          title={title}
          data={chartData}
          queryLabel={queryLabel ?? ''}
          className={className ?? ''}
        />
      );
    }

    case QueryVisualizationType.FUNNEL: {
      const funnelData = transformToFunnel(data);
      return (
        <Funnel
          title={title}
          data={funnelData}
          queryLabel={queryLabel ?? ''}
          className={className ?? ''}
        />
      );
    }

    case QueryVisualizationType.HEATMAP: {
      const heatmapData = transformToHeatmap(data);
      if (heatmapData.length === 0) {
        return (
          <DataTable
            title={title}
            columns={
              data.length > 0
                ? Object.keys(data[0] || {}).map(key => ({
                    key,
                    label: key,
                  }))
                : []
            }
            rows={data}
            queryLabel={queryLabel ?? ''}
            className={className ?? ''}
          />
        );
      }
      return (
        <Heatmap
          title={title}
          data={heatmapData}
          queryLabel={queryLabel ?? ''}
          className={className ?? ''}
        />
      );
    }

    case QueryVisualizationType.DATA_TABLE:
    default: {
      const { columns, rows } = transformToDataTable(data);
      const tableColumns: DataTableColumn[] = columns.map(col => ({
        key: col,
        label: col,
        sortable: true,
      }));

      return (
        <DataTable
          title={title}
          columns={tableColumns}
          rows={rows}
          queryLabel={queryLabel ?? ''}
          className={className ?? ''}
        />
      );
    }
  }
};

export default QueryVisualization;
