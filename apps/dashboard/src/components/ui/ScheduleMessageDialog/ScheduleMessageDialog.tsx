import { useState } from 'react';
import { format } from 'date-fns';
import { X } from 'lucide-react';
import { Dialog } from '../Dialog';
import { cn } from '../../../utils/classNames';

const MAX_SCHEDULE_DAYS = 100;

const SCHEDULE_HOUR = 9;
const WEEKEND_DAYS = [0, 6];

export interface SchedulePresetOption {
  key: string;
  trackId: string;
  label: string;
  at: Date;
}

export interface ScheduleMessageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (scheduledFor: number) => void;
  initialScheduledFor?: number;
  mode?: 'schedule' | 'reschedule';
  trackCategory?: string;
}

const padDatetimePart = (n: number): string => String(n).padStart(2, '0');

const toDatetimeLocalValue = (d: Date): string =>
  `${d.getFullYear()}-${padDatetimePart(d.getMonth() + 1)}-${padDatetimePart(d.getDate())}T${padDatetimePart(d.getHours())}:${padDatetimePart(d.getMinutes())}`;

const atScheduleHour = (from: Date, dayOffset: number): Date => {
  const d = new Date(from);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(SCHEDULE_HOUR, 0, 0, 0);
  return d;
};

export const getSchedulePresets = (now: Date = new Date()): SchedulePresetOption[] => {
  const tomorrow = atScheduleHour(now, 1);
  const nextMonday = atScheduleHour(now, (1 - now.getDay() + 7) % 7 || 7);

  const presets: SchedulePresetOption[] = [];
  if (!WEEKEND_DAYS.includes(tomorrow.getDay())) {
    presets.push({
      key: 'tomorrow',
      trackId: 'TOMORROW',
      label: `Tomorrow at ${format(tomorrow, 'h:mm a')}`,
      at: tomorrow,
    });
  }
  if (!presets.some(p => p.at.getTime() === nextMonday.getTime())) {
    presets.push({
      key: 'next-monday',
      trackId: 'NEXT_MONDAY',
      label: `${format(nextMonday, 'EEEE')} at ${format(nextMonday, 'h:mm a')}`,
      at: nextMonday,
    });
  }
  return presets;
};

export const ScheduleMessageDialog = ({
  open,
  onOpenChange,
  onConfirm,
  initialScheduledFor,
  mode = 'schedule',
  trackCategory = 'CHAT_INPUT',
}: ScheduleMessageDialogProps): React.ReactElement => {
  const [step, setStep] = useState<'pick' | 'confirm'>('pick');
  const [preset, setPreset] = useState<string | null>(null);
  const [showCustomPicker, setShowCustomPicker] = useState(false);
  const [scheduleDateValue, setScheduleDateValue] = useState('');
  const [pendingScheduleFor, setPendingScheduleFor] = useState<number | null>(null);

  const presets = open ? getSchedulePresets() : [];
  const defaultPreset = presets[0];

  const resetDialog = (): void => {
    setStep('pick');
    setPreset(null);
    setShowCustomPicker(false);
    setPendingScheduleFor(null);
    if (initialScheduledFor && initialScheduledFor > Date.now()) {
      setScheduleDateValue(toDatetimeLocalValue(new Date(initialScheduledFor)));
    } else {
      setScheduleDateValue('');
    }
  };

  const handleOpenChange = (nextOpen: boolean): void => {
    if (!nextOpen || !open) {
      resetDialog();
    }
    onOpenChange(nextOpen);
  };

  const handlePresetSelect = (nextPreset: SchedulePresetOption | 'custom'): void => {
    if (nextPreset === 'custom') {
      setPreset('custom');
      setShowCustomPicker(true);
      if (!scheduleDateValue && defaultPreset) {
        setScheduleDateValue(toDatetimeLocalValue(defaultPreset.at));
      }
      return;
    }
    setPreset(nextPreset.key);
    setShowCustomPicker(false);
    setScheduleDateValue(toDatetimeLocalValue(nextPreset.at));
  };

  const scheduledForMs = scheduleDateValue ? new Date(scheduleDateValue).getTime() : NaN;
  const maxScheduleMs = Date.now() + MAX_SCHEDULE_DAYS * 24 * 60 * 60 * 1000;
  const canContinue =
    Number.isFinite(scheduledForMs) &&
    scheduledForMs > Date.now() &&
    scheduledForMs <= maxScheduleMs;
  const exceedsMaxDays = Number.isFinite(scheduledForMs) && scheduledForMs > maxScheduleMs;

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
      title={
        step === 'pick'
          ? mode === 'reschedule'
            ? 'Reschedule message'
            : 'Schedule message'
          : mode === 'reschedule'
            ? 'Confirm rescheduled message'
            : 'Confirm scheduled message'
      }
      description={
        step === 'pick'
          ? mode === 'reschedule'
            ? 'Choose a new time for this message'
            : 'Choose when to send this message'
          : pendingScheduleFor
            ? `Message will be ${mode === 'reschedule' ? 'rescheduled' : 'sent'} at ${format(new Date(pendingScheduleFor), 'PPpp')}`
            : mode === 'reschedule'
              ? 'Confirm rescheduled message'
              : 'Confirm scheduled message'
      }
      className={cn('max-w-md p-0', step === 'confirm' && 'max-w-[420px]')}
    >
      {step === 'pick' ? (
        <div>
          <div className='px-6 pt-6 pb-1'>
            <h2 className='text-lg font-semibold text-foreground tracking-tight'>
              {mode === 'reschedule' ? 'Reschedule message' : 'Schedule message'}
            </h2>
            <p className='text-sm text-muted-foreground mt-1'>
              {mode === 'reschedule'
                ? 'Choose a new time for this message'
                : 'Choose when to send this message'}
            </p>
          </div>
          <div className='px-6 py-4 space-y-2.5'>
            {presets.map(option => (
              <button
                key={option.key}
                type='button'
                onClick={() => handlePresetSelect(option)}
                className={cn(
                  'w-full flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left text-sm transition-colors',
                  preset === option.key
                    ? 'border-2 border-primary bg-primary/5'
                    : 'border border-border hover:bg-accent/50',
                )}
                data-track-category={trackCategory}
                data-track-name={`schedule-preset-${option.key}`}
              >
                <span className='font-medium text-foreground'>{option.label}</span>
                <span className='text-muted-foreground tabular-nums shrink-0'>
                  {format(option.at, 'MMM d')}
                </span>
              </button>
            ))}
            <button
              type='button'
              onClick={() => handlePresetSelect('custom')}
              className={cn(
                'w-full flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left text-sm transition-colors',
                preset === 'custom'
                  ? 'border-2 border-primary bg-primary/5'
                  : 'border border-border hover:bg-accent/50',
              )}
              data-track-category={trackCategory}
              data-track-name='schedule-preset-custom'
            >
              <span className='font-medium text-foreground'>Custom date & time</span>
            </button>
            {showCustomPicker && (
              <div className='pt-1'>
                <label
                  htmlFor='schedule-datetime-input'
                  className='block text-xs font-medium text-muted-foreground mb-1.5'
                >
                  Date and time
                </label>
                <input
                  id='schedule-datetime-input'
                  type='datetime-local'
                  value={scheduleDateValue}
                  onChange={e => setScheduleDateValue(e.target.value)}
                  min={toDatetimeLocalValue(new Date(Date.now() + 60_000))}
                  max={toDatetimeLocalValue(
                    new Date(Date.now() + MAX_SCHEDULE_DAYS * 24 * 60 * 60 * 1000),
                  )}
                  step={900}
                  className='w-full border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary'
                  data-track-category={trackCategory}
                  data-track-name='schedule-custom-datetime'
                />
                {exceedsMaxDays && (
                  <p className='text-xs text-destructive mt-1'>
                    Cannot schedule more than 100 days in advance
                  </p>
                )}
              </div>
            )}
          </div>
          <div className='flex justify-end gap-2 px-6 py-5'>
            <button
              type='button'
              onClick={() => handleOpenChange(false)}
              className='text-sm font-medium px-4 py-2 rounded-md border border-border bg-background text-foreground hover:bg-muted/60 transition-colors'
              data-track-category={trackCategory}
              data-track-name='cancel-schedule-pick'
            >
              Cancel
            </button>
            <button
              type='button'
              onClick={() => {
                if (!canContinue) return;
                setPendingScheduleFor(scheduledForMs);
                setStep('confirm');
              }}
              disabled={!canContinue}
              className='text-sm font-medium px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
              data-track-category={trackCategory}
              data-track-name='continue-schedule-pick'
            >
              Continue
            </button>
          </div>
        </div>
      ) : (
        <div>
          <div className='flex items-start justify-between gap-3 px-5 py-4'>
            <h2 className='text-base font-semibold text-foreground leading-tight pr-2'>
              {mode === 'reschedule' ? 'Reschedule message?' : 'Schedule message?'}
            </h2>
            <button
              type='button'
              onClick={() => handleOpenChange(false)}
              className='rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shrink-0'
              aria-label='Close'
              data-track-category={trackCategory}
              data-track-name='close-schedule-confirm'
            >
              <X className='size-4' />
            </button>
          </div>
          <p className='px-5 py-5 text-sm text-foreground leading-relaxed'>
            This message will be {mode === 'reschedule' ? 'rescheduled to' : 'sent on'}{' '}
            <span className='font-semibold'>
              {pendingScheduleFor ? format(new Date(pendingScheduleFor), 'MMM d, yyyy h:mm a') : ''}
            </span>
            .
          </p>
          <div className='flex justify-end gap-2 px-5 py-4 bg-muted/20'>
            <button
              type='button'
              onClick={() => handleOpenChange(false)}
              className='text-sm font-medium px-4 py-2 rounded-md border border-border bg-background text-foreground hover:bg-muted/60 transition-colors'
              data-track-category={trackCategory}
              data-track-name='cancel-schedule-confirm'
            >
              Cancel
            </button>
            <button
              type='button'
              onClick={() => {
                if (pendingScheduleFor === null) return;
                onConfirm(pendingScheduleFor);
                handleOpenChange(false);
              }}
              className='text-sm font-medium px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 transition-colors'
              data-track-category={trackCategory}
              data-track-name='confirm-schedule-send'
            >
              {mode === 'reschedule' ? 'Reschedule' : 'Schedule'}
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
};
