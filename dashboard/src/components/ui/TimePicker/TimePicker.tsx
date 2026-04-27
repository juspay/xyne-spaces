/**
 * TimePicker
 * ----------
 * A lightweight 12-hour time picker using Radix Popover + ToggleGroup.
 */

import * as Popover from '@radix-ui/react-popover';
import * as ToggleGroup from '@radix-ui/react-toggle-group';
import { Clock } from 'lucide-react';
import React, { useState } from 'react';
import { cn } from '../../../utils/classNames';
import Input from '../Input';

// ==================== TYPES ====================

interface TimePickerProps {
  id?: string;
  /** Controlled time value in `hh:mm AM/PM` format */
  value: string;

  /** Callback function to update time */
  onChange?: (time: string) => void;

  /** Input box placeholder */
  placeholder?: string;

  /** Disable the time picker */
  disabled?: boolean;

  /** Fired when the popover closes */
  onClose?: () => void;
}

export const TimePicker: React.FC<TimePickerProps> = ({
  id,
  value,
  onChange,
  placeholder = 'Select time',
  disabled = false,
  onClose,
}) => {
  const [hour, setHour] = useState<string>(value ? (value.split(':')[0]?.split(' ')[0] ?? '') : '');
  const [minute, setMinute] = useState<string>(
    value ? (value.split(':')[1]?.split(' ')[0] ?? '') : '',
  );
  const [period, setPeriod] = useState<string>(value ? value.split(' ')[1] || 'AM' : 'AM');
  const [open, setOpen] = useState(false);

  const handleHourChange = (newHour: string) => {
    if (newHour === '' || newHour === '0') {
      setHour(newHour);
      return;
    }
    // validate hour input from 1-12
    const numHour = parseInt(newHour, 10);
    if (!isNaN(numHour) && numHour >= 1 && numHour <= 12) {
      setHour(newHour);
      updateTime(newHour, minute, period);
    }
  };

  const handleMinuteChange = (newMinute: string) => {
    if (newMinute === '') {
      setMinute('');
      return;
    }

    // Validate minute input from 0-59
    const numMinute = parseInt(newMinute, 10);
    if (!isNaN(numMinute) && numMinute >= 0 && numMinute <= 59) {
      setMinute(newMinute);
      updateTime(hour, newMinute, period);
    }
  };

  const handlePeriodChange = (newPeriod: string) => {
    if (newPeriod) {
      setPeriod(newPeriod);
      updateTime(hour, minute, newPeriod);
    }
  };

  const updateTime = (h: string, m: string, p: string) => {
    if (h && m) {
      const timeString = `${h.padStart(2, '0')}:${m.padStart(2, '0')} ${p}`;
      onChange?.(timeString);
    }
  };

  const displayTime =
    hour && minute ? `${hour.padStart(2, '0')}:${minute.padStart(2, '0')} ${period}` : placeholder;

  return (
    <Popover.Root
      open={open}
      onOpenChange={isOpen => {
        setOpen(isOpen);
        if (!isOpen) {
          onClose?.();
        }
      }}
    >
      <Popover.Trigger asChild>
        <div className='relative w-full rounded-lg h-9'>
          <Clock className='absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none' />
          <Input
            id={id}
            type='text'
            value={displayTime}
            placeholder={placeholder}
            disabled={disabled}
            readOnly
            className='pl-10 cursor-pointer hover:bg-muted text-foreground'
          />
        </div>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className={cn(
            'w-fit rounded-lg border border-border bg-background shadow-lg overflow-hidden z-50',
            // Animation classes
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
            'duration-200',
          )}
          align='start'
          sideOffset={5}
        >
          <div className='flex items-center gap-3 p-3.5'>
            <div>
              <label
                htmlFor='timepicker-hour'
                className='text-xs font-medium text-muted-foreground mb-2 block'
              >
                Hour
              </label>
              <Input
                id='timepicker-hour'
                value={hour}
                onChange={e => handleHourChange(e.target.value)}
                onFocus={e => e.target.select()}
                type='text'
                inputMode='numeric'
                pattern='[0-9]*'
                placeholder='12'
                maxLength={2}
                className='w-16 text-center select-all text-foreground'
              />
            </div>

            <div>
              <label
                htmlFor='timepicker-minute'
                className='text-xs font-medium text-muted-foreground mb-2 block'
              >
                Minute
              </label>
              <Input
                id='timepicker-minute'
                value={minute}
                onChange={e => handleMinuteChange(e.target.value)}
                onFocus={e => e.target.select()}
                type='text'
                inputMode='numeric'
                pattern='[0-9]*'
                placeholder='00'
                maxLength={2}
                className='w-16 text-center select-all text-foreground'
              />
            </div>

            <div>
              <label
                htmlFor='timepicker-period-label'
                className='text-xs font-medium text-muted-foreground mb-2 block'
              >
                Period
              </label>
              <ToggleGroup.Root
                type='single'
                value={period}
                onValueChange={handlePeriodChange}
                aria-labelledby='timepicker-period-label'
                className='inline-flex w-20 rounded-md border border-border bg-background overflow-hidden'
              >
                <ToggleGroup.Item
                  value='AM'
                  className={cn(
                    'flex-1 text-xs font-mono py-2 rounded-l-sm font-semibold transition-colors',
                    'hover:bg-muted',
                    'data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:hover:bg-primary',
                    'data-[state=off]:text-foreground',
                  )}
                >
                  AM
                </ToggleGroup.Item>

                <ToggleGroup.Item
                  value='PM'
                  className={cn(
                    'flex-1 text-xs font-mono py-2 font-semibold transition-colors border-l border-border',
                    'hover:bg-muted',
                    'data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:hover:bg-primary data-[state=on]:border-primary',
                    'data-[state=off]:text-foreground',
                  )}
                >
                  PM
                </ToggleGroup.Item>
              </ToggleGroup.Root>
            </div>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
};
