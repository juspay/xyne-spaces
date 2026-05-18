import React, { useMemo } from 'react';
import { cn } from '../../utils/classNames';
import { CHART_COLORS } from './constants';

interface FunnelData {
  label: string;
  value: number;
  color?: string;
}

interface FunnelProps {
  title: string;
  data: FunnelData[];
  queryLabel?: string;
  height?: number;
  className?: string;
  showDropoff?: boolean;
  animated?: boolean;
}

export const Funnel: React.FC<FunnelProps> = ({
  title,
  data,
  queryLabel,
  height = 300,
  className,
  showDropoff = true,
  animated = true,
}) => {
  const maxValue = useMemo(() => Math.max(...data.map(d => d.value), 1), [data]);

  const colors = data.map((_, i) => CHART_COLORS.series[i % CHART_COLORS.series.length]);

  const dropoffs = useMemo(() => {
    return data.map((item, index) => {
      if (index === 0) return 0;
      const prev = data[index - 1]!;
      return ((prev.value - item.value) / prev.value) * 100;
    });
  }, [data]);

  const baseWidth = 300;
  const segmentHeight = height / data.length;

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

      {/* Funnel Chart */}
      <div className='overflow-x-auto'>
        <div className='flex justify-center' style={{ minWidth: baseWidth + 40 }}>
          <div className='space-y-3' style={{ width: baseWidth }}>
            {data.map((item, index) => {
              const percentage = (item.value / maxValue) * 100;
              const color = item.color || colors[index];
              const dropoff = dropoffs[index];

              return (
                <div key={index} className='flex flex-col items-center gap-2'>
                  {/* Segment */}
                  <div
                    className={cn(
                      'rounded-lg transition-all duration-300 hover:shadow-xl hover:-translate-y-0.5',
                      'cursor-pointer group relative',
                      'flex items-center justify-center text-white font-bold text-sm shadow-lg',
                    )}
                    style={{
                      width: `${percentage}%`,
                      height: segmentHeight - 16,
                      backgroundColor: color,
                      boxShadow: `0 6px 20px ${color}50`,
                      animation: animated
                        ? `funnelScale 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) ${index * 0.12}s both`
                        : undefined,
                    }}
                  >
                    <span className='truncate px-2'>{item.value}</span>
                  </div>

                  {/* Label with dropoff */}
                  <div className='flex items-center gap-2 w-full justify-between px-2 text-xs'>
                    <span className='text-gray-600 dark:text-gray-400 font-medium truncate flex-1'>
                      {item.label}
                    </span>
                    {showDropoff && index > 0 && (
                      <span className='text-red-500 font-semibold flex-shrink-0'>
                        -{dropoff?.toFixed(0)}%
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Summary Stats */}
      {showDropoff && data.length > 0 && (
        <div className='mt-4 pt-4 border-t border-gray-200 dark:border-gray-700 grid grid-cols-2 gap-2'>
          <div className='text-center'>
            <p className='text-xs text-gray-500'>Top to Bottom</p>
            <p
              className={cn(
                'text-sm font-bold',
                data[data.length - 1]!.value >= data[0]!.value ? 'text-green-500' : 'text-red-500',
              )}
            >
              {(((data[data.length - 1]!.value - data[0]!.value) / data[0]!.value) * 100).toFixed(
                1,
              )}
              %
            </p>
          </div>
          <div className='text-center'>
            <p className='text-xs text-gray-500'>Bottom to Top</p>
            <p
              className={cn(
                'text-sm font-bold',
                data[0]!.value >= data[data.length - 1]!.value ? 'text-green-500' : 'text-red-500',
              )}
            >
              {(
                ((data[0]!.value - data[data.length - 1]!.value) / data[data.length - 1]!.value) *
                100
              ).toFixed(1)}
              %
            </p>
          </div>
        </div>
      )}

      {/* CSS Animation */}
      <style>{`
        @keyframes funnelScale {
          from {
            width: 0;
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
};

export const getFunnelPreview = (): FunnelData[] => [
  { label: 'Step 1', value: 1000 },
  { label: 'Step 2', value: 800 },
  { label: 'Step 3', value: 500 },
  { label: 'Step 4', value: 200 },
];

export default Funnel;
