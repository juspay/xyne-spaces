import React, { useMemo, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import type { MetricConfig } from '../../types/toolOutput';
import {
  formatMetricValue,
  formatMetricAxisValue,
  snakeToTitle,
  processBarData,
  PIE_COLORS,
  escapeHtml,
} from './chartUtils';

type ChartType = 'bar' | 'pie';
type GranularityOption = 'top5' | 'top10';

export interface VolumeChartProps {
  rawData: Array<Record<string, string | number>>;
  groupKey: string;
  selectedMetrics: MetricConfig;
  defaultChartType?: ChartType;
  showToggle?: boolean;
  title?: string;
  className?: string;
  isMobile?: boolean;
}

const BLUE = '#1B85FF';

const VolumeChart: React.FC<VolumeChartProps> = ({
  rawData,
  groupKey,
  selectedMetrics,
  defaultChartType = 'bar',
  showToggle = true,
  title,
  className,
  isMobile = false,
}) => {
  const [chartType, setChartType] = useState<ChartType>(defaultChartType);
  const [granularity, setGranularity] = useState<GranularityOption>('top5');
  const limit = granularity === 'top5' ? 5 : 10;

  const processed = useMemo(
    () => processBarData(rawData, groupKey, selectedMetrics.metric_name_db, limit),
    [rawData, groupKey, selectedMetrics.metric_name_db, limit],
  );

  const metricType = selectedMetrics.metric_type;
  const metricLabel =
    title || selectedMetrics.metric_label || snakeToTitle(selectedMetrics.metric_name_db);

  const barOption = useMemo(() => {
    if (!processed.length) return null;
    const names = processed.map(d => d.name);
    const values = processed.map(d => d.value);

    return {
      grid: { left: isMobile ? 80 : 100, right: 40, top: 20, bottom: 20, containLabel: false },
      tooltip: {
        trigger: 'item',
        backgroundColor: '#fff',
        borderColor: '#e5e7eb',
        borderWidth: 1,
        formatter: (p: { name: string; value: number }) => {
          const fv = escapeHtml(formatMetricValue(metricType, p.value));
          const name = escapeHtml(p.name);
          return `<div style="padding:6px 10px;">
            <div style="font-weight:600;color:#374151;margin-bottom:4px;font-size:12px;">${name}</div>
            <div style="display:flex;align-items:baseline;gap:6px;">
              <span style="font-size:14px;font-weight:600;color:#111827;background:#F3F4F6;padding:2px 6px;border-radius:4px;">${fv}</span>
              <span style="color:#6B7280;font-size:11px;">Total Volume</span>
            </div>
          </div>`;
        },
      },
      xAxis: {
        type: 'value',
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
  }, [processed, metricType, metricLabel, isMobile]);

  const pieOption = useMemo(() => {
    if (!processed.length) return null;
    return {
      tooltip: {
        trigger: 'item',
        backgroundColor: '#fff',
        borderColor: '#e5e7eb',
        borderWidth: 1,
        formatter: (p: { name: string; value: number; percent: number; color: string }) => {
          const fv = escapeHtml(formatMetricValue(metricType, p.value));
          const name = escapeHtml(p.name);
          const label = escapeHtml(metricLabel);
          return `<div style="padding:6px 10px;">
            <div style="font-weight:600;color:#374151;margin-bottom:4px;font-size:12px;">${name}</div>
            <div style="display:flex;align-items:baseline;gap:6px;">
              <span style="font-size:14px;font-weight:600;color:#111827;background:#F3F4F6;padding:2px 6px;border-radius:4px;">${p.percent.toFixed(0)}% (${fv})</span>
              <span style="color:#6B7280;font-size:11px;">${label}</span>
            </div>
          </div>`;
        },
      },
      legend: {
        type: 'scroll',
        orient: 'horizontal',
        bottom: 0,
        left: 'center',
        textStyle: { fontSize: 12, color: '#4B5563' },
        itemWidth: 16,
        itemHeight: 16,
        icon: 'circle',
      },
      series: [
        {
          name: metricLabel,
          type: 'pie',
          radius: ['40%', '70%'],
          center: ['50%', '45%'],
          data: processed.map((d, i) => ({
            name: d.name,
            value: d.value,
            itemStyle: { color: PIE_COLORS[i % PIE_COLORS.length] },
          })),
          label: { show: false },
          emphasis: {
            label: { show: false },
            itemStyle: { shadowBlur: 10, shadowOffsetX: 0, shadowColor: 'rgba(0,0,0,0.2)' },
          },
        },
      ],
    };
  }, [processed, metricType, metricLabel]);

  if (!processed.length) {
    return (
      <div className='flex items-center justify-center h-32 text-sm text-muted-foreground'>
        No data available
      </div>
    );
  }

  const activeOption = chartType === 'pie' ? pieOption : barOption;
  if (!activeOption) return null;

  return (
    <div
      className={`rounded-xl border border-border bg-card p-4${className ? ` ${className}` : ''}`}
    >
      <div className='flex items-center justify-between mb-2'>
        <select
          value={granularity}
          onChange={e => setGranularity(e.target.value as GranularityOption)}
          className='text-xs border border-border rounded px-2 py-1 bg-background text-foreground'
          data-track-category='Charts'
          data-track-name='VOLUME_CHART_GRANULARITY_CHANGE'
        >
          <option value='top5'>Top 5</option>
          <option value='top10'>Top 10</option>
        </select>

        {showToggle && (
          <div className='flex items-center border border-border rounded overflow-hidden text-xs'>
            <button
              onClick={() => setChartType('bar')}
              data-track-category='Charts'
              data-track-name='VOLUME_CHART_TOGGLE_BAR'
              className={`px-3 py-1 transition-colors ${
                chartType === 'bar'
                  ? 'bg-muted text-foreground font-semibold'
                  : 'text-muted-foreground hover:bg-muted/50'
              }`}
            >
              Bar
            </button>
            <button
              onClick={() => setChartType('pie')}
              data-track-category='Charts'
              data-track-name='VOLUME_CHART_TOGGLE_PIE'
              className={`px-3 py-1 transition-colors ${
                chartType === 'pie'
                  ? 'bg-muted text-foreground font-semibold'
                  : 'text-muted-foreground hover:bg-muted/50'
              }`}
            >
              Pie
            </button>
          </div>
        )}
      </div>

      <ReactECharts
        option={activeOption}
        style={{ height: isMobile ? 300 : 360, width: '100%' }}
        notMerge
        lazyUpdate
      />
    </div>
  );
};

export default VolumeChart;
