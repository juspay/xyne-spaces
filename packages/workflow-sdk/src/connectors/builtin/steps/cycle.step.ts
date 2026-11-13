/**
 * CYCLE step — run a body in rounds until it finishes without jumping back.
 *
 * LOOP walks an array known up front. CYCLE is for when the next round depends
 * on what happened in this one — a menu the user moves around in, a check that
 * waits until something is ready. Each round walks `body` as its own node-path
 * frame `<cycleStepId>:body#<round>`:
 *
 * - a GO_TO aimed at this step, at any depth inside the body, ends the round
 *   and starts the next one with the GO_TO's value as the new `input`
 * - a FINISH aimed at it ends the CYCLE, its value becoming the result
 * - the body finishing normally ends the CYCLE
 *
 * `__loop.output = { currentIndex, input }` is visible inside the body, like
 * LOOP's `__loop`. A round's input only ever comes from the jump that ended the
 * round before, and the executor saves that jump on its step records — so a
 * resumed execution replays into the same round with the same input.
 *
 * Output: `{ rounds, exit, result?, state }`. `result` is a FINISH's value and
 * nothing else's, so later steps can be typed against the `result` schema the
 * author declares; `state` is the last round's input whatever ended the cycle,
 * which on a give-up is the only diagnostic there is. One field meaning both
 * would make the declared schema false on two of the three exits.
 */

import { z } from 'zod';
import { BaseControlFlowStep, cloneScope } from '../../../steps/base-step.js';
import type { ControlFlowExecutionContext } from '../../../steps/base-step.js';
import { BuiltinStepType } from '../../../types/known-types.js';
import type { WorkflowStepConfig } from '../../../types/workflow-config.js';
import { VariableResolver } from '../../../engine/variable-resolver.js';
import { resolveExpressions } from '../../../engine/resolve-expressions.js';
import { BranchSignal } from '../../../engine/branch-signal.js';
import type { JumpKind } from '../../../engine/branch-signal.js';
import { isPureRef } from '../../../util/variable-ref.js';

// ─── Config ───

export const CycleStepConfigSchema = z.object({
  input: z.record(z.unknown()).default({}).describe('The state each round starts with — the first round gets this, and every Go to replaces it for the next one. Read it in the body as steps.__loop.output.input.<key>; the keys you put here are the keys a Go to must carry. Supports {{variable}} refs'),
  body: z.array(z.object({ id: z.string(), type: z.string() }).passthrough()).describe('Steps to run each round. They start again from the first one on every round'),
  maxIterations: z.number().int().positive().default(100).describe('Safety limit: how many rounds before the cycle stops on its own (exit: max_iterations)'),
  result: z
    .record(z.unknown())
    .optional()
    .describe(
      'JSON Schema of what a Finish hands back. Types the variable picker for the steps after this one, and a Finish that misses a required key is refused. Leave it empty if nothing after the cycle reads its result',
    ),
});

export type CycleStepConfig = z.infer<typeof CycleStepConfigSchema>;

// ─── Output ───

export interface CycleStepOutput extends Record<string, unknown> {
  /** How many rounds ran. */
  rounds: number;
  /** Why the CYCLE ended. */
  exit: 'completed' | 'finish' | 'max_iterations';
  /** What a FINISH handed back. Absent on every other exit — read `exit` first. */
  result?: Record<string, unknown>;
  /** The last round's input, whatever ended the cycle. */
  state: Record<string, unknown>;
}

const CycleStepOutputSchema = z.object({
  rounds: z.number(),
  exit: z.enum(['completed', 'finish', 'max_iterations']),
  result: z.record(z.unknown()).optional(),
  state: z.record(z.unknown()),
});

// ─── Step ───

export class CycleStep extends BaseControlFlowStep<
  typeof CycleStepConfigSchema,
  CycleStepOutput
> {
  override readonly type = BuiltinStepType.CYCLE;
  override readonly name = 'Cycle';
  override readonly description = 'Runs its steps in rounds, carrying state from one to the next. A Go to inside jumps back here and starts the next round from the top with a new input — it restarts the round rather than resuming where it left off. A Finish ends the cycle, and the value it carries becomes the result. Use it when the flow returns to the same steps again and again: a chat that shows a menu each turn, a retry until approved, a check until something is ready';
  override readonly configSchema = CycleStepConfigSchema;
  override readonly outputSchema = CycleStepOutputSchema;
  override readonly category = 'control' as const;
  override readonly branchModel = 'iterate' as const;
  override readonly jumps = 'catch' as const;
  override readonly icon = 'repeat';
  override readonly declaredOutputs = [
    { key: 'body', label: 'Each round' },
  ] as const;

  override getBranches(
    config: Record<string, unknown>,
  ): Record<string, WorkflowStepConfig[]> {
    return {
      body: (config['body'] ?? []) as WorkflowStepConfig[],
    };
  }

  /** The result field holds a JSON Schema, which the editor edits as one. */
  override decorateConfigSchema(jsonSchema: Record<string, unknown>): Record<string, unknown> {
    const props = jsonSchema['properties'] as Record<string, Record<string, unknown>> | undefined;
    if (props?.['result']) {
      props['result'] = { ...props['result'], format: 'json-schema' };
    }
    return jsonSchema;
  }

  /**
   * `result` is whatever the author declared, `state` is shaped by `input` —
   * the same trick the HTTP step does with its response.
   *
   * `result` is deliberately out of `required`: only a FINISH produces one.
   * Nothing reads `required` during ref resolution today, so this documents the
   * exit the author has to check rather than enforcing it.
   */
  override resolveOutputJsonSchema(config: Record<string, unknown>): Record<string, unknown> {
    const declared = config['result'];
    const result =
      declared !== null && typeof declared === 'object' && !Array.isArray(declared)
        ? (declared as Record<string, unknown>)
        : { type: 'object', additionalProperties: true };
    return {
      type: 'object',
      properties: {
        rounds: { type: 'number' },
        exit: { type: 'string', enum: ['completed', 'finish', 'max_iterations'] },
        result,
        state: inputJsonSchema(config['input']),
      },
      required: ['rounds', 'exit', 'state'],
    };
  }

  override branchScopeSchemas(
    config: Record<string, unknown>,
  ): Record<string, Record<string, unknown>> {
    return {
      '__loop.output': {
        type: 'object',
        properties: {
          currentIndex: { type: 'number' },
          input: inputJsonSchema(config['input']),
        },
      },
    };
  }

  /**
   * A GO_TO starts a round, so it must carry exactly the keys `input` declares;
   * a FINISH ends the cycle, so it answers to `result` instead.
   */
  override checkJump(
    config: Record<string, unknown>,
    jump: { kind: JumpKind; value: unknown },
  ): string | null {
    if (jump.kind === 'finish') return checkAgainstResult(config['result'], jump.value);
    if (jump.kind !== 'goto') return null;
    const expected = Object.keys(asRecord(config['input']));
    const given = Object.keys(asRecord(jump.value));

    const missing = expected.filter((key) => !given.includes(key));
    if (missing.length > 0) {
      return `GO_TO must set ${quoteList(missing)}: every round starts from the CYCLE's input.`;
    }
    const unknown = given.filter((key) => !expected.includes(key));
    if (unknown.length > 0) {
      return `${quoteList(unknown)} ${unknown.length === 1 ? 'is' : 'are'} not in the CYCLE's input. Add ${unknown.length === 1 ? 'it' : 'them'} there first.`;
    }
    return null;
  }

  override async execute(
    config: CycleStepConfig,
    ctx: ControlFlowExecutionContext,
  ): Promise<CycleStepOutput> {
    const self = ctx.runtime.stepId;
    // Control-step configs reach execute() unresolved, so resolve refs here —
    // expressions first, in the same order the executor uses for action steps.
    const prepared = (await resolveExpressions(config.input, ctx.workflow)).value;
    let input = asRecord(new VariableResolver().resolve(prepared, ctx.workflow));

    for (let round = 0; round < config.maxIterations; round++) {
      // Each round runs in its own scope, keyed by node-path frame
      // `repeat_x:body#<round>`, so a WAIT in round N resumes round N.
      const roundScope = cloneScope(ctx.workflow);
      (roundScope.steps as Record<string, unknown>)['__loop'] = {
        type: 'CYCLE',
        output: { currentIndex: round, input },
      };

      try {
        await ctx.walkBranch(
          config.body as unknown as WorkflowStepConfig[],
          roundScope,
          'body',
          round,
        );
        return { rounds: round + 1, exit: 'completed', state: input };
      } catch (err) {
        // Pauses, failures and jumps aimed at a loop further out keep unwinding.
        if (!BranchSignal.is(err) || err.signal.target !== self) throw err;
        if (err.signal.kind === 'finish') {
          return { rounds: round + 1, exit: 'finish', result: err.signal.value, state: input };
        }
        input = err.signal.value;
      }
    }

    return { rounds: config.maxIterations, exit: 'max_iterations', state: input };
  }
}

// ─── Helpers ───

/**
 * A FINISH against the declared result schema.
 *
 * JSON Schema's own `required` semantics are honoured rather than "every key",
 * because this schema is written in the schema editor, which has a per-field
 * required toggle. An undeclared key is still refused: it would not be in the
 * typed output, so no later step could read it — dead data worth naming.
 *
 * No declared schema means the cycle makes no claim about its result, so there
 * is nothing to check. That is what leaves every flow written before this
 * field — every conversation — exactly as it was.
 */
function checkAgainstResult(declared: unknown, value: unknown): string | null {
  const schema = asRecord(declared);
  const properties = asRecord(schema['properties']);
  const declaredKeys = Object.keys(properties);
  if (declaredKeys.length === 0) return null;

  const given = Object.keys(asRecord(value));
  const required = Array.isArray(schema['required'])
    ? schema['required'].filter((key): key is string => typeof key === 'string')
    : [];

  const missing = required.filter((key) => !given.includes(key));
  if (missing.length > 0) {
    return `FINISH must set ${quoteList(missing)}: the CYCLE's result says what it hands back.`;
  }
  const undeclared = given.filter((key) => !declaredKeys.includes(key));
  if (undeclared.length > 0) {
    return `${quoteList(undeclared)} ${undeclared.length === 1 ? 'is' : 'are'} not in the CYCLE's result. Add ${undeclared.length === 1 ? 'it' : 'them'} there first.`;
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** JSON Schema for the round input, typed from the literal values in `input`. */
function inputJsonSchema(input: unknown): Record<string, unknown> {
  const properties: Record<string, Record<string, unknown>> = {};
  for (const [key, value] of Object.entries(asRecord(input))) {
    properties[key] = valueJsonSchema(value);
  }
  return { type: 'object', properties };
}

function valueJsonSchema(value: unknown): Record<string, unknown> {
  // A ref's type isn't known until it resolves, so leave that property open.
  if (typeof value === 'string') return isPureRef(value) ? {} : { type: 'string' };
  if (typeof value === 'number') return { type: 'number' };
  if (typeof value === 'boolean') return { type: 'boolean' };
  if (Array.isArray(value)) return { type: 'array' };
  if (value !== null && typeof value === 'object') return { type: 'object', additionalProperties: true };
  return {};
}

function quoteList(keys: string[]): string {
  return keys.map((key) => `"${key}"`).join(', ');
}
