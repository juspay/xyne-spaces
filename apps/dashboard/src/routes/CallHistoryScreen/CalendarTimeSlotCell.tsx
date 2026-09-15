import { type ReactNode, type ReactElement } from 'react';
import { cn } from '../../utils/classNames';
import { createSlotClickHandler } from './CalenderViewUtils';

interface CalendarTimeSlotCellProps {
  setNodeRef: (node: HTMLElement | null) => void;
  date: Date;
  isPopoverOpen: boolean;
  onCreateCallAtSlot: ((startsAt: Date, endsAt: Date) => void) | undefined;
  onDragCreatePointerDown:
    | ((e: React.PointerEvent<HTMLDivElement>, date: Date) => void)
    | undefined;
  consumeDragEnd: (() => boolean) | undefined;
  trackName: string;
  className?: string;
  children: ReactNode;
}

export function CalendarTimeSlotCell({
  setNodeRef,
  date,
  isPopoverOpen,
  onCreateCallAtSlot,
  onDragCreatePointerDown,
  consumeDragEnd,
  trackName,
  className,
  children,
}: CalendarTimeSlotCellProps): ReactElement {
  const handleClick = createSlotClickHandler(
    date,
    isPopoverOpen,
    consumeDragEnd,
    onCreateCallAtSlot,
  );

  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events
    <div
      ref={setNodeRef}
      role='gridcell'
      tabIndex={0}
      onClick={handleClick}
      onPointerDown={
        onDragCreatePointerDown && !isPopoverOpen
          ? e => onDragCreatePointerDown(e, date)
          : undefined
      }
      data-track-category='CALLS'
      data-track-name={trackName}
      className={cn('flex-1 relative', onCreateCallAtSlot && 'cursor-pointer', className)}
    >
      {children}
    </div>
  );
}
