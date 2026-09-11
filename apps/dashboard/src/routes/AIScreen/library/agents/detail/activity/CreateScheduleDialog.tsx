import { useEffect, useState, type ReactElement } from 'react';
import { Button } from '@/components/ui/Button/index';
import { V2Dialog } from '../../../shared/primitives/V2Dialog';
import { BehaviourSelect } from '../behaviour/BehaviourRows';
import { MINUTE_MS, type NewScheduledJob } from './createScheduledJob';

const LABEL = 'text-sm font-medium leading-[1.2] tracking-[-0.1px] text-foreground';
const FIELD =
  'w-full rounded-2xl border border-border bg-card p-4 text-sm leading-5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring';

const TYPE_OPTIONS = [
  { value: 'cron', label: 'Repeating' },
  { value: 'once', label: 'Once' },
];

interface CreateScheduleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentSlug: string;
  saving: boolean;
  onCreate: (job: NewScheduledJob) => void;
}

export function CreateScheduleDialog({
  open,
  onOpenChange,
  agentSlug,
  saving,
  onCreate,
}: CreateScheduleDialogProps): ReactElement {
  const [task, setTask] = useState('');
  const [label, setLabel] = useState('');
  const [type, setType] = useState<'once' | 'cron'>('cron');
  const [cron, setCron] = useState('0 9 * * *');
  const [minutes, setMinutes] = useState('60');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTask('');
    setLabel('');
    setType('cron');
    setCron('0 9 * * *');
    setMinutes('60');
    setError(null);
  }, [open]);

  const submit = (): void => {
    if (!task.trim()) {
      setError('Describe what the agent should do.');
      return;
    }
    if (type === 'cron' && cron.trim().split(/\s+/).length !== 5) {
      setError('A cron expression needs five fields, e.g. 0 9 * * 1-5');
      return;
    }
    const delay = Number(minutes);
    if (type === 'once' && (!Number.isFinite(delay) || delay <= 0)) {
      setError('Enter how many minutes from now it should run.');
      return;
    }

    onCreate({
      agentSlug,
      task: task.trim(),
      type,
      ...(label.trim() ? { label: label.trim() } : {}),
      ...(type === 'cron' ? { cronExpression: cron.trim() } : { delayMs: delay * MINUTE_MS }),
    });
  };

  return (
    <V2Dialog
      open={open}
      onOpenChange={onOpenChange}
      title='Create schedule'
      description='Run this agent automatically, without anyone asking.'
      testId='create-schedule-dialog'
      footer={
        <>
          <Button
            variant='ghost'
            onClick={() => onOpenChange(false)}
            disabled={saving}
            className='h-auto rounded-xl px-3 py-2.5 text-[15px]'
            data-track-category='Claw Agents'
            data-track-name='Agent detail v2: cancel create schedule'
          >
            Cancel
          </Button>
          <Button
            onClick={submit}
            loading={saving}
            className='h-auto rounded-xl bg-foreground px-3 py-2.5 text-[15px] text-background hover:bg-foreground/90'
            data-track-category='Claw Agents'
            data-track-name='Agent detail v2: confirm create schedule'
          >
            Create
          </Button>
        </>
      }
    >
      <section className='flex w-full flex-col gap-3'>
        <label htmlFor='schedule-task' className={LABEL}>
          Task
        </label>
        <textarea
          id='schedule-task'
          value={task}
          onChange={e => {
            setTask(e.target.value);
            setError(null);
          }}
          placeholder='eg. Summarise yesterday’s error buckets and post the top three'
          data-track-category='Claw Agents'
          data-track-name='Agent detail v2: schedule task'
          className={`${FIELD} h-[86px] resize-y`}
        />
      </section>

      <section className='flex w-full flex-col gap-3'>
        <label htmlFor='schedule-label' className={LABEL}>
          Name
        </label>
        <input
          id='schedule-label'
          value={label}
          onChange={e => setLabel(e.target.value)}
          placeholder='Optional — shown in the schedules list'
          data-track-category='Claw Agents'
          data-track-name='Agent detail v2: schedule label'
          className={`${FIELD} h-11 py-0`}
        />
      </section>

      <section className='flex w-full flex-col gap-3'>
        <span className={LABEL}>When</span>
        <BehaviourSelect
          value={type}
          options={TYPE_OPTIONS}
          editable
          disabled={saving}
          label='How often it runs'
          trackName='Agent detail v2: schedule type'
          onChange={next => {
            setType(next === 'once' ? 'once' : 'cron');
            setError(null);
          }}
        />

        {type === 'cron' ? (
          <>
            <input
              value={cron}
              onChange={e => {
                setCron(e.target.value);
                setError(null);
              }}
              spellCheck={false}
              aria-label='Cron expression'
              placeholder='0 9 * * 1-5'
              data-track-category='Claw Agents'
              data-track-name='Agent detail v2: schedule cron'
              className={`${FIELD} h-11 py-0 font-mono text-xs`}
            />
            <span className='text-xs font-normal leading-4 tracking-[-0.24px] text-muted-foreground'>
              Five fields: minute, hour, day of month, month, day of week. `0 9 * * 1-5` is 9am on
              weekdays.
            </span>
          </>
        ) : (
          <>
            <input
              value={minutes}
              onChange={e => {
                setMinutes(e.target.value);
                setError(null);
              }}
              inputMode='numeric'
              aria-label='Minutes from now'
              placeholder='60'
              data-track-category='Claw Agents'
              data-track-name='Agent detail v2: schedule delay'
              className={`${FIELD} h-11 py-0`}
            />
            <span className='text-xs font-normal leading-4 tracking-[-0.24px] text-muted-foreground'>
              Minutes from now.
            </span>
          </>
        )}
      </section>

      {error && (
        <p className='text-xs font-normal leading-4 tracking-[-0.24px] text-destructive'>{error}</p>
      )}
    </V2Dialog>
  );
}
