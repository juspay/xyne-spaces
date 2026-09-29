import { z } from 'zod';
import { config } from '@/config/env';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_WAIT_MS = 30 * DAY_MS;
const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

export const BusinessHoursSchema = z
  .object({
    days: z.array(z.number().int().min(0).max(6)).min(1),
    startTime: z.string().regex(TIME_REGEX),
    endTime: z.string().regex(TIME_REGEX),
  })
  .refine((h) => h.endTime > h.startTime, {
    path: ['endTime'],
    message: 'must be after startTime',
  });
export type BusinessHours = z.infer<typeof BusinessHoursSchema>;

export const DEFAULT_BUSINESS_HOURS: BusinessHours = {
  days: [1, 2, 3, 4, 5],
  startTime: `${String(config.workingHours.start).padStart(2, '0')}:00`,
  endTime: `${String(config.workingHours.end).padStart(2, '0')}:00`,
};

function timeMs(time: string): number {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  return (hours * 60 + minutes) * 60 * 1000;
}

/** [open, close) of the business window on the IST day containing `istMs`, or null on a day off. */
function businessWindow(istMs: number, hours: BusinessHours): [number, number] | null {
  const dayStart = Math.floor(istMs / DAY_MS) * DAY_MS;
  if (!hours.days.includes(new Date(dayStart).getUTCDay())) return null;
  return [dayStart + timeMs(hours.startTime), dayStart + timeMs(hours.endTime)];
}

/** Callers validate with fitsWithinMaxWait first, so the walk always ends within 30 days. */
export function addBusinessTime(start: Date, durationMs: number, hours: BusinessHours): Date {
  let cursor = start.getTime() + IST_OFFSET_MS;
  let remaining = durationMs;
  for (;;) {
    const window = businessWindow(cursor, hours);
    if (window) {
      const from = Math.max(cursor, window[0]);
      const available = window[1] - from;
      if (remaining <= available) return new Date(from + remaining - IST_OFFSET_MS);
      remaining -= Math.max(0, available);
    }
    cursor = Math.floor(cursor / DAY_MS) * DAY_MS + DAY_MS;
  }
}

export function isWithinBusinessHours(at: Date, hours: BusinessHours): boolean {
  const ist = at.getTime() + IST_OFFSET_MS;
  const window = businessWindow(ist, hours);
  return window !== null && window[0] <= ist && ist < window[1];
}

export function fitsWithinMaxWait(durationMs: number, hours: BusinessHours): boolean {
  const referenceMonday = Date.UTC(2024, 0, 1) - IST_OFFSET_MS;
  return hours.days.every((day) => {
    const windowClose = referenceMonday + ((day + 6) % 7) * DAY_MS + timeMs(hours.endTime);
    const resumeAt = addBusinessTime(new Date(windowClose), durationMs, hours);
    return resumeAt.getTime() - windowClose <= MAX_WAIT_MS;
  });
}
