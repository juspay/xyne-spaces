import { z } from 'zod';
import { BaseActionStep } from './base-step';
import { StepCategory } from '../types/categories';
import { variableRef } from '../engine/variable-ref';
import type { AutomationContext } from '../types/context';
import { PauseStep } from '../engine/pause-step';
import { automationContextStorage } from '../engine/automation-context-storage';
import { automationScheduleQueue } from '../queue/automation-schedule.queue';
import { logger } from '@/utils/logger';
import { calculateETADeadline } from '@/utils/etaCalculation';
import { triggerRegistry } from '../triggers/trigger-registry';

const MAX_DELAY_SECONDS = 30 * 24 * 60 * 60;

const DelayUnitSchema = z.enum(['seconds', 'minutes', 'hours']);

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const IST_OFFSET_MS = 5.5 * HOUR_MS;

const BusinessHoursSchema = z
  .object({
    days: z.array(z.enum(WEEKDAYS)).min(1).default(['MON', 'TUE', 'WED', 'THU', 'FRI']),
    startHour: z.number().multipleOf(0.5).min(0).max(23.5).default(11).describe('IST start, e.g. 11.5 = 11:30'),
    endHour: z.number().multipleOf(0.5).min(0.5).max(24).default(19).describe('IST end, e.g. 19.5 = 19:30'),
  })
  .refine((b) => b.startHour < b.endHour, { path: ['endHour'], message: 'endHour must be after startHour' });

type BusinessHours = z.infer<typeof BusinessHoursSchema>;

const DelayConfigSchema = z
  .object({
    amount: variableRef(z.number().positive().describe('How long to wait')),
    unit: DelayUnitSchema.default('seconds').describe('Unit for "amount". Default seconds.'),
    businessHoursOnly: z.boolean().default(false).describe('Business Hours Only'),
    businessHours: BusinessHoursSchema.optional().describe('Custom business hours; omit for the default'),
  })
  .superRefine((data, ctx) => {
    if (typeof data.amount !== 'number') {
      return;
    }
    const seconds = toSeconds(data.amount, data.unit);
    if (seconds > MAX_DELAY_SECONDS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['amount'],
        message: `requested delay of ${seconds}s exceeds the maximum of ${MAX_DELAY_SECONDS}s (30 days)`,
      });
    }
    // Any 28 days contain each configured window 4 times, so this keeps the resume within 30 days.
    const hours = data.businessHoursOnly ? data.businessHours : undefined;
    const maxBusinessSeconds = hours ? 4 * new Set(hours.days).size * (hours.endHour - hours.startHour) * 3600 : 0;
    if (maxBusinessSeconds > 0 && seconds > maxBusinessSeconds) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['amount'],
        message: `requested delay of ${seconds}s exceeds the ${maxBusinessSeconds}s of business hours within 30 days`,
      });
    }
  });

const DelayOutputSchema = z.object({
  delayedUntil: z.string().describe('ISO timestamp the run resumed at'),
});

interface DelayOutput extends Record<string, unknown> {
  delayedUntil: string;
}

function toSeconds(amount: number, unit: z.infer<typeof DelayUnitSchema>): number {
  return unit === 'hours' ? amount * 3600 : unit === 'minutes' ? amount * 60 : amount;
}

export function calculateDelayUntil(
  start: Date,
  seconds: number,
  businessHoursOnly: boolean,
  businessHours?: BusinessHours,
): Date {
  if (!businessHoursOnly) {
    return new Date(start.getTime() + seconds * 1000);
  }

  if (businessHours) {
    return addBusinessTime(start, seconds, businessHours);
  }

  const roundedMinutes = Math.ceil(seconds / 60);
  const roundedDeadline = calculateETADeadline(start, roundedMinutes / 60);
  const roundingRemainderMs = (roundedMinutes * 60 - seconds) * 1000;

  return new Date(roundedDeadline.getTime() - roundingRemainderMs);
}

// Adds `seconds` of working time, counting only the IST [startHour, endHour) window on the configured days.
function addBusinessTime(start: Date, seconds: number, { days, startHour, endHour }: BusinessHours): Date {
  const workingDays = new Set(days.map((day) => WEEKDAYS.indexOf(day)));
  let remainingMs = seconds * 1000;
  let istMidnight = Math.floor((start.getTime() + IST_OFFSET_MS) / DAY_MS) * DAY_MS - IST_OFFSET_MS;

  for (;; istMidnight += DAY_MS) {
    if (!workingDays.has(new Date(istMidnight + IST_OFFSET_MS).getUTCDay())) {
      continue;
    }
    const windowStart = Math.max(start.getTime(), istMidnight + startHour * HOUR_MS);
    const availableMs = istMidnight + endHour * HOUR_MS - windowStart;
    if (remainingMs <= availableMs) {
      return new Date(windowStart + remainingMs);
    }
    remainingMs -= Math.max(0, availableMs);
  }
}

export class DelayStep extends BaseActionStep<typeof DelayConfigSchema, DelayOutput> {
  readonly type = 'DELAY';
  readonly configSchema = DelayConfigSchema;
  readonly outputSchema = DelayOutputSchema;
  readonly name = 'Delay';
  readonly description = 'Pauses the automation for a fixed duration, then resumes from the next step.';
  readonly category = StepCategory.CONTROL;
  readonly icon = 'Clock';

  async execute(
    config: z.infer<typeof DelayConfigSchema>,
    context: AutomationContext,
  ): Promise<DelayOutput> {
    const store = automationContextStorage.getStore();
    if (!store) {
      throw new Error('[DELAY] step executed outside an automation context — automationContextStorage was empty');
    }

    const amount = config.amount as number;
    const unit = config.unit;
    const seconds = toSeconds(amount, unit);
    if (seconds > MAX_DELAY_SECONDS) {
      throw new Error(
        `[DELAY] requested delay of ${seconds}s exceeds the maximum of ${MAX_DELAY_SECONDS}s (30 days)`,
      );
    }

    const now = new Date();
    const resumeAt = calculateDelayUntil(now, seconds, config.businessHoursOnly, config.businessHours);
    const delayMs = Math.max(0, resumeAt.getTime() - now.getTime());
    const delayedUntil = resumeAt.toISOString();

    const stepCount = Object.keys(context.steps).length;
    const currentIndex = Math.max(0, stepCount - 1);
    const jobId = `${store.runId}:delay:step_${currentIndex}`;

    logger.info(
      `[DELAY] scheduling wake-up — executionId=${store.runId} jobId=${jobId} amount=${amount} unit=${unit} delayedUntil=${delayedUntil}`,
    );

    await automationScheduleQueue
      .getQueue()
      .add({ executionId: store.runId }, { delay: delayMs, jobId });

    throw new PauseStep(`delaying ${amount} ${unit}`, {
      statePatch: { output: { delayedUntil } },
    });
  }

  async onResume(
    rowData: Record<string, unknown>,
    _config: z.infer<typeof DelayConfigSchema>,
    context: AutomationContext,
  ): Promise<DelayOutput> {
    const output = rowData['output'] as Partial<DelayOutput> | undefined;
    if (!output?.delayedUntil) {
      throw new Error('[DELAY] onResume called with no delayedUntil on the step row');
    }

    const triggerType = context.trigger.type;
    if (triggerRegistry.has(triggerType)) {
      const triggerImpl = triggerRegistry.get(triggerType);
      if (typeof triggerImpl.hydratePayload === 'function') {
        try {
          const hydratedTriggerData = await triggerImpl.hydratePayload(context.trigger.data ?? {});
          context.trigger = {
            type: triggerType,
            ...hydratedTriggerData,
            data: hydratedTriggerData,
          } as unknown as AutomationContext['trigger'];
        } catch (err) {
          logger.warn(
            `[DELAY] trigger rehydration failed for trigger=${triggerType}, using snapshot:`,
            err,
          );
        }
      }
    }

    return { delayedUntil: output.delayedUntil };
  }
}

export const delayStep = new DelayStep();
