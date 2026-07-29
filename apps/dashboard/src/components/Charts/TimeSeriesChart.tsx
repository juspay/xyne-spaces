import React, { useMemo, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import type {
  ChartDataPoint,
  GroupbyConfig,
  MetricConfig,
  CardinalityOption,
} from '../../types/toolOutput';
import {
  formatMetricValue,
  formatMetricAxisValue,
  getCardinalityNumber,
  getTopGroups,
  processTimeSeriesData,
  CHART_COLORS,
  escapeHtml,
} from './chartUtils';

type GranularityOption = 'top5' | 'top10';

const CARDINALITY_MAP: Record<GranularityOption, CardinalityOption> = {
  top5: 'TOP_5',
  top10: 'TOP_10',
};

export interface TimeSeriesChartProps {
  options?: object;
  rawChartData?: ChartDataPoint[];
  groupbyConfig?: GroupbyConfig;
  selectedMetrics?: MetricConfig;
  enableGroupby?: boolean;
  showCardinalityControl?: boolean;
  dimensionLabelMapper?: (label: string) => string;
  isMobile?: boolean;
  isExpanded?: boolean;
  className?: string;
}

const TimeSeriesChart: React.FC<TimeSeriesChartProps> = ({
  rawChartData = [],
  groupbyConfig,
  selectedMetrics,
  enableGroupby = false,
  showCardinalityControl = false,
  dimensionLabelMapper,
  isMobile = false,
  className,
}) => {
  const [granularity, setGranularity] = useState<GranularityOption>('top5');

  const chartOption = useMemo(() => {
    if (!enableGroupby || !rawChartData.length || !groupbyConfig) {
      return null;
    }

    const {
      groupbyKeys,
      timeColumn,
      metricColumns,
      cardinality = 'TOP_5',
      showCardinality = true,
    } = groupbyConfig;

    const activeCardinality = showCardinalityControl ? CARDINALITY_MAP[granularity] : cardinality;
    const limit = getCardinalityNumber(activeCardinality);

    let filteredData = rawChartData;
    const primaryKey = groupbyKeys[0];
    if (showCardinality && primaryKey) {
      const topGroups = getTopGroups(rawChartData, primaryKey, metricColumns, limit);
      filteredData = rawChartData.filter(row => topGroups.includes(String(row[primaryKey] ?? '')));
    }

    const topGroups = primaryKey
      ? getTopGroups(filteredData, primaryKey, metricColumns, limit)
      : [];

    const { categories, series } = processTimeSeriesData(
      filteredData,
      timeColumn,
      groupbyKeys,
      metricColumns,
      topGroups,
      dimensionLabelMapper,
    );

    const metricType = selectedMetrics?.metric_type ?? 'Count';

    return {
      color: CHART_COLORS,
      grid: { left: 48, right: 16, top: 32, bottom: isMobile ? 60 : 48, containLabel: false },
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#fff',
        borderColor: '#EAECF0',
        borderWidth: 1,
        textStyle: { fontSize: 12, fontFamily: 'Inter, sans-serif', color: '#374151' },
        formatter: (params: { seriesName: string; value: number; axisValue: string }[]) => {
          if (!params || !params.length || !params[0]) return '';
          const date = escapeHtml(params[0].axisValue);
          let html = `<div style="padding:4px 0 8px;font-weight:600;color:#374151;font-size:12px;">${date}</div>`;
          params.forEach(p => {
            const formatted = escapeHtml(formatMetricValue(metricType, p.value));
            const seriesName = escapeHtml(p.seriesName.toUpperCase());
            html += `<div style="display:flex;align-items:center;gap:8px;margin-top:4px;">
              <span style="font-weight:600;background:#D4F4E5;color:#008242;padding:2px 6px;border-radius:4px;font-size:12px;">${formatted}</span>
              <span style="color:#70747E;font-size:12px;">${seriesName}</span>
            </div>`;
          });
          return html;
        },
      },
      legend: {
        type: 'scroll',
        bottom: 0,
        left: 0,
        textStyle: { fontSize: 12, color: '#374151' },
        itemWidth: 12,
        itemHeight: 12,
        icon: 'roundRect',
        pageTextStyle: { fontSize: 11 },
      },
      xAxis: {
        type: 'category',
        data: categories,
        axisLabel: {
          color: '#9aa0a6',
          fontSize: 10,
          rotate: isMobile ? 30 : 0,
          interval: (() => {
            const n = categories.length;
            if (n <= 6) return 0;
            if (n <= 12) return 1;
            if (n <= 24) return 2;
            if (n <= 48) return Math.floor(n / 8) - 1;
            return Math.floor(n / 6) - 1;
          })(),
        },
        axisLine: { lineStyle: { color: '#e5e7eb' } },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        max: metricType === 'Rate' ? 100 : undefined,
        axisLabel: {
          color: '#9aa0a6',
          fontSize: 10,
          formatter: (value: number) => formatMetricAxisValue(metricType, value),
        },
        splitLine: { lineStyle: { color: '#e5e5e5', type: 'dashed' } },
        axisLine: { show: false },
      },
      series: series.map(s => ({
        name: s.name,
        type: 'line',
        data: s.data,
        color: s.color,
        smooth: false,
        connectNulls: true,
        symbol: 'none',
        lineStyle: { width: 2 },
        emphasis: { focus: 'series' },
      })),
    };
  }, [
    rawChartData,
    groupbyConfig,
    selectedMetrics,
    enableGroupby,
    showCardinalityControl,
    granularity,
    dimensionLabelMapper,
    isMobile,
  ]);

  if (!chartOption) return null;

  return (
    <div className={className}>
      {showCardinalityControl && enableGroupby && groupbyConfig?.groupbyKeys.length && (
        <div className='flex justify-end mb-2'>
          <select
            value={granularity}
            onChange={e => setGranularity(e.target.value as GranularityOption)}
            className='text-xs border border-border rounded px-2 py-1 bg-background text-foreground'
            data-track-category='Charts'
            data-track-name='TIME_SERIES_CARDINALITY_CHANGE'
          >
            <option value='top5'>Top 5</option>
            <option value='top10'>Top 10</option>
          </select>
        </div>
      )}
      <ReactECharts
        option={chartOption}
        style={{ height: isMobile ? 280 : 340, width: '100%' }}
        notMerge
        lazyUpdate
      />
    </div>
  );
};

export default TimeSeriesChart;
