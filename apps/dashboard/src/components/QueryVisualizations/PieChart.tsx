import React, { useMemo } from 'react';
import { cn } from '../../utils/classNames';
import { CHART_COLORS } from './constants';

interface PieChartData {
  label: string;
  value: number;
  color?: string;
}

interface PieChartProps {
  title: string;
  data: PieChartData[];
  queryLabel?: string;
  size?: 'sm' | 'md' | 'lg';
  showLegend?: boolean;
  className?: string;
  animated?: boolean;
}

// Helper function to create SVG path for pie slices
const createPiePath = (
  centerX: number,
  centerY: number,
  radius: number,
  startAngle: number,
  endAngle: number,
): string => {
  const startX = centerX + radius * Math.cos((startAngle - 90) * (Math.PI / 180));
  const startY = centerY + radius * Math.sin((startAngle - 90) * (Math.PI / 180));
  const endX = centerX + radius * Math.cos((endAngle - 90) * (Math.PI / 180));
  const endY = centerY + radius * Math.sin((endAngle - 90) * (Math.PI / 180));

  const largeArc = endAngle - startAngle > 180 ? 1 : 0;

  return `M ${centerX} ${centerY} L ${startX} ${startY} A ${radius} ${radius} 0 ${largeArc} 1 ${endX} ${endY} Z`;
};

export const PieChart: React.FC<PieChartProps> = ({
  title,
  data,
  queryLabel,
  size = 'md',
  showLegend = true,
  className,
  animated = true,
}) => {
  const total = useMemo(() => data.reduce((sum, item) => sum + item.value, 0), [data]);

  const sizeConfig = {
    sm: { diameter: 120 },
    md: { diameter: 160 },
    lg: { diameter: 200 },
  };

  const config = sizeConfig[size];
  const radius = config.diameter / 2;
  const centerX = radius;
  const centerY = radius;

  const colors = data.map((_, i) => CHART_COLORS.series[i % CHART_COLORS.series.length]);

  let currentAngle = 0;
  const segments = data.map((item, index) => {
    const percentage = (item.value / total) * 100;
    const sliceAngle = (percentage / 100) * 360;
    const startAngle = currentAngle;
    const endAngle = currentAngle + sliceAngle;
    currentAngle = endAngle;

    return {
      percentage,
      startAngle,
      endAngle,
      color: item.color || colors[index],
      index,
      path: createPiePath(centerX, centerY, radius * 0.85, startAngle, endAngle),
    };
  });

  return (
    <div
      className={cn(
        'rounded-xl border border-border/40 bg-gradient-to-br from-background via-background/90 to-background/80 p-6',
        'shadow-lg hover:shadow-xl transition-all duration-300 backdrop-blur-sm',
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

      <div className='flex flex-col items-center gap-6'>
        {/* Pie Chart */}
        <div className='flex items-center justify-center p-4 rounded-lg bg-muted/20 backdrop-blur-sm'>
          <svg
            width={config.diameter}
            height={config.diameter}
            viewBox={`0 0 ${config.diameter} ${config.diameter}`}
            className='drop-shadow-lg'
          >
            {/* Data segments */}
            {segments.map(segment => (
              <path
                key={segment.index}
                d={segment.path}
                fill={segment.color}
                opacity={0.95}
                className='transition-all duration-300 hover:opacity-100 cursor-pointer group'
                style={{
                  filter: `drop-shadow(0 4px 12px ${segment.color}40)`,
                  animation: animated
                    ? `fillIn 0.7s cubic-bezier(0.34, 1.56, 0.64, 1) ${segment.index * 0.12}s both`
                    : undefined,
                }}
              />
            ))}
          </svg>
        </div>

        {/* Legend */}
        {showLegend && (
          <div className='w-full flex flex-col gap-2.5 p-4 rounded-lg bg-muted/20 backdrop-blur-sm border border-border/30'>
            {data.map((item, index) => {
              const percentage = ((item.value / total) * 100).toFixed(1);
              const color = item.color || colors[index];

              return (
                <div
                  key={index}
                  className='flex items-center justify-between text-xs hover:bg-muted/30 px-2 py-1.5 rounded-md transition-colors'
                >
                  <div className='flex items-center gap-3 min-w-0 flex-1'>
                    <div
                      className='w-3 h-3 rounded-full flex-shrink-0 shadow-md'
                      style={{ backgroundColor: color, boxShadow: `0 2px 8px ${color}60` }}
                    />
                    <span className='text-foreground/80 font-medium truncate'>{item.label}</span>
                  </div>
                  <span className='font-bold text-foreground/90 ml-2 flex-shrink-0 bg-gradient-to-r from-primary/20 to-primary/10 px-2 py-0.5 rounded'>
                    {percentage}%
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Total Value */}
        <div className='text-center border-t border-border/30 pt-4 w-full'>
          <p className='text-xs font-semibold text-muted-foreground uppercase tracking-wider'>
            Total
          </p>
          <p className='text-3xl font-bold bg-gradient-to-r from-primary via-primary/80 to-primary/60 bg-clip-text text-transparent'>
            {total}
          </p>
        </div>
      </div>

      {/* CSS Animation */}
      <style>{`
        @keyframes fillIn {
          from {
            opacity: 0;
            transform: scale(0.7) rotate(-180deg);
          }
          to {
            opacity: 0.95;
            transform: scale(1) rotate(0deg);
          }
        }
      `}</style>
    </div>
  );
};

export const getPieChartPreview = (): PieChartData[] => [
  { label: 'Category A', value: 450 },
  { label: 'Category B', value: 300 },
  { label: 'Category C', value: 200 },
  { label: 'Category D', value: 150 },
];

export default PieChart;
