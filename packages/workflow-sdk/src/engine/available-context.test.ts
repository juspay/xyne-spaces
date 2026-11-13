import { describe, it, expect } from 'vitest';
import { testRegistry } from '../testing/test-connector.js';
import { z } from 'zod';
import { getAvailableContext } from './available-context.js';
import {
  BaseActionStep,
  BaseControlFlowStep,
} from '../steps/base-step.js';
import type {
  StepExecutionContext,
  ControlFlowExecutionContext,
} from '../steps/base-step.js';
import { BaseTrigger } from '../triggers/base-trigger.js';
import { TriggerCategory } from '../types/categories.js';
import { BuiltinStepType } from '../types/known-types.js';
import type { WorkflowConfig, WorkflowStepConfig } from '../types/workflow-config.js';
import { TRIGGER_FILTER_SCOPE } from '../types/workflow-config.js';

// ─── Test trigger ───

const TriggerOutput = z.object({ messageId: z.string(), text: z.string() });

class TestTrigger extends BaseTrigger<z.ZodObject<{}>> {
  readonly type = 'TEST_EVENT';
  readonly configSchema = z.object({});
  readonly name = 'Test Event';
  readonly description = 'Test trigger';
  readonly outputSchema = TriggerOutput;
  readonly category = TriggerCategory.EVENT;
}

// ─── Test steps ───

const FetchOutput = z.object({ data: z.string(), count: z.number() });

class FetchStep extends BaseActionStep<z.ZodObject<{}>, { data: string; count: number }> {
  readonly type = 'FETCH';
  readonly configSchema = z.object({});
  readonly name = 'Fetch';
  readonly description = 'Fetches data';
  readonly outputSchema = FetchOutput;
  readonly category = 'integration';

  async execute(
    _config: Record<string, never>,
    _ctx: StepExecutionContext,
  ): Promise<{ data: string; count: number }> {
    return { data: 'test', count: 1 };
  }
}

const TransformOutput = z.object({ result: z.string() });

class TransformStep extends BaseActionStep<z.ZodObject<{}>, { result: string }> {
  readonly type = 'TRANSFORM_TEST';
  readonly configSchema = z.object({});
  readonly name = 'Transform';
  readonly description = 'Transforms data';
  readonly outputSchema = TransformOutput;
  readonly category = 'data';

  async execute(
    _config: Record<string, never>,
    _ctx: StepExecutionContext,
  ): Promise<{ result: string }> {
    return { result: 'done' };
  }
}

const CondConfig = z.object({
  condition: z.unknown(),
  if_true: z.array(z.unknown()),
  if_false: z.array(z.unknown()).optional(),
});
const CondOutput = z.object({ branch: z.string() });

class ConditionalStep extends BaseControlFlowStep<typeof CondConfig, { branch: string }> {
  readonly type = BuiltinStepType.CONDITIONAL;
  readonly configSchema = CondConfig;
  readonly name = 'Conditional';
  readonly description = 'Branches';
  readonly outputSchema = CondOutput;
  override readonly category = 'control' as const;

  async execute(
    _config: z.infer<typeof CondConfig>,
    _ctx: ControlFlowExecutionContext,
  ): Promise<{ branch: string }> {
    return { branch: 'true' };
  }

  override getBranches(config: Record<string, unknown>): Record<string, WorkflowStepConfig[]> {
    return {
      if_true: (config['if_true'] ?? []) as WorkflowStepConfig[],
      if_false: (config['if_false'] ?? []) as WorkflowStepConfig[],
    };
  }
}

/**
 * A loop-shaped step: it injects a variable into its own body that appears
 * nowhere in the config, and types it from the author's own config — the shape
 * CYCLE has, and the reason the picker cannot infer these by walking steps.
 */
const LoopishConfig = z.object({
  input: z.record(z.unknown()).default({}),
  body: z.array(z.unknown()).default([]),
});

class LoopishStep extends BaseControlFlowStep<typeof LoopishConfig, { rounds: number }> {
  readonly type = 'LOOPISH';
  readonly configSchema = LoopishConfig;
  readonly name = 'Loopish';
  readonly description = 'Repeats its body';
  readonly outputSchema = z.object({ rounds: z.number() });
  override readonly category = 'control' as const;

  async execute(): Promise<{ rounds: number }> {
    return { rounds: 1 };
  }

  override getBranches(config: Record<string, unknown>): Record<string, WorkflowStepConfig[]> {
    return { body: (config['body'] ?? []) as WorkflowStepConfig[] };
  }

  override branchScopeSchemas(
    config: Record<string, unknown>,
  ): Record<string, Record<string, unknown>> {
    const input = (config['input'] ?? {}) as Record<string, unknown>;
    return {
      '__loop.output': {
        type: 'object',
        properties: {
          currentIndex: { type: 'number' },
          input: {
            type: 'object',
            properties: Object.fromEntries(
              Object.keys(input).map((k) => [k, { type: 'string' }]),
            ),
          },
        },
      },
    };
  }
}

// ─── Setup ───

function setup() {
  const connectors = testRegistry({
    triggers: [new TestTrigger()],
    steps: [new FetchStep(), new TransformStep(), new LoopishStep()],
  });

  return { connectors };
}

// ─── Tests ───

describe('getAvailableContext', () => {
  it('returns trigger output for the first step', () => {
    const { connectors } = setup();
    const config: WorkflowConfig = {
      trigger: { type: 'TEST_EVENT', config: {} },
      steps: [
        { id: 'step_1', type: 'FETCH', config: {} },
      ],
    };

    const ctx = getAvailableContext(config, 'step_1', connectors);
    expect(ctx).not.toBeNull();
    expect(ctx!['trigger']).toBeDefined();
    expect(ctx!['trigger']!['type']).toBe('object');
    // Should NOT include step_1's own output
    expect(ctx!['steps.step_1.output']).toBeUndefined();
  });

  it('returns trigger + preceding step outputs for later steps', () => {
    const { connectors } = setup();
    const config: WorkflowConfig = {
      trigger: { type: 'TEST_EVENT', config: {} },
      steps: [
        { id: 'fetch_data', type: 'FETCH', config: {} },
        { id: 'transform_it', type: 'TRANSFORM_TEST', config: {} },
        { id: 'step_3', type: 'FETCH', config: {} },
      ],
    };

    const ctx = getAvailableContext(config, 'step_3', connectors);
    expect(ctx).not.toBeNull();
    expect(ctx!['trigger']).toBeDefined();
    expect(ctx!['steps.fetch_data.output']).toBeDefined();
    expect(ctx!['steps.transform_it.output']).toBeDefined();
    // Should NOT include step_3's own output
    expect(ctx!['steps.step_3.output']).toBeUndefined();
  });

  it('returns null for unknown step ID', () => {
    const { connectors } = setup();
    const config: WorkflowConfig = {
      trigger: { type: 'TEST_EVENT', config: {} },
      steps: [
        { id: 'step_1', type: 'FETCH', config: {} },
      ],
    };

    const ctx = getAvailableContext(config, 'nonexistent', connectors);
    expect(ctx).toBeNull();
  });

  it('finds a step inside a conditional branch', () => {
    const { connectors } = setup();
    const config: WorkflowConfig = {
      trigger: { type: 'TEST_EVENT', config: {} },
      steps: [
        { id: 'fetch_data', type: 'FETCH', config: {} },
        {
          id: 'branch_1',
          type: BuiltinStepType.CONDITIONAL,
          config: {
            condition: {},
            if_true: [
              { id: 'inner_step', type: 'TRANSFORM_TEST', config: {} },
              { id: 'target_step', type: 'FETCH', config: {} },
            ],
            if_false: [],
          },
        },
      ],
    };

    const ctx = getAvailableContext(config, 'target_step', connectors);
    expect(ctx).not.toBeNull();
    // Should have trigger + fetch_data + branch_1 (the conditional itself) + inner_step
    expect(ctx!['trigger']).toBeDefined();
    expect(ctx!['steps.fetch_data.output']).toBeDefined();
    expect(ctx!['steps.branch_1.output']).toBeDefined();
    expect(ctx!['steps.inner_step.output']).toBeDefined();
    // Target step's own output should not be included
    expect(ctx!['steps.target_step.output']).toBeUndefined();
  });

  it('does not leak sibling branch steps', () => {
    const { connectors } = setup();
    const config: WorkflowConfig = {
      trigger: { type: 'TEST_EVENT', config: {} },
      steps: [
        {
          id: 'branch_1',
          type: BuiltinStepType.CONDITIONAL,
          config: {
            condition: {},
            if_true: [
              { id: 'true_step', type: 'FETCH', config: {} },
            ],
            if_false: [
              { id: 'false_step', type: 'TRANSFORM_TEST', config: {} },
              { id: 'target_in_false', type: 'FETCH', config: {} },
            ],
          },
        },
      ],
    };

    const ctx = getAvailableContext(config, 'target_in_false', connectors);
    expect(ctx).not.toBeNull();
    // Should have trigger + branch_1 + false_step
    expect(ctx!['trigger']).toBeDefined();
    expect(ctx!['steps.branch_1.output']).toBeDefined();
    expect(ctx!['steps.false_step.output']).toBeDefined();
    // Should NOT have true_step (sibling branch)
    expect(ctx!['steps.true_step.output']).toBeUndefined();
  });

  it('includes JSON Schema with properties for step outputs', () => {
    const { connectors } = setup();
    const config: WorkflowConfig = {
      trigger: { type: 'TEST_EVENT', config: {} },
      steps: [
        { id: 'fetch_data', type: 'FETCH', config: {} },
        { id: 'step_2', type: 'TRANSFORM_TEST', config: {} },
      ],
    };

    const ctx = getAvailableContext(config, 'step_2', connectors);
    expect(ctx).not.toBeNull();

    // Trigger schema should have properties matching TriggerOutput
    const triggerSchema = ctx!['trigger']!;
    expect(triggerSchema['type']).toBe('object');
    const triggerProps = triggerSchema['properties'] as Record<string, unknown>;
    expect(triggerProps['messageId']).toBeDefined();
    expect(triggerProps['text']).toBeDefined();

    // Fetch step output should have data + count
    const fetchSchema = ctx!['steps.fetch_data.output']!;
    expect(fetchSchema['type']).toBe('object');
    const fetchProps = fetchSchema['properties'] as Record<string, unknown>;
    expect(fetchProps['data']).toBeDefined();
    expect(fetchProps['count']).toBeDefined();
  });

  it('handles empty step list', () => {
    const { connectors } = setup();
    const config: WorkflowConfig = {
      trigger: { type: 'TEST_EVENT', config: {} },
      steps: [],
    };

    const ctx = getAvailableContext(config, 'any_step', connectors);
    expect(ctx).toBeNull();
  });

  // ─── Control-flow branch output typing ───

  describe('control-flow branch output schema', () => {
    /** Drill `output.branches.<key>.steps.<id>.output` from a resolved schema. */
    function branchStepOutput(
      schema: Record<string, unknown>,
      key: string,
      stepId: string,
    ): Record<string, unknown> {
      const branches = (schema['properties'] as Record<string, Record<string, unknown>>)['branches'];
      const branch = (branches!['properties'] as Record<string, Record<string, unknown>>)[key];
      const stepsMap = (branch!['properties'] as Record<string, Record<string, unknown>>)['steps'];
      const step = (stepsMap!['properties'] as Record<string, Record<string, unknown>>)[stepId];
      return (step!['properties'] as Record<string, Record<string, unknown>>)['output']!;
    }

    it('types a parallel step\'s branches → steps → output, drillable to inner fields', () => {
      const { connectors } = setup();
      const config: WorkflowConfig = {
        trigger: { type: 'TEST_EVENT', config: {} },
        steps: [
          {
            id: 'par',
            type: BuiltinStepType.PARALLEL,
            config: {
              merge: 'allSettled',
              branches: {
                market: [{ id: 'm1', type: 'FETCH', config: {} }],
                comp: [{ id: 'c1', type: 'TRANSFORM_TEST', config: {} }],
              },
            },
          },
          { id: 'after', type: 'FETCH', config: {} },
        ],
      };

      const ctx = getAvailableContext(config, 'after', connectors);
      const par = ctx!['steps.par.output']!;
      // mode meta survives (collapsed to the configured mode, concrete — not anyOf)
      expect((par['properties'] as Record<string, unknown>)['mode']).toBeDefined();
      // Inner step outputs are typed and drillable
      const m1 = branchStepOutput(par, 'market', 'm1');
      expect((m1['properties'] as Record<string, unknown>)['data']).toBeDefined();
      expect((m1['properties'] as Record<string, unknown>)['count']).toBeDefined();
      const c1 = branchStepOutput(par, 'comp', 'c1');
      expect((c1['properties'] as Record<string, unknown>)['result']).toBeDefined();
    });

    it('types conditional branches under output.branches by key', () => {
      const { connectors } = setup();
      const config: WorkflowConfig = {
        trigger: { type: 'TEST_EVENT', config: {} },
        steps: [
          {
            id: 'gate',
            type: BuiltinStepType.CONDITIONAL,
            config: {
              condition: { variable: '{{trigger.text}}', operator: 'exists' },
              if_true: [{ id: 't1', type: 'FETCH', config: {} }],
              if_false: [{ id: 'f1', type: 'TRANSFORM_TEST', config: {} }],
            },
          },
          { id: 'after', type: 'FETCH', config: {} },
        ],
      };

      const ctx = getAvailableContext(config, 'after', connectors);
      const gate = ctx!['steps.gate.output']!;
      expect((branchStepOutput(gate, 'if_true', 't1')['properties'] as Record<string, unknown>)['data']).toBeDefined();
      expect((branchStepOutput(gate, 'if_false', 'f1')['properties'] as Record<string, unknown>)['result']).toBeDefined();
    });

    it('recurses for a parallel nested inside a conditional branch', () => {
      const { connectors } = setup();
      const config: WorkflowConfig = {
        trigger: { type: 'TEST_EVENT', config: {} },
        steps: [
          {
            id: 'gate',
            type: BuiltinStepType.CONDITIONAL,
            config: {
              condition: { variable: '{{trigger.text}}', operator: 'exists' },
              if_true: [
                {
                  id: 'par',
                  type: BuiltinStepType.PARALLEL,
                  config: {
                    merge: 'allSettled',
                    branches: { market: [{ id: 'm1', type: 'FETCH', config: {} }] },
                  },
                },
              ],
              if_false: [],
            },
          },
          { id: 'after', type: 'FETCH', config: {} },
        ],
      };

      const ctx = getAvailableContext(config, 'after', connectors);
      const gate = ctx!['steps.gate.output']!;
      // gate.output.branches.if_true.steps.par.output is the nested parallel's
      // own config-aware output → drill into ITS branches → market → m1 → output
      const parOutput = branchStepOutput(gate, 'if_true', 'par');
      const m1 = branchStepOutput(parOutput, 'market', 'm1');
      expect((m1['properties'] as Record<string, unknown>)['data']).toBeDefined();
    });
  });

  // ─── Trigger-level resolveOutputJsonSchema ───

  describe('trigger.resolveOutputJsonSchema', () => {
    it('uses per-instance trigger schema when the trigger overrides resolveOutputJsonSchema', () => {
      class DynamicTrigger extends BaseTrigger<z.ZodTypeAny> {
        readonly type = 'DYNAMIC';
        readonly configSchema = z.object({
          bodyShape: z.record(z.unknown()).optional(),
        });
        readonly name = 'Dynamic';
        readonly description = 'Trigger that types its body from config';
        readonly outputSchema = z.object({ body: z.unknown() });
        readonly category = TriggerCategory.WEBHOOK;

        override resolveOutputJsonSchema(config: Record<string, unknown>): Record<string, unknown> {
          const bodyShape = config['bodyShape'] as Record<string, unknown> | undefined;
          return {
            type: 'object',
            properties: {
              body: bodyShape && Object.keys(bodyShape).length > 0
                ? bodyShape
                : { type: 'object' },
            },
          };
        }
      }

      const connectors = testRegistry({ triggers: [new DynamicTrigger()], steps: [new FetchStep()] });

      const bodyShape = {
        type: 'object',
        properties: {
          eventType: { type: 'string' },
          payload: {
            type: 'object',
            properties: { id: { type: 'number' } },
          },
        },
      };
      const config: WorkflowConfig = {
        trigger: { type: 'DYNAMIC', config: { bodyShape } },
        steps: [{ id: 'fetch_data', type: 'FETCH', config: {} }],
      };

      const ctx = getAvailableContext(config, 'fetch_data', connectors);

      // Trigger output's body should be the user-supplied schema verbatim.
      const triggerSchema = ctx!['trigger']!;
      const triggerProps = triggerSchema['properties'] as Record<string, unknown>;
      expect(triggerProps['body']).toEqual(bodyShape);
    });

    it('falls back to the static outputSchema when the trigger does not override resolveOutputJsonSchema', () => {
      const { connectors } = setup();
      const config: WorkflowConfig = {
        trigger: { type: 'TEST_EVENT', config: {} },
        steps: [{ id: 'fetch_data', type: 'FETCH', config: {} }],
      };

      const ctx = getAvailableContext(config, 'fetch_data', connectors);
      const triggerSchema = ctx!['trigger']!;
      const triggerProps = triggerSchema['properties'] as Record<string, unknown>;
      // From TestTrigger's static z.object({ messageId, text })
      expect(triggerProps['messageId']).toBeDefined();
      expect(triggerProps['text']).toBeDefined();
    });
  });
});

describe('getAvailableContext — trigger filter scope', () => {
  it('returns the trigger output and no step outputs, since a filter runs before any step', () => {
    const connectors = testRegistry({ steps: [new FetchStep()], triggers: [new TestTrigger()] });
    const config: WorkflowConfig = {
      trigger: { type: 'TEST_EVENT', config: {} },
      steps: [{ id: 'fetch1', type: 'FETCH', config: {} }],
    };
    const ctx = getAvailableContext(config, TRIGGER_FILTER_SCOPE, connectors);
    expect(ctx).not.toBeNull();
    expect(Object.keys(ctx!)).toEqual(['trigger']);
  });
});

/**
 * What a control-flow step injects into its own branches (`__loop`, `__map`)
 * appears nowhere in the config, so walking steps can never discover it — the
 * step has to declare it. The picker reads the same hook the validator does, so
 * anything it offers is something that validates.
 */
describe('getAvailableContext — branch scope variables', () => {
  const loopConfig = (bodySteps: WorkflowStepConfig[]): WorkflowConfig => ({
    trigger: { type: 'TEST_EVENT', config: {} },
    steps: [
      {
        id: 'support',
        type: 'LOOPISH',
        config: { input: { screen: 'root', text: '' }, body: bodySteps },
      },
      { id: 'after', type: 'FETCH', config: {} },
    ],
  });

  const inputPropsOf = (ctx: Record<string, Record<string, unknown>>): string[] => {
    const props = ctx['steps.__loop.output']!['properties'] as Record<string, unknown>;
    const input = props['input'] as { properties: Record<string, unknown> };
    return Object.keys(input.properties);
  };

  it('offers the loop scope to a step inside the body', () => {
    const { connectors } = setup();
    const ctx = getAvailableContext(
      loopConfig([{ id: 'inner', type: 'FETCH', config: {} }]),
      'inner',
      connectors,
    );

    expect(ctx).not.toBeNull();
    expect(ctx!['steps.__loop.output']).toBeDefined();
    const props = ctx!['steps.__loop.output']!['properties'] as Record<string, unknown>;
    expect(Object.keys(props)).toEqual(['currentIndex', 'input']);
  });

  it('types the loop input from the author config, not a fixed shape', () => {
    const { connectors } = setup();
    const ctx = getAvailableContext(
      loopConfig([{ id: 'inner', type: 'FETCH', config: {} }]),
      'inner',
      connectors,
    );

    expect(inputPropsOf(ctx!)).toEqual(['screen', 'text']);
  });

  it('does not leak the loop scope to steps outside the loop', () => {
    const { connectors } = setup();
    const ctx = getAvailableContext(
      loopConfig([{ id: 'inner', type: 'FETCH', config: {} }]),
      'after',
      connectors,
    );

    expect(ctx).not.toBeNull();
    expect(ctx!['steps.support.output']).toBeDefined();
    expect(ctx!['steps.__loop.output']).toBeUndefined();
  });

  it('shadows an outer loop scope with the inner one', () => {
    const { connectors } = setup();
    const config: WorkflowConfig = {
      trigger: { type: 'TEST_EVENT', config: {} },
      steps: [
        {
          id: 'outer',
          type: 'LOOPISH',
          config: {
            input: { outerKey: '' },
            body: [
              {
                id: 'inner_loop',
                type: 'LOOPISH',
                config: {
                  input: { innerKey: '' },
                  body: [{ id: 'deep', type: 'FETCH', config: {} }],
                },
              },
            ],
          },
        },
      ],
    };

    const ctx = getAvailableContext(config, 'deep', connectors);
    expect(ctx).not.toBeNull();
    expect(inputPropsOf(ctx!)).toEqual(['innerKey']);
  });
});
