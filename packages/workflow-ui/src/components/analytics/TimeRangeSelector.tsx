import { cn } from '../shared/cn.js';
import type { AnalyticsRange } from '../../hooks/use-analytics.js';

export interface TimeRangeSelectorProps {
  value: AnalyticsRange;
  onChange: (range: AnalyticsRange) => void;
  className?: string;
}

const RANGES: AnalyticsRange[] = [7, 14, 30];

export function TimeRangeSelector({ value, onChange, className }: TimeRangeSelectorProps) {
  return (
    <div className={cn('flex gap-1', className)}>
      {RANGES.map((r) => (
        <button
          key={r}
          onClick={() => onChange(r)}
          className={cn(
            'rounded px-2.5 py-1 text-xs font-medium transition-colors',
            r === value
              ? 'bg-[var(--wui-primary)] text-[var(--wui-primary-fg)]'
              : 'border border-[var(--wui-border)] text-[var(--wui-fg-muted)] hover:bg-[var(--wui-bg-subtle)]',
          )}
        >
          {r}d
        </button>
      ))}
    </div>
  );
}
