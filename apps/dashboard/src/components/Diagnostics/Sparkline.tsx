import { type ReactElement } from 'react';
import type { Point } from '../../services/diagnostics';

interface SparklineProps {
  points: Point[];
  /** Stroke colour; pass the verdict colour so the trend matches the tile. */
  className?: string;
  width?: number;
  height?: number;
}

/**
 * Hand-rolled SVG rather than a chart library: this renders inside a panel whose
 * whole purpose is measuring jank, so it must not pull in a layout-thrashing
 * charting runtime to draw twenty line segments.
 */
export function Sparkline({
  points,
  className = 'text-neutral-400',
  width = 120,
  height = 28,
}: SparklineProps): ReactElement | null {
  if (points.length < 2) return null;

  const values = points.map(p => p.v);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;

  const firstTime = points[0]?.t ?? 0;
  const lastTime = points[points.length - 1]?.t ?? firstTime;
  const timeSpan = lastTime - firstTime || 1;

  const path = points
    .map((point, index) => {
      const x = ((point.t - firstTime) / timeSpan) * width;
      const y = height - ((point.v - min) / span) * height;
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      aria-hidden='true'
      preserveAspectRatio='none'
    >
      <path d={path} fill='none' stroke='currentColor' strokeWidth={1.5} strokeLinejoin='round' />
    </svg>
  );
}
