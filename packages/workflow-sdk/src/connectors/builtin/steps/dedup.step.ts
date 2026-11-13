/**
 * DEDUP step — deduplication via ctx.staticData.
 *
 * Checks whether a key (derived from the current context) has been
 * seen before. If it has, marks the output as `duplicate: true` so
 * downstream steps/conditions can skip processing.
 *
 * Uses `ctx.staticData` for persistence — keys survive across executions.
 * Optional TTL: stored timestamps are compared against current time.
 */

import { z } from 'zod';
import { BaseActionStep } from '../../../steps/base-step.js';
import type { StepExecutionContext } from '../../../steps/base-step.js';
import { BuiltinStepType } from '../../../types/known-types.js';
import type { StepCategory } from '../../../types/categories.js';
import { resolveReference } from '../../../engine/resolve-expressions.js';

// ─── Config ───

export const DedupStepConfigSchema = z.object({
  keyPath: z.string().min(1).describe('Dotted path to the deduplication key in the workflow context'),
  ttlMs: z.number().int().positive().optional().describe('Time-to-live in milliseconds. Keys older than this are treated as new'),
  keyPrefix: z.string().default('dedup:').describe('Prefix for the storage key to avoid collisions'),
});

export type DedupStepConfig = z.infer<typeof DedupStepConfigSchema>;

// ─── Output ───

export interface DedupStepOutput extends Record<string, unknown> {
  duplicate: boolean;
  key: string;
}

const DedupStepOutputSchema = z.object({
  duplicate: z.boolean(),
  key: z.string(),
});

// ─── Step ───

export class DedupStep extends BaseActionStep<
  typeof DedupStepConfigSchema,
  DedupStepOutput
> {
  override readonly type = BuiltinStepType.DEDUP;
  override readonly name = 'Dedup';
  override readonly description = 'Skip duplicate items using persistent key tracking';
  override readonly configSchema = DedupStepConfigSchema;
  override readonly outputSchema = DedupStepOutputSchema;
  override readonly category: StepCategory = 'data';
  override readonly icon = 'copy-check';

  override async execute(
    config: DedupStepConfig,
    ctx: StepExecutionContext,
  ): Promise<DedupStepOutput> {
    // Resolve the dedup key from context
    const rawKey = await resolveReference(config.keyPath, ctx.workflow);

    if (rawKey === undefined || rawKey === null) {
      throw new Error(
        `DEDUP keyPath "${config.keyPath}" resolved to ${String(rawKey)}`,
      );
    }

    const key = `${config.keyPrefix}${String(rawKey)}`;

    // Check if key exists in staticData
    const existing = (await ctx.staticData.get(key)) as
      | { seenAt: number }
      | undefined;

    if (existing !== undefined) {
      // Check TTL if configured
      if (config.ttlMs !== undefined) {
        const age = Date.now() - existing.seenAt;
        if (age < config.ttlMs) {
          return { duplicate: true, key };
        }
        // Expired — treat as new, fall through to record
      } else {
        return { duplicate: true, key };
      }
    }

    // Record the key
    await ctx.staticData.set(key, { seenAt: Date.now() });

    return { duplicate: false, key };
  }
}
