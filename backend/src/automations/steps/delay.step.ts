import { z } from 'zod';
import { BaseActionStep } from './base-step';
import { StepCategory } from '../types/categories';
import { variableRef } from '../engine/variable-ref';
import type { AutomationContext } from '../types/context';
import { PauseStep } from '../engine/pause-step';
import { automationContextStorage } from '../engine/automation-context-storage';
import { automationScheduleQueue } from '../queue/automation-schedule.queue';
import { logger } from '@/utils/logger';

const MAX_DELAY_SECONDS = 30 * 24 * 60 * 60;

const DelayUnitSchema = z.enum(['seconds', 'minutes', 'hours']);

const DelayConfigSchema = z
  .object({
    amount: variableRef(z.number().positive().describe('How long to wait')),
    unit: DelayUnitSchema.default('seconds').describe('Unit for "amount". Default seconds.'),
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

    const delayMs = seconds * 1000;
    const delayedUntil = new Date(Date.now() + delayMs).toISOString();

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
    _context: AutomationContext,
  ): Promise<DelayOutput> {
    const output = rowData['output'] as Partial<DelayOutput> | undefined;
    if (!output?.delayedUntil) {
      throw new Error('[DELAY] onResume called with no delayedUntil on the step row');
    }
    return { delayedUntil: output.delayedUntil };
  }
}

export const delayStep = new DelayStep();
