import type { ReactElement } from 'react';
import { cn } from '../../../utils/classNames';

interface CanvasVersionDiffLegendProps {
  className?: string;
}

/**
 * Explains the inline highlighting used by the version preview while diff mode is on.
 * The diff itself is rendered inside the document, so this is the only chrome it needs.
 */
export const CanvasVersionDiffLegend = ({
  className,
}: CanvasVersionDiffLegendProps): ReactElement => (
  <div className={cn('flex flex-wrap items-center gap-3 text-xs text-muted-foreground', className)}>
    <span className='inline-flex items-center gap-1'>
      <span className='h-2 w-2 rounded-sm bg-emerald-300' />
      In this version
    </span>
    <span className='inline-flex items-center gap-1'>
      <span className='h-2 w-2 rounded-sm bg-red-300' />
      Only in current
    </span>
  </div>
);
