import { cn } from '../../../../utils/classNames';
import Input from '../../../ui/Input/Input';
import { Checkbox } from '../../../ui/Checkbox/Checkbox';
import { WORKING_HOUR_END, WORKING_HOUR_START } from '../../../../config';
import type { BusinessHours } from '../../../../api/automationsApi';
import { HolidaysField } from './HolidaysField';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

const DEFAULT_BUSINESS_HOURS: BusinessHours = {
  days: [1, 2, 3, 4, 5],
  startTime: `${String(WORKING_HOUR_START).padStart(2, '0')}:00`,
  endTime: `${String(WORKING_HOUR_END).padStart(2, '0')}:00`,
};

export interface BusinessHoursValue {
  businessHoursOnly?: boolean;
  businessHours?: BusinessHours;
}

/**
 * Business-hours editor shared by the schedule wait, DELAY and IS_OUTSIDE_BUSINESS_HOURS.
 * `toggleable` adds the "Business hours only" checkbox; without it the hours are always shown.
 * `onChange` receives a patch to spread into the owning config.
 */
export function BusinessHoursFields({
  value,
  onChange,
  toggleable = true,
}: {
  value: BusinessHoursValue;
  onChange: (patch: BusinessHoursValue) => void;
  toggleable?: boolean;
}): React.ReactElement {
  const hours = value.businessHours ?? DEFAULT_BUSINESS_HOURS;
  const enabled = !toggleable || value.businessHoursOnly === true;
  const setHours = (businessHours: BusinessHours): void => onChange({ businessHours });
  const toggleDay = (day: number): void => {
    if (hours.days.length === 1 && hours.days.includes(day)) return;
    setHours({
      ...hours,
      days: hours.days.includes(day) ? hours.days.filter(d => d !== day) : [...hours.days, day],
    });
  };

  return (
    <div className='flex flex-col gap-2'>
      {toggleable && (
        <Checkbox
          label='Business hours only'
          checked={enabled}
          onChange={checked => onChange({ businessHoursOnly: checked, businessHours: hours })}
          size='sm'
        />
      )}
      {enabled && (
        <>
          <div className='flex flex-wrap items-center gap-1.5'>
            {DAY_ORDER.map(day => (
              <button
                key={day}
                type='button'
                data-track-category='automation-builder'
                data-track-name='business-hours-day-toggle'
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
          </div>
          <div className='flex items-center gap-1.5'>
            <Input
              type='time'
              value={hours.startTime}
              onChange={e => setHours({ ...hours, startTime: e.target.value })}
              className='h-7 w-36 text-xs'
            />
            <span className='text-xs text-muted-foreground'>to</span>
            <Input
              type='time'
              value={hours.endTime}
              onChange={e => setHours({ ...hours, endTime: e.target.value })}
              className='h-7 w-36 text-xs'
            />
            <span className='text-xs text-muted-foreground'>IST</span>
          </div>
          <HolidaysField
            days={hours.days}
            holidays={hours.holidays ?? []}
            onChange={holidays => setHours({ ...hours, holidays })}
          />
        </>
      )}
    </div>
  );
}
