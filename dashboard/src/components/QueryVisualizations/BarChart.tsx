import React, { useMemo } from 'react';
import { cn } from '../../utils/classNames';
import { CHART_COLORS } from './constants';

interface BarChartData {
  label: string;
  value: number;
  color?: string;
}

interface BarChartProps {
  title: string;
  data: BarChartData[];
  queryLabel?: string;
  height?: number;
  className?: string;
  showGrid?: boolean;
  animated?: boolean;
}

export const BarChart: React.FC<BarChartProps> = ({
  title,
  data,
  queryLabel,
  height = 300,
  className,
  showGrid = true,
  animated = true,
}) => {
  const maxValue = useMemo(() => Math.max(...data.map(d => d.value), 1), [data]);

  const colors = data.map((_, i) => CHART_COLORS.series[i % CHART_COLORS.series.length]);

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
      <div className='relative' style={{ height }}>
        {/* Grid lines */}
        {showGrid && (
          <div className='absolute inset-0 flex flex-col justify-between pointer-events-none'>
            {[0, 0.25, 0.5, 0.75, 1].map((_, i) => (
              <div
                key={i}
                className='w-full h-px bg-gradient-to-r from-border/30 via-border/20 to-transparent'
              />
            ))}
          </div>
        )}

        {/* Bars Container */}
        <div className='flex items-end justify-between gap-3 px-2 h-full'>
          {data.map((item, index) => {
            const percentage = (item.value / maxValue) * 100;
            const color = item.color || colors[index];

            return (
              <div
                key={index}
                className='flex-1 flex flex-col items-center justify-end h-full min-w-0 gap-2'
              >
                {/* Bar */}
                <div
                  className={cn(
                    'w-full transition-all duration-300 rounded-lg',
                    'hover:shadow-lg cursor-pointer group relative',
                    'min-h-1 shadow-md hover:opacity-90',
                  )}
                  style={{
                    height: `${percentage}%`,
                    backgroundColor: color,
                    animation: animated
                      ? `slideUpBar 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) ${index * 0.08}s both`
                      : undefined,
                    minHeight: '4px',
                    boxShadow: `0 4px 12px ${color}40`,
                  }}
                >
                  {/* Hover tooltip */}
                  <div className='absolute bottom-full left-1/2 -translate-x-1/2 mb-3 px-3 py-2 bg-gradient-to-r from-gray-900 to-gray-800 dark:from-gray-700 dark:to-gray-600 text-white text-xs font-semibold rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-10 pointer-events-none shadow-lg'>
                    {item.value}
                  </div>
                </div>

                {/* Label */}
                <span className='text-xs font-semibold text-foreground/70 text-center truncate w-full'>
                  {item.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* CSS Animation */}
      <style>{`
        @keyframes slideUpBar {
          from {
            opacity: 0;
            transform: scaleY(0);
            transform-origin: bottom;
          }
          to {
            opacity: 1;
            transform: scaleY(1);
            transform-origin: bottom;
          }
        }
      `}</style>
    </div>
  );
};

export const getBarChartPreview = (): BarChartData[] => [
  { label: 'Jan', value: 400 },
  { label: 'Feb', value: 300 },
  { label: 'Mar', value: 200 },
  { label: 'Apr', value: 278 },
  { label: 'May', value: 189 },
];

export default BarChart;
