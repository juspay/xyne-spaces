import type { ReactElement } from 'react';
import { useMemo, useState } from 'react';
import { format, subDays } from 'date-fns';
import type { DateRange } from 'react-day-picker';
import { Calendar } from '../ui/Calendar';

export interface RecapDateRange {
  start: string; // YYYY-MM-DD (recap date, inclusive)
  end: string; // YYYY-MM-DD (recap date, inclusive)
}

interface RecapCalendarViewProps {
  onRangeSelect: (range: RecapDateRange) => void;
  selectedRange: RecapDateRange | null;
  onClose: () => void;
}

/**
 * RecapCalendarView - A compact range calendar for browsing recaps between two dates.
 * Dates refer to recap dates directly (inclusive on both ends).
 * Uses the shadcn-style Calendar component built on react-day-picker.
 */
export function RecapCalendarView({
  onRangeSelect,
  selectedRange,
  onClose,
}: RecapCalendarViewProps): ReactElement {
  // Recaps only exist up to yesterday, so today is not selectable.
  const latestSelectable = useMemo(() => {
    const d = subDays(new Date(), 1);
    d.setHours(23, 59, 59, 999);
    return d;
  }, []);

  const earliestDate = useMemo(() => subDays(new Date(), 30), []);

  // Local selection state - clicking once picks the start, clicking again picks the end
  const [pendingRange, setPendingRange] = useState<DateRange | undefined>(() =>
    selectedRange
      ? {
          from: new Date(`${selectedRange.start}T00:00:00Z`),
          to: new Date(`${selectedRange.end}T00:00:00Z`),
        }
      : undefined,
  );

  // Driven by the CLICKED day, not react-day-picker's computed range: in v9 the first
  // click already reports a collapsed complete range, which would apply a one-day range
  // immediately and make a two-click selection impossible.
  const handleSelect = (_range: DateRange | undefined, clickedDay: Date | undefined): void => {
    if (!clickedDay) return;

    const isStartingFresh = !pendingRange?.from || (pendingRange.from && pendingRange.to);
    if (isStartingFresh) {
      setPendingRange({ from: clickedDay, to: undefined });
      return;
    }

    // Second click completes it; either direction is accepted
    const first = pendingRange.from as Date;
    const [from, to] = clickedDay < first ? [clickedDay, first] : [first, clickedDay];
    setPendingRange({ from, to });
    onRangeSelect({
      start: format(from, 'yyyy-MM-dd'),
      end: format(to, 'yyyy-MM-dd'),
    });
    onClose();
  };

  return (
    <div className='flex flex-col h-full bg-background'>
      {/* Header with close button */}
      <div className='flex items-center justify-between px-4 py-2 bg-background border-b border-border'>
        <span className='text-xs font-semibold text-foreground'>Select Date Range</span>
        <button
          type='button'
          onClick={onClose}
          className='text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-accent transition-colors'
          data-track-category='RECAP_CALENDAR'
          data-track-name='CloseCalendar'
        >
          Close
        </button>
      </div>

      {/* Calendar using react-day-picker (range mode) */}
      <div className='flex-1 overflow-auto p-3'>
        <Calendar
          mode='range'
          selected={pendingRange}
          onSelect={handleSelect}
          disabled={{ before: earliestDate, after: latestSelectable }}
          defaultMonth={pendingRange?.from ?? new Date()}
          data-track-category='RECAP_CALENDAR'
          data-track-name='SelectDateRange'
        />
      </div>

      {/* Footer */}
      <div className='px-3 py-2 border-t border-border bg-muted/30'>
        <div className='flex items-center justify-between text-[10px] text-muted-foreground'>
          <span>
            {pendingRange?.from
              ? pendingRange.to
                ? `${format(pendingRange.from, 'MMM d')} – ${format(pendingRange.to, 'MMM d, yyyy')}`
                : `Start: ${format(pendingRange.from, 'MMM d, yyyy')} — pick an end date`
              : 'Pick a start and end date'}
          </span>
          <span className='text-muted-foreground/60'>Last 30 days available</span>
        </div>
      </div>
    </div>
  );
}
