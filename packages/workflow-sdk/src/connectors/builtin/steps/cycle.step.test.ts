import { describe, it, expect } from 'vitest';
import { CycleStep, CycleStepConfigSchema } from './cycle.step.js';
import { BranchSignal } from '../../../engine/branch-signal.js';
import type { JumpKind } from '../../../engine/branch-signal.js';
import { PauseStep } from '../../../engine/pause-step.js';
import { createMockControlFlowContext } from '../../../testing/mock-step-context.js';
import { createMockContext } from '../../../testing/mock-context.js';
import type { WorkflowContext } from '../../../types/context.js';
import { GateCategory } from '../../../types/known-types.js';

const CYCLE_ID = 'support';

/**
 * A walkBranch stub that plays one scripted outcome per round (a missing outcome
 * means the body finished normally) and records what each round saw.
 */
function scriptedRounds(outcomes: Array<() => void>) {
  const rounds: Array<{ iter: number | undefined; loop: unknown }> = [];
  const walkBranch = async (
    _steps: unknown[],
    context: WorkflowContext,
    _branchKey?: string,
    iter?: number,
  ): Promise<void> => {
    rounds.push({ iter, loop: (context.steps as Record<string, unknown>)['__loop'] });
    outcomes[rounds.length - 1]?.();
  };
  return { rounds, walkBranch };
}

function jumpTo(kind: JumpKind, value: Record<string, unknown>, target = CYCLE_ID): () => void {
  return () => {
    throw new BranchSignal({ kind, target, value });
  };
}

function loopOutput(round: { loop: unknown }): unknown {
  return (round.loop as { output: unknown }).output;
}

describe('CycleStep', () => {
  const step = new CycleStep();

  it('has correct metadata', () => {
    expect(step.type).toBe('CYCLE');
    expect(step.kind).toBe('control');
    expect(step.category).toBe('control');
    expect(step.branchModel).toBe('iterate');
    expect(step.jumps).toBe('catch');
    expect(step.declaredOutputs).toEqual([{ key: 'body', label: 'Each round' }]);
  });

  describe('config schema', () => {
    it('defaults input to {} and maxIterations to 100', () => {
      const config = CycleStepConfigSchema.parse({ body: [] });
      expect(config.input).toEqual({});
      expect(config.maxIterations).toBe(100);
    });

    it('rejects a maxIterations below 1', () => {
      expect(() => CycleStepConfigSchema.parse({ body: [], maxIterations: 0 })).toThrow();
    });
  });

  it('returns the body as its only branch', () => {
    expect(step.getBranches({ body: [{ id: 's1', type: 'ECHO', config: {} }] })['body']).toHaveLength(1);
    expect(step.getBranches({})['body']).toEqual([]);
  });

  it('types the round input from the literal input values', () => {
    const scope = step.branchScopeSchemas({
      input: { screen: 'root', depth: 0, from: '{{trigger.channel}}' },
    });
    expect(scope['__loop.output']).toEqual({
      type: 'object',
      properties: {
        currentIndex: { type: 'number' },
        input: {
          type: 'object',
          properties: { screen: { type: 'string' }, depth: { type: 'number' }, from: {} },
        },
      },
    });
  });

  describe('checkJump', () => {
    const config = { input: { screen: 'root', from: 'root' } };

    it('accepts a GO_TO that sets every input key', () => {
      expect(step.checkJump(config, { kind: 'goto', value: { screen: 'rides', from: 'root' } })).toBeNull();
    });

    it('reports input keys a GO_TO leaves out', () => {
      expect(step.checkJump(config, { kind: 'goto', value: { screen: 'rides' } })).toBe(
        'GO_TO must set "from": every round starts from the CYCLE\'s input.',
      );
    });

    it('reports keys the input does not declare', () => {
      expect(
        step.checkJump(config, { kind: 'goto', value: { screen: 'rides', from: 'root', note: 'x' } }),
      ).toBe('"note" is not in the CYCLE\'s input. Add it there first.');
    });

    it('lets a FINISH carry any value', () => {
      expect(step.checkJump(config, { kind: 'finish', value: { resolved: true } })).toBeNull();
    });
  });

  describe('the declared result schema', () => {
    const declared = {
      type: 'object',
      properties: { build: { type: 'object' }, tests: { type: 'array' } },
      required: ['build'],
    };

    it('types output.result from it, and output.state from input', () => {
      const schema = step.resolveOutputJsonSchema({
        input: { attempt: 1, feedback: '' },
        result: declared,
      });
      const properties = schema['properties'] as Record<string, unknown>;
      expect(properties['result']).toEqual(declared);
      expect(properties['state']).toEqual({
        type: 'object',
        properties: { attempt: { type: 'number' }, feedback: { type: 'string' } },
      });
      // Only a FINISH produces a result, so it cannot be required.
      expect(schema['required']).toEqual(['rounds', 'exit', 'state']);
    });

    it('leaves result open when nothing is declared', () => {
      const schema = step.resolveOutputJsonSchema({ input: {} });
      const properties = schema['properties'] as Record<string, unknown>;
      expect(properties['result']).toEqual({ type: 'object', additionalProperties: true });
    });

    it('marks the field for the schema editor', () => {
      const decorated = step.decorateConfigSchema({
        properties: { result: { type: 'object' }, input: { type: 'object' } },
      });
      const properties = decorated['properties'] as Record<string, Record<string, unknown>>;
      expect(properties['result']!['format']).toBe('json-schema');
      // `input` is literal values, not a schema — it keeps the ordinary editor.
      expect(properties['input']!['format']).toBeUndefined();
    });

    it('accepts a FINISH that carries what it declares', () => {
      const config = { input: {}, result: declared };
      expect(step.checkJump(config, { kind: 'finish', value: { build: {}, tests: [] } })).toBeNull();
      // `tests` is declared but not required.
      expect(step.checkJump(config, { kind: 'finish', value: { build: {} } })).toBeNull();
    });

    it('refuses a FINISH missing a required key', () => {
      const problem = step.checkJump(
        { input: {}, result: declared },
        { kind: 'finish', value: { tests: [] } },
      );
      expect(problem).toContain('"build"');
    });

    it('refuses a FINISH carrying a key the result does not declare', () => {
      const problem = step.checkJump(
        { input: {}, result: declared },
        { kind: 'finish', value: { build: {}, notes: 'x' } },
      );
      expect(problem).toContain('"notes"');
    });

    it('checks nothing when no result is declared — every flow written before this', () => {
      const config = { input: { screen: 'root' } };
      expect(step.checkJump(config, { kind: 'finish', value: { anything: 1 } })).toBeNull();
      expect(step.checkJump(config, { kind: 'finish', value: {} })).toBeNull();
    });
  });

  describe('execute', () => {
    it('runs one round when the body finishes without jumping', async () => {
      const { rounds, walkBranch } = scriptedRounds([]);
      const result = await step.execute(
        { input: { screen: 'root' }, body: [], maxIterations: 100 },
        createMockControlFlowContext({ runtime: { stepId: CYCLE_ID }, walkBranch }),
      );
      expect(result).toEqual({ rounds: 1, exit: 'completed', state: { screen: 'root' } });
      expect(rounds.map((r) => r.iter)).toEqual([0]);
    });

    it('starts the next round with the value a GO_TO carries', async () => {
      const { rounds, walkBranch } = scriptedRounds([
        jumpTo('goto', { screen: 'rides' }),
        jumpTo('goto', { screen: 'payments' }),
      ]);
      const result = await step.execute(
        { input: { screen: 'root' }, body: [], maxIterations: 100 },
        createMockControlFlowContext({ runtime: { stepId: CYCLE_ID }, walkBranch }),
      );
      expect(result).toEqual({ rounds: 3, exit: 'completed', state: { screen: 'payments' } });
      expect(rounds.map((r) => r.iter)).toEqual([0, 1, 2]);
      expect(rounds.map(loopOutput)).toEqual([
        { currentIndex: 0, input: { screen: 'root' } },
        { currentIndex: 1, input: { screen: 'rides' } },
        { currentIndex: 2, input: { screen: 'payments' } },
      ]);
    });

    it('ends with the value a FINISH carries', async () => {
      const { walkBranch } = scriptedRounds([
        jumpTo('goto', { screen: 'rides' }),
        jumpTo('finish', { resolved: true }),
      ]);
      const result = await step.execute(
        { input: { screen: 'root' }, body: [], maxIterations: 100 },
        createMockControlFlowContext({ runtime: { stepId: CYCLE_ID }, walkBranch }),
      );
      expect(result).toEqual({
        rounds: 2,
        exit: 'finish',
        result: { resolved: true },
        state: { screen: 'rides' },
      });
    });

    it('hands back no result when the body falls through', async () => {
      const { walkBranch } = scriptedRounds([]);
      const output = await step.execute(
        { input: { attempt: 1 }, body: [], maxIterations: 100, result: { type: 'object' } },
        createMockControlFlowContext({ runtime: { stepId: CYCLE_ID }, walkBranch }),
      );
      // Declared or not, only a FINISH produces one — and `state` still carries
      // the last round, which on a give-up is the only diagnostic there is.
      expect(output.result).toBeUndefined();
      expect(output.state).toEqual({ attempt: 1 });
    });

    it('stops at maxIterations', async () => {
      const { rounds, walkBranch } = scriptedRounds([
        jumpTo('goto', { n: 1 }),
        jumpTo('goto', { n: 2 }),
        jumpTo('goto', { n: 3 }),
      ]);
      const result = await step.execute(
        { input: { n: 0 }, body: [], maxIterations: 2 },
        createMockControlFlowContext({ runtime: { stepId: CYCLE_ID }, walkBranch }),
      );
      expect(result).toEqual({ rounds: 2, exit: 'max_iterations', state: { n: 2 } });
      expect(rounds).toHaveLength(2);
    });

    it('lets a pause unwind', async () => {
      const { walkBranch } = scriptedRounds([
        () => {
          throw new PauseStep('waiting for the user', { category: GateCategory.WaitingOnApprover });
        },
      ]);
      await expect(
        step.execute(
          { input: {}, body: [], maxIterations: 100 },
          createMockControlFlowContext({ runtime: { stepId: CYCLE_ID }, walkBranch }),
        ),
      ).rejects.toBeInstanceOf(PauseStep);
    });

    it('lets a jump aimed at a loop further out unwind', async () => {
      const { walkBranch } = scriptedRounds([jumpTo('goto', { screen: 'rides' }, 'outer')]);
      await expect(
        step.execute(
          { input: {}, body: [], maxIterations: 100 },
          createMockControlFlowContext({ runtime: { stepId: CYCLE_ID }, walkBranch }),
        ),
      ).rejects.toMatchObject({ signal: { target: 'outer' } });
    });

    it('resolves refs in the first round input', async () => {
      const { rounds, walkBranch } = scriptedRounds([]);
      await step.execute(
        { input: { screen: '{{trigger.startScreen}}' }, body: [], maxIterations: 100 },
        createMockControlFlowContext({
          runtime: { stepId: CYCLE_ID },
          workflow: createMockContext({ triggerData: { startScreen: 'payments' } }),
          walkBranch,
        }),
      );
      expect(loopOutput(rounds[0]!)).toEqual({ currentIndex: 0, input: { screen: 'payments' } });
    });

    it('keeps __loop out of the enclosing scope', async () => {
      const { walkBranch } = scriptedRounds([]);
      const ctx = createMockControlFlowContext({ runtime: { stepId: CYCLE_ID }, walkBranch });
      await step.execute({ input: {}, body: [], maxIterations: 100 }, ctx);
      expect((ctx.workflow.steps as Record<string, unknown>)['__loop']).toBeUndefined();
    });
  });
});
