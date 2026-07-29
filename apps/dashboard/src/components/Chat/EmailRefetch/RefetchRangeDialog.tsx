import React, { useCallback, useMemo, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Calendar as CalendarIcon } from 'lucide-react';
import Dialog from '../../ui/Dialog';
import { Button } from '../../ui/Button';
import { cn } from '../../../utils/classNames';
import { RangeCalendar } from './RangeCalendar';

type Mode = 'today' | 'last-7d' | 'last-30d' | 'last-3mo' | 'last-6mo' | 'custom';

interface PresetOption {
  value: Exclude<Mode, 'custom'>;
  label: string;
  days: number;
}

const PRESETS: PresetOption[] = [
  { value: 'today', label: 'Today', days: 0 },
  { value: 'last-7d', label: 'Last 7 days', days: 7 },
  { value: 'last-30d', label: 'Last 30 days', days: 30 },
  { value: 'last-3mo', label: 'Last 3 months', days: 90 },
  { value: 'last-6mo', label: 'Last 6 months', days: 180 },
];

const MAX_RANGE_DAYS = 365;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const startOfDay = (date: Date): Date => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

const endOfDay = (date: Date): Date => {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
};

const daysAgo = (days: number): Date => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return startOfDay(d);
};

const formatRange = (start: Date, end: Date): string => {
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
  const sameYear = start.getFullYear() === end.getFullYear();
  const sY = `${months[start.getMonth()]} ${start.getDate()}${sameYear ? '' : `, ${start.getFullYear()}`}`;
  const eY = `${months[end.getMonth()]} ${end.getDate()}, ${end.getFullYear()}`;
  return `${sY} – ${eY}`;
};

interface RefetchRangeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (range?: { startDate: string; endDate: string }) => void;
  isPending?: boolean;
}

export const RefetchRangeDialog: React.FC<RefetchRangeDialogProps> = ({
  open,
  onOpenChange,
  onConfirm,
  isPending = false,
}) => {
  const [mode, setMode] = useState<Mode>('last-7d');
  const [customStart, setCustomStart] = useState<Date | null>(null);
  const [customEnd, setCustomEnd] = useState<Date | null>(null);

  // Resolved range for the current mode (used for both summary text and submit).
  const resolved = useMemo<{ startDate: Date; endDate: Date } | null>(() => {
    if (mode === 'custom') {
      if (!customStart || !customEnd) return null;
      return { startDate: startOfDay(customStart), endDate: endOfDay(customEnd) };
    }
    const preset = PRESETS.find(p => p.value === mode);
    if (!preset) return null;
    return { startDate: daysAgo(preset.days), endDate: endOfDay(new Date()) };
  }, [mode, customStart, customEnd]);

  const customRangeError = useMemo<string | null>(() => {
    if (mode !== 'custom' || !customStart || !customEnd) return null;
    if (customStart > customEnd) return 'Start date must be on or before end date';
    const span = endOfDay(customEnd).getTime() - startOfDay(customStart).getTime();
    if (span > MAX_RANGE_DAYS * MS_PER_DAY) return `Range cannot exceed ${MAX_RANGE_DAYS} days`;
    return null;
  }, [mode, customStart, customEnd]);

  const isCustomReady = mode !== 'custom' || (!!customStart && !!customEnd && !customRangeError);
  const isConfirmDisabled = isPending || !isCustomReady;

  const handleConfirm = useCallback((): void => {
    if (!resolved) return;
    onConfirm({
      startDate: resolved.startDate.toISOString(),
      endDate: resolved.endDate.toISOString(),
    });
  }, [resolved, onConfirm]);

  const renderPreset = (value: Mode, label: string, sublabel?: string): React.ReactElement => {
    const active = mode === value;
    return (
      <button
        key={value}
        type='button'
        onClick={() => setMode(value)}
        className={cn(
          'flex flex-col items-start justify-center gap-0.5 rounded-lg border-2 px-3 py-2 min-h-[58px] transition-all text-left',
          active
            ? 'border-primary bg-primary/10 text-primary'
            : 'border-border text-foreground hover:border-muted-foreground/40 hover:bg-muted/40',
        )}
        data-track-category='Support'
        data-track-name='RefetchRangePreset'
        data-track-metadata={JSON.stringify({ mode: value })}
      >
        <span className='text-sm font-medium'>{label}</span>
        {sublabel && (
          <span className={cn('text-[11px]', active ? 'text-primary/80' : 'text-muted-foreground')}>
            {sublabel}
          </span>
        )}
      </button>
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title='Fetch emails'
      description='Choose how much history to pull from the inbox.'
      className='max-w-lg'
    >
      <div className='p-6 space-y-5'>
        {/* Header */}
        <div>
          <div className='text-lg font-semibold text-foreground'>Fetch emails</div>
          <p className='text-sm text-muted-foreground mt-0.5'>
            Pull new mail or backfill a specific time range from the connected inbox.
          </p>
        </div>

        {/* Quick presets */}
        <div className='space-y-2'>
          <div className='text-xs font-medium text-muted-foreground uppercase tracking-wide'>
            Quick range
          </div>
          <div className='grid grid-cols-3 gap-2'>
            {PRESETS.map(p => renderPreset(p.value, p.label))}
            {renderPreset('custom', 'Custom')}
          </div>
        </div>

        {/* Custom range — both fields open our custom range calendar via a
            Radix Popover. Each field picks its own date but the calendar
            renders the existing range as visual context. */}
        {mode === 'custom' && (
          <div className='space-y-2'>
            <div className='grid grid-cols-2 gap-2'>
              <DateField
                label='From'
                value={customStart}
                rangeForVisual={{ start: customStart, end: customEnd }}
                onPick={d => setCustomStart(d)}
                placeholder='Start date'
                maxDate={customEnd ?? new Date()}
                trackName='FetchRangeFromTrigger'
              />
              <DateField
                label='To'
                value={customEnd}
                rangeForVisual={{ start: customStart, end: customEnd }}
                onPick={d => setCustomEnd(d)}
                placeholder='End date'
                {...(customStart && { minDate: customStart })}
                maxDate={new Date()}
                trackName='FetchRangeToTrigger'
              />
            </div>

            {(customStart || customEnd || customRangeError) && (
              <div className='text-xs text-muted-foreground'>
                {!customStart && 'Pick a start date.'}
                {customStart && !customEnd && 'Now pick the end date.'}
                {customStart && customEnd && !customRangeError && (
                  <span className='text-foreground'>{formatRange(customStart, customEnd)}</span>
                )}
                {customRangeError && <p className='text-destructive'>{customRangeError}</p>}
              </div>
            )}
          </div>
        )}

        {/* Resolved-range summary for presets */}
        {mode !== 'custom' && resolved && (
          <div className='rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground'>
            Will fetch emails received{' '}
            <span className='text-foreground font-medium'>
              {formatRange(resolved.startDate, resolved.endDate)}
            </span>
          </div>
        )}

        {/* Footer */}
        <div className='flex justify-end gap-2 pt-1'>
          <Button
            variant='outline'
            type='button'
            onClick={() => onOpenChange(false)}
            disabled={isPending}
            data-track-category='Support'
            data-track-name='FetchRangeCancel'
          >
            Cancel
          </Button>
          <Button
            type='button'
            onClick={handleConfirm}
            disabled={isConfirmDisabled}
            loading={isPending}
            data-track-category='Support'
            data-track-name='FetchRangeConfirm'
            data-track-metadata={JSON.stringify({ mode })}
          >
            Fetch
          </Button>
        </div>
      </div>
    </Dialog>
  );
};

interface DateFieldProps {
  label: string;
  value: Date | null;
  rangeForVisual: { start: Date | null; end: Date | null };
  onPick: (date: Date) => void;
  placeholder: string;
  minDate?: Date;
  maxDate?: Date;
  trackName: string;
}

const formatTriggerDate = (d: Date | null, placeholder: string): string => {
  if (!d) return placeholder;
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
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
};

const DateField: React.FC<DateFieldProps> = ({
  label,
  value,
  rangeForVisual,
  onPick,
  placeholder,
  minDate,
  maxDate,
  trackName,
}) => {
  const [open, setOpen] = useState(false);
  return (
    <div className='space-y-1'>
      <span className='text-[11px] uppercase tracking-wide text-muted-foreground'>{label}</span>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            type='button'
            className={cn(
              'w-full h-9 px-2.5 rounded-md border border-border bg-background text-sm flex items-center justify-between gap-2',
              'hover:border-muted-foreground/40 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 transition-colors',
              value ? 'text-foreground' : 'text-muted-foreground',
            )}
            data-track-category='Support'
            data-track-name={trackName}
          >
            <span className='truncate'>{formatTriggerDate(value, placeholder)}</span>
            <CalendarIcon className='size-3.5 text-muted-foreground shrink-0' />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            sideOffset={6}
            align='start'
            side='bottom'
            avoidCollisions
            collisionPadding={16}
            className={cn(
              'z-50 rounded-lg border border-border bg-popover shadow-md',
              'data-[state=open]:animate-in data-[state=closed]:animate-out',
              'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
              'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
              'duration-150',
            )}
          >
            <RangeCalendar
              value={value}
              range={rangeForVisual}
              onSelect={d => {
                onPick(d);
                setOpen(false);
              }}
              {...(minDate && { minDate })}
              {...(maxDate && { maxDate })}
            />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
};
