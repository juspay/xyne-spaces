import { memo, type ReactElement } from 'react';
import Svg, { G, Path, Polyline, Text as SvgText } from 'react-native-svg';

import {
  compactChartValue,
  pivotChartSeries,
  type ChartSeriesPoint,
} from '@/src/utils/flowChartUtils';

import { seriesColor } from './FlowChartColors';

export const FlowLineAreaChart = memo(function FlowLineAreaChart({
  series,
  kind,
  width,
  height,
  mutedColor,
  borderColor,
}: {
  series: ChartSeriesPoint[];
  kind: 'line' | 'area';
  width: number;
  height: number;
  mutedColor: string;
  borderColor: string;
}): ReactElement {
  const { data, names } = pivotChartSeries(series);
  const padTop = 12;
  const padBottom = 28;
  const padLeft = 36;
  const padRight = 8;
  const chartH = Math.max(40, height - padTop - padBottom);
  const chartW = Math.max(40, width - padLeft - padRight);
  const values = data.flatMap(row =>
    names.map(name => {
      const value = row[name];
      return typeof value === 'number' ? value : 0;
    }),
  );
  const maxY = Math.max(...values, 1);
  const minY = Math.min(0, ...values);
  const range = maxY - minY || 1;
  const xAt = (index: number): number =>
    data.length <= 1 ? padLeft + chartW / 2 : padLeft + (index / (data.length - 1)) * chartW;
  const yAt = (value: number): number => padTop + chartH - ((value - minY) / range) * chartH;

  return (
    <Svg width={width} height={height}>
      {[0.25, 0.5, 0.75, 1].map(fraction => {
        const y = padTop + chartH * (1 - fraction);
        return (
          <Path
            key={fraction}
            d={`M ${padLeft} ${y} H ${width - padRight}`}
            stroke={borderColor}
            strokeDasharray='3 3'
            strokeWidth={1}
          />
        );
      })}
      <SvgText x={4} y={padTop + 4} fill={mutedColor} fontSize={10}>
        {compactChartValue(maxY)}
      </SvgText>
      <SvgText x={4} y={padTop + chartH} fill={mutedColor} fontSize={10}>
        {compactChartValue(minY)}
      </SvgText>

      {names.map((name, seriesIndex) => {
        const points = data
          .map((row, index) => {
            const value = row[name];
            if (typeof value !== 'number') return null;
            return `${xAt(index)},${yAt(value)}`;
          })
          .filter((point): point is string => point !== null);
        if (points.length === 0) return null;
        const color = seriesColor(seriesIndex);
        const polyline = points.join(' ');
        return (
          <G key={name}>
            {kind === 'area' && points.length > 1 ? (
              <Path
                d={`M ${points[0]} L ${points.slice(1).join(' L ')} L ${xAt(data.length - 1)},${yAt(minY)} L ${xAt(0)},${yAt(minY)} Z`}
                fill={color}
                opacity={0.2}
              />
            ) : null}
            <Polyline points={polyline} fill='none' stroke={color} strokeWidth={2} />
          </G>
        );
      })}

      {data.map((row, index) => {
        const show =
          data.length <= 6 || index === 0 || index === data.length - 1 || index % 2 === 0;
        if (!show) return null;
        const label = String(row['x'] ?? '');
        const truncated = label.length > 8 ? `${label.slice(0, 7)}…` : label;
        return (
          <SvgText
            key={`x-${index}`}
            x={xAt(index)}
            y={height - 8}
            fill={mutedColor}
            fontSize={10}
            textAnchor='middle'
          >
            {truncated}
          </SvgText>
        );
      })}
    </Svg>
  );
});
FlowLineAreaChart.displayName = 'FlowLineAreaChart';
