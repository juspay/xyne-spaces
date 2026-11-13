import { z } from 'zod';
import { CronTrigger } from '../../../triggers/cron-trigger.js';
import type { CronSchedule } from '../../../triggers/cron-trigger.js';
import { BuiltinTriggerType } from '../../../types/known-types.js';
import { TriggerCategory } from '../../../types/categories.js';

const DefaultCronTriggerConfigSchema = z.object({
  expression: z.string().min(1)
    .describe('Cron expression defining the schedule (e.g. "0 * * * *" for every hour)'),
});

/**
 * Default cron trigger — fires on a cron schedule.
 *
 * Config accepts only the cron expression. Timezone is set globally on the
 * runtime via `RuntimeOptions.defaultCronTimezone` (defaults to
 * `Asia/Kolkata`), so every cron job in a deployment runs against the same
 * zone.
 */
/** Every tick tells the run when it fired, and nothing else. */
const DefaultCronTriggerOutputSchema = z.object({ firedAt: z.string() });

export class DefaultCronTrigger extends CronTrigger<
  typeof DefaultCronTriggerConfigSchema,
  typeof DefaultCronTriggerOutputSchema
> {
  override readonly type = BuiltinTriggerType.CRON;
  override readonly name = 'Cron Trigger';
  override readonly description = 'Trigger a workflow on a recurring schedule';
  override readonly category = TriggerCategory.CRON;
  override readonly icon = 'timer';
  override readonly configSchema = DefaultCronTriggerConfigSchema;
  override readonly outputSchema = DefaultCronTriggerOutputSchema;

  getSchedule(config: z.infer<typeof DefaultCronTriggerConfigSchema>): CronSchedule {
    return { expression: config.expression };
  }
}
