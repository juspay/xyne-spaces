import React, { useState, useRef } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../../utils/classNames';
import { CalendarView, type DateRangeValue } from '../../ui/DateRangeFilter';

const DEFAULT_MAX_DAYS = 90;

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
/** Calendar days a range covers, inclusive — what the preset labels count. */
const spanDays = (r: DateRangeValue): number =>
  Math.round(
    (startOfDay(r.endDate).getTime() - startOfDay(r.startDate).getTime()) / (24 * 60 * 60 * 1000),
  ) + 1;
const isSameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();
const fmtShort = (d: Date): string => {
  const mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${mo[d.getMonth()]} ${d.getDate()}`;
};

const PRESETS = [
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
      const e = new Date(),
        s = new Date();
      s.setDate(s.getDate() - 6);
      return { startDate: startOfDay(s), endDate: endOfDay(e) };
    },
  },
  {
    label: 'Last 30 days',
    getValue: () => {
      const e = new Date(),
        s = new Date();
      s.setDate(s.getDate() - 29);
      return { startDate: startOfDay(s), endDate: endOfDay(e) };
    },
  },
  {
    label: 'Last 60 days',
    getValue: () => {
      const e = new Date(),
        s = new Date();
      s.setDate(s.getDate() - 59);
      return { startDate: startOfDay(s), endDate: endOfDay(e) };
    },
  },
  {
    label: 'Last 90 days',
    getValue: () => {
      const e = new Date(),
        s = new Date();
      s.setDate(s.getDate() - 89);
      return { startDate: startOfDay(s), endDate: endOfDay(e) };
    },
  },
];

const matchPreset = (dr: DateRangeValue): string | null => {
  for (const p of PRESETS) {
    const v = p.getValue();
    if (isSameDay(dr.startDate, v.startDate) && isSameDay(dr.endDate, v.endDate)) return p.label;
  }
  return null;
};

const TimeInput: React.FC<{ value: string; onChange: (v: string) => void }> = ({
  value,
  onChange,
}) => {
  const [h, setH] = useState(() => value.split(':')[0] ?? '00');
  const [m, setM] = useState(() => value.split(':')[1] ?? '00');
  const minRef = useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    setH(value.split(':')[0] ?? '00');
    setM(value.split(':')[1] ?? '00');
  }, [value]);

  const clampFmt = (v: string, max: number) =>
    String(Math.min(max, Math.max(0, parseInt(v || '0', 10)))).padStart(2, '0');

  const commit = (hRaw: string, mRaw: string) => {
    const hFmt = clampFmt(hRaw, 23);
    const mFmt = clampFmt(mRaw, 59);
    setH(hFmt);
    setM(mFmt);
    onChange(`${hFmt}:${mFmt}`);
  };

  const handleHourChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const digits = e.target.value.replace(/\D/g, '').slice(0, 2);
    setH(digits.length === 2 ? clampFmt(digits, 23) : digits);
    if (digits.length === 2) {
      minRef.current?.focus();
      minRef.current?.select();
    }
  };

  const handleMinChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const digits = e.target.value.replace(/\D/g, '').slice(0, 2);
    setM(digits.length === 2 ? clampFmt(digits, 59) : digits);
  };

  const keyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.ctrlKey || e.metaKey) return;
    if (['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.key)) return;
    if (e.key === 'Enter') {
      e.currentTarget.blur();
      return;
    }
    if (!/^\d$/.test(e.key)) e.preventDefault();
  };

  const cls = 'w-7 bg-background px-0.5 py-1 text-center text-xs outline-none';

  return (
    <div className='inline-flex items-center rounded-md border border-border overflow-hidden focus-within:border-desk-accent'>
      <input
        type='text'
        inputMode='numeric'
        value={h}
        placeholder='HH'
        maxLength={2}
        data-track-category='DeskMetrics'
        data-track-name='TimeInputHour'
        onChange={handleHourChange}
        onKeyDown={keyDown}
        onBlur={e => commit(e.target.value, m)}
        onFocus={e => e.target.select()}
        className={cls}
      />
      <span className='text-xs text-muted-foreground select-none'>:</span>
      <input
        ref={minRef}
        type='text'
        inputMode='numeric'
        value={m}
        placeholder='MM'
        maxLength={2}
        data-track-category='DeskMetrics'
        data-track-name='TimeInputMinute'
        onChange={handleMinChange}
        onKeyDown={keyDown}
        onBlur={e => commit(h, e.target.value)}
        onFocus={e => e.target.select()}
        className={cls}
      />
    </div>
  );
};

export interface DeskMetricsDateRangePickerProps {
  dateRange: DateRangeValue;
  startTime: string;
  endTime: string;
  onChange: (dr: DateRangeValue, st: string, et: string) => void;
  /** Longest selectable span, in calendar days. Hides longer presets too. */
  maxDays?: number;
}

export const DeskMetricsDateRangePicker: React.FC<DeskMetricsDateRangePickerProps> = ({
  dateRange,
  startTime,
  endTime,
  onChange,
  maxDays = DEFAULT_MAX_DAYS,
}) => {
  const [open, setOpen] = useState(false);
  const [showCustom, setShowCustom] = useState(false);
  const [pendingRange, setPendingRange] = useState<DateRangeValue>(dateRange);
  const [pendingStart, setPendingStart] = useState(startTime);
  const [pendingEnd, setPendingEnd] = useState(endTime);

  const activePreset = matchPreset(dateRange);
  const isDefaultTime = startTime === '00:00' && endTime === '23:59';
  const label = (() => {
    if (activePreset && isDefaultTime) return activePreset;
    const s = fmtShort(dateRange.startDate);
    const e = fmtShort(dateRange.endDate);
    if (isDefaultTime) return `${s} – ${e}`;
    return isSameDay(dateRange.startDate, dateRange.endDate)
      ? `${s} ${startTime} – ${endTime}`
      : `${s} ${startTime} – ${e} ${endTime}`;
  })();

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      setPendingRange(dateRange);
      setPendingStart(startTime);
      setPendingEnd(endTime);
      setShowCustom(!activePreset || !isDefaultTime);
    } else {
      setShowCustom(false);
    }
  };

  return (
    <Popover.Root open={open} onOpenChange={handleOpenChange}>
      <Popover.Trigger asChild>
        <button
          type='button'
          data-track-category='DeskMetrics'
          data-track-name='DateRangePickerOpen'
          className='inline-flex h-[32px] items-center gap-1.5 rounded-[8px] border border-desk-border bg-background px-3 text-sm text-foreground hover:bg-muted/50 dark:border-border'
        >
          <span>{label}</span>
          <ChevronDown className='size-3 text-muted-foreground' />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side='bottom'
          align='end'
          sideOffset={4}
          onCloseAutoFocus={e => e.preventDefault()}
          className='z-50 w-[264px] rounded-xl border bg-popover text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 duration-150'
        >
          <div className='p-1'>
            {PRESETS.filter(p => spanDays(p.getValue()) <= maxDays).map(p => (
              <button
                key={p.label}
                type='button'
                data-track-category='DeskMetrics'
                data-track-name='DateRangePreset'
                onClick={() => {
                  onChange(p.getValue(), '00:00', '23:59');
                  setOpen(false);
                }}
                className={cn(
                  'flex w-full items-center rounded-sm px-2 py-1.5 text-sm select-none',
                  activePreset === p.label && isDefaultTime
                    ? 'bg-accent text-foreground font-medium'
                    : 'hover:bg-accent hover:text-accent-foreground',
                )}
              >
                {p.label}
              </button>
            ))}
            <button
              type='button'
              data-track-category='DeskMetrics'
              data-track-name='DateRangeCustomToggle'
              onClick={() => setShowCustom(v => !v)}
              className={cn(
                'flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-sm select-none',
                !activePreset || !isDefaultTime
                  ? 'bg-accent text-foreground font-medium'
                  : 'hover:bg-accent hover:text-accent-foreground',
              )}
            >
              Custom range
              <ChevronDown
                className={cn(
                  'size-3 transition-transform duration-150',
                  showCustom && 'rotate-180',
                )}
              />
            </button>
          </div>

          {showCustom && (
            <>
              <div className='border-t border-border'>
                <CalendarView range={pendingRange} onSelect={setPendingRange} />
              </div>
              <div className='flex flex-col gap-2 border-t border-border p-3'>
                <div className='flex items-center gap-2'>
                  <span className='w-8 shrink-0 text-xs text-muted-foreground'>From</span>
                  <TimeInput value={pendingStart} onChange={setPendingStart} />
                </div>
                <div className='flex items-center gap-2'>
                  <span className='w-8 shrink-0 text-xs text-muted-foreground'>To</span>
                  <TimeInput value={pendingEnd} onChange={setPendingEnd} />
                </div>
                <button
                  type='button'
                  onClick={() => {
                    if (spanDays(pendingRange) > maxDays) {
                      toast.error(`Date range cannot exceed ${maxDays} days`);
                      return;
                    }
                    if (
                      isSameDay(pendingRange.startDate, pendingRange.endDate) &&
                      pendingStart >= pendingEnd
                    ) {
                      toast.error('Start time must be before end time');
                      return;
                    }
                    onChange(pendingRange, pendingStart, pendingEnd);
                    setOpen(false);
                  }}
                  data-track-category='DeskMetrics'
                  data-track-name='DateRangeApply'
                  className='w-full rounded-[8px] bg-desk-accent py-1.5 text-sm font-medium text-white hover:opacity-90'
                >
                  Apply
                </button>
              </div>
            </>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
};
