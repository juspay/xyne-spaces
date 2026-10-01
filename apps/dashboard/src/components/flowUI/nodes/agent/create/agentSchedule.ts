/**
 * The create canvas Schedule property: when the new agent runs on its own.
 * On Save it becomes a real ScheduledJob (`POST /scheduled-jobs`) once the
 * agent exists; until then it lives on the form like any other property.
 */

interface ScheduleBase {
  /** IANA zone the time is read in. The browser's zone when set on the canvas. */
  timezone: string;
  /** What the agent is asked to do on each run. Blank means "its usual job". */
  task: string;
}

export type CreateSchedule =
  /** One run at an absolute instant (ISO string). */
  | (ScheduleBase & { kind: 'once'; at: string })
  /** Repeating 5-field cron, read in `timezone`. */
  | (ScheduleBase & { kind: 'repeat'; cron: string });

export type RepeatFrequency = 'daily' | 'weekdays' | 'weekly';

export interface RepeatParts {
  frequency: RepeatFrequency;
  hour: number;
  minute: number;
  /** 0 = Sunday … 6 = Saturday. Only read for `weekly`. */
  weekday: number;
}

export const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** A fresh schedule for Add property → Schedule: tomorrow at 9:00, once. */
export function defaultSchedule(now: Date = new Date()): CreateSchedule {
  const at = new Date(now);
  at.setDate(at.getDate() + 1);
  at.setHours(9, 0, 0, 0);
  return { kind: 'once', at: at.toISOString(), timezone: browserTimezone(), task: '' };
}

export function cronFromRepeat(parts: RepeatParts): string {
  const time = `${parts.minute} ${parts.hour}`;
  switch (parts.frequency) {
    case 'weekdays':
      return `${time} * * 1-5`;
    case 'weekly':
      return `${time} * * ${parts.weekday}`;
    default:
      return `${time} * * *`;
  }
}

/** The picker's view of a cron, or null for anything the picker can't express. */
export function repeatFromCron(cron: string): RepeatParts | null {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const [minute, hour, dom, month, dow] = fields;
  if (!/^\d{1,2}$/.test(minute ?? '') || !/^\d{1,2}$/.test(hour ?? '')) return null;
  if (dom !== '*' || month !== '*') return null;
  const base = { hour: Number(hour), minute: Number(minute) };
  if (base.hour > 23 || base.minute > 59) return null;
  if (dow === '*') return { ...base, frequency: 'daily', weekday: 1 };
  if (dow === '1-5') return { ...base, frequency: 'weekdays', weekday: 1 };
  if (/^[0-7]$/.test(dow ?? '')) {
    return { ...base, frequency: 'weekly', weekday: Number(dow) % 7 };
  }
  return null;
}

export function formatClock(hour: number, minute: number): string {
  return new Date(2000, 0, 1, hour, minute).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** "Oct 3, 9:00 AM", "Weekdays at 9:00 AM", "Mondays at 5:30 PM". */
export function scheduleLabel(schedule: CreateSchedule, now: Date = new Date()): string {
  if (schedule.kind === 'once') {
    const at = new Date(schedule.at);
    if (Number.isNaN(at.getTime())) return 'Pick a date and time';
    return at.toLocaleString([], {
      month: 'short',
      day: 'numeric',
      ...(at.getFullYear() !== now.getFullYear() ? { year: 'numeric' as const } : {}),
      hour: 'numeric',
      minute: '2-digit',
      timeZone: schedule.timezone,
    });
  }
  const parts = repeatFromCron(schedule.cron);
  if (!parts) return `Repeats (${schedule.cron})`;
  const clock = formatClock(parts.hour, parts.minute);
  switch (parts.frequency) {
    case 'weekdays':
      return `Weekdays at ${clock}`;
    case 'weekly':
      return `${WEEKDAY_NAMES[parts.weekday]}s at ${clock}`;
    default:
      return `Every day at ${clock}`;
  }
}

/** Why this schedule can't be saved yet, phrased for the Save tooltip. Null when it can. */
export function scheduleProblem(
  schedule: CreateSchedule | null,
  now: number = Date.now(),
): string | null {
  if (!schedule) return null;
  if (schedule.kind === 'once') {
    const at = Date.parse(schedule.at);
    if (!Number.isFinite(at)) return 'Pick a date and time for the schedule.';
    if (at <= now) return 'The scheduled time has passed. Pick a later time.';
    return null;
  }
  if (schedule.cron.trim().split(/\s+/).length !== 5) {
    return 'The repeating schedule needs a five-field cron, like 0 9 * * 1-5.';
  }
  return null;
}

export interface ScheduledJobInput {
  agentSlug: string;
  task: string;
  type: 'once' | 'cron';
  delayMs?: number;
  cronExpression?: string;
  timezone?: string;
  label?: string;
}

/** The POST body that arms this schedule for a just-created agent. */
export function scheduledJobInput(
  schedule: CreateSchedule,
  agentSlug: string,
  fallbackTask: string,
  now: number = Date.now(),
): ScheduledJobInput {
  const task =
    schedule.task.trim() || fallbackTask.trim() || 'Do the job described in your instructions.';
  const label = scheduleLabel(schedule);
  if (schedule.kind === 'once') {
    return {
      agentSlug,
      task,
      label,
      type: 'once',
      delayMs: Math.max(1_000, Date.parse(schedule.at) - now),
    };
  }
  return {
    agentSlug,
    task,
    label,
    type: 'cron',
    cronExpression: schedule.cron.trim(),
    timezone: schedule.timezone,
  };
}

/** One line for the saved instructions, so the agent knows it runs unattended. */
export function schedulePromptLine(schedule: CreateSchedule): string {
  const when =
    schedule.kind === 'once'
      ? `once, on ${scheduleLabel(schedule)}`
      : scheduleLabel(schedule).replace(/^./, first => first.toLowerCase());
  const task = schedule.task.trim();
  return `Runs on a schedule: ${when} (${schedule.timezone}).${task ? ` Each run: ${task}` : ''}`;
}

const pad = (value: number): string => String(value).padStart(2, '0');

/** ISO instant → the browser-local value a `datetime-local` input shows. */
export function toLocalInputValue(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

/** A `datetime-local` value (browser local time) → ISO instant, or null when blank. */
export function fromLocalInputValue(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A stored or chat-supplied schedule, or null when it isn't one. */
export function parseCreateSchedule(value: unknown): CreateSchedule | null {
  if (!isRecord(value)) return null;
  const timezone =
    typeof value['timezone'] === 'string' && value['timezone'] ? value['timezone'] : 'UTC';
  const task = typeof value['task'] === 'string' ? value['task'] : '';
  if (value['kind'] === 'once' && typeof value['at'] === 'string') {
    return { kind: 'once', at: value['at'], timezone, task };
  }
  if (value['kind'] === 'repeat' && typeof value['cron'] === 'string') {
    return { kind: 'repeat', cron: value['cron'], timezone, task };
  }
  return null;
}
