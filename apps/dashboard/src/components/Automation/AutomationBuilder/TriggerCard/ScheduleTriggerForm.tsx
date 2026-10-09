import { cn } from '../../../../utils/classNames';
import type { ValidationIssue } from '../../Automation.types';

interface ScheduleTriggerFormProps {
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  issues: ValidationIssue[] | null;
  pathPrefix: string;
}

type Frequency = 'WEEKLY' | 'DAY_OF_MONTH' | 'NTH_WEEKDAY' | 'LAST_DAY';

const DEFAULT_TIME = '09:00';
const DEFAULT_DAYS = '1,2,3,4,5';
const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const ORDINALS = [
  { value: 1, label: 'First' },
  { value: 2, label: 'Second' },
  { value: 3, label: 'Third' },
  { value: 4, label: 'Fourth' },
  { value: 5, label: 'Last' },
];
const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];
const FREQUENCIES: { value: Frequency; label: string }[] = [
  { value: 'WEEKLY', label: 'Weekly' },
  { value: 'DAY_OF_MONTH', label: 'Day of month' },
  { value: 'NTH_WEEKDAY', label: 'Nth weekday' },
  { value: 'LAST_DAY', label: 'Last day' },
];

const selectClass =
  'h-8 rounded-md border border-border bg-background px-2 text-sm text-foreground';

// Mirrors the backend encoding (utils/cronUtils.ts): daysOfWeek "-" marks monthly,
// DAY_OF_MONTH -1 is the last day, NTH_WEEKDAY packs ordinal*10 + weekday.
export function ScheduleTriggerForm({
  value,
  onChange,
  issues,
  pathPrefix,
}: ScheduleTriggerFormProps): React.ReactElement {
  const time = typeof value['scheduledTime'] === 'string' ? value['scheduledTime'] : DEFAULT_TIME;
  const daysOfWeek = typeof value['daysOfWeek'] === 'string' ? value['daysOfWeek'] : DEFAULT_DAYS;
  const monthlyMode = value['monthlyMode'];
  const monthlyValue = typeof value['monthlyValue'] === 'number' ? value['monthlyValue'] : null;

  const frequency: Frequency =
    daysOfWeek !== '-'
      ? 'WEEKLY'
      : monthlyMode === 'NTH_WEEKDAY'
        ? 'NTH_WEEKDAY'
        : monthlyValue === -1
          ? 'LAST_DAY'
          : 'DAY_OF_MONTH';
  const selectedDays = daysOfWeek === '-' ? [] : daysOfWeek.split(',').filter(Boolean).map(Number);
  const nth = monthlyValue ?? 11;
  const ordinal = Math.floor(nth / 10) || 1;
  const weekday = nth % 10;

  const errors = (issues ?? []).filter(i => i.path.startsWith(pathPrefix)).map(i => i.message);

  const emit = (patch: Record<string, unknown>): void => onChange({ ...value, ...patch });

  const setFrequency = (next: Frequency): void => {
    if (next === 'WEEKLY') {
      emit({ daysOfWeek: DEFAULT_DAYS, monthlyMode: null, monthlyValue: null });
    } else if (next === 'DAY_OF_MONTH') {
      emit({ daysOfWeek: '-', monthlyMode: 'DAY_OF_MONTH', monthlyValue: 1 });
    } else if (next === 'NTH_WEEKDAY') {
      emit({ daysOfWeek: '-', monthlyMode: 'NTH_WEEKDAY', monthlyValue: 11 });
    } else {
      emit({ daysOfWeek: '-', monthlyMode: 'DAY_OF_MONTH', monthlyValue: -1 });
    }
  };

  const toggleDay = (d: number): void => {
    const next = selectedDays.includes(d)
      ? selectedDays.filter(x => x !== d)
      : [...selectedDays, d];
    // An empty list would make an invalid cron; keep at least one day.
    if (next.length === 0) return;
    emit({ daysOfWeek: next.sort((a, b) => a - b).join(',') });
  };

  return (
    <div className='flex flex-col gap-4'>
      <div className='flex flex-col gap-1.5'>
        <label htmlFor='schedule-time' className='text-sm font-medium text-foreground'>
          Time <span className='text-[11px] font-normal text-muted-foreground'>IST (UTC+5:30)</span>
        </label>
        <input
          id='schedule-time'
          data-track-category='automation-builder'
          data-track-name='schedule-time'
          type='time'
          value={time}
          onChange={e => e.target.value && emit({ scheduledTime: e.target.value })}
          className={cn(selectClass, 'w-32')}
        />
      </div>

      <div className='flex flex-col gap-1.5'>
        <span className='text-sm font-medium text-foreground'>Repeats</span>
        <div className='flex flex-wrap gap-1.5'>
          {FREQUENCIES.map(f => (
            <button
              key={f.value}
              data-track-category='automation-builder'
              data-track-name='schedule-frequency'
              type='button'
              onClick={() => setFrequency(f.value)}
              className={cn(
                'rounded-md border px-2.5 py-1 text-xs',
                f.value === frequency
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-border text-muted-foreground hover:bg-accent/40',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {frequency === 'WEEKLY' && (
        <div className='flex flex-wrap gap-1.5'>
          {DAYS.map((label, d) => (
            <button
              key={label}
              data-track-category='automation-builder'
              data-track-name='schedule-weekday'
              type='button'
              onClick={() => toggleDay(d)}
              className={cn(
                'size-8 rounded-md border text-xs',
                selectedDays.includes(d)
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-border text-muted-foreground hover:bg-accent/40',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {frequency === 'DAY_OF_MONTH' && (
        <div className='flex items-center gap-2 text-sm text-foreground'>
          On day
          <select
            data-track-category='automation-builder'
            data-track-name='schedule-day-of-month'
            value={monthlyValue ?? 1}
            onChange={e => emit({ monthlyValue: Number(e.target.value) })}
            className={selectClass}
          >
            {Array.from({ length: 28 }, (_, i) => i + 1).map(d => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          of every month
        </div>
      )}

      {frequency === 'NTH_WEEKDAY' && (
        <div className='flex items-center gap-2 text-sm text-foreground'>
          On the
          <select
            data-track-category='automation-builder'
            data-track-name='schedule-nth-ordinal'
            value={ordinal}
            onChange={e => emit({ monthlyValue: Number(e.target.value) * 10 + weekday })}
            className={selectClass}
          >
            {ORDINALS.map(o => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <select
            data-track-category='automation-builder'
            data-track-name='schedule-nth-weekday'
            value={weekday}
            onChange={e => emit({ monthlyValue: ordinal * 10 + Number(e.target.value) })}
            className={selectClass}
          >
            {WEEKDAY_NAMES.map((n, i) => (
              <option key={n} value={i}>
                {n}
              </option>
            ))}
          </select>
          of every month
        </div>
      )}

      {errors.map(m => (
        <span key={m} className='text-[11px] text-red-600'>
          {m}
        </span>
      ))}
    </div>
  );
}
