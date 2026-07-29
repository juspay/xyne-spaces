import React, { useMemo } from 'react';
import { cn } from '../../utils/classNames';
import { HEATMAP_COLORS } from './constants';

interface HeatmapData {
  x: string | number;
  y: string | number;
  value: number;
}

interface HeatmapProps {
  title: string;
  data: HeatmapData[];
  xLabel?: string;
  yLabel?: string;
  queryLabel?: string;
  className?: string;
  animated?: boolean;
  cellSize?: number;
}

export const Heatmap: React.FC<HeatmapProps> = ({
  title,
  data,
  queryLabel,
  className,
  animated = true,
  cellSize = 40,
}) => {
  // Extract unique X and Y values and sort them
  const uniqueX = useMemo(
    () => [...new Set(data.map(d => d.x))].sort((a, b) => String(a).localeCompare(String(b))),
    [data],
  );
  const uniqueY = useMemo(
    () => [...new Set(data.map(d => d.y))].sort((a, b) => String(a).localeCompare(String(b))),
    [data],
  );

  // Find min and max values for color scaling
  const values = data.map(d => d.value);
  const minValue = Math.min(...values, 0);
  const maxValue = Math.max(...values, 1);
  const range = maxValue - minValue;

  // Create a map for quick value lookup
  const valueMap = useMemo(() => {
    const map = new Map<string, number>();
    data.forEach(d => {
      map.set(`${d.x},${d.y}`, d.value);
    });
    return map;
  }, [data]);

  // Get color based on value
  const getColor = (value: number): string => {
    if (range === 0) return HEATMAP_COLORS[5]!; // Middle color if all values are the same
    const normalized = (value - minValue) / range;
    const index = Math.round(normalized * (HEATMAP_COLORS.length - 1));
    return HEATMAP_COLORS[index]!;
  };

  const labelWidth = Math.max(...uniqueY.map(y => String(y).length)) * 8 + 10;
  const topLabelHeight = 40;

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

      {/* Heatmap */}
      <div className='overflow-x-auto'>
        <div className='inline-block'>
          {/* Top labels (X-axis) */}
          <div className='flex'>
            <div style={{ width: labelWidth, height: topLabelHeight }} />
            <div className='flex gap-px'>
              {uniqueX.map((x, i) => (
                <div
                  key={i}
                  className='text-xs text-muted-foreground font-semibold flex items-end justify-center pb-1'
                  style={{ width: cellSize, height: topLabelHeight }}
                >
                  <span className='rotate-45 transform origin-center text-center max-w-xs'>
                    {String(x).length > 5 ? String(x).substring(0, 5) : x}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Heatmap grid */}
          {uniqueY.map((y, yIndex) => (
            <div key={yIndex} className='flex'>
              {/* Y-axis label */}
              <div
                className='flex items-center justify-end pr-2 text-xs text-gray-500 font-medium'
                style={{ width: labelWidth }}
              >
                {String(y).length > 8 ? String(y).substring(0, 8) : y}
              </div>

              {/* Cells */}
              <div className='flex gap-px'>
                {uniqueX.map((x, xIndex) => {
                  const value = valueMap.get(`${x},${y}`);
                  const color = value !== undefined ? getColor(value) : '#f0f0f0';

                  return (
                    <div
                      key={`${xIndex}-${yIndex}`}
                      className={cn(
                        'rounded transition-all duration-200 hover:ring-2 hover:ring-foreground/30 cursor-pointer group relative',
                      )}
                      style={{
                        width: cellSize,
                        height: cellSize,
                        backgroundColor: color,
                        animation: animated
                          ? `cellFade 0.4s ease-out ${(yIndex * uniqueX.length + xIndex) * 0.02}s both`
                          : undefined,
                      }}
                    >
                      {/* Hover tooltip */}
                      {value !== undefined && (
                        <div className='absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-gray-900 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-20 pointer-events-none'>
                          {value}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className='mt-4 pt-4 border-t border-gray-200 dark:border-gray-700'>
        <div className='flex items-center gap-2'>
          <span className='text-xs text-gray-500 font-medium'>Low</span>
          <div className='flex gap-1 flex-1'>
            {HEATMAP_COLORS.map((color, i) => (
              <div
                key={i}
                className='h-4 flex-1 rounded transition-all hover:scale-110'
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
          <span className='text-xs text-gray-500 font-medium'>High</span>
        </div>
        <div className='mt-2 text-xs text-gray-500'>
          <span>Min: {Math.round(minValue)}</span>
          <span className='mx-2'>•</span>
          <span>Max: {Math.round(maxValue)}</span>
        </div>
      </div>

      {/* CSS Animation */}
      <style>{`
        @keyframes cellFade {
          from {
            opacity: 0;
            transform: scale(0.8);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }
      `}</style>
    </div>
  );
};

export const getHeatmapPreview = (): Record<string, unknown>[] => [
  { x: 'Mon', y: '09:00', value: 10 },
  { x: 'Mon', y: '10:00', value: 20 },
  { x: 'Mon', y: '11:00', value: 15 },
  { x: 'Tue', y: '09:00', value: 25 },
  { x: 'Tue', y: '10:00', value: 30 },
  { x: 'Tue', y: '11:00', value: 28 },
  { x: 'Wed', y: '09:00', value: 12 },
  { x: 'Wed', y: '10:00', value: 18 },
  { x: 'Wed', y: '11:00', value: 22 },
];

export default Heatmap;
