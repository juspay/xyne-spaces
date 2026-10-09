import { ReactElement } from 'react';
import { cn } from '../../utils/classNames';
import { HATCH_BACKGROUND } from './CalenderViewUtils';

interface CalendarEventGhostProps {
  top: number;
  height: number;
  formattedTime: string;
  /** WeekView columns are narrower — compact reduces inset and content padding */
  compact?: boolean;
}

export function CalendarEventGhost({
  top,
  height,
  formattedTime,
  compact = false,
}: CalendarEventGhostProps): ReactElement {
  return (
    <div
      className={cn(
        'absolute overflow-hidden rounded-lg border-2 border-dashed border-primary/70 bg-primary/10 text-primary pointer-events-none z-[4]',
        compact ? 'left-1 right-1' : 'left-2 right-2',
      )}
      style={{ top, height, backgroundImage: HATCH_BACKGROUND }}
    >
      <div className={compact ? 'px-1.5 py-1' : 'px-3 py-1'}>
        <span className='truncate text-xs font-semibold leading-tight text-primary'>
          {formattedTime}
        </span>
      </div>
    </div>
  );
}
