import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  fillHeight?: boolean;
  className?: string;
  showGrid?: boolean;
  animated?: boolean;
}

/** Minimum width per bar column before we switch to horizontal scroll. */
const MIN_BAR_WIDTH_PX = 50;
/** Maximum width per bar in stretch mode — prevents a single bar from filling the card. */
const MAX_BAR_WIDTH_PX = 150;
const BAR_GAP_PX = 8;
const CHART_HORIZONTAL_PADDING_PX = 8;

export const BarChart: React.FC<BarChartProps> = ({
  title,
  data,
  queryLabel,
  height = 300,
  fillHeight = false,
  className,
  showGrid = true,
  animated = true,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  const chartData = useMemo(() => [...data].sort((a, b) => b.value - a.value), [data]);
  const maxValue = useMemo(() => Math.max(...chartData.map(d => d.value), 1), [chartData]);
  const colors = chartData.map(
    (_, i) => CHART_COLORS.series[i % CHART_COLORS.series.length],
  ) as string[];

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = (): void => {
      const w = el.clientWidth;
      if (w > 0) setContainerWidth(w);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [chartData.length]);

  const barCount = chartData.length;
  const gapsWidth = Math.max(0, barCount - 1) * BAR_GAP_PX;
  const totalRequiredWidth = barCount * MIN_BAR_WIDTH_PX + gapsWidth + CHART_HORIZONTAL_PADDING_PX;
  const isScrollMode = containerWidth > 0 && totalRequiredWidth > containerWidth;

  const availableBarSpace =
    containerWidth > 0 ? Math.max(0, containerWidth - gapsWidth - CHART_HORIZONTAL_PADDING_PX) : 0;
  const stretchSlotWidth =
    barCount > 0 && availableBarSpace > 0
      ? Math.min(MAX_BAR_WIDTH_PX, Math.max(MIN_BAR_WIDTH_PX, availableBarSpace / barCount))
      : MAX_BAR_WIDTH_PX;
  const contentWidth = isScrollMode
    ? totalRequiredWidth
    : barCount * stretchSlotWidth + gapsWidth + CHART_HORIZONTAL_PADDING_PX;

  return (
    <div
      className={cn(
        'rounded-xl border border-border/40 bg-gradient-to-br from-background via-background/90 to-background/80 p-6',
        'shadow-lg hover:shadow-xl transition-all duration-300 overflow-hidden backdrop-blur-sm',
        fillHeight && 'h-full flex flex-col',
        className,
      )}
    >
      {(title || queryLabel) && (
        <div className='mb-4 pb-4 border-b border-border/30 shrink-0'>
          {title && (
            <h3 className='text-base font-bold bg-gradient-to-r from-foreground to-foreground/80 bg-clip-text text-transparent truncate'>
              {title}
            </h3>
          )}
          {queryLabel && (
            <p className='text-xs text-muted-foreground font-mono mt-2 line-clamp-1 opacity-70'>
              {queryLabel}
            </p>
          )}
        </div>
      )}

      <div
        className={cn('relative', fillHeight && 'flex-1 min-h-0')}
        style={fillHeight ? undefined : { height }}
      >
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

        <div
          ref={scrollRef}
          className={cn(
            'h-full w-full overflow-x-auto overflow-y-hidden',
            !isScrollMode && 'flex justify-center',
          )}
        >
          <div
            className='flex items-end gap-2 px-1 h-full shrink-0'
            style={{
              width: contentWidth,
              minWidth: isScrollMode ? contentWidth : undefined,
            }}
          >
            {chartData.map((item, index) => {
              const percentage = (item.value / maxValue) * 100;
              const color = item.color || colors[index % colors.length] || CHART_COLORS.series[0];
              const barWidth = isScrollMode ? MIN_BAR_WIDTH_PX : stretchSlotWidth;

              return (
                <div
                  key={`${item.label}-${index}`}
                  className='flex flex-col items-center justify-end h-full gap-2 shrink-0'
                  style={{ width: barWidth, flex: '0 0 auto' }}
                >
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
                    <div className='absolute bottom-full left-1/2 -translate-x-1/2 mb-3 px-3 py-2 bg-gradient-to-r from-gray-900 to-gray-800 dark:from-gray-700 dark:to-gray-600 text-white text-xs font-semibold rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-10 pointer-events-none shadow-lg'>
                      {item.value}
                    </div>
                  </div>

                  <span
                    className='text-xs font-semibold text-foreground/70 text-center truncate w-full'
                    title={item.label}
                  >
                    {item.label}
                  </span>
                </div>
              );
            })}
          </div>
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
