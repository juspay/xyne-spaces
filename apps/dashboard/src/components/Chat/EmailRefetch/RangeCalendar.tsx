import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react';
import { cn } from '../../../utils/classNames';

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const MONTH_ABBR = [
  'JAN',
  'FEB',
  'MAR',
  'APR',
  'MAY',
  'JUN',
  'JUL',
  'AUG',
  'SEP',
  'OCT',
  'NOV',
  'DEC',
];
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

const startOfDay = (d: Date): Date => {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
};

const isSameDay = (a: Date | null, b: Date | null): boolean => {
  if (!a || !b) return false;
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
};

const isBetween = (d: Date, lo: Date, hi: Date): boolean => {
  const t = startOfDay(d).getTime();
  return t > startOfDay(lo).getTime() && t < startOfDay(hi).getTime();
};

const pad2 = (n: number): string => String(n).padStart(2, '0');

type View = 'days' | 'months' | 'years';

export interface RangeCalendarProps {
  value: Date | null;
  range?: { start: Date | null; end: Date | null };
  onSelect: (date: Date) => void;
  minDate?: Date;
  maxDate?: Date;
}

export const RangeCalendar: React.FC<RangeCalendarProps> = ({
  value,
  range,
  onSelect,
  minDate,
  maxDate,
}) => {
  const [view, setView] = useState<View>('days');
  const [displayDate, setDisplayDate] = useState<Date>(
    () => value ?? range?.start ?? range?.end ?? new Date(),
  );
  const [hoverDate, setHoverDate] = useState<Date | null>(null);

  const year = displayDate.getFullYear();
  const month = displayDate.getMonth();
  const today = startOfDay(new Date());

  const isDisabled = (d: Date): boolean => {
    if (minDate && d < startOfDay(minDate)) return true;
    if (maxDate && d > maxDate) return true;
    return false;
  };

  const renderDaysView = (): React.ReactElement => {
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const rStart = range?.start ?? null;
    const rEnd = range?.end ?? hoverDate;
    const hasRange = rStart && rEnd && !isSameDay(rStart, rEnd) && rEnd >= rStart;

    return (
      <div className='w-[300px] h-[372px] p-3'>
        {/* Header */}
        <div className='flex items-center justify-between mb-3'>
          <button
            type='button'
            onClick={() => setView('months')}
            className='flex items-center gap-1 text-sm font-medium text-foreground hover:bg-muted px-2 py-1 rounded-md transition-colors'
            data-track-category='Support'
            data-track-name='RefetchCalendarOpenMonths'
          >
            {MONTH_NAMES[month]}, {year}
            <ChevronDown className='size-3.5 text-muted-foreground' />
          </button>
          <div className='flex items-center gap-1'>
            <button
              type='button'
              onClick={() => setDisplayDate(new Date(year, month - 1, 1))}
              className='p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted'
              data-track-category='Support'
              data-track-name='RefetchCalendarPrev'
            >
              <ChevronLeft className='size-4' />
            </button>
            <button
              type='button'
              onClick={() => setDisplayDate(new Date(year, month + 1, 1))}
              className='p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted'
              data-track-category='Support'
              data-track-name='RefetchCalendarNext'
            >
              <ChevronRight className='size-4' />
            </button>
          </div>
        </div>

        {/* Weekday labels */}
        <div className='grid grid-cols-7 mb-1 border-b border-border pb-1'>
          {WEEKDAYS.map(d => (
            <div
              key={d}
              className='flex items-center justify-center h-7 text-xs text-muted-foreground'
            >
              {d}
            </div>
          ))}
        </div>

        {/* Day grid — fixed 6 rows × 7 cols so height never jumps */}
        <div className='grid grid-cols-7'>
          {Array.from({ length: 42 }).map((_, i) => {
            const dayNum = i - firstDay + 1;
            if (dayNum < 1 || dayNum > daysInMonth) {
              return <div key={`pad-${i}`} className='h-10' />;
            }
            const d = new Date(year, month, dayNum);
            const disabled = isDisabled(d);
            const isStart = isSameDay(d, rStart);
            const isEnd = isSameDay(d, rEnd);
            const inMiddle = hasRange && rStart && rEnd && isBetween(d, rStart, rEnd);
            const isSelected = isSameDay(d, value);
            const isToday = isSameDay(d, today);

            const bgLayer =
              hasRange && (isStart || isEnd || inMiddle) ? (
                <div
                  className={cn(
                    'absolute inset-y-1 bg-primary/10',
                    isStart && !isEnd && 'left-1/2 right-0',
                    isEnd && !isStart && 'left-0 right-1/2',
                    inMiddle && 'inset-x-0',
                  )}
                />
              ) : null;

            return (
              <div
                key={`d-${dayNum}`}
                className='relative h-10 flex items-center justify-center'
                onMouseEnter={() => !disabled && setHoverDate(d)}
                onMouseLeave={() => setHoverDate(null)}
              >
                {bgLayer}
                <button
                  type='button'
                  disabled={disabled}
                  onClick={() => onSelect(d)}
                  className={cn(
                    'relative z-10 h-9 w-9 flex items-center justify-center rounded-full text-sm transition-colors',
                    disabled && 'text-muted-foreground/40 cursor-not-allowed',
                    !disabled &&
                      !isSelected &&
                      !isStart &&
                      !isEnd &&
                      'hover:bg-muted text-foreground',
                    isToday &&
                      !isSelected &&
                      !isStart &&
                      !isEnd &&
                      'bg-muted/60 font-semibold text-foreground',
                    (isSelected || isStart || isEnd) &&
                      'bg-primary text-primary-foreground font-semibold hover:bg-primary',
                  )}
                  data-track-category='Support'
                  data-track-name='RefetchCalendarDay'
                >
                  {pad2(dayNum)}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  /* ── MONTHS VIEW ───────────────────────────────────────────────────── */
  const renderMonthsView = (): React.ReactElement => (
    <div className='w-[300px] p-3'>
      <div className='flex items-center justify-between mb-3'>
        <button
          type='button'
          onClick={() => setView('years')}
          className='flex items-center gap-1 text-sm font-medium text-foreground hover:bg-muted px-2 py-1 rounded-md transition-colors'
          data-track-category='Support'
          data-track-name='RefetchCalendarOpenYears'
        >
          {year}
          <ChevronDown className='size-3.5 text-muted-foreground' />
        </button>
        <div className='flex items-center gap-1'>
          <button
            type='button'
            onClick={() => setDisplayDate(new Date(year - 1, month, 1))}
            className='p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted'
            data-track-category='Support'
            data-track-name='RefetchCalendarPrevYear'
          >
            <ChevronLeft className='size-4' />
          </button>
          <button
            type='button'
            onClick={() => setDisplayDate(new Date(year + 1, month, 1))}
            className='p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted'
            data-track-category='Support'
            data-track-name='RefetchCalendarNextYear'
          >
            <ChevronRight className='size-4' />
          </button>
        </div>
      </div>
      <div className='grid grid-cols-3 gap-1'>
        {MONTH_ABBR.map((label, i) => {
          const isCurrent = i === month;
          return (
            <button
              key={label}
              type='button'
              onClick={() => {
                setDisplayDate(new Date(year, i, 1));
                setView('days');
              }}
              className={cn(
                'h-12 rounded-md text-sm font-medium transition-colors',
                isCurrent ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-muted',
              )}
              data-track-category='Support'
              data-track-name='RefetchCalendarPickMonth'
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );

  /* ── YEARS VIEW ────────────────────────────────────────────────────── */
  const renderYearsView = (): React.ReactElement => {
    const baseStart = Math.floor(year / 12) * 12;
    const years = Array.from({ length: 12 }, (_, i) => baseStart + i);

    return (
      <div className='w-[300px] h-[372px] p-3'>
        <div className='flex items-center justify-between mb-3'>
          <span className='text-sm font-medium text-foreground px-2 py-1'>
            {years[0]}–{years[years.length - 1]}
          </span>
          <div className='flex items-center gap-1'>
            <button
              type='button'
              onClick={() =>
                setDisplayDate(new Date(baseStart - 12 + (year - baseStart), month, 1))
              }
              className='p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted'
              data-track-category='Support'
              data-track-name='RefetchCalendarPrevDecade'
            >
              <ChevronLeft className='size-4' />
            </button>
            <button
              type='button'
              onClick={() =>
                setDisplayDate(new Date(baseStart + 12 + (year - baseStart), month, 1))
              }
              className='p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted'
              data-track-category='Support'
              data-track-name='RefetchCalendarNextDecade'
            >
              <ChevronRight className='size-4' />
            </button>
          </div>
        </div>
        <div className='grid grid-cols-3 gap-1'>
          {years.map(y => {
            const isCurrent = y === year;
            return (
              <button
                key={y}
                type='button'
                onClick={() => {
                  setDisplayDate(new Date(y, month, 1));
                  setView('months');
                }}
                className={cn(
                  'h-12 rounded-md text-sm font-medium transition-colors',
                  isCurrent ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-muted',
                )}
                data-track-category='Support'
                data-track-name='RefetchCalendarPickYear'
              >
                {y}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  if (view === 'years') return renderYearsView();
  if (view === 'months') return renderMonthsView();
  return renderDaysView();
};
