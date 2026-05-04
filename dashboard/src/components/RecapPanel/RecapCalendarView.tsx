import type { ReactElement } from 'react';
import { useMemo } from 'react';
import { format, subDays } from 'date-fns';
import { Calendar } from '../ui/Calendar';

interface RecapCalendarViewProps {
  onDateSelect: (dateStr: string | null) => void;
  selectedDate: string | null;
  onClose: () => void;
}

/**
 * RecapCalendarView - A compact calendar view for browsing historical recaps
 * Uses the shadcn-style Calendar component built on react-day-picker
 */
export function RecapCalendarView({
  onDateSelect,
  selectedDate,
  onClose,
}: RecapCalendarViewProps): ReactElement {
  // Calculate date constraints - last 30 days including today
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(23, 59, 59, 999);
    return d;
  }, []);

  const earliestDate = useMemo(() => subDays(new Date(), 30), []);

  // Convert selectedDate string to Date object for the calendar
  const selectedDateObj = useMemo(() => {
    if (!selectedDate) return undefined;
    return new Date(selectedDate);
  }, [selectedDate]);

  // Handle date selection - convert Date to string format
  const handleSelect = (date: Date | undefined): void => {
    if (date) {
      const dateStr = format(date, 'yyyy-MM-dd');
      onDateSelect(dateStr);
    }
    onClose();
  };

  return (
    <div className='flex flex-col h-full bg-background'>
      {/* Header with close button */}
      <div className='flex items-center justify-between px-4 py-2 bg-background border-b border-border'>
        <span className='text-xs font-semibold text-foreground'>Select Date</span>
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

      {/* Calendar using react-day-picker */}
      <div className='flex-1 overflow-auto p-3'>
        <Calendar
          mode='single'
          selected={selectedDateObj}
          onSelect={handleSelect}
          disabled={{ before: earliestDate, after: today }}
          defaultMonth={selectedDateObj ?? new Date()}
          data-track-category='RECAP_CALENDAR'
          data-track-name='SelectDate'
        />
      </div>

      {/* Footer */}
      <div className='px-3 py-2 border-t border-border bg-muted/30'>
        <div className='flex items-center justify-between text-[10px] text-muted-foreground'>
          <span>
            {selectedDate
              ? `Selected: ${format(new Date(selectedDate), 'MMM d, yyyy')}`
              : "Viewing today's recap"}
          </span>
          <span className='text-muted-foreground/60'>Last 30 days available</span>
        </div>
      </div>
    </div>
  );
}
