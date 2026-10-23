import type { ScheduledJobPatch } from '@/services/claw/clawScheduledJobsService';

export interface EditableScheduledJob {
  readonly id: string;
  readonly task: string;
  readonly label: string | null;
  readonly type: 'once' | 'cron';
  readonly cronExpression: string | null;
  readonly nextRunAt: string | null;
  readonly status: string;
  readonly replyMode?: string | null;
  readonly channelId?: string | null;
}

export type ReplyMode = 'thread' | 'channel';

export interface ScheduleDraft {
  task: string;
  label: string;
  cron: string;
  runAt: string;
  replyMode: ReplyMode;
}

const MIN_LEAD_MS = 60 * 1000;

const pad = (value: number): string => String(value).padStart(2, '0');

export function toDateTimeLocal(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

export const canPauseJob = (job: Pick<EditableScheduledJob, 'status'>): boolean =>
  job.status === 'active';

export const canResumeJob = (job: Pick<EditableScheduledJob, 'status'>): boolean =>
  job.status === 'paused';

export const canEditJob = (job: Pick<EditableScheduledJob, 'status'>): boolean =>
  job.status === 'active' || job.status === 'paused';

export const canRescheduleJob = (job: Pick<EditableScheduledJob, 'status'>): boolean =>
  job.status === 'active';

export const canChangeDelivery = (
  job: Pick<EditableScheduledJob, 'channelId' | 'replyMode'>,
): boolean => Boolean(job.channelId) && job.replyMode !== 'whatsapp';

export function draftFromJob(job: EditableScheduledJob): ScheduleDraft {
  return {
    task: job.task,
    label: job.label ?? '',
    cron: job.cronExpression ?? '',
    runAt: toDateTimeLocal(job.nextRunAt),
    replyMode: job.replyMode === 'channel' ? 'channel' : 'thread',
  };
}

export type SchedulePatchResult = { patch: ScheduledJobPatch } | { error: string };

export function schedulePatch(
  job: EditableScheduledJob,
  draft: ScheduleDraft,
  now: number = Date.now(),
): SchedulePatchResult {
  const patch: ScheduledJobPatch = {};

  const task = draft.task.trim();
  if (!task) return { error: 'Describe what the agent should do.' };
  if (task !== job.task.trim()) patch.task = task;

  const label = draft.label.trim() || null;
  if (label !== (job.label?.trim() || null)) patch.label = label;

  if (canRescheduleJob(job) && job.type === 'cron') {
    const cron = draft.cron.trim().replace(/\s+/g, ' ');
    if (cron.split(' ').length !== 5) {
      return { error: 'A cron expression needs five fields, e.g. 0 9 * * 1-5' };
    }
    if (cron !== (job.cronExpression ?? '').trim().replace(/\s+/g, ' ')) {
      patch.cronExpression = cron;
    }
  }

  if (
    canRescheduleJob(job) &&
    job.type === 'once' &&
    draft.runAt !== toDateTimeLocal(job.nextRunAt)
  ) {
    const runAt = new Date(draft.runAt);
    if (Number.isNaN(runAt.getTime())) return { error: 'Pick when it should run.' };
    if (runAt.getTime() - now < MIN_LEAD_MS) {
      return { error: 'Pick a time at least a minute from now.' };
    }
    patch.nextRunAt = runAt.toISOString();
  }

  if (canChangeDelivery(job)) {
    const current: ReplyMode = job.replyMode === 'channel' ? 'channel' : 'thread';
    if (draft.replyMode !== current) patch.replyMode = draft.replyMode;
  }

  return { patch };
}

export function describeSchedule(
  job: Pick<EditableScheduledJob, 'type' | 'cronExpression' | 'nextRunAt' | 'status'>,
): string {
  const when =
    job.type === 'cron'
      ? job.cronExpression
        ? `Repeats · ${job.cronExpression}`
        : 'Repeats'
      : job.nextRunAt
        ? `Runs once · ${new Date(job.nextRunAt).toLocaleString()}`
        : 'One-off';
  return job.status === 'paused' ? `Paused · ${when}` : when;
}
