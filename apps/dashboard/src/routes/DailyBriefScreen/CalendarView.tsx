import { ReactElement, useMemo } from 'react';
import { format } from 'date-fns';
import { Calendar } from '../../components/ui/Calendar';
import { ChevronBigLeft } from '@xyne/icons';

const BUCKET_FORMAT = 'yyyy-MM-dd';

function parseBucket(date: string): Date | null {
  const parsed = new Date(`${date}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

interface CalendarViewProps {
  /** Every day the user has a brief for, as YYYY-MM-DD buckets. */
  availableDates: string[];
  selectedDate: string | null;
  onSelect: (date: string, source: 'history_menu' | 'date_picker') => void;
  onBack: () => void;
}

export function CalendarView({
  availableDates,
  selectedDate,
  onSelect,
  onBack,
}: CalendarViewProps): ReactElement {
  const dateSet = useMemo(() => new Set(availableDates), [availableDates]);

  const bounds = useMemo(() => {
    const parsed = availableDates
      .map(parseBucket)
      .filter((value): value is Date => value !== null)
      .sort((a, b) => a.getTime() - b.getTime());
    return { earliest: parsed[0] ?? null, latest: parsed[parsed.length - 1] ?? null };
  }, [availableDates]);

  const selectedObj = selectedDate ? parseBucket(selectedDate) : null;
  const defaultMonth = selectedObj ?? bounds.latest ?? new Date();

  const handleSelect = (date: Date | undefined): void => {
    if (!date) return;
    onSelect(format(date, BUCKET_FORMAT), 'date_picker');
  };

  return (
    <div className='flex flex-col'>
      <div className='flex items-center gap-1 pb-1 pl-0.5 pr-2.5'>
        <button
          type='button'
          onClick={onBack}
          aria-label='Back to recent briefs'
          data-track-category='DailyBrief'
          data-track-name='daily-brief-calendar-back'
          className='flex size-7 shrink-0 items-center justify-center rounded-[8px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
        >
          <ChevronBigLeft size={14} />
        </button>
        <span className='text-[13px] font-medium tracking-[-0.1px] text-foreground'>
          Select a date
        </span>
      </div>
      {availableDates.length === 0 ? (
        <div className='px-2.5 py-2 text-[13px] text-muted-foreground'>No briefs yet.</div>
      ) : (
        <Calendar
          mode='single'
          {...(selectedObj && { selected: selectedObj })}
          onSelect={handleSelect}
          defaultMonth={defaultMonth}
          {...(bounds.earliest && { startMonth: bounds.earliest })}
          {...(bounds.latest && { endMonth: bounds.latest })}
          disabled={date => !dateSet.has(format(date, BUCKET_FORMAT))}
          classNames={{
            day: 'relative flex-1 p-0 text-center text-sm focus-within:relative focus-within:z-20',
            selected:
              'bg-primary text-white hover:bg-primary hover:text-white focus:bg-primary focus:text-white rounded-md',
            // root: 'relative',
          }}
          // navLayout='around'
          data-track-category='DailyBrief'
          data-track-name='daily-brief-calendar-day'
        />
      )}
    </div>
  );
}
