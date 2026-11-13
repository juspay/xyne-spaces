/**
 * CONDITIONAL step — branch on a recursive {@link Condition} AST.
 *
 * BaseControlFlowStep with two branches: `if_true` and `if_false`.
 *
 *   evaluator.evaluate(config.condition, ctx.workflow)
 *     true  → walk `if_true`  → output.branch = 'if_true'
 *     false → walk `if_false` → output.branch = 'if_false'
 *             (no-op when `if_false` is omitted → output.branch = 'none')
 *
 * The condition evaluator + variable resolver already understand `{{...}}`
 * refs and the operator catalog, so a leaf condition like
 *
 *   { variable: 'steps.fetch.output.status', operator: '==', value: 200 }
 *
 * works without any per-step parsing here.
 *
 * Pause/resume inside either branch is handled by the executor's
 * `walkBranchSteps` — same mechanism the PARALLEL and LOOP steps rely on.
 */

import { z } from 'zod';
import { BaseControlFlowStep, collectBranchSteps } from '../../../steps/base-step.js';
import type { ControlFlowExecutionContext, BranchStepOutputs } from '../../../steps/base-step.js';
import { BuiltinStepType } from '../../../types/known-types.js';
import type { WorkflowStepConfig } from '../../../types/workflow-config.js';
import { ConditionSchema } from '../../../types/workflow-config.js';
import { ConditionEvaluator } from '../../../engine/condition-evaluator.js';

// ─── Config ───

export const ConditionalStepConfigSchema = z.object({
  condition: ConditionSchema
    .describe('Recursive condition tree. Leaf nodes reference {{variables}} and apply operators; `all`/`any` compose children.'),
  if_true: z.array(
    z.object({ id: z.string(), type: z.string() }).passthrough(),
  ).describe('Steps to execute when the condition resolves true'),
  if_false: z.array(
    z.object({ id: z.string(), type: z.string() }).passthrough(),
  ).optional().describe('Steps to execute when the condition resolves false. Omit to no-op on the false branch.'),
});

export type ConditionalStepConfig = z.infer<typeof ConditionalStepConfigSchema>;

// ─── Output ───

export interface ConditionalStepOutput extends Record<string, unknown> {
  /** Which branch executed. `'none'` when condition was false and `if_false` was omitted. */
  branch: 'if_true' | 'if_false' | 'none';
  /** The boolean result of evaluating the condition. */
  evaluated: boolean;
  /**
   * The taken branch's top-level steps, keyed by branch key (`if_true`/`if_false`)
   * then step id — referenced as `…output.branches.<key>.steps.<id>.output.<field>`.
   * Only the taken branch is populated (`{}` when `branch === 'none'`). The harness
   * types both branches from `getBranches`.
   */
  branches: Record<string, { steps: BranchStepOutputs }>;
}

const ConditionalStepOutputSchema = z.object({
  branch: z.enum(['if_true', 'if_false', 'none']),
  evaluated: z.boolean(),
  branches: z.record(z.object({ steps: z.record(z.object({ output: z.record(z.unknown()) })) })),
});

// ─── Step ───

export class ConditionalStep extends BaseControlFlowStep<
  typeof ConditionalStepConfigSchema,
  ConditionalStepOutput
> {
  override readonly type = BuiltinStepType.CONDITIONAL;
  override readonly name = 'Conditional';
  override readonly description = 'Branch execution based on a condition';
  override readonly configSchema = ConditionalStepConfigSchema;
  override readonly outputSchema = ConditionalStepOutputSchema;
  override readonly category = 'control' as const;
  override readonly icon = 'fork';
  override readonly declaredOutputs = [
    { key: 'if_true', label: 'When true' },
    { key: 'if_false', label: 'When false' },
  ] as const;

  /** Allows config-validator to recursively validate nested branches. */
  override getBranches(
    config: Record<string, unknown>,
  ): Record<string, WorkflowStepConfig[]> {
    return {
      if_true: (config['if_true'] ?? []) as WorkflowStepConfig[],
      if_false: (config['if_false'] ?? []) as WorkflowStepConfig[],
    };
  }

  override async execute(
    config: ConditionalStepConfig,
    ctx: ControlFlowExecutionContext,
  ): Promise<ConditionalStepOutput> {
    const evaluator = new ConditionEvaluator();
    const evaluated = await evaluator.evaluate(config.condition, ctx.workflow);

    if (evaluated) {
      const branchSteps = config.if_true as unknown as WorkflowStepConfig[];
      await ctx.walkBranch(branchSteps, ctx.workflow, 'if_true');
      return {
        branch: 'if_true',
        evaluated: true,
        branches: { if_true: { steps: collectBranchSteps(branchSteps, ctx.workflow) } },
      };
    }

    if (config.if_false && config.if_false.length > 0) {
      const branchSteps = config.if_false as unknown as WorkflowStepConfig[];
      await ctx.walkBranch(branchSteps, ctx.workflow, 'if_false');
      return {
        branch: 'if_false',
        evaluated: false,
        branches: { if_false: { steps: collectBranchSteps(branchSteps, ctx.workflow) } },
      };
    }

    return { branch: 'none', evaluated: false, branches: {} };
  }
}
