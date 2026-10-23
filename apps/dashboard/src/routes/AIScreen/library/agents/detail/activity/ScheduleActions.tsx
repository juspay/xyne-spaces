import type { ReactElement } from 'react';
import { Pause, Pencil, Play } from 'lucide-react';
import {
  canEditJob,
  canPauseJob,
  canResumeJob,
  type EditableScheduledJob,
} from './scheduledJobEdit';

const ICON_BUTTON =
  'flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40';

export function ScheduleActions({
  job,
  busy,
  onEdit,
  onPause,
  onResume,
}: {
  job: EditableScheduledJob;
  busy: boolean;
  onEdit: () => void;
  onPause: () => void;
  onResume: () => void;
}): ReactElement {
  const name = job.label || job.task;
  return (
    <span className='flex shrink-0 items-center gap-0.5'>
      {canEditJob(job) && (
        <button
          type='button'
          onClick={onEdit}
          disabled={busy}
          aria-label={`Edit ${name}`}
          title='Edit schedule'
          data-track-category='Claw Agents'
          data-track-name='Schedule: open edit'
          data-testid='schedule-edit'
          className={ICON_BUTTON}
        >
          <Pencil className='size-3.5' aria-hidden />
        </button>
      )}
      {canPauseJob(job) && (
        <button
          type='button'
          onClick={onPause}
          disabled={busy}
          aria-label={`Pause ${name}`}
          title='Pause schedule'
          data-track-category='Claw Agents'
          data-track-name='Schedule: pause'
          data-testid='schedule-pause'
          className={ICON_BUTTON}
        >
          <Pause className='size-3.5' aria-hidden />
        </button>
      )}
      {canResumeJob(job) && (
        <button
          type='button'
          onClick={onResume}
          disabled={busy}
          aria-label={`Resume ${name}`}
          title='Resume schedule'
          data-track-category='Claw Agents'
          data-track-name='Schedule: resume'
          data-testid='schedule-resume'
          className={ICON_BUTTON}
        >
          <Play className='size-3.5' aria-hidden />
        </button>
      )}
    </span>
  );
}
