import { z } from 'zod';
import { BaseControlFlowStep, type ControlFlowExecutionContext } from './base-step';
import { StepCategory } from '../types/categories';
import { ControlFlowStepType } from '../types/known-types';
import {
  ConditionSchema,
  type AutomationStepConfig,
} from '../types/automation-config';
import type { AutomationContext } from '../types/context';
import { ConditionEvaluator } from '../engine/condition-evaluator';

const ConditionalConfigSchema = z.object({
  condition: ConditionSchema,
  if_true: z.array(z.unknown()),
  if_false: z.array(z.unknown()).optional(),
});

interface ConditionalOutput extends Record<string, unknown> {
  result: boolean;
}

export class ConditionalStep extends BaseControlFlowStep<typeof ConditionalConfigSchema, ConditionalOutput> {
  readonly type = ControlFlowStepType.CONDITIONAL;
  readonly configSchema = ConditionalConfigSchema;
  readonly name = 'Conditional Branch';
  readonly description =
    'Branches the automation. Evaluates the condition and runs the matching branch.';
  readonly outputSchema = z.object({ result: z.boolean() });
  readonly category = StepCategory.CONTROL;
  readonly icon = 'GitBranch';

  private readonly evaluator = new ConditionEvaluator();

  async execute(
    config: z.infer<typeof ConditionalConfigSchema>,
    context: AutomationContext,
    ctx: ControlFlowExecutionContext,
  ): Promise<ConditionalOutput> {
    const result = this.evaluator.evaluate(config.condition, context);
    const branch = (result ? config.if_true : (config.if_false ?? [])) as AutomationStepConfig[];
    await ctx.walkBranch(branch, context, result ? 'if_true' : 'if_false');
    return { result };
  }
}

export const conditionalStep = new ConditionalStep();
