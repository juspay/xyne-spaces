import type { ReactElement } from 'react';
import { CalendarTimer } from '@xyne/icons';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Popover } from '@/components/ui/Popover';
import { cn } from '@/utils/classNames';
import { PROPERTY_MENU_ITEM } from './AddPropertyMenu';
import { ChatFillHighlight } from './ChatFillHighlight';
import { PropertyRow } from './PropertyRow';
import { useExclusiveMenu } from './useExclusiveMenu';
import {
  cronFromRepeat,
  fromLocalInputValue,
  repeatFromCron,
  scheduleLabel,
  scheduleProblem,
  toLocalInputValue,
  WEEKDAY_NAMES,
  type CreateSchedule,
  type RepeatFrequency,
  type RepeatParts,
} from './agentSchedule';

const FIELD =
  'h-9 w-full rounded-lg border border-border bg-background px-2.5 text-sm leading-5 text-foreground outline-none focus:ring-1 focus:ring-ring disabled:opacity-60';
const FIELD_LABEL = 'text-xs font-medium leading-4 text-muted-foreground';

const FREQUENCIES: Array<{ value: RepeatFrequency; label: string }> = [
  { value: 'daily', label: 'Every day' },
  { value: 'weekdays', label: 'Weekdays' },
  { value: 'weekly', label: 'Every week' },
];

const pad = (value: number): string => String(value).padStart(2, '0');

interface ScheduleRowProps {
  schedule: CreateSchedule;
  disabled?: boolean;
  /** Chat is writing this row. */
  shimmer?: boolean;
  onChange: (next: CreateSchedule) => void;
  onRemove: () => void;
}

/**
 * The Schedule property: when the agent runs on its own. The value reads as a
 * sentence ("Weekdays at 9:00 AM"); clicking it opens the editor. Saved as a
 * ScheduledJob right after the agent is created.
 */
export function ScheduleRow({
  schedule,
  disabled = false,
  shimmer = false,
  onChange,
  onRemove,
}: ScheduleRowProps): ReactElement {
  const editor = useExclusiveMenu();
  const problem = scheduleProblem(schedule);

  return (
    <PropertyRow
      label={<span data-testid='property-label-schedule'>Schedule</span>}
      menuLabel='Schedule'
      menuTestId='property-menu-schedule'
      menuDisabled={disabled}
      menu={
        <DropdownMenuItem
          className={PROPERTY_MENU_ITEM}
          onSelect={onRemove}
          data-testid='property-remove-schedule'
        >
          Remove
        </DropdownMenuItem>
      }
    >
      <ChatFillHighlight active={shimmer} field='schedule'>
        <Popover
          open={editor.open}
          onOpenChange={next => editor.onOpenChange(disabled ? false : next)}
          align='start'
          sideOffset={6}
          className='w-[280px] rounded-xl border-[0.8px] border-border p-3'
          trigger={
            <button
              type='button'
              disabled={disabled}
              data-track-category='Claw Agents'
              data-track-name='Create agent: edit schedule'
              data-testid='schedule-value'
              className='flex w-fit items-center gap-1.5 rounded-md text-left text-sm font-normal leading-[1.3] tracking-[-0.1px] text-foreground outline-none disabled:opacity-60'
            >
              <CalendarTimer className='size-4 shrink-0 text-muted-foreground' aria-hidden />
              <span data-shimmer-text>{scheduleLabel(schedule)}</span>
              {problem ? (
                <span className='text-xs text-destructive' data-testid='schedule-problem'>
                  · {problem}
                </span>
              ) : null}
            </button>
          }
        >
          <ScheduleEditor schedule={schedule} onChange={onChange} />
        </Popover>
      </ChatFillHighlight>
    </PropertyRow>
  );
}

function ScheduleEditor({
  schedule,
  onChange,
}: {
  schedule: CreateSchedule;
  onChange: (next: CreateSchedule) => void;
}): ReactElement {
  const repeat: RepeatParts =
    (schedule.kind === 'repeat' ? repeatFromCron(schedule.cron) : null) ??
    ((): RepeatParts => {
      const at = schedule.kind === 'once' ? new Date(schedule.at) : new Date();
      const valid = !Number.isNaN(at.getTime());
      return {
        frequency: 'weekdays',
        hour: valid ? at.getHours() : 9,
        minute: valid ? at.getMinutes() : 0,
        weekday: 1,
      };
    })();
  const customCron = schedule.kind === 'repeat' && repeatFromCron(schedule.cron) === null;

  const setRepeat = (next: Partial<RepeatParts>): void =>
    onChange({
      kind: 'repeat',
      cron: cronFromRepeat({ ...repeat, ...next }),
      timezone: schedule.timezone,
      task: schedule.task,
    });

  return (
    <div className='flex flex-col gap-3' data-testid='schedule-editor'>
      <div className='flex rounded-lg bg-muted p-0.5' role='radiogroup' aria-label='How often'>
        {(['once', 'repeat'] as const).map(kind => (
          <button
            key={kind}
            type='button'
            role='radio'
            aria-checked={schedule.kind === kind}
            onClick={() => {
              if (schedule.kind === kind) return;
              if (kind === 'repeat') {
                setRepeat({});
                return;
              }
              const at = new Date();
              at.setDate(at.getDate() + 1);
              at.setHours(repeat.hour, repeat.minute, 0, 0);
              onChange({
                kind: 'once',
                at: at.toISOString(),
                timezone: schedule.timezone,
                task: schedule.task,
              });
            }}
            data-track-category='Claw Agents'
            data-track-name={`Create agent: schedule ${kind}`}
            className={cn(
              'h-7 flex-1 rounded-md text-sm leading-5 transition-colors',
              schedule.kind === kind
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {kind === 'once' ? 'Once' : 'Repeat'}
          </button>
        ))}
      </div>

      {schedule.kind === 'once' ? (
        <label className='flex flex-col gap-1.5'>
          <span className={FIELD_LABEL}>Date and time</span>
          <input
            type='datetime-local'
            value={toLocalInputValue(schedule.at)}
            onChange={event => {
              const at = fromLocalInputValue(event.target.value);
              if (at) onChange({ ...schedule, at });
            }}
            data-track-category='Claw Agents'
            data-track-name='Create agent: schedule date'
            className={FIELD}
          />
        </label>
      ) : customCron ? (
        <label className='flex flex-col gap-1.5'>
          <span className={FIELD_LABEL}>Cron (minute hour day month weekday)</span>
          <input
            value={schedule.cron}
            onChange={event => onChange({ ...schedule, cron: event.target.value })}
            spellCheck={false}
            data-track-category='Claw Agents'
            data-track-name='Create agent: schedule cron'
            className={cn(FIELD, 'font-mono text-xs')}
          />
        </label>
      ) : (
        <div className='flex flex-col gap-2'>
          <div className='flex gap-2'>
            <label className='flex flex-1 flex-col gap-1.5'>
              <span className={FIELD_LABEL}>Repeats</span>
              <select
                value={repeat.frequency}
                onChange={event => setRepeat({ frequency: event.target.value as RepeatFrequency })}
                data-track-category='Claw Agents'
                data-track-name='Create agent: schedule frequency'
                className={FIELD}
              >
                {FREQUENCIES.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            {/* Room for a 12-hour "10:00 AM" plus the picker icon. */}
            <label className='flex w-[124px] flex-col gap-1.5'>
              <span className={FIELD_LABEL}>At</span>
              <input
                type='time'
                value={`${pad(repeat.hour)}:${pad(repeat.minute)}`}
                onChange={event => {
                  const [hour, minute] = event.target.value.split(':').map(Number);
                  if (Number.isFinite(hour) && Number.isFinite(minute)) {
                    setRepeat({ hour: hour ?? 0, minute: minute ?? 0 });
                  }
                }}
                data-track-category='Claw Agents'
                data-track-name='Create agent: schedule time'
                className={FIELD}
              />
            </label>
          </div>
          {repeat.frequency === 'weekly' ? (
            <label className='flex flex-col gap-1.5'>
              <span className={FIELD_LABEL}>On</span>
              <select
                value={repeat.weekday}
                onChange={event => setRepeat({ weekday: Number(event.target.value) })}
                data-track-category='Claw Agents'
                data-track-name='Create agent: schedule weekday'
                className={FIELD}
              >
                {WEEKDAY_NAMES.map((day, index) => (
                  <option key={day} value={index}>
                    {day}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      )}

      <label className='flex flex-col gap-1.5'>
        <span className={FIELD_LABEL}>Each run</span>
        <textarea
          value={schedule.task}
          onChange={event => onChange({ ...schedule, task: event.target.value })}
          rows={2}
          placeholder='What it should do. Leave blank for its usual job.'
          data-track-category='Claw Agents'
          data-track-name='Create agent: schedule task'
          className={cn(FIELD, 'h-auto resize-none py-2')}
        />
      </label>
      <p className='text-xs leading-4 text-muted-foreground'>Time zone: {schedule.timezone}</p>
    </div>
  );
}
