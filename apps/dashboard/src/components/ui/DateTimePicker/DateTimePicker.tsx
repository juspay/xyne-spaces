import React, { useState, useEffect } from 'react';
import * as Popover from '@radix-ui/react-popover';
import * as ToggleGroup from '@radix-ui/react-toggle-group';
import {
  Calendar as CalendarIcon,
  Clock,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  AlertCircle,
} from 'lucide-react';
import { cn } from '../../../utils/classNames';

export interface DateTimePickerProps {
  value: Date | null;
  onChange: (date: Date | null) => void;
  placeholder?: string;
  autoOpen?: boolean;
  inline?: boolean;
  onConfirm?: (date: Date) => void;
}

export const DateTimePicker: React.FC<DateTimePickerProps> = ({
  value,
  onChange,
  placeholder = 'Select date and time',
  autoOpen = false,
  inline = false,
  onConfirm,
}) => {
  const [isOpen, setIsOpen] = useState(autoOpen);
  const [viewDate, setViewDate] = useState(() =>
    value instanceof Date && !isNaN(value.getTime()) ? value : new Date(),
  );

  // Initialize time to 1 minute ahead of now if no value provided
  const getDefaultTime = () => {
    if (value instanceof Date && !isNaN(value.getTime())) {
      return {
        hour: (value.getHours() % 12 || 12).toString(),
        minute: value.getMinutes().toString().padStart(2, '0'),
        period: value.getHours() >= 12 ? 'PM' : 'AM',
      };
    }
    const now = new Date();
    now.setMinutes(now.getMinutes() + 1);
    return {
      hour: (now.getHours() % 12 || 12).toString(),
      minute: now.getMinutes().toString().padStart(2, '0'),
      period: now.getHours() >= 12 ? 'PM' : 'AM',
    };
  };

  const defaultTime = getDefaultTime();
  const [hour, setHour] = useState(defaultTime.hour);
  const [minute, setMinute] = useState(defaultTime.minute);
  const [period, setPeriod] = useState(defaultTime.period);

  const [isPast, setIsPast] = useState(false);
  useEffect(() => {
    const checkIsPast = () => {
      const baseDate = value instanceof Date && !isNaN(value.getTime()) ? value : new Date();
      const hrs = parseInt(hour, 10);
      const mins = parseInt(minute, 10);
      if (!isNaN(hrs) && !isNaN(mins)) {
        const checkDate = new Date(baseDate);
        let calculatedHrs = hrs;
        if (period === 'PM' && hrs < 12) calculatedHrs += 12;
        if (period === 'AM' && hrs === 12) calculatedHrs = 0;
        checkDate.setHours(calculatedHrs, mins, 0, 0);
        setIsPast(checkDate.getTime() < Date.now());
      } else {
        setIsPast(value ? value.getTime() < Date.now() : false);
      }
    };

    checkIsPast();
    const interval = setInterval(checkIsPast, 1000);
    return () => clearInterval(interval);
  }, [value, hour, minute, period]);

  useEffect(() => {
    if (value instanceof Date && !isNaN(value.getTime())) {
      setHour((value.getHours() % 12 || 12).toString());
      setMinute(value.getMinutes().toString().padStart(2, '0'));
      setPeriod(value.getHours() >= 12 ? 'PM' : 'AM');
      setViewDate(value);
    } else {
      // Reset to default time (1 minute ahead) when value is null/invalid
      const now = new Date();
      now.setMinutes(now.getMinutes() + 1);
      setHour((now.getHours() % 12 || 12).toString());
      setMinute(now.getMinutes().toString().padStart(2, '0'));
      setPeriod(now.getHours() >= 12 ? 'PM' : 'AM');
    }
  }, [value]);

  const updateDateTime = (baseDate: Date, h: string, m: string, p: string) => {
    const updated = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate());
    const hrs = parseInt(h, 10);
    const mins = parseInt(m, 10);

    const finalHrs = isNaN(hrs) ? 12 : Math.max(1, Math.min(12, hrs));
    const finalMins = isNaN(mins) ? 0 : Math.max(0, Math.min(59, mins));

    let calculatedHrs = finalHrs;
    if (p === 'PM' && finalHrs < 12) calculatedHrs += 12;
    if (p === 'AM' && finalHrs === 12) calculatedHrs = 0;

    updated.setHours(calculatedHrs, finalMins, 0, 0);

    if (!isNaN(updated.getTime())) {
      onChange(updated);
    }
  };

  const handleTimePartChange = (type: 'h' | 'm' | 'p', val: string) => {
    if (type === 'p') {
      setPeriod(val);
      updateDateTime(value || new Date(), hour, minute, val);
      return;
    }
    const cleanVal = val.replace(/\D/g, '');
    if (type === 'h') {
      if (cleanVal === '') {
        setHour('');
        return;
      }
      const numVal = parseInt(cleanVal, 10);
      const clamped = numVal > 12 ? '12' : cleanVal;
      setHour(clamped);
    } else if (type === 'm') {
      if (cleanVal === '') {
        setMinute('');
        return;
      }
      const clamped = parseInt(cleanVal, 10) > 59 ? '59' : cleanVal;
      setMinute(clamped);
    }
  };

  const handleConfirm = () => {
    if (inline) {
      if (onConfirm && value && !isPast) {
        onConfirm(value);
      }
    } else {
      setIsOpen(false);
    }
  };

  const isConfirmDisabled = isPast || (inline && !value);

  const panel = (
    <div className='bg-card rounded-xl overflow-hidden flex flex-col md:flex-row'>
      {/* CALENDAR PANEL */}
      <div className='w-[280px] border-r border-border flex flex-col bg-card'>
        <div className='px-3 py-3 flex items-center justify-between border-b border-border bg-muted/10'>
          <div className='flex gap-0.5'>
            <button
              onClick={() =>
                setViewDate(new Date(viewDate.setFullYear(viewDate.getFullYear() - 1)))
              }
              data-track-category='DATE_TIME_PICKER'
              data-track-name='PREV_YEAR'
              className='p-1 hover:bg-secondary rounded text-muted-foreground'
            >
              <ChevronsLeft className='w-4 h-4' />
            </button>
            <button
              onClick={() => setViewDate(new Date(viewDate.setMonth(viewDate.getMonth() - 1)))}
              data-track-category='DATE_TIME_PICKER'
              data-track-name='PREV_MONTH'
              className='p-1 hover:bg-secondary rounded text-muted-foreground'
            >
              <ChevronLeft className='w-4 h-4' />
            </button>
          </div>
          <span className='text-sm font-bold text-foreground'>
            {viewDate.toLocaleString('default', { month: 'short', year: 'numeric' })}
          </span>
          <div className='flex gap-0.5'>
            <button
              onClick={() => setViewDate(new Date(viewDate.setMonth(viewDate.getMonth() + 1)))}
              data-track-category='DATE_TIME_PICKER'
              data-track-name='NEXT_MONTH'
              className='p-1 hover:bg-secondary rounded text-muted-foreground'
            >
              <ChevronRight className='w-4 h-4' />
            </button>
            <button
              onClick={() =>
                setViewDate(new Date(viewDate.setFullYear(viewDate.getFullYear() + 1)))
              }
              data-track-category='DATE_TIME_PICKER'
              data-track-name='NEXT_YEAR'
              className='p-1 hover:bg-secondary rounded text-muted-foreground'
            >
              <ChevronsRight className='w-4 h-4' />
            </button>
          </div>
        </div>

        <div className='p-3'>
          <div className='grid grid-cols-7 gap-1 mb-2'>
            {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => (
              <div
                key={d}
                className='text-[10px] font-bold text-muted-foreground text-center uppercase'
              >
                {d}
              </div>
            ))}
          </div>
          <MonthView
            year={viewDate.getFullYear()}
            month={viewDate.getMonth()}
            selectedDate={value}
            onSelect={d => updateDateTime(d, hour, minute, period)}
          />
        </div>
      </div>

      {/* TIME PANEL */}
      <div className='w-[180px] p-4 bg-muted/20 flex flex-col'>
        <div className='flex items-center gap-2 mb-6 text-[10px] font-bold text-muted-foreground uppercase tracking-widest'>
          <Clock className='w-3.5 h-3.5' />
          Time
        </div>

        <div className='space-y-5 flex-1'>
          <div className='grid grid-cols-2 gap-3'>
            <div className='relative'>
              <label
                htmlFor='time-hours'
                className='text-[9px] font-bold text-muted-foreground uppercase mb-1.5 block'
              >
                Hrs
              </label>
              <input
                id='time-hours'
                type='text'
                inputMode='numeric'
                value={hour}
                onChange={e => handleTimePartChange('h', e.target.value)}
                onBlur={() => {
                  let finalHour = hour;
                  if (hour === '' || hour === '0') {
                    finalHour = '12';
                    setHour(finalHour);
                  } else if (hour === '00') {
                    finalHour = '01';
                    setHour(finalHour);
                  }
                  updateDateTime(value || new Date(), finalHour, minute, period);
                }}
                className={cn(
                  'w-full border rounded-md py-2 text-center text-sm font-medium focus:ring-1 focus:ring-black outline-none transition-colors',
                  isPast ? 'border-red-300 bg-red-50 text-red-900' : 'border-border bg-background',
                )}
                maxLength={2}
              />
            </div>
            <div>
              <label
                htmlFor='time-minutes'
                className='text-[9px] font-bold text-muted-foreground uppercase mb-1.5 block'
              >
                Min
              </label>
              <input
                id='time-minutes'
                type='text'
                inputMode='numeric'
                value={minute}
                onChange={e => handleTimePartChange('m', e.target.value)}
                onBlur={() => {
                  const finalMinute = minute === '' ? '00' : minute.padStart(2, '0');
                  setMinute(finalMinute);
                  updateDateTime(value || new Date(), hour, finalMinute, period);
                }}
                className={cn(
                  'w-full border rounded-md py-2 text-center text-sm font-medium focus:ring-1 focus:ring-black outline-none transition-colors',
                  isPast ? 'border-red-300 bg-red-50 text-red-900' : 'border-border bg-background',
                )}
                maxLength={2}
              />
            </div>
          </div>

          <ToggleGroup.Root
            type='single'
            value={period}
            onValueChange={val => val && handleTimePartChange('p', val)}
            className='flex border border-border rounded-lg overflow-hidden bg-background'
          >
            {['AM', 'PM'].map(p => (
              <ToggleGroup.Item
                key={p}
                value={p}
                className='flex-1 py-2 text-[11px] font-bold data-[state=on]:bg-foreground data-[state=on]:text-background'
              >
                {p}
              </ToggleGroup.Item>
            ))}
          </ToggleGroup.Root>
        </div>

        <button
          onClick={handleConfirm}
          data-track-category='DATE_TIME_PICKER'
          data-track-name='CONFIRM_DATE_TIME'
          disabled={isConfirmDisabled}
          className={cn(
            'mt-6 w-full py-2.5 text-xs font-bold rounded-lg transition-all',
            isConfirmDisabled
              ? 'bg-muted text-muted-foreground cursor-not-allowed'
              : 'bg-foreground text-background hover:bg-foreground/90 active:scale-95',
          )}
        >
          Confirm
        </button>
      </div>
    </div>
  );

  if (inline) {
    return panel;
  }

  return (
    <Popover.Root open={isOpen} onOpenChange={setIsOpen}>
      <Popover.Trigger asChild>
        <button
          className={cn(
            'flex items-center gap-2 w-full px-3 py-2 text-sm border rounded-[8px] transition-colors text-left focus:outline-none',
            isPast ? 'border-red-200 bg-red-50' : 'border-border bg-background hover:bg-accent',
          )}
        >
          <CalendarIcon
            className={cn('w-4 h-4', isPast ? 'text-red-500' : 'text-muted-foreground')}
          />
          <span
            className={cn('flex-1', !value && 'text-muted-foreground', isPast && 'text-red-700')}
          >
            {value && !isNaN(value.getTime())
              ? value.toLocaleString([], {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : placeholder}
          </span>
          {isPast && <AlertCircle className='w-4 h-4 text-red-500' />}
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          className='z-50 bg-card rounded-xl shadow-2xl border border-border overflow-hidden flex flex-col md:flex-row animate-in fade-in zoom-in-95 duration-150'
          align='start'
          sideOffset={8}
        >
          {panel}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
};

const MonthView: React.FC<{
  year: number;
  month: number;
  selectedDate: Date | null;
  onSelect: (d: Date) => void;
}> = ({ year, month, selectedDate, onSelect }) => {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const days = [];
  for (let i = 0; i < firstDay; i++) days.push(<div key={`empty-${i}`} />);
  for (let i = 1; i <= daysInMonth; i++) {
    const d = new Date(year, month, i);
    const isSelected =
      selectedDate instanceof Date &&
      !isNaN(selectedDate.getTime()) &&
      d.toDateString() === selectedDate.toDateString();
    const isBeforeToday = d < today;

    days.push(
      <button
        key={i}
        onClick={() => onSelect(d)}
        data-track-category='DATE_TIME_PICKER'
        data-track-name='SELECT_DAY'
        disabled={isBeforeToday}
        className={cn(
          'aspect-square text-[12px] rounded-lg transition-all flex items-center justify-center',
          isSelected
            ? 'bg-foreground text-background font-bold'
            : 'hover:bg-accent text-muted-foreground',
          isBeforeToday && 'opacity-25 cursor-not-allowed hover:bg-transparent',
        )}
      >
        {i}
      </button>,
    );
  }

  return <div className='grid grid-cols-7 gap-1'>{days}</div>;
};
