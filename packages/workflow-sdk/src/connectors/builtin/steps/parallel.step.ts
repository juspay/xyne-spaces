/**
 * PARALLEL step — fan-out N named branches concurrently and collect results.
 *
 * BaseControlFlowStep with N dynamic branches. Runs all in parallel via
 * Promise.allSettled or Promise.race depending on `merge` mode.
 *
 * Each branch gets an isolated copy of the workflow context so concurrent
 * writes to `context.steps` don't conflict. After completion, the last
 * step's output from each branch is collected into the parallel step's output.
 *
 * ## Pause handling (allSettled)
 *
 * Each branch runs in its own scope and persists its steps under node-path keys
 * (`parallel_x:<branch>#0/<stepId>`). When a branch parks, its `walkBranch`
 * throws `PauseStep`; PARALLEL collects which branches paused and, if any did,
 * throws a single `PauseStep` so the whole step parks. There is no internal
 * saved state — the per-branch step records ARE the durable state. On resume
 * the executor re-enters PARALLEL, re-runs every branch via `walkBranch`:
 * completed branch steps memo-skip from their records, the parked one(s) resume
 * from theirs. Multiple branches can be paused simultaneously; each `resume()`
 * targets one branch's gate by node-path. When the last paused branch
 * completes, PARALLEL merges everything and returns.
 *
 * ## Jumps
 *
 * A GO_TO or FINISH can't leave a branch while the other branches are still
 * running. The validator rejects one that tries; if it runs anyway, the step
 * fails rather than recording the jump as a failed branch.
 *
 * ## Output
 *
 * Discriminated union on `mode` so consumers (including the UI)
 * can switch on `mode` and get full type safety for each case:
 *
 *   allSettled: { mode: 'allSettled', branches: { [name]: { status, value?, reason? } } }
 *   race:       { mode: 'race',       winner: string, result: { output } }
 */

import { z } from 'zod';
import { BaseControlFlowStep, collectBranchSteps, cloneScope } from '../../../steps/base-step.js';
import type { ControlFlowExecutionContext, BranchStepOutputs } from '../../../steps/base-step.js';
import { BuiltinStepType } from '../../../types/known-types.js';
import type { WorkflowStepConfig } from '../../../types/workflow-config.js';
import { PauseStep } from '../../../engine/pause-step.js';
import { BranchSignal, blockedJumpError } from '../../../engine/branch-signal.js';

// ─── Config ───

export const ParallelStepConfigSchema = z.object({
  branches: z.record(
    z.string(),
    z.array(z.object({ id: z.string(), type: z.string() }).passthrough()),
  ).describe('Named branches that execute concurrently. Each key is a branch name, value is the steps to run'),
  merge: z.enum(['allSettled', 'race']).default('allSettled').describe('How to combine branch results: allSettled waits for all, race returns first completed'),
});

export type ParallelStepConfig = z.infer<typeof ParallelStepConfigSchema>;

// ─── Output types — discriminated union on `mode` ───

/**
 * Per-branch result — the branch's TOP-LEVEL steps map (keyed by step id, each
 * `{ output }`, mirroring the main context's `steps.<id>.output`), or a failure.
 * Referenced as `…output.branches.<key>.steps.<id>.output.<field>`.
 */
export type ParallelSettledBranchResult =
  | { status: 'fulfilled'; steps: BranchStepOutputs }
  | { status: 'rejected'; reason: string };

export interface ParallelAllSettledOutput extends Record<string, unknown> {
  mode: 'allSettled';
  branches: Record<string, ParallelSettledBranchResult>;
}

export interface ParallelRaceOutput extends Record<string, unknown> {
  mode: 'race';
  /** Which branch won. */
  branch: string;
  /** Only the winner is populated; uniform `branches` shape with all control flow. */
  branches: Record<string, ParallelSettledBranchResult>;
}

export type ParallelStepOutput =
  | ParallelAllSettledOutput
  | ParallelRaceOutput;

// ─── Output Zod schema (for validation / introspection) ───

const StepOutputMapSchema = z.record(z.object({ output: z.record(z.unknown()) }));

const ParallelSettledBranchResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('fulfilled'),
    steps: StepOutputMapSchema,
  }),
  z.object({
    status: z.literal('rejected'),
    reason: z.string(),
  }),
]);

const ParallelStepOutputSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('allSettled'),
    branches: z.record(ParallelSettledBranchResultSchema),
  }),
  z.object({
    mode: z.literal('race'),
    branch: z.string(),
    branches: z.record(ParallelSettledBranchResultSchema),
  }),
]);

// ─── Step ───

export class ParallelStep extends BaseControlFlowStep<
  typeof ParallelStepConfigSchema,
  ParallelStepOutput
> {
  override readonly type = BuiltinStepType.PARALLEL;
  override readonly name = 'Parallel';
  override readonly description =
    'Run multiple branches concurrently and collect results';
  override readonly configSchema = ParallelStepConfigSchema;
  override readonly outputSchema = ParallelStepOutputSchema;
  override readonly category = 'control' as const;
  override readonly icon = 'columns';
  override readonly jumps = 'block' as const;

  /**
   * Declared outputs are dynamic — one per branch key.
   * Since branch keys are user-defined, we return empty here and let
   * `getBranches()` handle discovery for validation.
   */
  override readonly declaredOutputs = [] as const;

  override getBranches(
    config: Record<string, unknown>,
  ): Record<string, WorkflowStepConfig[]> {
    const branches = (config['branches'] ?? {}) as Record<
      string,
      unknown[]
    >;
    const result: Record<string, WorkflowStepConfig[]> = {};
    for (const [key, steps] of Object.entries(branches)) {
      result[key] = steps as unknown as WorkflowStepConfig[];
    }
    return result;
  }

  /**
   * Collapse the static `mode` discriminated union to the *configured* mode, so
   * the variable picker sees a concrete object (not an `anyOf`) it can drill.
   * Only the mode-dependent meta is declared here; the harness
   * (`resolveOutputJsonSchemaOf`) splices the typed `branches` from `getBranches`.
   */
  override resolveOutputJsonSchema(
    config: Record<string, unknown>,
  ): Record<string, unknown> {
    const mode = config['merge'] === 'race' ? 'race' : 'allSettled';
    const properties: Record<string, unknown> = { mode: { type: 'string', const: mode } };
    if (mode === 'race') properties['branch'] = { type: 'string' };
    return { type: 'object', properties };
  }

  override async execute(
    config: ParallelStepConfig,
    ctx: ControlFlowExecutionContext,
  ): Promise<ParallelStepOutput> {
    const branchEntries = Object.entries(config.branches);

    if (branchEntries.length === 0) {
      return { mode: config.merge, branches: {} } as ParallelStepOutput;
    }

    if (config.merge === 'allSettled') {
      return this.executeAllSettled(branchEntries, ctx);
    }
    // race
    return this.executeRace(branchEntries, ctx);
  }

  // ─── Merge: allSettled ───

  private async executeAllSettled(
    branchEntries: [string, Record<string, unknown>[]][],
    ctx: ControlFlowExecutionContext,
  ): Promise<ParallelAllSettledOutput> {
    // Run every branch concurrently, each in its own scope. Completed branch
    // steps memo-skip on resume; the parked one(s) resume — handled entirely by
    // the executor's node-path records, so no saved state lives here.
    const settled = await Promise.allSettled(
      branchEntries.map(async ([name, steps]) => {
        const branchCtx = cloneScope(ctx.workflow);
        await ctx.walkBranch(
          steps as unknown as WorkflowStepConfig[],
          branchCtx,
          name,
        );
        return {
          steps: collectBranchSteps(steps as unknown as WorkflowStepConfig[], branchCtx),
        };
      }),
    );

    const branches: Record<string, ParallelSettledBranchResult> = {};
    let pausedCount = 0;
    let firstExternalRef: string | undefined;
    let firstPause: PauseStep | undefined;

    for (let i = 0; i < branchEntries.length; i++) {
      const name = branchEntries[i]![0];
      const entry = settled[i]!;
      if (entry.status === 'fulfilled') {
        branches[name] = { status: 'fulfilled', steps: entry.value.steps };
      } else if (BranchSignal.is(entry.reason)) {
        throw blockedJumpError(entry.reason.signal, this.type);
      } else if (PauseStep.is(entry.reason)) {
        pausedCount++;
        const pe = entry.reason as PauseStep;
        firstPause ??= pe;
        if (firstExternalRef === undefined && pe.externalRef !== undefined) {
          firstExternalRef = pe.externalRef;
        }
      } else {
        branches[name] = {
          status: 'rejected',
          reason:
            entry.reason instanceof Error
              ? entry.reason.message
              : String(entry.reason),
        };
      }
    }

    // Any paused branch parks the whole step. The executor records PARALLEL as
    // EXTERNAL_WAIT and re-enters it on resume; this throw discards the partial
    // `branches` (the completed branches' outputs are durable in their records).
    if (firstPause) {
      const reason =
        pausedCount === 1 ? 'branch awaiting resume' : `${String(pausedCount)} branches paused`;
      // The frame's own record is not a gate; it reports what its subtree waits
      // on, and the first of mixed children — the same compromise as externalRef.
      throw new PauseStep(reason, {
        category: firstPause.category,
        ...(firstExternalRef !== undefined ? { externalRef: firstExternalRef } : {}),
      });
    }

    return { mode: 'allSettled', branches };
  }

  // ─── Merge: race ───

  private async executeRace(
    branchEntries: [string, Record<string, unknown>[]][],
    ctx: ControlFlowExecutionContext,
  ): Promise<ParallelRaceOutput> {
    const promises = branchEntries.map(async ([name, steps]) => {
      const branchCtx = cloneScope(ctx.workflow);
      try {
        await ctx.walkBranch(
          steps as unknown as WorkflowStepConfig[],
          branchCtx,
          name,
        );
      } catch (err) {
        if (BranchSignal.is(err)) throw blockedJumpError(err.signal, this.type);
        throw err;
      }
      return {
        name,
        steps: collectBranchSteps(steps as unknown as WorkflowStepConfig[], branchCtx),
      };
    });

    const winner = await Promise.race(promises);

    return {
      mode: 'race',
      branch: winner.name,
      branches: { [winner.name]: { status: 'fulfilled', steps: winner.steps } },
    };
  }
}
