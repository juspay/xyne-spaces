import { CalendarDays, X } from 'lucide-react';
import { Calendar } from '../../../ui/Calendar';
import { Popover } from '../../../ui/Popover';

// Holidays recur yearly and are stored without a year. A leap year keeps 29 Feb labelled correctly.
const LEAP_YEAR = 2024;

/** Local date parts, never toISOString — that shifts the day for timezones ahead of UTC. */
function holidayKey(date: Date): string {
  return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function holidayDate(key: string, year = LEAP_YEAR): Date {
  const [month = 1, day = 1] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function holidayLabel(key: string): string {
  return holidayDate(key).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export function HolidaysField({
  days,
  holidays,
  onChange,
}: {
  /** Working weekdays (0 = Sunday); the calendar greys out the rest. */
  days: number[];
  holidays: string[];
  onChange: (next: string[]) => void;
}): React.ReactElement {
  const keys = [...holidays].sort();
  const year = new Date().getFullYear();
  // 29 Feb has no date in a non-leap year: keep it out of the calendar, and keep it stored.
  const shown = keys.filter(key => holidayKey(holidayDate(key, year)) === key);
  const hidden = keys.filter(key => !shown.includes(key));

  return (
    <div className='flex flex-wrap items-center gap-1.5'>
      <Popover
        align='start'
        collisionPadding={8}
        className='max-h-[var(--radix-popover-content-available-height)] w-[min(640px,calc(100vw-2rem))] overflow-y-auto p-2'
        trigger={
          <button
            type='button'
            data-track-category='automation-builder'
            data-track-name='business-hours-holidays-open'
            className='flex h-7 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs text-muted-foreground hover:text-foreground'
          >
            <CalendarDays className='size-3.5' />
            {keys.length === 0 ? 'Add holidays' : `Holidays · ${keys.length}`}
          </button>
        }
      >
        <p className='px-2 pb-1 text-xs text-muted-foreground'>
          Pick the days off. They repeat every year; greyed days are already non-working.
        </p>
        <Calendar
          mode='multiple'
          selected={shown.map(key => holidayDate(key, year))}
          onSelect={dates => onChange([...hidden, ...(dates ?? []).map(holidayKey)])}
          defaultMonth={new Date(year, 0)}
          numberOfMonths={12}
          hideNavigation
          weekStartsOn={1}
          modifiers={{ off: date => !days.includes(date.getDay()) }}
          modifiersClassNames={{ off: 'text-muted-foreground/50' }}
          showOutsideDays={false}
          classNames={{
            months: 'grid grid-cols-3 gap-x-4 gap-y-2 sm:grid-cols-4',
            month_caption: 'flex h-6 items-center px-1',
            caption_label: 'text-xs font-medium text-foreground',
            weekday:
              'flex h-5 flex-1 items-center justify-center text-[10px] font-normal text-muted-foreground',
            day_button:
              'h-6 w-full p-0 inline-flex items-center justify-center rounded-md text-[11px] transition-colors focus-visible:outline-none hover:bg-muted hover:text-foreground',
          }}
        />
      </Popover>
      {keys.map(key => (
        <button
          key={key}
          type='button'
          aria-label={`Remove the ${holidayLabel(key)} holiday`}
          data-track-category='automation-builder'
          data-track-name='business-hours-holiday-remove'
          onClick={() => onChange(keys.filter(k => k !== key))}
          className='flex h-7 items-center gap-1 rounded-md border border-border bg-muted px-2 text-xs text-foreground hover:bg-accent/40'
        >
          {holidayLabel(key)}
          <X className='size-3 text-muted-foreground' />
        </button>
      ))}
    </div>
  );
}
