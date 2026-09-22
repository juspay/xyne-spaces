import { cn } from '../../../../utils/classNames';
import Input from '../../../ui/Input/Input';
import { WORKING_HOUR_END, WORKING_HOUR_START } from '../../../../config';
import type { BusinessHours } from '../../Automation.types';

const WEEKDAYS: { value: number; label: string }[] = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' },
];

function toTimeString(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

export const DEFAULT_BUSINESS_HOURS: BusinessHours = {
  days: [1, 2, 3, 4, 5],
  startTime: toTimeString(WORKING_HOUR_START),
  endTime: toTimeString(WORKING_HOUR_END),
};

interface BusinessHoursFieldsProps {
  value: BusinessHours | undefined;
  onChange: (next: BusinessHours) => void;
  readOnly?: boolean;
}

export function BusinessHoursFields({
  value,
  onChange,
  readOnly = false,
}: BusinessHoursFieldsProps): React.ReactElement {
  const hours = value ?? DEFAULT_BUSINESS_HOURS;
  const noDays = hours.days.length === 0;
  const invalidRange = hours.endTime <= hours.startTime;

  const toggleDay = (day: number): void => {
    const days = hours.days.includes(day)
      ? hours.days.filter(d => d !== day)
      : [...hours.days, day].sort((a, b) => a - b);
    onChange({ ...hours, days });
  };

  const selectedLabels = WEEKDAYS.filter(d => hours.days.includes(d.value)).map(d => d.label);

  return (
    <div className='flex flex-col gap-2 rounded-md border border-border/80 bg-background p-3'>
      <span className='text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground'>
        Working days
      </span>
      <div className='flex flex-wrap gap-1.5'>
        {WEEKDAYS.map(day => {
          const active = hours.days.includes(day.value);
          return (
            <button
              key={day.value}
              type='button'
              disabled={readOnly}
              onClick={() => toggleDay(day.value)}
              data-track-category='automation-builder'
              data-track-name='business-hours-day-toggle'
              className={cn(
                'h-7 rounded-md border px-2.5 text-xs transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40',
                'disabled:cursor-not-allowed disabled:opacity-60',
                active
                  ? 'border-foreground/40 bg-foreground text-background'
                  : 'border-border bg-background text-muted-foreground hover:bg-accent/30',
              )}
            >
              {day.label}
            </button>
          );
        })}
      </div>

      <div className='flex flex-wrap items-end gap-2'>
        <label className='flex flex-col gap-1'>
          <span className='text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground'>
            From
          </span>
          <Input
            type='time'
            value={hours.startTime}
            disabled={readOnly}
            onChange={e => onChange({ ...hours, startTime: e.target.value })}
            className='h-9 w-32'
          />
        </label>
        <label className='flex flex-col gap-1'>
          <span
            className={cn(
              'text-[10px] font-medium uppercase tracking-[0.08em]',
              invalidRange ? 'text-destructive' : 'text-muted-foreground',
            )}
          >
            To
          </span>
          <Input
            type='time'
            value={hours.endTime}
            disabled={readOnly}
            onChange={e => onChange({ ...hours, endTime: e.target.value })}
            className='h-9 w-32'
          />
        </label>
        <span className='pb-2 text-xs text-muted-foreground'>IST</span>
      </div>

      {noDays ? (
        <p className='text-[11px] text-destructive'>Pick at least one working day.</p>
      ) : invalidRange ? (
        <p className='text-[11px] text-destructive'>End time must be after the start time.</p>
      ) : (
        <p className='text-[11px] text-muted-foreground'>
          Waits only count {selectedLabels.join(', ')}, {hours.startTime}–{hours.endTime} IST.
        </p>
      )}
    </div>
  );
}
