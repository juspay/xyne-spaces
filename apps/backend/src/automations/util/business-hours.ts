import { z } from 'zod';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const MAX_DAY_ITERATIONS = 32;

const TIME_OF_DAY_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

export const BusinessHoursSchema = z
  .object({
    days: z
      .array(z.number().int().min(0).max(6))
      .min(1)
      .describe('Working days (0 = Sunday … 6 = Saturday)'),
    startTime: z.string().regex(TIME_OF_DAY_REGEX).describe('Working hours start (HH:mm, IST)'),
    endTime: z.string().regex(TIME_OF_DAY_REGEX).describe('Working hours end (HH:mm, IST)'),
  })
  .describe('Business Hours');
export type BusinessHours = z.infer<typeof BusinessHoursSchema>;

function toMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

export function isValidBusinessHoursRange(hours: Pick<BusinessHours, 'startTime' | 'endTime'>): boolean {
  return toMinutes(hours.endTime) > toMinutes(hours.startTime);
}

export function parseBusinessHours(value: unknown): BusinessHours | null {
  const parsed = BusinessHoursSchema.safeParse(value);
  if (!parsed.success || !isValidBusinessHoursRange(parsed.data)) return null;
  return parsed.data;
}

const REFERENCE_MONDAY_IST_MS = Date.UTC(2024, 0, 1);

export function maxBusinessWaitCalendarMs(durationMs: number, hours: BusinessHours): number {
  const windowEndMs = toMinutes(hours.endTime) * 60 * 1000;
  let worst = 0;
  for (const day of new Set(hours.days)) {
    const offsetDays = (day + 6) % 7;
    const start = new Date(REFERENCE_MONDAY_IST_MS + offsetDays * DAY_MS + windowEndMs - IST_OFFSET_MS);
    worst = Math.max(worst, addBusinessTime(start, durationMs, hours).getTime() - start.getTime());
  }
  return worst;
}

export function formatCalendarSpan(ms: number): string {
  const days = Math.ceil(ms / DAY_MS);
  return `${days} calendar day${days === 1 ? '' : 's'}`;
}

export function addBusinessTime(start: Date, durationMs: number, hours: BusinessHours): Date {
  if (durationMs <= 0) return new Date(start);

  const days = new Set(hours.days);
  const windowStartMs = toMinutes(hours.startTime) * 60 * 1000;
  const windowEndMs = toMinutes(hours.endTime) * 60 * 1000;
  const weeklyWorkingMs = days.size * (windowEndMs - windowStartMs);

  let cursor = start.getTime() + IST_OFFSET_MS;
  let remaining = durationMs;

  if (remaining > weeklyWorkingMs) {
    const fullWeeks = Math.floor((remaining - 1) / weeklyWorkingMs);
    cursor += fullWeeks * WEEK_MS;
    remaining -= fullWeeks * weeklyWorkingMs;
  }

  for (let i = 0; i < MAX_DAY_ITERATIONS; i++) {
    const dayStart = Math.floor(cursor / DAY_MS) * DAY_MS;
    if (days.has(new Date(dayStart).getUTCDay())) {
      const from = Math.max(cursor, dayStart + windowStartMs);
      const windowEnd = dayStart + windowEndMs;
      if (from < windowEnd) {
        const available = windowEnd - from;
        if (remaining <= available) {
          return new Date(from + remaining - IST_OFFSET_MS);
        }
        remaining -= available;
      }
    }
    cursor = dayStart + DAY_MS;
  }

  throw new Error('[business-hours] could not resolve a business-time deadline');
}
