/**
 * SWITCH step — first-match-wins over an ordered list of conditional cases,
 * with a guaranteed `default` fallback.
 *
 * Semantics (no fall-through):
 *
 *   for (const [i, c] of cases.entries())
 *     if (evaluator.evaluate(c.condition, ctx.workflow)) {
 *       walkBranch(c.steps, `case_${i}`)
 *       return { branch: `case_${i}`, caseIndex: i, label: c.label ?? null }
 *     }
 *   walkBranch(default, 'default')
 *   return { branch: 'default', caseIndex: null, label: null }
 *
 * Branch keys are positional (`case_0`, `case_1`, ..., `default`) so a
 * paused execution's PausePath survives label edits.
 */

import { z } from 'zod';
import { BaseControlFlowStep, collectBranchSteps } from '../../../steps/base-step.js';
import type { ControlFlowExecutionContext, BranchStepOutputs } from '../../../steps/base-step.js';
import { BuiltinStepType } from '../../../types/known-types.js';
import type { WorkflowStepConfig } from '../../../types/workflow-config.js';
import { ConditionSchema } from '../../../types/workflow-config.js';
import { ConditionEvaluator } from '../../../engine/condition-evaluator.js';

// ─── Config ───

const SwitchCaseSchema = z.object({
  condition: ConditionSchema
    .describe('Recursive condition tree (leaf or all/any composite). First case whose condition is true wins.'),
  label: z.string().optional()
    .describe('Optional UI label for this case. Not used for routing — branch keys are positional.'),
  steps: z.array(
    z.object({ id: z.string(), type: z.string() }).passthrough(),
  ).describe('Steps to execute when this case wins.'),
});

export const SwitchStepConfigSchema = z.object({
  cases: z.array(SwitchCaseSchema)
    .describe('Ordered cases. Evaluated top-to-bottom; first match wins, no fall-through.'),
  default: z.array(
    z.object({ id: z.string(), type: z.string() }).passthrough(),
  ).describe('Fallback branch. Runs when no case matches. Use `[]` to no-op the fallback.'),
});

export type SwitchStepConfig = z.infer<typeof SwitchStepConfigSchema>;

// ─── Output ───

export interface SwitchStepOutput extends Record<string, unknown> {
  /** Which branch executed. `'default'` when no case matched. `case_<i>` (i = caseIndex) otherwise. */
  branch: string;
  /** Index of the matched case, or `null` when `default` ran. */
  caseIndex: number | null;
  /** Label of the matched case, or `null` when `default` ran (or case had no label). */
  label: string | null;
  /**
   * The taken branch's top-level steps, keyed by branch key (`case_<i>`/`default`)
   * then step id — referenced as `…output.branches.<key>.steps.<id>.output.<field>`.
   * Only the taken branch is populated. The harness types all branches from `getBranches`.
   */
  branches: Record<string, { steps: BranchStepOutputs }>;
}

const SwitchStepOutputSchema = z.object({
  branch: z.string(),
  caseIndex: z.number().int().nullable(),
  label: z.string().nullable(),
  branches: z.record(z.object({ steps: z.record(z.object({ output: z.record(z.unknown()) })) })),
});

// ─── Step ───

const DEFAULT_BRANCH_KEY = 'default';
const caseBranchKey = (i: number): string => `case_${i}`;

export class SwitchStep extends BaseControlFlowStep<
  typeof SwitchStepConfigSchema,
  SwitchStepOutput
> {
  override readonly type = BuiltinStepType.SWITCH;
  override readonly name = 'Switch';
  override readonly description = 'Route to one of N branches; first matching case wins, otherwise default';
  override readonly configSchema = SwitchStepConfigSchema;
  override readonly outputSchema = SwitchStepOutputSchema;
  override readonly category = 'control' as const;
  override readonly icon = 'switch';
  override readonly declaredOutputs = [
    { key: 'branch', label: 'Matched branch key' },
    { key: 'caseIndex', label: 'Matched case index' },
    { key: 'label', label: 'Matched case label' },
  ] as const;

  /**
   * Expose every branch (each case + default) so the config validator can
   * walk forward references inside each one independently.
   */
  override getBranches(
    config: Record<string, unknown>,
  ): Record<string, WorkflowStepConfig[]> {
    const branches: Record<string, WorkflowStepConfig[]> = {};
    const cases = (config['cases'] ?? []) as Array<{ steps?: WorkflowStepConfig[] }>;
    for (let i = 0; i < cases.length; i++) {
      branches[caseBranchKey(i)] = (cases[i]?.steps ?? []) as WorkflowStepConfig[];
    }
    branches[DEFAULT_BRANCH_KEY] = (config['default'] ?? []) as WorkflowStepConfig[];
    return branches;
  }

  override async execute(
    config: SwitchStepConfig,
    ctx: ControlFlowExecutionContext,
  ): Promise<SwitchStepOutput> {
    const evaluator = new ConditionEvaluator();

    for (let i = 0; i < config.cases.length; i++) {
      const entry = config.cases[i]!;
      if (await evaluator.evaluate(entry.condition, ctx.workflow)) {
        const branchKey = caseBranchKey(i);
        const branchSteps = entry.steps as unknown as WorkflowStepConfig[];
        if (branchSteps.length > 0) {
          await ctx.walkBranch(branchSteps, ctx.workflow, branchKey);
        }
        return {
          branch: branchKey,
          caseIndex: i,
          label: entry.label ?? null,
          branches: { [branchKey]: { steps: collectBranchSteps(branchSteps, ctx.workflow) } },
        };
      }
    }

    const defaultSteps = config.default as unknown as WorkflowStepConfig[];
    if (defaultSteps.length > 0) {
      await ctx.walkBranch(defaultSteps, ctx.workflow, DEFAULT_BRANCH_KEY);
    }
    return {
      branch: DEFAULT_BRANCH_KEY,
      caseIndex: null,
      label: null,
      branches: { [DEFAULT_BRANCH_KEY]: { steps: collectBranchSteps(defaultSteps, ctx.workflow) } },
    };
  }
}
