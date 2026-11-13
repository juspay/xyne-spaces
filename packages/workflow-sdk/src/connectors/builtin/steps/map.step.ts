/**
 * MAP step — iterate an array and run one `body` per item CONCURRENTLY.
 *
 * Like LOOP (resolves a source array, single `body`) but items run in parallel
 * rather than sequentially — for cases where N dynamically-discovered items
 * each need the same processing (e.g. validate the PAN of each of N owners).
 * `concurrency` bounds how many are in flight; omit it for unbounded, or set
 * it to 1 when each item is expensive enough that they must run one at a time
 * (and unlike LOOP, MAP still collects every item's outputs). Whatever the
 * bound, `items` stays index-aligned with the source.
 *
 * Each iteration runs in its own scope keyed by the node-path frame
 * `map_x:item#<i>`, so a WAIT inside an iteration parks that iteration's own
 * gate; multiple iterations can pause at once and resume independently — the
 * same durable model PARALLEL uses (the executor's node-path records ARE the
 * state; no saved state lives here).
 *
 * A GO_TO or FINISH can't leave an iteration while the others are still
 * running. The validator rejects one that tries; if it runs anyway, the step
 * fails rather than recording the jump as an item error.
 *
 * Output: `{ count, items: [{ index, item, steps }] }` — per-iteration step
 * outputs, index-aligned with the source array (mirrors PARALLEL's
 * `branches.<key>.steps`). Reference downstream as
 * `…output.items.<i>.steps.<stepId>.output.<field>`.
 */

import { z } from 'zod';
import { BaseControlFlowStep, cloneScope, collectBranchSteps } from '../../../steps/base-step.js';
import type { BranchStepOutputs, ControlFlowExecutionContext } from '../../../steps/base-step.js';
import { BuiltinStepType } from '../../../types/known-types.js';
import type { WorkflowStepConfig } from '../../../types/workflow-config.js';
import { resolveReference } from '../../../engine/resolve-expressions.js';
import { PauseStep } from '../../../engine/pause-step.js';
import { BranchSignal, blockedJumpError } from '../../../engine/branch-signal.js';

// ─── Config ───

export const MapStepConfigSchema = z.object({
  source: z.string().min(1).describe('Path to the array to map over (e.g. steps.extract.output.owners). Supports {{variable}} refs'),
  body: z.array(z.object({ id: z.string(), type: z.string() }).passthrough()).describe('Steps to execute for each item — items run concurrently up to `concurrency`'),
  concurrency: z.number().int().positive().optional().describe('Max iterations in flight at once. Omit for unbounded (every item starts immediately); 1 runs items strictly one after another'),
});

export type MapStepConfig = z.infer<typeof MapStepConfigSchema>;

// ─── Output ───

/** One iteration's result — its top-level step outputs (or an error). */
export interface MapItemResult {
  index: number;
  item: unknown;
  steps?: BranchStepOutputs;
  error?: string;
}

export interface MapStepOutput extends Record<string, unknown> {
  count: number;
  items: MapItemResult[];
}

const MapStepOutputSchema = z.object({
  count: z.number(),
  items: z.array(
    z.object({
      index: z.number(),
      item: z.unknown(),
      steps: z.record(z.object({ output: z.record(z.unknown()) })).optional(),
      error: z.string().optional(),
    }),
  ),
});

// ─── Step ───

export class MapStep extends BaseControlFlowStep<
  typeof MapStepConfigSchema,
  MapStepOutput
> {
  override readonly type = BuiltinStepType.MAP;
  override readonly name = 'Map';
  override readonly description = 'Map over an array, running steps for each item concurrently';
  override readonly configSchema = MapStepConfigSchema;
  override readonly outputSchema = MapStepOutputSchema;
  override readonly category = 'control' as const;
  override readonly branchModel = 'map' as const;
  override readonly jumps = 'block' as const;
  override readonly icon = 'layers';
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
      '__map.output': {
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
    config: MapStepConfig,
    ctx: ControlFlowExecutionContext,
  ): Promise<MapStepOutput> {
    // A path, a {{ref}}, or an expression — so a loop can iterate a list
    // that had to be computed (`{% $filter(...) %}`) and not merely named.
    const sourceValue = await resolveReference(config.source, ctx.workflow);
    if (!Array.isArray(sourceValue)) {
      throw new Error(
        `MAP source "${config.source}" did not resolve to an array (got ${typeof sourceValue})`,
      );
    }

    const items = sourceValue as unknown[];
    const body = config.body as unknown as WorkflowStepConfig[];

    // Run iterations in their own scopes keyed by node-path `map_x:item#<i>`.
    // A paused iteration throws PauseStep; on resume the MAP re-enters and
    // re-walks all iterations — completed ones memo-skip from their records,
    // the parked one(s) resume. No saved state lives here.
    //
    // `concurrency` bounds how many run at once. Workers pull from a shared
    // cursor and write into `settled` by item index, so the result array is
    // identical in shape and order to the Promise.allSettled it replaces —
    // completion order never leaks into it. Omitted concurrency starts one
    // worker per item, which is exactly the previous behaviour.
    const settled: PromiseSettledResult<MapItemResult>[] = new Array(items.length);
    const workerCount = Math.min(config.concurrency ?? items.length, items.length);
    let cursor = 0;

    const worker = async (): Promise<void> => {
      for (let i = cursor++; i < items.length; i = cursor++) {
        const item = items[i];
        try {
          const iterScope = cloneScope(ctx.workflow);
          (iterScope.steps as Record<string, unknown>)['__map'] = {
            type: 'MAP',
            output: { currentItem: item, currentIndex: i, totalItems: items.length },
          };
          await ctx.walkBranch(body, iterScope, 'item', i);
          settled[i] = {
            status: 'fulfilled',
            value: { index: i, item, steps: collectBranchSteps(body, iterScope) },
          };
        } catch (err) {
          // Including PauseStep: a parked iteration must not stop the worker
          // from picking up the remaining items, since allSettled did not
          // stop the others either. The pause is re-raised after the loop.
          settled[i] = { status: 'rejected', reason: err };
        }
      }
    };

    // allSettled, not all: a worker already catches everything inside its own loop, but if one
    // ever threw outside it, `all` would reject while the other workers were still running and
    // still filling `settled` — and the loop below reads every slot.
    await Promise.allSettled(Array.from({ length: workerCount }, () => worker()));

    const results: MapItemResult[] = [];
    let pausedCount = 0;
    let firstExternalRef: string | undefined;
    let firstPause: PauseStep | undefined;

    for (let i = 0; i < settled.length; i++) {
      const entry = settled[i]!;
      if (entry.status === 'fulfilled') {
        results.push(entry.value);
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
        results.push({
          index: i,
          item: items[i],
          error:
            entry.reason instanceof Error
              ? entry.reason.message
              : String(entry.reason),
        });
      }
    }

    // Any paused iteration parks the whole MAP; the executor records it as
    // EXTERNAL_WAIT and re-enters on resume. Completed/failed iterations are
    // durable in their per-item records — this throw discards the partial list.
    if (firstPause) {
      const reason =
        pausedCount === 1 ? 'item awaiting resume' : `${String(pausedCount)} items awaiting resume`;
      // The frame's own record is not a gate; it reports what its subtree waits
      // on, and the first of mixed children — the same compromise as externalRef.
      throw new PauseStep(reason, {
        category: firstPause.category,
        ...(firstExternalRef !== undefined ? { externalRef: firstExternalRef } : {}),
      });
    }

    results.sort((a, b) => a.index - b.index);
    return { count: items.length, items: results };
  }
}
