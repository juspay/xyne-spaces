import { cn } from '../../../../utils/classNames';
import Input from '../../../ui/Input/Input';
import { WORKING_HOUR_END, WORKING_HOUR_START } from '../../../../config';
import type { BusinessHours } from '../../../../api/automationsApi';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

const DEFAULT_BUSINESS_HOURS: BusinessHours = {
  days: [1, 2, 3, 4, 5],
  startTime: `${String(WORKING_HOUR_START).padStart(2, '0')}:00`,
  endTime: `${String(WORKING_HOUR_END).padStart(2, '0')}:00`,
};

export function BusinessHoursFields({
  value,
  onChange,
}: {
  value: BusinessHours | undefined;
  onChange: (next: BusinessHours) => void;
}): React.ReactElement {
  const hours = value ?? DEFAULT_BUSINESS_HOURS;
  const toggleDay = (day: number): void =>
    onChange({
      ...hours,
      days: hours.days.includes(day) ? hours.days.filter(d => d !== day) : [...hours.days, day],
    });

  return (
    <div className='flex flex-wrap items-center gap-1.5'>
      {DAY_ORDER.map(day => (
        <button
          key={day}
          type='button'
          onClick={() => toggleDay(day)}
          className={cn(
            'h-7 rounded-md border px-2.5 text-xs',
            hours.days.includes(day)
              ? 'border-foreground/40 bg-foreground text-background'
              : 'border-border bg-background text-muted-foreground',
          )}
        >
          {WEEKDAYS[day]}
        </button>
      ))}
      <Input
        type='time'
        value={hours.startTime}
        onChange={e => onChange({ ...hours, startTime: e.target.value })}
        className='h-7 w-28'
      />
      <span className='text-xs text-muted-foreground'>to</span>
      <Input
        type='time'
        value={hours.endTime}
        onChange={e => onChange({ ...hours, endTime: e.target.value })}
        className='h-7 w-28'
      />
      <span className='text-xs text-muted-foreground'>IST</span>
    </div>
  );
}
