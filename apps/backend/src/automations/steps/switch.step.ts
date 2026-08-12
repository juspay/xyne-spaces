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

const SwitchCaseEntrySchema = z.object({
  condition: ConditionSchema,
  label: z.string().optional(),
  steps: z.array(z.unknown()),
});

const SwitchConfigSchema = z.object({
  cases: z.array(SwitchCaseEntrySchema),
  default: z.array(z.unknown()),
});

interface SwitchOutput extends Record<string, unknown> {
  matchedIndex: number;
}

export class SwitchStep extends BaseControlFlowStep<typeof SwitchConfigSchema, SwitchOutput> {
  readonly type = ControlFlowStepType.SWITCH;
  readonly configSchema = SwitchConfigSchema;
  readonly name = 'Switch / Case';
  readonly description =
    'Evaluates multiple conditions top-to-bottom and runs the first matching branch, or the default.';
  readonly outputSchema = z.object({ matchedIndex: z.number() });
  readonly category = StepCategory.CONTROL;
  readonly icon = 'ListTree';

  private readonly evaluator = new ConditionEvaluator();

  async execute(
    config: z.infer<typeof SwitchConfigSchema>,
    context: AutomationContext,
    ctx: ControlFlowExecutionContext,
  ): Promise<SwitchOutput> {
    for (let i = 0; i < config.cases.length; i++) {
      const caseEntry = config.cases[i]!;
      const matched = this.evaluator.evaluate(caseEntry.condition, context);
      if (matched) {
        await ctx.walkBranch(caseEntry.steps as AutomationStepConfig[], context, `case_${i}`);
        return { matchedIndex: i };
      }
    }
    // No case matched — run default branch
    await ctx.walkBranch(config.default as AutomationStepConfig[], context, 'default');
    return { matchedIndex: -1 };
  }
}

export const switchStep = new SwitchStep();
