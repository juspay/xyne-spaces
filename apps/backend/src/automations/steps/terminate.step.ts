import { z } from 'zod';
import { BaseActionStep } from './base-step';
import { StepCategory } from '../types/categories';
import { variableRef } from '../engine/variable-ref';
import { TerminateRun } from '../engine/pause-step';

const TerminateConfigSchema = z.object({
  reason: variableRef(z.string().min(1)).optional().describe('Why the run was stopped'),
});

const TerminateOutputSchema = z.object({});

export class TerminateStep extends BaseActionStep<typeof TerminateConfigSchema> {
  readonly type = 'TERMINATE';
  readonly configSchema = TerminateConfigSchema;
  readonly outputSchema = TerminateOutputSchema;
  readonly name = 'Terminate run';
  readonly description =
    'Stops the run immediately and marks it Cancelled. Works at the top level or inside a conditional / switch branch.';
  readonly category = StepCategory.CONTROL;
  readonly icon = 'OctagonX';

  async execute(config: z.infer<typeof TerminateConfigSchema>): Promise<Record<string, unknown>> {
    throw new TerminateRun(typeof config.reason === 'string' ? config.reason : undefined);
  }
}

export const terminateStep = new TerminateStep();
