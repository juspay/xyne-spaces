import { cn } from '../../../../utils/classNames';
import { WORKING_HOUR_END, WORKING_HOUR_START } from '../../../../config';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../ui/Select/Select';

const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;
// Mirrors what the backend applies when businessHours is unset (env working hours, Mon-Fri).
const DEFAULT_HOURS = {
  days: ['MON', 'TUE', 'WED', 'THU', 'FRI'],
  startHour: WORKING_HOUR_START,
  endHour: WORKING_HOUR_END,
};

interface BusinessHours {
  days: string[];
  startHour: number;
  endHour: number;
}

interface BusinessHoursFieldProps {
  value: unknown;
  onChange: (next: BusinessHours) => void;
  errorMessage?: string | undefined;
}

/** Hours are in half-hour steps: 11.5 → "11:30 AM", 24 → "12:00 AM" (midnight). */
function formatHour(hour: number): string {
  const whole = Math.floor(hour);
  const suffix = whole < 12 || whole === 24 ? 'AM' : 'PM';
  return `${whole % 12 === 0 ? 12 : whole % 12}:${hour % 1 === 0 ? '00' : '30'} ${suffix}`;
}

/**
 * Working days + daily IST window for the DELAY step. Shows the backend defaults until the
 * user edits, and writes the whole object at once so no field is lost.
 */
export function BusinessHoursField({
  value,
  onChange,
  errorMessage,
}: BusinessHoursFieldProps): React.ReactElement {
  const hours: BusinessHours = {
    ...DEFAULT_HOURS,
    ...(value && typeof value === 'object' ? (value as Partial<BusinessHours>) : {}),
  };

  // Flips `day`, keeps Mon→Sun order, and never clears the last day (the backend needs one).
  const toggleDay = (day: string): void => {
    const days = WEEKDAYS.filter(d => (d === day) !== hours.days.includes(d));
    if (days.length > 0) onChange({ ...hours, days });
  };

  const hourSelect = (
    label: string,
    selected: number,
    options: number[],
    onSelect: (hour: number) => void,
  ): React.ReactElement => (
    <div className='flex flex-1 flex-col gap-1'>
      <span className='text-[11px] text-muted-foreground'>{label}</span>
      <Select value={String(selected)} onValueChange={v => onSelect(Number(v))}>
        <SelectTrigger className='w-full'>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map(hour => (
            <SelectItem key={hour} value={String(hour)}>
              {formatHour(hour)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  const hourRange = (from: number, to: number): number[] =>
    Array.from({ length: (to - from) * 2 + 1 }, (_, i) => from + i / 2);

  return (
    <div className='flex flex-col gap-3 rounded-lg border border-border bg-background/40 px-3 py-3'>
      <div className='flex flex-col gap-0.5'>
        <span className='text-xs font-medium text-foreground'>Business hours</span>
        <span className='text-[11px] text-muted-foreground'>
          The delay only counts down inside this window (IST).
        </span>
      </div>

      <div className='flex flex-wrap gap-1.5'>
        {WEEKDAYS.map(day => {
          const active = hours.days.includes(day);
          return (
            <button
              key={day}
              type='button'
              aria-pressed={active}
              onClick={() => toggleDay(day)}
              data-track-category='automation-builder'
              data-track-name={`business-hours-day-${day}`}
              className={cn(
                'h-8 min-w-10 rounded-md border px-2 text-xs font-medium transition-colors',
                active
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-background text-muted-foreground hover:bg-muted',
              )}
            >
              {day.charAt(0) + day.slice(1).toLowerCase()}
            </button>
          );
        })}
      </div>

      <div className='flex items-end gap-2'>
        {hourSelect('From', hours.startHour, hourRange(0, hours.endHour - 0.5), startHour =>
          onChange({ ...hours, startHour }),
        )}
        {hourSelect('To', hours.endHour, hourRange(hours.startHour + 0.5, 24), endHour =>
          onChange({ ...hours, endHour }),
        )}
      </div>

      <span className={cn('text-[11px]', errorMessage ? 'text-red-600' : 'text-muted-foreground')}>
        {errorMessage ??
          `${hours.endHour - hours.startHour}h a day, ${hours.days.length} day${hours.days.length === 1 ? '' : 's'} a week`}
      </span>
    </div>
  );
}
