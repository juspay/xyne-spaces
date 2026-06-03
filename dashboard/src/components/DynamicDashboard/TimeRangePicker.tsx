import { ReactElement, useCallback, useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { cn } from '../../utils/classNames';
import {
  RELATIVE_RANGE_OPTIONS,
  relativeRangeLabel,
  type DashboardTimeRange,
} from '../../services/DynamicDashboard/planResolver';
import { Popover } from '../ui/Popover/Popover';

interface TimeRangePickerProps {
  value: DashboardTimeRange | null;
  onChange: (next: DashboardTimeRange | null) => void;
}

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}
function endOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(23, 59, 59, 999);
  return r;
}
function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
function isInRange(d: Date, start: Date, end: Date): boolean {
  const t = startOfDay(d).getTime();
  return t >= startOfDay(start).getTime() && t <= startOfDay(end).getTime();
}

export const TimeRangePicker = ({ value, onChange }: TimeRangePickerProps): ReactElement => {
  const isAbsolute = !!value?.from && !!value?.to;
  const isActive = !!value?.relative || isAbsolute;
  const [isOpen, setIsOpen] = useState(false);

  const label = value?.relative
    ? relativeRangeLabel(value.relative)
    : value?.from && value?.to
      ? `${value.from.slice(0, 10)} → ${value.to.slice(0, 10)}`
      : 'Date filter';

  const initialRange: { start: Date | null; end: Date | null } =
    value?.from && value?.to
      ? { start: new Date(value.from), end: new Date(value.to) }
      : { start: null, end: null };

  return (
    <Popover
      side='bottom'
      align='end'
      sideOffset={6}
      open={isOpen}
      onOpenChange={setIsOpen}
      trigger={
        <button
          className={`inline-flex items-center gap-2 h-9 px-3 rounded-[10px] border border-xyne-gray-200 bg-white text-[13px] leading-[18px] font-medium transition-colors hover:bg-xyne-gray-50 ${
            isActive ? 'text-xyne-gray-900' : 'text-xyne-gray-500'
          }`}
          data-track-category='DYNAMIC_DASHBOARD'
          data-track-name='Open_Time_Range_Picker'
        >
          <span>{label}</span>
          <ChevronDown size={14} className='text-xyne-gray-400' />
        </button>
      }
    >
      <div className='flex'>
        <div className='w-40 p-1.5 border-r border-border'>
          <PresetItem
            label='All time'
            selected={!isActive}
            onClick={() => {
              onChange(null);
              setIsOpen(false);
            }}
          />
          <div className='h-px bg-border my-1' />
          {RELATIVE_RANGE_OPTIONS.map(r => (
            <PresetItem
              key={r}
              label={relativeRangeLabel(r)}
              selected={value?.relative === r}
              onClick={() => {
                onChange({ relative: r });
                setIsOpen(false);
              }}
            />
          ))}
        </div>
        <RangeCalendar
          initial={initialRange}
          onSelect={(start, end) => {
            onChange({ from: start.toISOString(), to: end.toISOString() });
            setIsOpen(false);
          }}
        />
      </div>
    </Popover>
  );
};

interface RangeCalendarProps {
  initial: { start: Date | null; end: Date | null };
  onSelect: (start: Date, end: Date) => void;
}

const RangeCalendar = ({ initial, onSelect }: RangeCalendarProps): ReactElement => {
  const today = useMemo(() => startOfDay(new Date()), []);
  const [viewDate, setViewDate] = useState(() => initial.start ?? new Date());
  const [selStart, setSelStart] = useState<Date | null>(initial.start);
  const [selEnd, setSelEnd] = useState<Date | null>(initial.end);
  const [hoverDate, setHoverDate] = useState<Date | null>(null);

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDay = new Date(year, month, 1).getDay();
  const monthLabel = `${
    [
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
    ][month]
  } ${year}`;

  const handleDayClick = useCallback(
    (day: number) => {
      const clicked = new Date(year, month, day);
      if (!selStart || selEnd) {
        setSelStart(clicked);
        setSelEnd(null);
        return;
      }
      if (clicked < selStart) {
        setSelStart(clicked);
        setSelEnd(null);
        return;
      }
      const start = startOfDay(selStart);
      const end = endOfDay(clicked);
      setSelEnd(clicked);
      onSelect(start, end);
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
    <div className='w-[280px] p-3'>
      <div className='flex items-center justify-between mb-2'>
        <button
          type='button'
          onClick={() => setViewDate(new Date(year, month - 1, 1))}
          className='p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted'
          aria-label='Previous month'
          data-track-category='DYNAMIC_DASHBOARD'
          data-track-name='Calendar_Prev_Month'
        >
          <ChevronLeft className='size-4' />
        </button>
        <span className='text-sm font-medium text-foreground'>{monthLabel}</span>
        <button
          type='button'
          onClick={() => setViewDate(new Date(year, month + 1, 1))}
          className='p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted'
          aria-label='Next month'
          data-track-category='DYNAMIC_DASHBOARD'
          data-track-name='Calendar_Next_Month'
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
              onMouseEnter={() => setHoverDate(new Date(year, month, day))}
              onMouseLeave={() => setHoverDate(null)}
              data-track-category='DYNAMIC_DASHBOARD'
              data-track-name='Calendar_Pick_Day'
              className={cn(
                'flex items-center justify-center h-8 w-8 mx-auto text-sm rounded-full cursor-pointer',
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

interface PresetItemProps {
  label: string;
  selected: boolean;
  onClick: () => void;
}
const PresetItem = ({ label, selected, onClick }: PresetItemProps): ReactElement => (
  <button
    onClick={onClick}
    className={`flex items-center justify-between w-full px-2 py-1.5 rounded text-sm transition-colors ${
      selected ? 'bg-accent text-foreground' : 'text-foreground hover:bg-accent/60'
    }`}
    data-track-category='DYNAMIC_DASHBOARD'
    data-track-name='Select_Time_Preset'
  >
    <span>{label}</span>
    {selected && <Check size={12} className='text-foreground' />}
  </button>
);

interface AutoRefreshPickerProps {
  value: number | null;
  onChange: (next: number | null) => void;
}

const REFRESH_OPTIONS: ReadonlyArray<{ value: number | null; label: string }> = [
  { value: null, label: 'Off' },
  { value: 30_000, label: '30s' },
  { value: 60_000, label: '1m' },
  { value: 5 * 60_000, label: '5m' },
  { value: 15 * 60_000, label: '15m' },
];

export const AutoRefreshPicker = ({ value, onChange }: AutoRefreshPickerProps): ReactElement => {
  const current = REFRESH_OPTIONS.find(o => o.value === value) ?? REFRESH_OPTIONS[0];
  const isActive = !!value;
  const [isOpen, setIsOpen] = useState(false);
  return (
    <Popover
      side='bottom'
      align='end'
      sideOffset={6}
      open={isOpen}
      onOpenChange={setIsOpen}
      trigger={
        <button
          className={`inline-flex items-center gap-2 h-9 px-3 rounded-[10px] border border-xyne-gray-200 bg-white text-[13px] leading-[18px] font-medium transition-colors hover:bg-xyne-gray-50 ${
            isActive ? 'text-xyne-gray-900' : 'text-xyne-gray-500'
          }`}
          data-track-category='DYNAMIC_DASHBOARD'
          data-track-name='Open_Auto_Refresh_Picker'
        >
          <RefreshCw
            size={14}
            className={isActive ? 'animate-spin-slow text-xyne-gray-400' : 'text-xyne-gray-400'}
          />
          <span>{current!.label === 'Off' ? 'Auto refresh' : current!.label}</span>
          <ChevronDown size={14} className='text-xyne-gray-400' />
        </button>
      }
    >
      <div className='w-40 p-1.5'>
        {REFRESH_OPTIONS.map(o => (
          <PresetItem
            key={o.label}
            label={o.label}
            selected={o.value === value}
            onClick={() => {
              onChange(o.value);
              setIsOpen(false);
            }}
          />
        ))}
      </div>
    </Popover>
  );
};
