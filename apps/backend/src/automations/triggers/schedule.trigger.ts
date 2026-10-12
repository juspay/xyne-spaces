import { z } from 'zod';
import { BaseTrigger } from './base-trigger';
import { TriggerCategory } from '../types/categories';
import { buildCronPattern } from '@/utils/cronUtils';

export const SCHEDULE_EVENT = 'CRON';

// Times are IST wall-clock as typed; the Bull repeatable is registered with tz Asia/Kolkata
// (DEFAULT_CRON_TIMEZONE), so no UTC conversion happens anywhere.
const ScheduleTriggerConfigSchema = z.object({
  scheduledTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .default('09:00')
    .describe('Time of day, HH:mm in IST.'),
  daysOfWeek: z
    .string()
    .regex(/^(-|[0-6](,[0-6])*)$/)
    .default('1,2,3,4,5')
    .describe('Weekly: comma-separated weekdays (0=Sun..6=Sat). "-" means monthly.'),
  monthlyMode: z.enum(['DAY_OF_MONTH', 'NTH_WEEKDAY']).nullish(),
  monthlyValue: z
    .number()
    .int()
    .nullish()
    .describe(
      'Monthly only. DAY_OF_MONTH: 1..28, or -1 for the last day. NTH_WEEKDAY: ordinal*10+weekday (ordinal 5 = last).',
    ),
  intervalUnit: z
    .enum(['MINUTES', 'HOURS'])
    .nullish()
    .describe('Set for "every N minutes/hours"; takes precedence over the time-of-day fields.'),
  intervalValue: z
    .number()
    .int()
    .min(1)
    .max(59)
    .nullish()
    .describe('Whole number. UI caps MINUTES at 59 and HOURS at 23.'),
}).refine(c => c.intervalUnit !== 'HOURS' || !c.intervalValue || c.intervalValue <= 23, {
  path: ['intervalValue'],
  message: 'Hours must be between 1 and 23.',
});

const ScheduleTriggerOutputSchema = z.object({
  firedAt: z.string().describe('IST timestamp, e.g. 2026-10-09T14:09:00.109+05:30'),
  date: z.string().describe('IST date, YYYY-MM-DD'),
  time: z.string().describe('IST time, HH:mm'),
  weekday: z.string().describe('IST weekday name, e.g. Friday'),
});

/** Single source of the cron expression for activate, tick-time checks and boot recovery. */
export function cronFromTrigger(config: unknown): string {
  const parsed = ScheduleTriggerConfigSchema.parse(config);
  if (parsed.intervalUnit && parsed.intervalValue) {
    return parsed.intervalUnit === 'MINUTES'
      ? `*/${parsed.intervalValue} * * * *`
      : `0 */${parsed.intervalValue} * * *`;
  }
  return buildCronPattern(parsed);
}

export class ScheduleTrigger extends BaseTrigger<typeof ScheduleTriggerConfigSchema> {
  readonly type = SCHEDULE_EVENT;
  readonly configSchema = ScheduleTriggerConfigSchema;
  readonly outputSchema = ScheduleTriggerOutputSchema;
  readonly name = 'On a schedule';
  readonly description =
    'Fires at a set time (IST) on chosen weekdays, or monthly on a day of the month or the Nth weekday.';
  readonly category = TriggerCategory.TIMER;
  readonly icon = 'Clock';
  readonly requiresScopeFilter = false;
}

export const scheduleTrigger = new ScheduleTrigger();
