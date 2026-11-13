/**
 * GO_TO and FINISH steps — jump out of the current round of a CYCLE.
 *
 * - GO_TO ends the round; the CYCLE starts its next one with `with` as the
 *   new input.
 * - FINISH ends the loop; the CYCLE returns `with` as its result.
 *
 * Both throw a `BranchSignal` that unwinds to the step named in `target`, which
 * must be a CYCLE around this step (the validator checks it). CYCLE is the
 * only built-in that catches jumps: a signal passes straight through a LOOP,
 * CONDITIONAL or SWITCH, and is refused inside a MAP or PARALLEL, which run
 * their branches concurrently.
 *
 * The executor saves the jump on every step record it passes through, so a
 * resumed execution follows it again instead of running what came after it.
 */

import { z } from 'zod';
import { BaseActionStep } from '../../../steps/base-step.js';
import type { StepCategory } from '../../../types/categories.js';
import { BuiltinStepType } from '../../../types/known-types.js';
import { BranchSignal } from '../../../engine/branch-signal.js';
import type { JumpKind, JumpingStep } from '../../../engine/branch-signal.js';

// ─── Config ───

export const JumpStepConfigSchema = z.object({
  target: z.string().min(1).describe('Step id of the Cycle around this step, e.g. "support". With nested Cycles, name the one to jump to — the jump unwinds past any Cycle it does not name'),
  with: z.record(z.unknown()).default({}).describe("Go to: input for the next round — must carry the target Cycle's input keys. Finish: the cycle's result. Supports {{variable}} refs"),
});

export type JumpStepConfig = z.infer<typeof JumpStepConfigSchema>;

const JumpStepOutputSchema = z.object({});

// ─── Steps ───

abstract class JumpStep
  extends BaseActionStep<typeof JumpStepConfigSchema, Record<string, never>>
  implements JumpingStep
{
  abstract readonly jumpKind: JumpKind;
  override readonly configSchema = JumpStepConfigSchema;
  override readonly outputSchema = JumpStepOutputSchema;
  override readonly category: StepCategory = 'flow';

  /** Lets the builder offer the loops around this step instead of a free-text id. */
  override decorateConfigSchema(
    jsonSchema: Record<string, unknown>,
  ): Record<string, unknown> {
    const props = jsonSchema['properties'] as Record<string, Record<string, unknown>> | undefined;
    if (props?.['target']) {
      props['target'] = { ...props['target'], format: 'loop-target' };
    }
    return jsonSchema;
  }

  override async execute(config: JumpStepConfig): Promise<Record<string, never>> {
    // `with` arrives resolved: the executor resolves an action step's refs first.
    throw new BranchSignal({ kind: this.jumpKind, target: config.target, value: config.with });
  }
}

export class GoToStep extends JumpStep {
  override readonly type = BuiltinStepType.GO_TO;
  override readonly name = 'Go to';
  override readonly description = 'Jumps back to the Cycle around this step and starts its next round with a new input. Anything after it in this round is skipped and the round begins again from the top — this is how a flow moves to another screen, retries, or asks again';
  override readonly jumpKind = 'goto' as const;
}

export class FinishStep extends JumpStep {
  override readonly type = BuiltinStepType.FINISH;
  override readonly name = 'Finish';
  override readonly description = 'Ends the Cycle around this step — no further rounds. The value it carries becomes the cycle\'s result, so later steps can read what the flow concluded';
  override readonly jumpKind = 'finish' as const;
}
