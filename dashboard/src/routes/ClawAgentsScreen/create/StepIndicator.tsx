import { Fragment, ReactElement } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/utils/classNames';

/**
 * Numbered step indicator: completed steps show a check on a filled circle,
 * the active step is ringed, upcoming steps are muted; connectors between them
 * fill as you advance. Ported from the reference wizard.
 */
export function StepIndicator({
  steps,
  current,
}: {
  steps: readonly string[];
  current: number;
}): ReactElement {
  return (
    <div className='flex justify-center'>
      {steps.map((label, i) => (
        <Fragment key={label}>
          <div className='flex shrink-0 flex-col items-center gap-1.5'>
            <div
              className={cn(
                'flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold transition-all duration-200',
                i < current
                  ? 'bg-primary text-primary-foreground'
                  : i === current
                    ? 'bg-card text-foreground ring-2 ring-primary'
                    : 'bg-muted text-muted-foreground',
              )}
            >
              {i < current ? <Check size={11} strokeWidth={2.5} /> : i + 1}
            </div>
            <span
              className={cn(
                'text-[10px] font-medium leading-none transition-colors duration-200',
                i === current ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              {label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div
              className={cn(
                'mx-3 mt-3 h-px w-16 shrink-0 transition-colors duration-300',
                i < current ? 'bg-primary' : 'bg-border/60',
              )}
            />
          )}
        </Fragment>
      ))}
    </div>
  );
}
