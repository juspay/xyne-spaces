import { cn } from '../../../utils/classNames';

interface SignalBarsProps {
  /** Number of total bars to render */
  total?: number;
  /** Number of bars that are active (lit) */
  active?: number;
  /** Color for active bars (hex / CSS color) */
  activeColor: string;
  className?: string;
}

export function SignalBars({
  total = 3,
  active = 1,
  activeColor,
  className,
}: SignalBarsProps): React.ReactElement {
  const barWidth = 3;
  const gap = 2;
  const viewBoxWidth = total * barWidth + (total - 1) * gap;
  const viewBoxHeight = 10;

  return (
    <svg
      viewBox={`0 0 ${viewBoxWidth} ${viewBoxHeight}`}
      className={cn('shrink-0', className)}
      aria-hidden='true'
    >
      {Array.from({ length: total }).map((_, i) => {
        const x = i * (barWidth + gap);
        const barHeight = Math.round(((i + 1) / total) * viewBoxHeight);
        const y = viewBoxHeight - barHeight;
        const isActive = i < active;
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={barWidth}
            height={barHeight}
            rx='0.5'
            fill={activeColor}
            opacity={isActive ? 1 : 0.25}
          />
        );
      })}
    </svg>
  );
}
