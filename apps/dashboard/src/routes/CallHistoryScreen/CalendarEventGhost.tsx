import { ReactElement } from 'react';
import { cn } from '../../utils/classNames';

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
        'absolute rounded pointer-events-none z-[4]',
        compact ? 'left-1 right-1' : 'left-2 right-2',
      )}
      style={{
        top,
        height,
        backgroundColor: '#0077FF0D',
        borderLeft: '3px dashed #0077FF',
      }}
    >
      <div className={compact ? 'px-1.5 py-1' : 'px-2 py-1'}>
        <span style={{ color: '#092E58', fontSize: '10px', lineHeight: '14px', opacity: 0.8 }}>
          {formattedTime}
        </span>
      </div>
    </div>
  );
}
