import React, { useMemo } from 'react';
import { cn } from '../../utils/classNames';
import { CHART_COLORS } from './constants';

interface LineChartData {
  label: string;
  value: number;
}

interface LineChartProps {
  title: string;
  data: LineChartData[];
  queryLabel?: string;
  height?: number;
  className?: string;
  showGrid?: boolean;
  showArea?: boolean;
  color?: string;
  animated?: boolean;
}

export const LineChart: React.FC<LineChartProps> = ({
  title,
  data,
  queryLabel,
  height = 300,
  className,
  showGrid = true,
  showArea = true,
  color: colorProp,
  animated = true,
}) => {
  const values = data.map(d => d.value);
  const minValue = Math.min(...values, 0);
  const maxValue = Math.max(...values, 1);
  const range = maxValue - minValue;

  const gradientId = `line-chart-gradient`;
  let lineColor = colorProp || CHART_COLORS.primary;
  if (data.length >= 2) {
    const startValue = data[0]!.value;
    const endValue = data[data.length - 1]!.value;
    if (startValue > endValue) {
      lineColor = CHART_COLORS.error;
    } else if (startValue < endValue) {
      lineColor = CHART_COLORS.success;
    }
  }

  const padding = 40;
  const width = 1000;
  const bottomPadding = 70;
  const chartHeight = height - 40 - (bottomPadding - 40);

  const points = data.map((item, index) => {
    const x = (index / (data.length - 1 || 1)) * (width - padding * 2) + padding;
    const y = chartHeight - ((item.value - minValue) / range) * (chartHeight - 40) + 20;
    return { x, y, value: item.value };
  });

  // Generate smooth curve path
  const generatePath = () => {
    if (points.length === 0) return '';
    if (points.length === 1) {
      return `M${points[0]!.x},${points[0]!.y} L${points[0]!.x},${points[0]!.y}`;
    }

    let path = `M${points[0]!.x},${points[0]!.y}`;

    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1]!;
      const curr = points[i]!;
      const controlX = (prev.x + curr.x) / 2;

      path += ` Q${controlX},${prev.y} ${controlX},${(prev.y + curr.y) / 2}`;
      path += ` Q${controlX},${curr.y} ${curr.x},${curr.y}`;
    }

    return path;
  };

  const generateAreaPath = () => {
    const linePath = generatePath();
    const lastPoint = points[points.length - 1];
    const firstPoint = points[0];

    if (!lastPoint || !firstPoint) return '';

    return (
      linePath +
      ` L${lastPoint.x},${chartHeight + 20}` +
      ` L${firstPoint.x},${chartHeight + 20}` +
      ' Z'
    );
  };

  const gridLines = useMemo(() => {
    const count = 5;
    return Array.from({ length: count }, (_, i) => {
      const value = minValue + (i / (count - 1)) * range;
      const y = chartHeight - ((value - minValue) / range) * (chartHeight - 40) + 20;
      return { y, value };
    });
  }, [minValue, maxValue, range, chartHeight]);

  return (
    <div
      className={cn(
        'rounded-xl border border-border/40 bg-gradient-to-br from-background via-background/90 to-background/80 p-6',
        'shadow-lg hover:shadow-xl transition-all duration-300 overflow-hidden backdrop-blur-sm',
        className,
      )}
    >
      {/* Header */}
      <div className='mb-6 pb-4 border-b border-border/30'>
        <h3 className='text-base font-bold bg-gradient-to-r from-foreground to-foreground/80 bg-clip-text text-transparent'>
          {title}
        </h3>
        {queryLabel && (
          <p className='text-xs text-muted-foreground font-mono mt-2 line-clamp-1 opacity-70'>
            {queryLabel}
          </p>
        )}
      </div>

      {/* Chart Container */}
      <div className='w-full'>
        <svg
          viewBox={`0 0 ${width} ${height + 100}`}
          width='100%'
          height={height + 100}
          preserveAspectRatio='none'
          className='w-full'
        >
          {/* Grid lines */}
          {showGrid &&
            gridLines.map((line, i) => (
              <g key={i}>
                <line
                  x1={padding}
                  y1={line.y}
                  x2={width - padding}
                  y2={line.y}
                  stroke='currentColor'
                  strokeWidth={1}
                  strokeDasharray='4'
                  opacity={0.2}
                  className='text-border'
                />
                <text
                  x={padding - 10}
                  y={line.y + 4}
                  textAnchor='end'
                  fontSize={12}
                  fill='currentColor'
                  className='text-muted-foreground opacity-60'
                >
                  {Math.round(line.value)}
                </text>
              </g>
            ))}

          {/* Area */}
          {showArea && (
            <defs>
              <linearGradient id={gradientId} x1='0%' y1='0%' x2='0%' y2='100%'>
                <stop offset='0%' stopColor={lineColor} stopOpacity={0.4} />
                <stop offset='100%' stopColor={lineColor} stopOpacity={0.05} />
              </linearGradient>
            </defs>
          )}
          {showArea && (
            <path
              d={generateAreaPath()}
              fill={`url(#${gradientId})`}
              opacity={1}
              style={{
                animation: animated ? 'areaFade 0.7s cubic-bezier(0.34, 1.56, 0.64, 1)' : undefined,
              }}
            />
          )}

          {/* Line */}
          <path
            d={generatePath()}
            fill='none'
            stroke={lineColor}
            strokeWidth={3}
            strokeLinecap='round'
            strokeLinejoin='round'
            style={{
              animation: animated ? 'lineDraw 0.8s ease-out' : undefined,
            }}
          />

          {/* Points */}
          {points.map((point, i) => (
            <g key={i}>
              <circle
                cx={point.x}
                cy={point.y}
                r={4}
                fill={lineColor}
                opacity={0.8}
                className='hover:r-6 transition-all cursor-pointer'
                style={{
                  animation: animated ? `pointFade 0.5s ease-out ${i * 0.05}s both` : undefined,
                }}
              />
              {/* Hover tooltip */}
              <g className='pointer-events-none'>
                <text
                  x={point.x}
                  y={point.y - 10}
                  textAnchor='middle'
                  fontSize={12}
                  fill={lineColor}
                  fontWeight='bold'
                  opacity={0}
                  className='peer-hover:opacity-100'
                >
                  {point.value}
                </text>
              </g>
            </g>
          ))}

          {/* X-axis labels */}
          {data.map((item, i) => {
            if (data.length > 10 && i % Math.ceil(data.length / 5) !== 0) return null;
            const point = points[i];
            if (!point) return null;

            return (
              <g key={i}>
                <text
                  x={point.x}
                  y={height + 40}
                  textAnchor='middle'
                  fontSize={12}
                  fill='#000000'
                  fontWeight='600'
                  className='text-sm'
                >
                  {item.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* CSS Animation */}
      <style>{`
        @keyframes lineDraw {
          from {
            stroke-dasharray: 1000;
            stroke-dashoffset: 1000;
          }
          to {
            stroke-dasharray: 1000;
            stroke-dashoffset: 0;
          }
        }
        @keyframes areaFade {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
        @keyframes pointFade {
          from {
            opacity: 0;
            r: 0;
          }
          to {
            opacity: 0.8;
            r: 4;
          }
        }
      `}</style>
    </div>
  );
};

interface LineChartData {
  label: string;
  value: number;
}

export const getLineChartPreview = (): LineChartData[] => [
  { label: 'Week 1', value: 400 },
  { label: 'Week 2', value: 300 },
  { label: 'Week 3', value: 200 },
  { label: 'Week 4', value: 278 },
  { label: 'Week 5', value: 189 },
  { label: 'Week 6', value: 239 },
];

export default LineChart;
