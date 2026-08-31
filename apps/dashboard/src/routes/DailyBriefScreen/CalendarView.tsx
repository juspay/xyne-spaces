import { ReactElement, useMemo } from 'react';
import { format } from 'date-fns';
import { DayPicker } from 'react-day-picker';
import { ChevronBigLeft, ChevronBigRight } from '@xyne/icons';
const BUCKET_FORMAT = 'yyyy-MM-dd';

function parseBucket(date: string): Date | null {
  const parsed = new Date(`${date}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const NAV_BUTTON_CLASS =
  'z-10 inline-flex size-7 items-center justify-center rounded-[8px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40 aria-disabled:pointer-events-none aria-disabled:opacity-40';

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
    <div className='flex flex-col gap-2'>
      <button
        type='button'
        onClick={onBack}
        aria-label='Back to recent briefs'
        data-track-category='DailyBrief'
        data-track-name='daily-brief-calendar-back'
        className='self-start flex items-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground pl-0.5 pr-1 py-0.5'
      >
        <ChevronBigLeft size={14} variant='Solid' />
        <span className='text-xs font-medium tracking-[-0.1px] text-foreground'>List View</span>
      </button>
      {availableDates.length === 0 ? (
        <div className='px-2.5 py-2 text-[13px] text-muted-foreground'>No briefs yet.</div>
      ) : (
        <DayPicker
          mode='single'
          navLayout='after'
          showOutsideDays
          weekStartsOn={0}
          {...(selectedObj && { selected: selectedObj })}
          onSelect={handleSelect}
          defaultMonth={defaultMonth}
          {...(bounds.earliest && { startMonth: bounds.earliest })}
          {...(bounds.latest && { endMonth: bounds.latest })}
          disabled={date => !dateSet.has(format(date, BUCKET_FORMAT))}
          className='w-full'
          classNames={{
            months: 'flex w-full flex-col',
            month: 'relative w-full',
            month_caption: 'flex h-7 items-center px-2',
            caption_label: 'text-lg font-medium tracking-[-0.1px] text-foreground',
            nav: 'absolute top-0 right-0 px-1',
            button_previous: `${NAV_BUTTON_CLASS}`,
            button_next: `${NAV_BUTTON_CLASS}`,
            month_grid: 'mt-1 w-full border-collapse',
            weekdays: 'flex w-full',
            weekday:
              'flex h-7 flex-1 items-center justify-center text-[11px] font-normal text-muted-foreground',
            week: 'flex w-full',
            day: 'flex-1 p-0 text-center',
            day_button:
              'flex h-8 w-full items-center justify-center rounded-[8px] text-[13px] font-normal text-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none disabled:pointer-events-none disabled:text-muted-foreground/30',
            selected:
              '[&_button]:bg-primary [&_button]:text-white [&_button]:hover:bg-primary [&_button]:hover:text-white',
            today: '[&_button]:font-semibold',
            outside: '[&_button]:text-muted-foreground/40',
            disabled: '[&_button]:text-muted-foreground/30',
            hidden: 'invisible',
          }}
          components={{
            Chevron: ({ orientation }) => {
              const Icon = orientation === 'left' ? ChevronBigLeft : ChevronBigRight;
              return <Icon size={18} />;
            },
          }}
          data-track-category='DailyBrief'
          data-track-name='daily-brief-calendar-day'
        />
      )}
    </div>
  );
}
