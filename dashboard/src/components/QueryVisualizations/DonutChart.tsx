import React, { useMemo } from 'react';
import { cn } from '../../utils/classNames';
import { CHART_COLORS } from './constants';

interface DonutChartData {
  label: string;
  value: number;
  color?: string;
}

interface DonutChartProps {
  title: string;
  data: DonutChartData[];
  queryLabel?: string;
  size?: 'sm' | 'md' | 'lg';
  showLegend?: boolean;
  className?: string;
  animated?: boolean;
}

// Helper function to create SVG path for donut slices
const createDonutPath = (
  centerX: number,
  centerY: number,
  outerRadius: number,
  innerRadius: number,
  startAngle: number,
  endAngle: number,
): string => {
  const startOuterX = centerX + outerRadius * Math.cos((startAngle - 90) * (Math.PI / 180));
  const startOuterY = centerY + outerRadius * Math.sin((startAngle - 90) * (Math.PI / 180));
  const endOuterX = centerX + outerRadius * Math.cos((endAngle - 90) * (Math.PI / 180));
  const endOuterY = centerY + outerRadius * Math.sin((endAngle - 90) * (Math.PI / 180));

  const startInnerX = centerX + innerRadius * Math.cos((startAngle - 90) * (Math.PI / 180));
  const startInnerY = centerY + innerRadius * Math.sin((startAngle - 90) * (Math.PI / 180));
  const endInnerX = centerX + innerRadius * Math.cos((endAngle - 90) * (Math.PI / 180));
  const endInnerY = centerY + innerRadius * Math.sin((endAngle - 90) * (Math.PI / 180));

  const largeArc = endAngle - startAngle > 180 ? 1 : 0;

  return `M ${startOuterX} ${startOuterY} A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${endOuterX} ${endOuterY} L ${endInnerX} ${endInnerY} A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${startInnerX} ${startInnerY} Z`;
};

export const DonutChart: React.FC<DonutChartProps> = ({
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
    sm: { diameter: 120, outerRadius: 60, innerRadius: 35 },
    md: { diameter: 160, outerRadius: 80, innerRadius: 50 },
    lg: { diameter: 200, outerRadius: 100, innerRadius: 65 },
  };

  const config = sizeConfig[size];
  const centerX = config.diameter / 2;
  const centerY = config.diameter / 2;

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
      path: createDonutPath(
        centerX,
        centerY,
        config.outerRadius,
        config.innerRadius,
        startAngle,
        endAngle,
      ),
    };
  });

  return (
    <div
      className={cn(
        'rounded-lg border border-gray-200 dark:border-gray-700 bg-background p-4',
        className,
      )}
    >
      {/* Header */}
      <div className='mb-4'>
        <h3 className='text-sm font-semibold text-foreground'>{title}</h3>
        {queryLabel && (
          <p className='text-xs text-gray-500 font-mono mt-1 line-clamp-1'>{queryLabel}</p>
        )}
      </div>

      <div className='flex flex-col items-center gap-6'>
        {/* Donut Chart */}
        <div className='flex items-center justify-center relative'>
          <svg
            width={config.diameter}
            height={config.diameter}
            viewBox={`0 0 ${config.diameter} ${config.diameter}`}
          >
            {/* Data segments */}
            {segments.map(segment => (
              <path
                key={segment.index}
                d={segment.path}
                fill={segment.color}
                opacity={0.9}
                className='transition-all duration-300 hover:opacity-100 cursor-pointer'
                style={{
                  filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.1))',
                  animation: animated
                    ? `fillIn 0.6s ease-out ${segment.index * 0.1}s both`
                    : undefined,
                }}
              />
            ))}
          </svg>

          {/* Center content */}
          <div className='absolute flex flex-col items-center justify-center'>
            <p className='text-xs text-gray-500 font-medium'>Total</p>
            <p className='text-2xl font-bold text-foreground'>{total}</p>
          </div>
        </div>

        {/* Legend */}
        {showLegend && (
          <div className='w-full flex flex-col gap-2'>
            {data.map((item, index) => {
              const percentage = ((item.value / total) * 100).toFixed(1);
              const color = item.color || colors[index];

              return (
                <div key={index} className='flex items-center justify-between text-xs'>
                  <div className='flex items-center gap-2 min-w-0 flex-1'>
                    <div
                      className='w-3 h-3 rounded-sm flex-shrink-0'
                      style={{ backgroundColor: color }}
                    />
                    <span className='text-gray-600 dark:text-gray-400 truncate'>{item.label}</span>
                  </div>
                  <span className='font-semibold text-foreground ml-2 flex-shrink-0'>
                    {percentage}%
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* CSS Animation */}
      <style>{`
        @keyframes fillIn {
          from {
            opacity: 0;
            transform: scale(0.8);
          }
          to {
            opacity: 0.9;
            transform: scale(1);
          }
        }
      `}</style>
    </div>
  );
};

export const getDonutChartPreview = (): DonutChartData[] => [
  { label: 'Category A', value: 450 },
  { label: 'Category B', value: 300 },
  { label: 'Category C', value: 200 },
  { label: 'Category D', value: 150 },
];

export default DonutChart;
