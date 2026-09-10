import React, { useMemo, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import type { MetricConfig } from '../../types/toolOutput';
import {
  formatMetricValue,
  formatMetricAxisValue,
  snakeToTitle,
  processBarData,
  escapeHtml,
} from './chartUtils';

type GranularityOption = 'top5' | 'top10';

export interface BarChart1DProps {
  rawData: Array<Record<string, string | number>>;
  groupKey: string;
  selectedMetrics: MetricConfig;
  isHorizontalBar?: boolean;
  className?: string;
  showGranularityControl?: boolean;
  isMobile?: boolean;
}

const BLUE = '#1B85FF';

const BarChart1D: React.FC<BarChart1DProps> = ({
  rawData,
  groupKey,
  selectedMetrics,
  isHorizontalBar = true,
  className,
  showGranularityControl = true,
  isMobile = false,
}) => {
  const [granularity, setGranularity] = useState<GranularityOption>('top5');
  const limit = granularity === 'top5' ? 5 : 10;

  const processed = useMemo(
    () => processBarData(rawData, groupKey, selectedMetrics.metric_name_db, limit),
    [rawData, groupKey, selectedMetrics.metric_name_db, limit],
  );

  const chartOption = useMemo(() => {
    if (!processed.length) return null;

    const names = processed.map(d => d.name);
    const values = processed.map(d => d.value);
    const metricType = selectedMetrics.metric_type;
    const metricLabel =
      selectedMetrics.metric_label || snakeToTitle(selectedMetrics.metric_name_db);

    const commonTooltip = {
      trigger: 'item',
      backgroundColor: '#fff',
      borderColor: '#e5e7eb',
      borderWidth: 1,
      formatter: (p: { name: string; value: number }) => {
        const fv = escapeHtml(formatMetricValue(metricType, p.value));
        const name = escapeHtml(p.name);
        const label = escapeHtml(metricLabel);
        return `<div style="padding:6px 10px;">
          <div style="font-weight:600;color:#374151;margin-bottom:4px;font-size:12px;">${name}</div>
          <div style="display:flex;align-items:baseline;gap:6px;">
            <span style="font-size:14px;font-weight:600;color:#111827;background:#F3F4F6;padding:2px 6px;border-radius:4px;">${fv}</span>
            <span style="color:#6B7280;font-size:11px;">${label}</span>
          </div>
        </div>`;
      },
    };

    if (isHorizontalBar) {
      return {
        grid: { left: isMobile ? 80 : 100, right: 40, top: 20, bottom: 20, containLabel: false },
        tooltip: commonTooltip,
        xAxis: {
          type: 'value',
          max: metricType === 'Rate' ? 100 : undefined,
          axisLabel: {
            color: '#666',
            fontSize: 11,
            formatter: (v: number) => formatMetricAxisValue(metricType, v),
          },
          splitLine: { lineStyle: { color: '#DDE3EE', type: 'dot' } },
        },
        yAxis: {
          type: 'category',
          data: [...names].reverse(),
          axisLabel: {
            color: '#666',
            fontSize: isMobile ? 11 : 12,
            width: isMobile ? 70 : 95,
            overflow: 'truncate',
          },
          splitLine: { show: false },
          axisTick: { show: false },
        },
        series: [
          {
            name: metricLabel,
            type: 'bar',
            data: [...values].reverse(),
            itemStyle: { color: BLUE, borderRadius: [0, 3, 3, 0] },
            barMaxWidth: 24,
          },
        ],
      };
    }

    return {
      grid: { left: 48, right: 16, top: 20, bottom: isMobile ? 60 : 48, containLabel: false },
      tooltip: commonTooltip,
      xAxis: {
        type: 'category',
        data: names,
        axisLabel: {
          color: '#666',
          fontSize: isMobile ? 11 : 12,
          interval: 0,
          rotate: names.length > 5 ? 30 : 0,
          width: isMobile ? 60 : 80,
          overflow: 'truncate',
        },
        splitLine: { show: false },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        max: metricType === 'Rate' ? 100 : undefined,
        axisLabel: {
          color: '#666',
          fontSize: 11,
          formatter: (v: number) => formatMetricAxisValue(metricType, v),
        },
        splitLine: { lineStyle: { color: '#DDE3EE', type: 'dot' } },
      },
      series: [
        {
          name: metricLabel,
          type: 'bar',
          data: values,
          itemStyle: { color: BLUE, borderRadius: [3, 3, 0, 0] },
          barMaxWidth: 40,
        },
      ],
    };
  }, [processed, selectedMetrics, isHorizontalBar, isMobile]);

  if (!chartOption || !processed.length) {
    return (
      <div className='flex items-center justify-center h-32 text-sm text-muted-foreground'>
        No data available
      </div>
    );
  }

  return (
    <div className={className}>
      {showGranularityControl && (
        <div className='flex justify-end mb-2'>
          <select
            value={granularity}
            onChange={e => setGranularity(e.target.value as GranularityOption)}
            className='text-xs border border-border rounded px-2 py-1 bg-background text-foreground'
            data-track-category='Charts'
            data-track-name='BAR_CHART_GRANULARITY_CHANGE'
          >
            <option value='top5'>Top 5</option>
            <option value='top10'>Top 10</option>
          </select>
        </div>
      )}
      <ReactECharts
        option={chartOption}
        style={{ height: isMobile ? 300 : 380, width: '100%' }}
        notMerge
        lazyUpdate
      />
    </div>
  );
};

export default BarChart1D;
