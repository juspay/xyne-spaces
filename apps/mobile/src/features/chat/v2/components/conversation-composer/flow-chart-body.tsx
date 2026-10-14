import { memo, useMemo, useState, type ReactElement } from 'react';
import { Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, G, Path, Polyline, Rect, Text as SvgText } from 'react-native-svg';

import {
  compactChartValue,
  pivotChartSeries,
  type ChartPoint,
  type ChartSeriesPoint,
  type ChartViewModel,
} from '@/src/utils/flowChartUtils';

export const CHART_SERIES_COLORS = ['#e76f51', '#2a9d8f', '#264653', '#e9c46a', '#f4a261'] as const;

export const seriesColor = (index: number): string =>
  CHART_SERIES_COLORS[index % CHART_SERIES_COLORS.length]!;

type ChartBodyProps = {
  viewModel: ChartViewModel;
  height: number;
  mutedColor: string;
  borderColor: string;
  cardColor: string;
};

const polar = (cx: number, cy: number, r: number, angleDeg: number) => {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
};

const describeWedge = (
  cx: number,
  cy: number,
  outerR: number,
  innerR: number,
  startAngle: number,
  endAngle: number,
): string => {
  const sweep = endAngle - startAngle;
  if (sweep <= 0) return '';
  // Full circle needs two arcs (SVG can't draw a single 360° arc).
  if (sweep >= 359.9) {
    if (innerR <= 0) {
      return `M ${cx - outerR} ${cy} A ${outerR} ${outerR} 0 1 1 ${cx + outerR} ${cy} A ${outerR} ${outerR} 0 1 1 ${cx - outerR} ${cy} Z`;
    }
    return [
      `M ${cx - outerR} ${cy}`,
      `A ${outerR} ${outerR} 0 1 1 ${cx + outerR} ${cy}`,
      `A ${outerR} ${outerR} 0 1 1 ${cx - outerR} ${cy}`,
      `M ${cx - innerR} ${cy}`,
      `A ${innerR} ${innerR} 0 1 0 ${cx + innerR} ${cy}`,
      `A ${innerR} ${innerR} 0 1 0 ${cx - innerR} ${cy}`,
      'Z',
    ].join(' ');
  }

  const oStart = polar(cx, cy, outerR, endAngle);
  const oEnd = polar(cx, cy, outerR, startAngle);
  const large = sweep <= 180 ? 0 : 1;
  if (innerR <= 0) {
    return `M ${cx} ${cy} L ${oStart.x} ${oStart.y} A ${outerR} ${outerR} 0 ${large} 0 ${oEnd.x} ${oEnd.y} Z`;
  }
  const iStart = polar(cx, cy, innerR, endAngle);
  const iEnd = polar(cx, cy, innerR, startAngle);
  return [
    `M ${oStart.x} ${oStart.y}`,
    `A ${outerR} ${outerR} 0 ${large} 0 ${oEnd.x} ${oEnd.y}`,
    `L ${iEnd.x} ${iEnd.y}`,
    `A ${innerR} ${innerR} 0 ${large} 1 ${iStart.x} ${iStart.y}`,
    'Z',
  ].join(' ');
};

const Legend = ({
  items,
  mutedColor,
}: {
  items: Array<{ label: string; color: string }>;
  mutedColor: string;
}): ReactElement => (
  <View
    style={{
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      paddingHorizontal: 4,
      paddingBottom: 4,
    }}
  >
    {items.map(item => (
      <View key={item.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
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

const BarChartBody = ({
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
}): ReactElement => {
  const padTop = 18;
  const padBottom = 28;
  const padX = 8;
  const chartH = Math.max(40, height - padTop - padBottom);
  const chartW = Math.max(40, width - padX * 2);
  const maxValue = Math.max(...points.map(p => p.value), 1);
  const gap = Math.min(8, chartW / (points.length * 4));
  const barW = Math.min(48, (chartW - gap * (points.length - 1)) / points.length);

  return (
    <Svg width={width} height={height}>
      {[0.25, 0.5, 0.75, 1].map(frac => {
        const y = padTop + chartH * (1 - frac);
        return (
          <Path
            key={frac}
            d={`M ${padX} ${y} H ${width - padX}`}
            stroke={borderColor}
            strokeDasharray='3 3'
            strokeWidth={1}
          />
        );
      })}
      {points.map((point, index) => {
        const x = padX + index * (barW + gap);
        const barH = (point.value / maxValue) * chartH;
        const y = padTop + chartH - barH;
        const label = point.label.length > 8 ? `${point.label.slice(0, 7)}…` : point.label;
        return (
          <G key={`${point.label}-${index}`}>
            <Rect
              x={x}
              y={y}
              width={barW}
              height={Math.max(barH, 1)}
              rx={4}
              ry={4}
              fill={seriesColor(0)}
            />
            <SvgText
              x={x + barW / 2}
              y={Math.max(12, y - 4)}
              fill={mutedColor}
              fontSize={10}
              textAnchor='middle'
            >
              {compactChartValue(point.value)}
            </SvgText>
            <SvgText
              x={x + barW / 2}
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
};

const PieChartBody = ({
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
}): ReactElement => {
  const size = Math.min(width, height);
  const cx = width / 2;
  const cy = height / 2;
  const outerR = size * 0.4;
  const innerR = kind === 'donut' ? outerR * 0.55 : 0;
  const total = points.reduce((sum, p) => sum + Math.abs(p.value), 0) || 1;

  let angle = 0;
  const wedges = points.map((point, index) => {
    const sweep = (Math.abs(point.value) / total) * 360;
    const start = angle;
    const end = angle + sweep;
    angle = end;
    return {
      key: `${point.label}-${index}`,
      d: describeWedge(cx, cy, outerR, innerR, start, end),
      color: seriesColor(index),
    };
  });

  return (
    <Svg width={width} height={height}>
      {wedges.map(wedge =>
        wedge.d ? (
          <Path key={wedge.key} d={wedge.d} fill={wedge.color} stroke={cardColor} strokeWidth={2} />
        ) : null,
      )}
      {kind === 'donut' ? <Circle cx={cx} cy={cy} r={innerR} fill={cardColor} /> : null}
    </Svg>
  );
};

const LineAreaChartBody = ({
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
}): ReactElement => {
  const { data, names } = pivotChartSeries(series);
  const padTop = 12;
  const padBottom = 28;
  const padLeft = 36;
  const padRight = 8;
  const chartH = Math.max(40, height - padTop - padBottom);
  const chartW = Math.max(40, width - padLeft - padRight);

  const values = data.flatMap(row =>
    names.map(name => {
      const v = row[name];
      return typeof v === 'number' ? v : 0;
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
      {[0.25, 0.5, 0.75, 1].map(frac => {
        const y = padTop + chartH * (1 - frac);
        return (
          <Path
            key={frac}
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
            const v = row[name];
            if (typeof v !== 'number') return null;
            return `${xAt(index)},${yAt(v)}`;
          })
          .filter((p): p is string => p !== null);
        if (points.length === 0) return null;
        const color = seriesColor(seriesIndex);
        const poly = points.join(' ');
        return (
          <G key={name}>
            {kind === 'area' && points.length > 1 ? (
              <Path
                d={`M ${points[0]} L ${points.slice(1).join(' L ')} L ${xAt(data.length - 1)},${yAt(minY)} L ${xAt(0)},${yAt(minY)} Z`}
                fill={color}
                opacity={0.2}
              />
            ) : null}
            <Polyline points={poly} fill='none' stroke={color} strokeWidth={2} />
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
};

const FlowChartBodyComponent = ({
  viewModel,
  height,
  mutedColor,
  borderColor,
  cardColor,
}: ChartBodyProps): ReactElement => {
  const [width, setWidth] = useState(0);

  const onLayout = (event: LayoutChangeEvent): void => {
    const next = Math.floor(event.nativeEvent.layout.width);
    if (next > 0 && next !== width) setWidth(next);
  };

  const legendItems = useMemo(() => {
    if (viewModel.kind === 'pie' || viewModel.kind === 'donut') {
      return viewModel.points.map((point, index) => ({
        label: point.label,
        color: seriesColor(index),
      }));
    }
    if (viewModel.kind === 'line' || viewModel.kind === 'area') {
      const { names } = pivotChartSeries(viewModel.series);
      if (names.length <= 1) return [];
      return names.map((name, index) => ({ label: name, color: seriesColor(index) }));
    }
    return [];
  }, [viewModel]);

  return (
    <View style={{ width: '100%', minHeight: height }} onLayout={onLayout}>
      {legendItems.length > 0 ? <Legend items={legendItems} mutedColor={mutedColor} /> : null}
      {width > 0 ? (
        viewModel.kind === 'bar' ? (
          <BarChartBody
            points={viewModel.points}
            width={width}
            height={height - (legendItems.length > 0 ? 22 : 0)}
            mutedColor={mutedColor}
            borderColor={borderColor}
          />
        ) : viewModel.kind === 'pie' || viewModel.kind === 'donut' ? (
          <PieChartBody
            points={viewModel.points}
            kind={viewModel.kind}
            width={width}
            height={height - (legendItems.length > 0 ? 22 : 0)}
            cardColor={cardColor}
          />
        ) : (
          <LineAreaChartBody
            series={viewModel.series}
            kind={viewModel.kind}
            width={width}
            height={height - (legendItems.length > 0 ? 22 : 0)}
            mutedColor={mutedColor}
            borderColor={borderColor}
          />
        )
      ) : (
        <View style={{ height }} />
      )}
    </View>
  );
};

const FlowChartBody = memo(FlowChartBodyComponent);
FlowChartBody.displayName = 'FlowChartBody';

export { FlowChartBody };
