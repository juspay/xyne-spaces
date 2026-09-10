import React, { useState, useMemo, useCallback } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { cn } from '../../../utils/classNames';
import { TimePicker } from '../TimePicker/TimePicker';

export interface DateRangeValue {
  startDate: Date;
  endDate: Date;
}

interface DateRangeFilterProps {
  dateRange: DateRangeValue | null;
  onChange: (range: DateRangeValue | null) => void;
  className?: string;
}

/* ── Date helpers ── */
const startOfDay = (d: Date): Date => {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
};

const endOfDay = (d: Date): Date => {
  const r = new Date(d);
  r.setHours(23, 59, 59, 999);
  return r;
};

const isSameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

const isInRange = (d: Date, start: Date, end: Date): boolean => {
  const t = startOfDay(d).getTime();
  return t >= startOfDay(start).getTime() && t <= startOfDay(end).getTime();
};

export const formatShortDate = (d: Date): string => {
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  return `${months[d.getMonth()]} ${d.getDate()}`;
};

const getDaysInMonth = (year: number, month: number): number =>
  new Date(year, month + 1, 0).getDate();
const getFirstDayOfMonth = (year: number, month: number): number =>
  new Date(year, month, 1).getDay();

/* ── Presets ── */
export interface Preset {
  label: string;
  getValue: () => DateRangeValue;
}

export const PRESETS: Preset[] = [
  {
    label: 'Today',
    getValue: () => ({ startDate: startOfDay(new Date()), endDate: endOfDay(new Date()) }),
  },
  {
    label: 'Yesterday',
    getValue: () => {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      return { startDate: startOfDay(d), endDate: endOfDay(d) };
    },
  },
  {
    label: 'Last 7 days',
    getValue: () => {
      const end = new Date();
      const start = new Date();
      start.setDate(start.getDate() - 6);
      return { startDate: startOfDay(start), endDate: endOfDay(end) };
    },
  },
  {
    label: 'Last 30 days',
    getValue: () => {
      const end = new Date();
      const start = new Date();
      start.setDate(start.getDate() - 29);
      return { startDate: startOfDay(start), endDate: endOfDay(end) };
    },
  },
  {
    label: 'Last 6 months',
    getValue: () => {
      const end = new Date();
      const start = new Date();
      start.setMonth(start.getMonth() - 6);
      return { startDate: startOfDay(start), endDate: endOfDay(end) };
    },
  },
];

export const matchPreset = (range: DateRangeValue | null): string | null => {
  if (!range) return null;
  for (const preset of PRESETS) {
    const v = preset.getValue();
    if (isSameDay(range.startDate, v.startDate) && isSameDay(range.endDate, v.endDate)) {
      return preset.label;
    }
  }
  return null;
};

/* ── Calendar ── */
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

export const CalendarView: React.FC<{
  range: DateRangeValue | null;
  onSelect: (range: DateRangeValue) => void;
}> = ({ range, onSelect }) => {
  const today = useMemo(() => startOfDay(new Date()), []);
  const [viewDate, setViewDate] = useState(() => range?.startDate ?? new Date());
  const [selStart, setSelStart] = useState<Date | null>(range?.startDate ?? null);
  const [selEnd, setSelEnd] = useState<Date | null>(range?.endDate ?? null);
  const [hoverDate, setHoverDate] = useState<Date | null>(null);

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);
  const monthLabel = `${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][month]} ${year}`;

  const prevMonth = () => setViewDate(new Date(year, month - 1, 1));
  const nextMonth = () => setViewDate(new Date(year, month + 1, 1));

  const handleDayClick = useCallback(
    (day: number) => {
      const clicked = new Date(year, month, day);
      if (!selStart || selEnd) {
        setSelStart(clicked);
        setSelEnd(null);
      } else {
        if (clicked < selStart) {
          setSelStart(clicked);
          setSelEnd(null);
        } else {
          setSelEnd(clicked);
          onSelect({ startDate: startOfDay(selStart), endDate: endOfDay(clicked) });
        }
      }
    },
    [selStart, selEnd, year, month, onSelect],
  );

  const getDayClass = (day: number): string => {
    const d = new Date(year, month, day);
    const isToday = isSameDay(d, today);
    const isStart = selStart && isSameDay(d, selStart);
    const isEnd = selEnd && isSameDay(d, selEnd);
    const rangeEnd = selEnd ?? hoverDate;
    const inRange =
      selStart &&
      rangeEnd &&
      rangeEnd >= selStart &&
      isInRange(d, selStart, rangeEnd) &&
      !isStart &&
      !isEnd;

    if (isStart || isEnd) return 'bg-action-primary text-action-primary-foreground';
    if (inRange) return 'bg-accent text-accent-foreground';
    if (isToday) return 'border border-action-primary text-foreground';
    return 'text-foreground hover:bg-muted';
  };

  return (
    <div data-id='date-range-calendar' className='w-[252px] p-3'>
      <div className='flex items-center justify-between mb-2'>
        <button
          type='button'
          onClick={prevMonth}
          data-track-category='DATE_RANGE_FILTER'
          data-track-name='PREV_MONTH'
          className='p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted'
        >
          <ChevronLeft className='size-4' />
        </button>
        <span className='text-sm font-medium text-foreground'>{monthLabel}</span>
        <button
          type='button'
          onClick={nextMonth}
          data-track-category='DATE_RANGE_FILTER'
          data-track-name='NEXT_MONTH'
          className='p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted'
        >
          <ChevronRight className='size-4' />
        </button>
      </div>
      <div className='grid grid-cols-7 gap-0'>
        {WEEKDAYS.map(d => (
          <div
            key={d}
            className='flex items-center justify-center h-8 text-xs text-muted-foreground'
          >
            {d}
          </div>
        ))}
        {Array.from({ length: firstDay }).map((_, i) => (
          <div key={`empty-${i}`} className='h-8' />
        ))}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day = i + 1;
          return (
            <button
              key={day}
              type='button'
              onClick={() => handleDayClick(day)}
              data-track-category='DATE_RANGE_FILTER'
              data-track-name='SELECT_DAY'
              onMouseEnter={() => setHoverDate(new Date(year, month, day))}
              onMouseLeave={() => setHoverDate(null)}
              className={cn(
                'flex items-center justify-center h-8 w-8 text-sm rounded-full cursor-pointer',
                getDayClass(day),
              )}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
};

/* ── Time-of-day helpers ── */
// `TimePicker` speaks 12-hour "h:mm AM/PM" strings — this is its native
// display/parse format (see its own usage in ScheduleCallModal.tsx), so we
// convert to/from that instead of a 24-hour "HH:mm" of our own.
const formatTimeLabel = (d: Date): string =>
  d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

const parseTimeLabel = (value: string): { h: number; m: number } | null => {
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(value.trim());
  if (!match?.[1] || !match[2] || !match[3]) return null;
  const h = (Number(match[1]) % 12) + (/PM/i.test(match[3]) ? 12 : 0);
  return { h, m: Number(match[2]) };
};

const applyTime = (date: Date, h: number, m: number, isEnd: boolean): Date => {
  const r = new Date(date);
  if (isEnd) r.setHours(h, m, 59, 999);
  else r.setHours(h, m, 0, 0);
  return r;
};

const isFullDaySpan = (r: DateRangeValue): boolean =>
  r.startDate.getHours() === 0 &&
  r.startDate.getMinutes() === 0 &&
  r.endDate.getHours() === 23 &&
  r.endDate.getMinutes() === 59;

/* ── Main component ── */
export const DateRangeFilter: React.FC<DateRangeFilterProps> = ({
  dateRange,
  onChange,
  className,
}) => {
  const [presetOpen, setPresetOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);

  const activePreset = useMemo(() => matchPreset(dateRange), [dateRange]);

  const presetLabel = activePreset ?? (dateRange ? 'Custom' : 'Date');

  const rangeLabel = useMemo(() => {
    if (!dateRange) return 'Select dates';
    const base = isSameDay(dateRange.startDate, dateRange.endDate)
      ? formatShortDate(dateRange.startDate)
      : `${formatShortDate(dateRange.startDate)} – ${formatShortDate(dateRange.endDate)}`;
    if (isFullDaySpan(dateRange)) return base;
    return `${base} · ${formatTimeLabel(dateRange.startDate)}–${formatTimeLabel(dateRange.endDate)}`;
  }, [dateRange]);

  const handlePresetSelect = (preset: Preset) => {
    onChange(preset.getValue());
    setPresetOpen(false);
  };

  const carryTime = (picked: Date, existing: Date | undefined, isEnd: boolean): Date =>
    existing ? applyTime(picked, existing.getHours(), existing.getMinutes(), isEnd) : picked;

  const handleCalendarSelect = (range: DateRangeValue) => {
    // Carry over whatever time-of-day is already set, instead of resetting
    // a deliberately-narrowed time window back to the full day. Popover
    // stays open — picking the date shouldn't close it before the user gets
    // a chance to also set the time.
    onChange({
      startDate: carryTime(range.startDate, dateRange?.startDate, false),
      endDate: carryTime(range.endDate, dateRange?.endDate, true),
    });
  };

  // Time picker applies instantly against the already-committed range — no
  // separate staging/Apply step, so picking a date and narrowing its time
  // are just two ordinary edits to the same value.
  const handleTimeChange = (
    field: 'startDate' | 'endDate',
    isEnd: boolean,
    value: string,
  ): void => {
    const parsed = dateRange && parseTimeLabel(value);
    if (!dateRange || !parsed) return;
    onChange({ ...dateRange, [field]: applyTime(dateRange[field], parsed.h, parsed.m, isEnd) });
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(null);
  };

  return (
    <div
      data-id='ticket-header-date-range-filter'
      className={cn(
        'inline-flex h-7 items-center rounded-full border border-border divide-x divide-border text-sm',
        className,
      )}
    >
      {/* Left — Preset dropdown */}
      <Popover.Root open={presetOpen} onOpenChange={setPresetOpen}>
        <Popover.Trigger asChild>
          <button
            type='button'
            data-id='date-range-preset-trigger'
            className='flex items-center gap-1 h-full px-2.5 rounded-l-full text-foreground hover:bg-muted/50 whitespace-nowrap'
          >
            <span className={cn(activePreset && 'text-foreground font-medium')}>{presetLabel}</span>
            <ChevronDown className='size-3 text-muted-foreground' />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            data-id='date-range-preset-popover'
            side='bottom'
            align='start'
            sideOffset={4}
            className='z-50 min-w-[140px] rounded-xl border bg-popover text-popover-foreground shadow-md p-1 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 duration-150'
            onCloseAutoFocus={e => e.preventDefault()}
          >
            {PRESETS.map(preset => (
              <button
                key={preset.label}
                type='button'
                onClick={() => handlePresetSelect(preset)}
                data-track-category='DATE_RANGE_FILTER'
                data-track-name='SELECT_PRESET'
                className={cn(
                  'flex w-full items-center rounded-sm px-2 py-1.5 text-sm select-none',
                  activePreset === preset.label
                    ? 'bg-accent text-foreground font-medium'
                    : 'hover:bg-accent hover:text-accent-foreground',
                )}
              >
                {preset.label}
              </button>
            ))}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      {/* Right — Calendar range */}
      <Popover.Root open={calendarOpen} onOpenChange={setCalendarOpen}>
        <Popover.Trigger asChild>
          <button
            type='button'
            data-id='date-range-calendar-trigger'
            className='flex items-center gap-1.5 h-full px-2.5 rounded-r-full hover:bg-muted/50 whitespace-nowrap'
          >
            <CalendarDays className='size-3.5 text-muted-foreground' />
            <span className={cn(dateRange ? 'text-foreground' : 'text-muted-foreground')}>
              {rangeLabel}
            </span>
            {dateRange && (
              <button
                type='button'
                data-id='date-range-clear'
                onClick={handleClear}
                data-track-category='DATE_RANGE_FILTER'
                data-track-name='CLEAR_RANGE'
                className='p-0.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted'
              >
                <X className='size-3' />
              </button>
            )}
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            data-id='date-range-calendar-popover'
            side='bottom'
            align='end'
            sideOffset={4}
            className='z-50 rounded-xl border bg-popover text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 duration-150'
            onCloseAutoFocus={e => e.preventDefault()}
          >
            <CalendarView range={dateRange} onSelect={handleCalendarSelect} />
            <div className='flex items-center gap-2 border-t border-border p-3'>
              <TimePicker
                value={dateRange ? formatTimeLabel(dateRange.startDate) : ''}
                onChange={value => handleTimeChange('startDate', false, value)}
                placeholder='Start time'
                disabled={!dateRange}
              />
              <span className='text-xs text-muted-foreground'>–</span>
              <TimePicker
                value={dateRange ? formatTimeLabel(dateRange.endDate) : ''}
                onChange={value => handleTimeChange('endDate', true, value)}
                placeholder='End time'
                disabled={!dateRange}
              />
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
};
