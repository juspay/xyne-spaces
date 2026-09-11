/* eslint-disable local-rules/require-tracking-on-click */
import { ReactElement, ReactNode } from 'react';
import { Check } from 'lucide-react';
import { cn } from '../../../../utils/classNames';

interface CompareSelectRowProps {
  rank: number;
  score: number;
  selected: boolean;
  relevant: boolean;
  hasDebug: boolean;
  onToggle: () => void;
  children: ReactNode;
}

/**
 * In compare mode, wraps a result card with a left selection rail (checkbox +
 * rank + relevance score) and makes the whole row a single toggle target. The
 * card itself is made non-interactive so clicks select rather than navigate.
 */
export function CompareSelectRow({
  rank,
  score,
  selected,
  relevant,
  hasDebug,
  onToggle,
  children,
}: CompareSelectRowProps): ReactElement {
  return (
    <div
      role='button'
      tabIndex={hasDebug ? 0 : -1}
      aria-pressed={selected}
      aria-disabled={!hasDebug}
      onClick={hasDebug ? onToggle : undefined}
      data-track-category='SEARCH_COMPARE'
      data-track-name='TOGGLE_COMPARE_ROW'
      onKeyDown={e => {
        if (hasDebug && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onToggle();
        }
      }}
      title={hasDebug ? undefined : 'No ranking data for this result'}
      className={cn(
        'group/cmp flex items-stretch gap-2 rounded-2xl transition',
        hasDebug ? 'cursor-pointer' : 'cursor-not-allowed opacity-55',
        selected ? 'ring-1 ring-primary bg-primary/[0.04]' : hasDebug && 'hover:bg-muted/40',
      )}
    >
      {/* Selection rail */}
      <div
        className={cn(
          'shrink-0 w-14 flex flex-col items-center justify-center gap-1 rounded-l-2xl transition-colors',
          selected ? 'bg-primary/[0.07]' : 'bg-muted/30 group-hover/cmp:bg-muted/50',
        )}
      >
        <span
          className={cn(
            'flex items-center justify-center size-[18px] rounded-md border transition',
            selected
              ? 'bg-primary border-primary text-primary-foreground'
              : 'border-muted-foreground/40 text-transparent group-hover/cmp:border-muted-foreground/70',
          )}
        >
          <Check size={12} strokeWidth={3} />
        </span>
        <span className='text-[11px] font-semibold tabular-nums text-muted-foreground'>
          #{rank}
        </span>
        <span
          className={cn(
            'text-[10px] tabular-nums leading-none',
            relevant ? 'text-amber-500' : 'text-muted-foreground/70',
          )}
        >
          {score.toFixed(3)}
        </span>
      </div>

      {/* Original result card — non-interactive in compare mode */}
      <div className='flex-1 min-w-0 py-0.5 pointer-events-none select-none'>{children}</div>
    </div>
  );
}
