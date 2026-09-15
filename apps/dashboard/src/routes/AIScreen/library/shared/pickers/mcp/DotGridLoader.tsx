import { type ReactElement } from 'react';
import { cn } from '@/utils/classNames';

const AXIS = [1.26126, 4.86478, 8.46829] as const;
const RADIUS = 1.26126;

export function DotGridLoader({ className }: { className?: string }): ReactElement {
  return (
    <svg
      viewBox='0 0 10 9.72974'
      width='10'
      height='9.72974'
      fill='none'
      aria-hidden
      className={cn('shrink-0 text-primary', className)}
    >
      {AXIS.flatMap((cy, row) =>
        AXIS.map((cx, col) => (
          <circle
            key={`${row}-${col}`}
            cx={cx}
            cy={cy}
            r={RADIUS}
            fill='currentColor'
            className='animate-pulse'
            style={{ animationDelay: `${(row * AXIS.length + col) * 110}ms` }}
          />
        )),
      )}
    </svg>
  );
}
