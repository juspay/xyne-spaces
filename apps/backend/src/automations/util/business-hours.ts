import { z } from 'zod';

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
  .refine(h => h.endTime > h.startTime, { path: ['endTime'], message: 'must be after startTime' });
export type BusinessHours = z.infer<typeof BusinessHoursSchema>;

function timeMs(time: string): number {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  return (hours * 60 + minutes) * 60 * 1000;
}

export function addBusinessTime(start: Date, durationMs: number, hours: BusinessHours): Date | null {
  const limit = start.getTime() + IST_OFFSET_MS + MAX_WAIT_MS;
  let cursor = start.getTime() + IST_OFFSET_MS;
  let remaining = durationMs;
  while (cursor <= limit) {
    const dayStart = Math.floor(cursor / DAY_MS) * DAY_MS;
    if (hours.days.includes(new Date(dayStart).getUTCDay())) {
      const from = Math.max(cursor, dayStart + timeMs(hours.startTime));
      const available = dayStart + timeMs(hours.endTime) - from;
      if (remaining <= available) {
        return from + remaining <= limit ? new Date(from + remaining - IST_OFFSET_MS) : null;
      }
      remaining -= Math.max(0, available);
    }
    cursor = dayStart + DAY_MS;
  }
  return null;
}

export function fitsWithinMaxWait(durationMs: number, hours: BusinessHours): boolean {
  const referenceMonday = Date.UTC(2024, 0, 1) - IST_OFFSET_MS;
  return hours.days.every(day => {
    const windowClose = referenceMonday + ((day + 6) % 7) * DAY_MS + timeMs(hours.endTime);
    return addBusinessTime(new Date(windowClose), durationMs, hours) !== null;
  });
}
