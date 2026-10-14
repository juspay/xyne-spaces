export const NOTIFICATION_SCHEDULE_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
export const MAX_NOTIFICATION_SCHEDULE_TIMEZONE_LENGTH = 100;

export interface NotificationScheduleDay {
  day: number;
  start: string;
  end: string;
}

export interface NotificationSchedule {
  enabled: boolean;
  days: NotificationScheduleDay[];
  timeZone: string;
}

export function isValidTimeZone(timeZone: unknown): timeZone is string {
  if (typeof timeZone !== 'string' || timeZone.length === 0) return false;
  if (timeZone.length > MAX_NOTIFICATION_SCHEDULE_TIMEZONE_LENGTH) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function normalizeNotificationSchedule(raw: NotificationSchedule): NotificationSchedule {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid notification schedule');
  if (typeof raw.enabled !== 'boolean') throw new Error('Notification schedule "enabled" must be a boolean');
  if (!isValidTimeZone(raw.timeZone)) throw new Error(`Invalid time zone: ${String(raw.timeZone)}`);
  if (!Array.isArray(raw.days)) throw new Error('Notification schedule "days" must be an array');

  const seen = new Set<number>();
  const days: NotificationScheduleDay[] = [];
  for (const entry of raw.days) {
    const { day, start, end } = entry ?? ({} as NotificationScheduleDay);
    if (!Number.isInteger(day) || day < 0 || day > 6) throw new Error(`Invalid day: ${String(day)}`);
    if (typeof start !== 'string' || !NOTIFICATION_SCHEDULE_TIME_PATTERN.test(start)) {
      throw new Error(`Invalid start time: ${String(start)}`);
    }
    if (typeof end !== 'string' || !NOTIFICATION_SCHEDULE_TIME_PATTERN.test(end)) {
      throw new Error(`Invalid end time: ${String(end)}`);
    }
    if (start === end) throw new Error('Start and end time must differ');
    if (seen.has(day)) throw new Error(`Duplicate day: ${day}`);
    seen.add(day);
    days.push({ day, start, end });
  }
  if (raw.enabled && days.length === 0) {
    throw new Error('An enabled notification schedule needs at least one day');
  }
  days.sort((a, b) => a.day - b.day);
  return { enabled: raw.enabled, days, timeZone: raw.timeZone };
}

export function parseNotificationSchedule(
  value: string | null | undefined,
): NotificationSchedule | null {
  if (!value) return null;
  try {
    return normalizeNotificationSchedule(JSON.parse(value));
  } catch {
    return null;
  }
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};
export function getZonedDayAndMinute(now: Date, timeZone: string): { day: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  const day = WEEKDAY_INDEX[get('weekday')];
  const hour = Number(get('hour')) % 24;
  const minute = Number(get('minute'));
  return { day, minute: hour * 60 + minute };
}

export function isOutsideWorkingHours(
  schedule: NotificationSchedule | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!schedule || !schedule.enabled || schedule.days.length === 0) return false;
  if (!isValidTimeZone(schedule.timeZone)) return false;

  const { day, minute } = getZonedDayAndMinute(now, schedule.timeZone);
  const previousDay = (day + 6) % 7;

  for (const window of schedule.days) {
    const start = toMinutes(window.start);
    const end = toMinutes(window.end);
    if (start < end) {
      if (window.day === day && minute >= start && minute < end) return false;
    } else {
      if (window.day === day && minute >= start) return false;
      if (window.day === previousDay && minute < end) return false;
    }
  }
  return true;
}

export function getNextWorkingHoursStart(
  schedule: NotificationSchedule | null | undefined,
  now: Date = new Date(),
): { day: number; start: string } | null {
  if (!schedule || !schedule.enabled || schedule.days.length === 0) return null;
  if (!isValidTimeZone(schedule.timeZone)) return null;

  const { day, minute } = getZonedDayAndMinute(now, schedule.timeZone);
  for (let offset = 0; offset <= 7; offset++) {
    const candidateDay = (day + offset) % 7;
    const window = schedule.days.find(d => d.day === candidateDay);
    if (!window) continue;
    if (offset === 0 && toMinutes(window.start) <= minute) continue;
    return { day: candidateDay, start: window.start };
  }
  return null;
}
