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
});

const ScheduleTriggerOutputSchema = z.object({
  firedAt: z.string(),
});

/** Single source of the cron expression for activate, tick-time checks and boot recovery. */
export function cronFromTrigger(config: unknown): string {
  return buildCronPattern(ScheduleTriggerConfigSchema.parse(config));
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
