/**
 * LOOP step — iterate over an array and walk a body branch per item.
 *
 * BaseControlFlowStep with a single `body` branch. For each item in the
 * source array, sets `ctx.workflow.steps[loopStepId].currentItem` and walks
 * the body branch.
 *
 * Not a jump target: only CYCLE catches GO_TO/FINISH (`jumps` stays at the
 * base default, 'pass'). A jump raised inside the body unwinds straight through
 * to the CYCLE it names.
 *
 * Output: `{ results: unknown[], count: number }`
 */

import { z } from 'zod';
import { BaseControlFlowStep, cloneScope } from '../../../steps/base-step.js';
import type { ControlFlowExecutionContext } from '../../../steps/base-step.js';
import { BuiltinStepType } from '../../../types/known-types.js';
import type { WorkflowStepConfig } from '../../../types/workflow-config.js';
import { resolveReference } from '../../../engine/resolve-expressions.js';

// ─── Config ───

export const LoopStepConfigSchema = z.object({
  source: z.string().min(1).describe('Path to the array to iterate over (e.g. steps.fetch.output.items). Supports {{variable}} refs'),
  body: z.array(z.object({ id: z.string(), type: z.string() }).passthrough()).describe('Steps to execute for each item in the array'),
  maxIterations: z.number().int().positive().default(1000).describe('Maximum number of iterations as a safety limit'),
});

export type LoopStepConfig = z.infer<typeof LoopStepConfigSchema>;

// ─── Output ───

export interface LoopStepOutput extends Record<string, unknown> {
  results: unknown[];
  count: number;
}

const LoopStepOutputSchema = z.object({
  results: z.array(z.unknown()),
  count: z.number(),
});

// ─── Step ───

export class LoopStep extends BaseControlFlowStep<
  typeof LoopStepConfigSchema,
  LoopStepOutput
> {
  override readonly type = BuiltinStepType.LOOP;
  override readonly name = 'Loop';
  override readonly description = 'Iterate over an array and execute steps for each item';
  override readonly configSchema = LoopStepConfigSchema;
  override readonly outputSchema = LoopStepOutputSchema;
  override readonly category = 'control' as const;
  override readonly branchModel = 'iterate' as const;
  override readonly icon = 'repeat';
  override readonly declaredOutputs = [
    { key: 'body', label: 'For each item' },
  ] as const;

  override getBranches(
    config: Record<string, unknown>,
  ): Record<string, WorkflowStepConfig[]> {
    return {
      body: (config['body'] ?? []) as WorkflowStepConfig[],
    };
  }

  override branchScopeSchemas(): Record<string, Record<string, unknown>> {
    return {
      '__loop.output': {
        type: 'object',
        properties: {
          currentItem: {},
          currentIndex: { type: 'number' },
          totalItems: { type: 'number' },
        },
      },
    };
  }

  override async execute(
    config: LoopStepConfig,
    ctx: ControlFlowExecutionContext,
  ): Promise<LoopStepOutput> {
    // Resolve the source array from context
    // A path, a {{ref}}, or an expression — so a loop can iterate a list
    // that had to be computed (`{% $filter(...) %}`) and not merely named.
    const sourceValue = await resolveReference(config.source, ctx.workflow);

    if (!Array.isArray(sourceValue)) {
      throw new Error(
        `LOOP source "${config.source}" did not resolve to an array (got ${typeof sourceValue})`,
      );
    }

    const items = sourceValue as unknown[];
    const limit = Math.min(items.length, config.maxIterations);
    const results: unknown[] = [];

    for (let i = 0; i < limit; i++) {
      const item = items[i];

      // Each iteration runs in its own scope, keyed by node-path frame
      // `loop_y:body#<i>`. The iteration index isolates body-step records and
      // is the identity that lets a WAIT in iteration N resume the right
      // iteration. `__loop` exposes the current item to body steps within the
      // iteration scope (nested loops nest their own `__loop` in child scopes).
      const iterScope = cloneScope(ctx.workflow);
      (iterScope.steps as Record<string, unknown>)['__loop'] = {
        type: 'LOOP',
        output: {
          currentItem: item,
          currentIndex: i,
          totalItems: items.length,
        },
      };

      await ctx.walkBranch(
        config.body as unknown as WorkflowStepConfig[],
        iterScope,
        'body',
        i,
      );

      results.push(item);
    }

    return { results, count: results.length };
  }
}
