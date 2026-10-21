import { z } from 'zod';
import { BaseActionStep } from './base-step';
import { StepCategory } from '../types/categories';
import { variableRef } from '../engine/variable-ref';
import type { AutomationContext } from '../types/context';
import { coerceToDate } from '../types/automation-config';
import {
  BusinessHoursSchema,
  DEFAULT_BUSINESS_HOURS,
  isWithinBusinessHours,
} from '../util/business-hours';

const IsOutsideBusinessHoursConfigSchema = z.object({
  value: variableRef(z.coerce.date().describe('Date/time to check')),
  businessHours: BusinessHoursSchema.default(DEFAULT_BUSINESS_HOURS),
});

const IsOutsideBusinessHoursOutputSchema = z.object({
  isOutsideBusinessHours: z
    .boolean()
    .describe('True when the date/time falls outside the configured business hours'),
});

interface IsOutsideBusinessHoursOutput extends Record<string, unknown> {
  isOutsideBusinessHours: boolean;
}

export class IsOutsideBusinessHoursStep extends BaseActionStep<
  typeof IsOutsideBusinessHoursConfigSchema,
  IsOutsideBusinessHoursOutput
> {
  readonly type = 'IS_OUTSIDE_BUSINESS_HOURS';
  readonly configSchema = IsOutsideBusinessHoursConfigSchema;
  readonly outputSchema = IsOutsideBusinessHoursOutputSchema;
  readonly name = 'Is outside business hours';
  readonly description =
    'Checks whether a date/time variable falls outside the configured business hours (IST) and returns true or false.';
  readonly category = StepCategory.VALIDATOR;
  readonly icon = 'CalendarClock';

  async execute(
    config: z.infer<typeof IsOutsideBusinessHoursConfigSchema>,
    _context: AutomationContext,
  ): Promise<IsOutsideBusinessHoursOutput> {
    const at = coerceToDate(config.value);
    if (!at) {
      throw new Error(`[IS_OUTSIDE_BUSINESS_HOURS] "${String(config.value)}" is not a valid date/time`);
    }
    return { isOutsideBusinessHours: !isWithinBusinessHours(at, config.businessHours) };
  }
}

export const isOutsideBusinessHoursStep = new IsOutsideBusinessHoursStep();
