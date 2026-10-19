import { memo, type ReactElement } from 'react';
import { Text, View } from 'react-native';
import Svg, { Circle, G, Path, Rect, Text as SvgText } from 'react-native-svg';

import { compactChartValue, type ChartPoint } from '@/src/utils/flowChartUtils';

import { seriesColor } from './FlowChartColors';

export const FlowChartLegend = memo(function FlowChartLegend({
  items,
  mutedColor,
}: {
  items: ReadonlyArray<{ label: string; color: string }>;
  mutedColor: string;
}): ReactElement | null {
  if (items.length === 0) return null;
  return (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        paddingHorizontal: 4,
        paddingBottom: 4,
      }}
    >
      {items.map((item, index) => (
        <View
          key={`${item.label}-${index}`}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
        >
          <View
            style={{
              width: 8,
              height: 8,
              borderRadius: 2,
              backgroundColor: item.color,
            }}
          />
          <Text style={{ fontSize: 11, color: mutedColor }} numberOfLines={1}>
            {item.label}
          </Text>
        </View>
      ))}
    </View>
  );
});
FlowChartLegend.displayName = 'FlowChartLegend';

export const FlowBarChart = memo(function FlowBarChart({
  points,
  width,
  height,
  mutedColor,
  borderColor,
}: {
  points: ChartPoint[];
  width: number;
  height: number;
  mutedColor: string;
  borderColor: string;
}): ReactElement {
  const padTop = 18;
  const padBottom = 28;
  const padX = 8;
  const chartH = Math.max(40, height - padTop - padBottom);
  const chartW = Math.max(40, width - padX * 2);
  const maxValue = Math.max(0, ...points.map(point => point.value));
  const minValue = Math.min(0, ...points.map(point => point.value));
  const range = maxValue - minValue || 1;
  const valueToY = (value: number): number =>
    padTop + chartH - ((value - minValue) / range) * chartH;
  const zeroY = valueToY(0);
  const slotWidth = chartW / Math.max(points.length, 1);
  const gap = Math.min(8, slotWidth * 0.25);
  const barWidth = Math.max(2, slotWidth - gap);

  return (
    <Svg width={width} height={height}>
      {[0.25, 0.5, 0.75, 1].map(fraction => {
        const y = padTop + chartH * (1 - fraction);
        return (
          <Path
            key={fraction}
            d={`M ${padX} ${y} H ${width - padX}`}
            stroke={borderColor}
            strokeDasharray='3 3'
            strokeWidth={1}
          />
        );
      })}
      {points.map((point, index) => {
        const x = padX + index * slotWidth + gap / 2;
        const valueY = valueToY(point.value);
        const barY = Math.min(valueY, zeroY);
        const barHeight = Math.max(Math.abs(valueY - zeroY), 1);
        const label = point.label.length > 8 ? `${point.label.slice(0, 7)}…` : point.label;
        return (
          <G key={`${point.label}-${index}`}>
            <Rect
              x={x}
              y={barY}
              width={barWidth}
              height={barHeight}
              rx={4}
              ry={4}
              fill={seriesColor(0)}
            />
            <SvgText
              x={x + barWidth / 2}
              y={
                point.value >= 0
                  ? Math.max(12, barY - 4)
                  : Math.min(height - 12, zeroY + barHeight + 12)
              }
              fill={mutedColor}
              fontSize={10}
              textAnchor='middle'
            >
              {compactChartValue(point.value)}
            </SvgText>
            <SvgText
              x={x + barWidth / 2}
              y={height - 8}
              fill={mutedColor}
              fontSize={10}
              textAnchor='middle'
            >
              {label}
            </SvgText>
          </G>
        );
      })}
    </Svg>
  );
});
FlowBarChart.displayName = 'FlowBarChart';

const polar = (
  cx: number,
  cy: number,
  radius: number,
  angleDeg: number,
): { x: number; y: number } => {
  const radians = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + radius * Math.cos(radians), y: cy + radius * Math.sin(radians) };
};

const describeWedge = (
  cx: number,
  cy: number,
  outerRadius: number,
  innerRadius: number,
  startAngle: number,
  endAngle: number,
): string => {
  const sweep = endAngle - startAngle;
  if (sweep <= 0) return '';
  if (sweep >= 359.9) {
    if (innerRadius <= 0) {
      return `M ${cx - outerRadius} ${cy} A ${outerRadius} ${outerRadius} 0 1 1 ${cx + outerRadius} ${cy} A ${outerRadius} ${outerRadius} 0 1 1 ${cx - outerRadius} ${cy} Z`;
    }
    return [
      `M ${cx - outerRadius} ${cy}`,
      `A ${outerRadius} ${outerRadius} 0 1 1 ${cx + outerRadius} ${cy}`,
      `A ${outerRadius} ${outerRadius} 0 1 1 ${cx - outerRadius} ${cy}`,
      `M ${cx - innerRadius} ${cy}`,
      `A ${innerRadius} ${innerRadius} 0 1 0 ${cx + innerRadius} ${cy}`,
      `A ${innerRadius} ${innerRadius} 0 1 0 ${cx - innerRadius} ${cy}`,
      'Z',
    ].join(' ');
  }

  const outerStart = polar(cx, cy, outerRadius, endAngle);
  const outerEnd = polar(cx, cy, outerRadius, startAngle);
  const largeArc = sweep <= 180 ? 0 : 1;
  if (innerRadius <= 0) {
    return `M ${cx} ${cy} L ${outerStart.x} ${outerStart.y} A ${outerRadius} ${outerRadius} 0 ${largeArc} 0 ${outerEnd.x} ${outerEnd.y} Z`;
  }

  const innerStart = polar(cx, cy, innerRadius, endAngle);
  const innerEnd = polar(cx, cy, innerRadius, startAngle);
  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArc} 0 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArc} 1 ${innerStart.x} ${innerStart.y}`,
    'Z',
  ].join(' ');
};

export const FlowPieChart = memo(function FlowPieChart({
  points,
  kind,
  width,
  height,
  cardColor,
}: {
  points: ChartPoint[];
  kind: 'pie' | 'donut';
  width: number;
  height: number;
  cardColor: string;
}): ReactElement {
  const size = Math.min(width, height);
  const cx = width / 2;
  const cy = height / 2;
  const outerRadius = size * 0.4;
  const innerRadius = kind === 'donut' ? outerRadius * 0.55 : 0;
  const total = points.reduce((sum, point) => sum + Math.abs(point.value), 0) || 1;

  let angle = 0;
  const wedges = points.map((point, index) => {
    const sweep = (Math.abs(point.value) / total) * 360;
    const start = angle;
    const end = angle + sweep;
    angle = end;
    return {
      key: `${point.label}-${index}`,
      path: describeWedge(cx, cy, outerRadius, innerRadius, start, end),
      color: seriesColor(index),
    };
  });

  return (
    <Svg width={width} height={height}>
      {wedges.map(wedge =>
        wedge.path ? (
          <Path
            key={wedge.key}
            d={wedge.path}
            fill={wedge.color}
            stroke={cardColor}
            strokeWidth={2}
          />
        ) : null,
      )}
      {kind === 'donut' ? <Circle cx={cx} cy={cy} r={innerRadius} fill={cardColor} /> : null}
    </Svg>
  );
});
FlowPieChart.displayName = 'FlowPieChart';
