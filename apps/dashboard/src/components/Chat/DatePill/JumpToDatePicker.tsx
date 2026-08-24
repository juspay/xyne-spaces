import { ReactElement, useMemo, useState } from 'react';
import {
  addMonths,
  addYears,
  format,
  isAfter,
  isBefore,
  startOfDay,
  startOfMonth,
  subDays,
} from 'date-fns';
import { CalendarDays, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { Calendar } from '../../ui/Calendar';
import { cn } from '../../../utils/classNames';

export interface JumpToDatePickerProps {
  /** Called with the chosen day (react-day-picker/presets give local midnight). */
  onSelect: (date: Date) => void;
  /** Earliest selectable day (e.g. first message in the conversation). */
  minDate?: Date;
  /** Latest selectable day (defaults to today). */
  maxDate?: Date;
}

interface Preset {
  label: string;
  date: Date;
  trackName: string;
}

type View = 'menu' | 'calendar';

/**
 * Slack-style "jump to date" content. Opens on a list of quick presets plus a
 * "Jump to a specific date" row; choosing that reveals a month calendar with
 * both month (‹ ›) and year («  ») navigation. The picked day is handed to the
 * caller, which jumps to the first message on (or after) it.
 */
export const JumpToDatePicker = ({
  onSelect,
  minDate,
  maxDate,
}: JumpToDatePickerProps): ReactElement => {
  const today = useMemo(() => startOfDay(new Date()), []);
  const upperBound = maxDate ?? today;

  const [view, setView] = useState<View>('menu');
  // Slack always opens the picker on the current month, regardless of which
  // date pill it was launched from.
  const [month, setMonth] = useState<Date>(startOfMonth(today));

  const minMonth = minDate ? startOfMonth(minDate) : undefined;
  const maxMonth = startOfMonth(upperBound);

  const clampMonth = (date: Date): Date => {
    let next = startOfMonth(date);
    if (minMonth && isBefore(next, minMonth)) next = minMonth;
    if (isAfter(next, maxMonth)) next = maxMonth;
    return next;
  };

  // Each nav arrow is disabled independently: a year step can be out of range
  // while a month step is still valid (and vice versa).
  const prevMonthDisabled = !!minMonth && !isAfter(month, minMonth);
  const prevYearDisabled = !!minMonth && isBefore(startOfMonth(addYears(month, -1)), minMonth);
  const nextMonthDisabled = !isBefore(month, maxMonth);
  const nextYearDisabled = isAfter(startOfMonth(addYears(month, 1)), maxMonth);

  const presets = useMemo<Preset[]>(
    () => [
      { label: 'Today', date: today, trackName: 'jump-to-date-today' },
      { label: 'Yesterday', date: subDays(today, 1), trackName: 'jump-to-date-yesterday' },
      { label: 'Last 7 days', date: subDays(today, 7), trackName: 'jump-to-date-last-7-days' },
      { label: 'Last 30 days', date: subDays(today, 30), trackName: 'jump-to-date-last-30-days' },
    ],
    [today],
  );

  const rowClasses = (): string =>
    cn(
      'w-full rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-colors',
      'hover:bg-muted focus-visible:bg-muted focus-visible:outline-none',
    );

  const navButtonClasses =
    'inline-flex h-7 w-7 items-center justify-center rounded-md text-foreground transition-colors ' +
    'hover:bg-muted focus-visible:bg-muted focus-visible:outline-none ' +
    'disabled:pointer-events-none disabled:opacity-40';

  if (view === 'menu') {
    return (
      <div className='flex w-[15rem] flex-col gap-0.5' data-component='jump-to-date-picker'>
        <div className='px-2 pb-1 pt-0.5 text-xs font-medium text-muted-foreground'>Jump to…</div>

        {/* Presets are relative shortcuts and stay enabled; a target older than the
            channel's first message clamps to it (nearest-following) on jump. */}
        {presets.map(preset => (
          <button
            key={preset.label}
            type='button'
            onClick={() => onSelect(preset.date)}
            data-track-category='chat'
            data-track-name={preset.trackName}
            className={rowClasses()}
          >
            {preset.label}
          </button>
        ))}

        <div className='my-1 border-t border-border' />

        <button
          type='button'
          onClick={() => setView('calendar')}
          data-track-category='chat'
          data-track-name='jump-to-date-specific'
          className={cn(rowClasses(), 'flex items-center justify-between gap-2')}
        >
          <span className='flex items-center gap-2'>
            <CalendarDays className='size-4 text-muted-foreground' />
            Jump to a specific date
          </span>
          <ChevronRight className='size-4 text-muted-foreground' />
        </button>
      </div>
    );
  }

  return (
    <div className='flex w-[16rem] flex-col' data-component='jump-to-date-picker'>
      <button
        type='button'
        onClick={() => setView('menu')}
        data-track-category='chat'
        data-track-name='jump-to-date-back'
        className={cn(rowClasses(), 'flex items-center gap-1.5 text-muted-foreground')}
      >
        <ChevronLeft className='size-4' />
        Back
      </button>

      {/* Custom navigation: «  ‹  Month Year  ›  » (month + year steppers). */}
      <div className='flex items-center justify-between px-1 pb-1 pt-0.5'>
        <div className='flex items-center gap-0.5'>
          <button
            type='button'
            aria-label='Previous year'
            disabled={prevYearDisabled}
            onClick={() => setMonth(clampMonth(addYears(month, -1)))}
            data-track-category='chat'
            data-track-name='jump-to-date-prev-year'
            className={navButtonClasses}
          >
            <ChevronsLeft className='size-4' />
          </button>
          <button
            type='button'
            aria-label='Previous month'
            disabled={prevMonthDisabled}
            onClick={() => setMonth(clampMonth(addMonths(month, -1)))}
            data-track-category='chat'
            data-track-name='jump-to-date-prev-month'
            className={navButtonClasses}
          >
            <ChevronLeft className='size-4' />
          </button>
        </div>

        <span className='text-sm font-medium text-foreground'>{format(month, 'MMMM yyyy')}</span>

        <div className='flex items-center gap-0.5'>
          <button
            type='button'
            aria-label='Next month'
            disabled={nextMonthDisabled}
            onClick={() => setMonth(clampMonth(addMonths(month, 1)))}
            data-track-category='chat'
            data-track-name='jump-to-date-next-month'
            className={navButtonClasses}
          >
            <ChevronRight className='size-4' />
          </button>
          <button
            type='button'
            aria-label='Next year'
            disabled={nextYearDisabled}
            onClick={() => setMonth(clampMonth(addYears(month, 1)))}
            data-track-category='chat'
            data-track-name='jump-to-date-next-year'
            className={navButtonClasses}
          >
            <ChevronsRight className='size-4' />
          </button>
        </div>
      </div>

      <Calendar
        mode='single'
        month={month}
        onMonthChange={setMonth}
        hideNavigation
        showOutsideDays={false}
        classNames={{ month_caption: 'hidden' }}
        disabled={{
          ...(minDate ? { before: startOfDay(minDate) } : {}),
          after: startOfDay(upperBound),
        }}
        onSelect={date => {
          if (date) onSelect(date);
        }}
      />
    </div>
  );
};
