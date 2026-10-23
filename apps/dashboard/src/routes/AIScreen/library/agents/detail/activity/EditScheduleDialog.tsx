import { useEffect, useState, type ReactElement } from 'react';
import { Button } from '@/components/ui/Button/index';
import type { ScheduledJobPatch } from '@/services/claw/clawScheduledJobsService';
import { V2Dialog } from '../../../shared/primitives/V2Dialog';
import { BehaviourSelect } from '../behaviour/BehaviourRows';
import {
  canChangeDelivery,
  canRescheduleJob,
  draftFromJob,
  schedulePatch,
  type EditableScheduledJob,
  type ScheduleDraft,
} from './scheduledJobEdit';

const LABEL = 'text-sm font-medium leading-[1.2] tracking-[-0.1px] text-foreground';
const HINT = 'text-xs font-normal leading-4 tracking-[-0.24px] text-muted-foreground';
const FIELD =
  'w-full rounded-2xl border border-border bg-card p-4 text-sm leading-5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60';

const REPLY_OPTIONS = [
  { value: 'thread', label: 'In the thread it was set up in' },
  { value: 'channel', label: 'As a new post in the channel' },
];

interface EditScheduleDialogProps {
  job: EditableScheduledJob | null;
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (job: EditableScheduledJob, patch: ScheduledJobPatch) => void;
}

export function EditScheduleDialog({
  job,
  saving,
  onOpenChange,
  onSave,
}: EditScheduleDialogProps): ReactElement {
  const [draft, setDraft] = useState<ScheduleDraft | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(job ? draftFromJob(job) : null);
    setError(null);
  }, [job]);

  const update = (change: Partial<ScheduleDraft>): void => {
    setDraft(current => (current ? { ...current, ...change } : current));
    setError(null);
  };

  const submit = (): void => {
    if (!job || !draft) return;
    const result = schedulePatch(job, draft);
    if ('error' in result) {
      setError(result.error);
      return;
    }
    if (Object.keys(result.patch).length === 0) {
      onOpenChange(false);
      return;
    }
    onSave(job, result.patch);
  };

  const reschedulable = job ? canRescheduleJob(job) : false;

  return (
    <V2Dialog
      open={job !== null}
      onOpenChange={onOpenChange}
      title='Edit schedule'
      description='Changes apply from the next run.'
      testId='edit-schedule-dialog'
      footer={
        <>
          <Button
            variant='ghost'
            onClick={() => onOpenChange(false)}
            disabled={saving}
            className='h-auto rounded-xl px-3 py-2.5 text-[15px]'
            data-track-category='Claw Agents'
            data-track-name='Schedule: cancel edit'
          >
            Cancel
          </Button>
          <Button
            onClick={submit}
            loading={saving}
            className='h-auto rounded-xl bg-foreground px-3 py-2.5 text-[15px] text-background hover:bg-foreground/90'
            data-track-category='Claw Agents'
            data-track-name='Schedule: save edit'
            data-testid='edit-schedule-save'
          >
            Save
          </Button>
        </>
      }
    >
      {job && draft && (
        <>
          <section className='flex w-full flex-col gap-3'>
            <label htmlFor='edit-schedule-task' className={LABEL}>
              Prompt
            </label>
            <textarea
              id='edit-schedule-task'
              value={draft.task}
              onChange={e => update({ task: e.target.value })}
              data-track-category='Claw Agents'
              data-track-name='Schedule: edit prompt'
              className={`${FIELD} h-[96px] resize-y`}
            />
          </section>

          <section className='flex w-full flex-col gap-3'>
            <label htmlFor='edit-schedule-label' className={LABEL}>
              Name
            </label>
            <input
              id='edit-schedule-label'
              value={draft.label}
              onChange={e => update({ label: e.target.value })}
              placeholder='Optional — shown in the schedules list'
              data-track-category='Claw Agents'
              data-track-name='Schedule: edit name'
              className={`${FIELD} h-11 py-0`}
            />
          </section>

          <section className='flex w-full flex-col gap-3'>
            <label
              htmlFor={job.type === 'cron' ? 'edit-schedule-cron' : 'edit-schedule-run-at'}
              className={LABEL}
            >
              {job.type === 'cron' ? 'Repeats' : 'Runs at'}
            </label>
            {job.type === 'cron' ? (
              <input
                id='edit-schedule-cron'
                value={draft.cron}
                onChange={e => update({ cron: e.target.value })}
                disabled={!reschedulable}
                spellCheck={false}
                placeholder='0 9 * * 1-5'
                data-track-category='Claw Agents'
                data-track-name='Schedule: edit cron'
                className={`${FIELD} h-11 py-0 font-mono text-xs`}
              />
            ) : (
              <input
                id='edit-schedule-run-at'
                type='datetime-local'
                value={draft.runAt}
                onChange={e => update({ runAt: e.target.value })}
                disabled={!reschedulable}
                data-track-category='Claw Agents'
                data-track-name='Schedule: edit run time'
                className={`${FIELD} h-11 py-0`}
              />
            )}
            <span className={HINT}>
              {!reschedulable
                ? 'Resume the schedule to change when it runs.'
                : job.type === 'cron'
                  ? 'Five fields: minute, hour, day of month, month, day of week. `0 9 * * 1-5` is 9am on weekdays.'
                  : 'In your local time.'}
            </span>
          </section>

          {canChangeDelivery(job) && (
            <section className='flex w-full flex-col gap-3'>
              <span className={LABEL}>Post results</span>
              <BehaviourSelect
                value={draft.replyMode}
                options={REPLY_OPTIONS}
                editable
                disabled={saving}
                label='Where results are posted'
                trackName='Schedule: edit delivery'
                onChange={next => update({ replyMode: next === 'channel' ? 'channel' : 'thread' })}
              />
            </section>
          )}

          {error && (
            <p className='text-xs font-normal leading-4 tracking-[-0.24px] text-destructive'>
              {error}
            </p>
          )}
        </>
      )}
    </V2Dialog>
  );
}
