/**
 * DELAY step — wait for the clock, with nobody to call.
 *
 * Pauses with `wakeAt`; the runtime enqueues the next pass with that delay and
 * the walk resumes the gate once it has passed. No new host port: the queue
 * adapter already takes a delay, and a timer that fires on a gate which has
 * since closed is a no-op.
 */

import { z } from 'zod';
import { BaseActionStep } from '../../../steps/base-step.js';
import type { StepExecutionContext } from '../../../steps/base-step.js';
import { BuiltinStepType, GateCategory } from '../../../types/known-types.js';
import type { StepCategory } from '../../../types/categories.js';
import { variableRef } from '../../../types/workflow-config.js';

export const DelayStepConfigSchema = z.object({
  afterMs: variableRef(
    z.number().int().positive().describe('How long to wait, in milliseconds'),
  ),
});

export type DelayStepConfig = z.infer<typeof DelayStepConfigSchema>;

export interface DelayStepOutput extends Record<string, unknown> {
  /** When the run came back, ISO 8601. */
  wokeAt: string;
}

const DelayStepOutputSchema = z.object({ wokeAt: z.string() });

export class DelayStep extends BaseActionStep<typeof DelayStepConfigSchema, DelayStepOutput> {
  override readonly type = BuiltinStepType.DELAY;
  override readonly name = 'Delay';
  override readonly description = 'Pause the run for a while, then carry on';
  override readonly configSchema = DelayStepConfigSchema;
  override readonly outputSchema = DelayStepOutputSchema;
  override readonly category: StepCategory = 'flow';
  override readonly icon = 'clock';

  // Async so a signature promising a Promise never throws synchronously.
  override async execute(config: DelayStepConfig, ctx: StepExecutionContext): Promise<DelayStepOutput> {
    const afterMs = Number(config.afterMs);
    if (!Number.isInteger(afterMs) || afterMs <= 0) {
      throw new Error(`Delay needs a whole number of milliseconds, got ${JSON.stringify(config.afterMs)}`);
    }
    ctx.pause(`Waiting ${String(afterMs)}ms`, {
      category: GateCategory.Delay,
      statePatch: { wakeAt: new Date(Date.now() + afterMs).toISOString() },
    });
  }

  override async onResume(): Promise<DelayStepOutput> {
    return { wokeAt: new Date().toISOString() };
  }
}
