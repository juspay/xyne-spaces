import { describe, it, expect } from 'vitest';
import { testRegistry } from '../testing/test-connector.js';
import { z } from 'zod';
import { ConfigValidator } from './config-validator.js';
import { defineCredential } from '../connectors/core/credentials.js';
import { ConditionOperator } from '../types/operators.js';
import {
  BaseActionStep,
  BaseControlFlowStep,
  StepKind,
} from '../steps/base-step.js';
import type {
  StepExecutionContext,
  ControlFlowExecutionContext,
} from '../steps/base-step.js';
import { BaseTrigger } from '../triggers/base-trigger.js';
import { TriggerCategory } from '../types/categories.js';
import { BuiltinStepType } from '../types/known-types.js';
import { ValidationIssueCode } from '../types/validation.js';
import { variableRef } from '../types/workflow-config.js';
import type { WorkflowConfig, WorkflowStepConfig } from '../types/workflow-config.js';

// ─── Test trigger ───

const TriggerConfig = z.object({ channel: z.string() });
const TriggerOutput = z.object({
  messageId: z.string(),
  text: z.string(),
  tags: z.array(z.string()),
});

class TestTrigger extends BaseTrigger<typeof TriggerConfig> {
  readonly type = 'TEST_EVENT';
  readonly configSchema = TriggerConfig;
  readonly name = 'Test Event';
  readonly description = 'Test trigger';
  readonly outputSchema = TriggerOutput;
  readonly category = TriggerCategory.EVENT;
}

// ─── Test action step ───

const SendConfig = z.object({
  to: variableRef(z.string()),
  body: z.string(),
  count: variableRef(z.number()).optional(),
});
const SendOutput = z.object({ sent: z.boolean(), msgId: z.string() });

class SendStep extends BaseActionStep<typeof SendConfig, { sent: boolean; msgId: string }> {
  readonly type = 'SEND_MSG';
  readonly configSchema = SendConfig;
  readonly name = 'Send Message';
  readonly description = 'Sends a message';
  readonly outputSchema = SendOutput;
  readonly category = 'messaging';

  async execute(
    _config: z.infer<typeof SendConfig>,
    _ctx: StepExecutionContext,
  ): Promise<{ sent: boolean; msgId: string }> {
    return { sent: true, msgId: 'msg_1' };
  }
}

// ─── Test control flow step (conditional) ───

const CondConfig = z.object({
  condition: z.unknown(),
  if_true: z.array(z.unknown()),
  if_false: z.array(z.unknown()).optional(),
});
const CondOutput = z.object({ result: z.boolean() });

class ConditionalStep extends BaseControlFlowStep<typeof CondConfig, { result: boolean }> {
  readonly type = BuiltinStepType.CONDITIONAL;
  readonly configSchema = CondConfig;
  readonly name = 'Conditional';
  readonly description = 'Branches on condition';
  readonly outputSchema = CondOutput;
  override readonly category = 'control' as const;
  override readonly declaredOutputs = [
    { key: 'if_true', label: 'True' },
    { key: 'if_false', label: 'False' },
  ] as const;

  async execute(
    _config: z.infer<typeof CondConfig>,
    _ctx: ControlFlowExecutionContext,
  ): Promise<{ result: boolean }> {
    return { result: true };
  }

  override getBranches(config: Record<string, unknown>): Record<string, WorkflowStepConfig[]> {
    return {
      if_true: (config['if_true'] ?? []) as WorkflowStepConfig[],
      if_false: (config['if_false'] ?? []) as WorkflowStepConfig[],
    };
  }
}

// ─── Setup ───

function setup() {
  const connectors = testRegistry({ triggers: [new TestTrigger()], steps: [new SendStep()] });

  const validator = new ConfigValidator(connectors);
  return { validator, connectors };
}

// ─── Tests ───

describe('ConfigValidator', () => {
  describe('trigger validation', () => {
    it('validates a correct trigger', () => {
      const { validator } = setup();
      const result = validator.validate({
        trigger: { type: 'TEST_EVENT', config: { channel: 'ch_1' } },
        steps: [],
      });
      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('reports unknown trigger type', () => {
      const { validator } = setup();
      const result = validator.validate({
        trigger: { type: 'NONEXISTENT', config: {} },
        steps: [],
      });
      expect(result.valid).toBe(false);
      expect(result.issues[0]!.code).toBe(ValidationIssueCode.SHAPE);
      expect(result.issues[0]!.message).toContain('Unknown trigger type');
    });

    it('accepts a delayed start', () => {
      const { validator } = setup();
      const result = validator.validate({
        trigger: {
          type: 'TEST_EVENT',
          config: { channel: 'ch_1' },
          start: { kind: 'delay', offset: { amount: 2, unit: 'hours' } },
        },
        steps: [],
      });
      expect(result.valid).toBe(true);
    });

    it('accepts an anchor that names a real trigger field', () => {
      const { validator } = setup();
      const result = validator.validate({
        trigger: {
          type: 'TEST_EVENT',
          config: { channel: 'ch_1' },
          start: { kind: 'at', anchor: '{{trigger.messageId}}', ifPast: 'skip' },
        },
        steps: [],
      });
      expect(result.valid).toBe(true);
    });

    it('rejects an anchor naming a field the trigger does not produce', () => {
      const { validator } = setup();
      const result = validator.validate({
        trigger: {
          type: 'TEST_EVENT',
          config: { channel: 'ch_1' },
          start: { kind: 'at', anchor: '{{trigger.eta}}', ifPast: 'skip' },
        },
        steps: [],
      });
      // The whole point of a reference: a renamed or mistyped field is caught
      // here, not by a rule that silently never arms.
      expect(result.valid).toBe(false);
      expect(result.issues[0]!.path).toBe('trigger.start.anchor');
      expect(result.issues[0]!.code).toBe(ValidationIssueCode.UNKNOWN_REFERENCE);
    });

    it('rejects an anchor on an undeclared workflow variable', () => {
      const { validator } = setup();
      const result = validator.validate({
        trigger: {
          type: 'TEST_EVENT',
          config: { channel: 'ch_1' },
          start: { kind: 'at', anchor: '{{vars.cutoff}}', ifPast: 'skip' },
        },
        steps: [],
      });
      expect(result.valid).toBe(false);
      expect(result.issues[0]!.code).toBe(ValidationIssueCode.UNKNOWN_REFERENCE);
    });

    it('accepts an anchor on a declared workflow variable', () => {
      const { validator } = setup();
      const result = validator.validate({
        trigger: {
          type: 'TEST_EVENT',
          config: { channel: 'ch_1' },
          start: { kind: 'at', anchor: '{{vars.cutoff}}', ifPast: 'skip' },
        },
        variables: [{ key: 'cutoff', type: 'text', value: '2026-03-01T00:00:00.000Z' }],
        steps: [],
      } as WorkflowConfig);
      expect(result.valid).toBe(true);
    });

    it('rejects an anchor pointing at a field that is not a time', () => {
      const { validator } = setup();
      const result = validator.validate({
        trigger: {
          type: 'TEST_EVENT',
          config: { channel: 'ch_1' },
          // `tags` exists on the trigger's output, but a list can never be a time.
          start: { kind: 'at', anchor: '{{trigger.tags}}', ifPast: 'skip' },
        },
        steps: [],
      });
      expect(result.valid).toBe(false);
      expect(result.issues[0]!.code).toBe(ValidationIssueCode.TYPE_MISMATCH);
    });

    it('accepts a literal timestamp as the anchor', () => {
      const { validator } = setup();
      const result = validator.validate({
        trigger: {
          type: 'TEST_EVENT',
          config: { channel: 'ch_1' },
          start: { kind: 'at', anchor: '2026-03-01T14:00:00.000Z', ifPast: 'run' },
        },
        steps: [],
      });
      expect(result.valid).toBe(true);
    });

    it('rejects a bare path as an anchor', () => {
      const { validator } = setup();
      const result = validator.validate({
        trigger: {
          type: 'TEST_EVENT',
          config: { channel: 'ch_1' },
          start: { kind: 'at', anchor: 'ticket.eta', ifPast: 'skip' },
        },
        steps: [],
      });
      expect(result.valid).toBe(false);
      expect(result.issues[0]!.path).toContain('trigger.start');
    });

    it('rejects a start delay beyond the cap', () => {
      const { validator } = setup();
      const result = validator.validate({
        trigger: {
          type: 'TEST_EVENT',
          config: { channel: 'ch_1' },
          start: { kind: 'delay', offset: { amount: 60, unit: 'days' } },
        },
        steps: [],
      });
      expect(result.valid).toBe(false);
      expect(result.issues[0]!.message).toContain('30 days');
    });

    it('reports invalid trigger config', () => {
      const { validator } = setup();
      const result = validator.validate({
        trigger: { type: 'TEST_EVENT', config: {} }, // missing channel
        steps: [],
      });
      expect(result.valid).toBe(false);
      expect(result.issues[0]!.path).toContain('trigger.config');
    });
  });

  describe('step validation', () => {
    it('validates a correct step', () => {
      const { validator } = setup();
      const result = validator.validate({
        trigger: { type: 'TEST_EVENT', config: { channel: 'ch_1' } },
        steps: [
          { id: 'step1', type: 'SEND_MSG', config: { to: 'alice', body: 'hi' } },
        ],
      });
      expect(result.valid).toBe(true);
    });

    it('reports unknown step type', () => {
      const { validator } = setup();
      const result = validator.validate({
        trigger: { type: 'TEST_EVENT', config: { channel: 'ch_1' } },
        steps: [
          { id: 'step1', type: 'UNKNOWN_STEP', config: {} },
        ],
      });
      expect(result.valid).toBe(false);
      expect(result.issues[0]!.code).toBe(ValidationIssueCode.SHAPE);
      expect(result.issues[0]!.message).toContain('Unknown step type');
    });

    it('reports invalid step config', () => {
      const { validator } = setup();
      const result = validator.validate({
        trigger: { type: 'TEST_EVENT', config: { channel: 'ch_1' } },
        steps: [
          { id: 'step1', type: 'SEND_MSG', config: { body: 'hi' } }, // missing 'to'
        ],
      });
      expect(result.valid).toBe(false);
      expect(result.issues[0]!.path).toContain('steps[0].config');
    });
  });

  describe('issue location (resolved navigation data)', () => {
    it('tags trigger-config issues with scope=trigger + field', () => {
      const { validator } = setup();
      const result = validator.validate({
        trigger: { type: 'TEST_EVENT', config: {} }, // missing channel
        steps: [],
      });
      expect(result.issues[0]!.location).toEqual({ scope: 'trigger', field: 'channel' });
    });

    it('tags step shape issues with the owning stepId + field', () => {
      const { validator } = setup();
      const result = validator.validate({
        trigger: { type: 'TEST_EVENT', config: { channel: 'ch_1' } },
        steps: [
          { id: 'step1', type: 'SEND_MSG', config: { body: 'hi' } }, // missing 'to'
        ],
      });
      const issue = result.issues.find((i) => i.location?.field === 'to');
      expect(issue?.location).toEqual({ scope: 'step', stepId: 'step1', field: 'to' });
    });

    it('resolves the NESTED step id for issues inside a branch', () => {
      const { validator } = setup();
      const result = validator.validate({
        trigger: { type: 'TEST_EVENT', config: { channel: 'ch_1' } },
        steps: [
          {
            id: 'cond1',
            type: 'CONDITIONAL',
            config: {
              condition: {},
              if_true: [
                { id: 'nested1', type: 'SEND_MSG', config: { body: 'hi' } }, // missing 'to'
              ],
            },
          },
        ],
      });
      const issue = result.issues.find((i) => i.location?.stepId === 'nested1');
      expect(issue).toBeDefined();
      expect(issue!.location).toEqual({ scope: 'step', stepId: 'nested1', field: 'to' });
    });

    it('tags ref issues with the referencing step + field', () => {
      const { validator } = setup();
      const result = validator.validate({
        trigger: { type: 'TEST_EVENT', config: { channel: 'ch_1' } },
        steps: [
          { id: 'step1', type: 'SEND_MSG', config: { to: '{{ghost.output.x}}', body: 'hi' } },
        ],
      });
      const issue = result.issues.find((i) => i.code === ValidationIssueCode.FORWARD_REFERENCE);
      expect(issue?.location).toEqual({ scope: 'step', stepId: 'step1', field: 'to' });
    });
  });

  describe('variable ref validation', () => {
    it('accepts valid trigger ref', () => {
      const { validator } = setup();
      const result = validator.validate({
        trigger: { type: 'TEST_EVENT', config: { channel: 'ch_1' } },
        steps: [
          {
            id: 'step1',
            type: 'SEND_MSG',
            config: { to: '{{trigger.text}}', body: 'hi' },
          },
        ],
      });
      expect(result.valid).toBe(true);
    });

    it('accepts valid step output ref', () => {
      const { validator } = setup();
      const result = validator.validate({
        trigger: { type: 'TEST_EVENT', config: { channel: 'ch_1' } },
        steps: [
          {
            id: 'step1',
            type: 'SEND_MSG',
            config: { to: 'alice', body: 'first' },
          },
          {
            id: 'step2',
            type: 'SEND_MSG',
            config: { to: '{{step1.output.msgId}}', body: 'reply' },
          },
        ],
      });
      expect(result.valid).toBe(true);
    });

    it('reports forward reference', () => {
      const { validator } = setup();
      const result = validator.validate({
        trigger: { type: 'TEST_EVENT', config: { channel: 'ch_1' } },
        steps: [
          {
            id: 'step1',
            type: 'SEND_MSG',
            config: { to: '{{step2.output.msgId}}', body: 'hi' },
          },
          {
            id: 'step2',
            type: 'SEND_MSG',
            config: { to: 'alice', body: 'hi' },
          },
        ],
      });
      expect(result.valid).toBe(false);
      expect(result.issues[0]!.code).toBe(ValidationIssueCode.FORWARD_REFERENCE);
    });

    it('reports unknown ref path', () => {
      const { validator } = setup();
      const result = validator.validate({
        trigger: { type: 'TEST_EVENT', config: { channel: 'ch_1' } },
        steps: [
          {
            id: 'step1',
            type: 'SEND_MSG',
            config: { to: '{{trigger.nonexistent}}', body: 'hi' },
          },
        ],
      });
      expect(result.valid).toBe(false);
      expect(result.issues[0]!.code).toBe(ValidationIssueCode.UNKNOWN_REFERENCE);
    });

    it('allows scalar-to-scalar coercion (text ref in number field)', () => {
      // The validator uses loose scalar compatibility — string and number
      // are both scalar types and are considered compatible.
      const { validator } = setup();
      const result = validator.validate({
        trigger: { type: 'TEST_EVENT', config: { channel: 'ch_1' } },
        steps: [
          {
            id: 'step1',
            type: 'SEND_MSG',
            config: {
              to: 'alice',
              body: 'hi',
              count: '{{trigger.text}}',
            },
          },
        ],
      });
      expect(result.valid).toBe(true);
    });

    it('reports type mismatch (list ref in number field)', () => {
      // list → number is not compatible even with loose scalar matching
      const ListTriggerOutput = z.object({ items: z.array(z.string()), name: z.string() });

      class ListTrigger extends BaseTrigger<typeof TriggerConfig> {
        readonly type = 'LIST_EVENT';
        readonly configSchema = TriggerConfig;
        readonly name = 'List Event';
        readonly description = 'list trigger';
        readonly outputSchema = ListTriggerOutput;
        readonly category = TriggerCategory.EVENT;
      }

      const connectors = testRegistry({
        triggers: [new ListTrigger()],
        steps: [new SendStep()],
      });
      const validator = new ConfigValidator(connectors);

      const result = validator.validate({
        trigger: { type: 'LIST_EVENT', config: { channel: 'ch_1' } },
        steps: [
          {
            id: 'step1',
            type: 'SEND_MSG',
            config: {
              to: 'alice',
              body: 'hi',
              count: '{{trigger.items}}', // list → number
            },
          },
        ],
      });
      expect(result.valid).toBe(false);
      expect(result.issues[0]!.code).toBe(ValidationIssueCode.TYPE_MISMATCH);
    });
  });

  describe('output schema resolution matches the picker (resolveOutputJsonSchema)', () => {
    // Mimics the HTTP step: the static output `body` is z.unknown(), but the
    // per-instance resolveOutputJsonSchema types `body` from the author's config.
    const HttpLikeConfig = z.object({
      bodySchema: z.record(z.string(), z.unknown()).optional(),
    });
    const HttpLikeOutput = z.object({ status: z.number().int(), body: z.unknown() });

    class HttpLikeStep extends BaseActionStep<typeof HttpLikeConfig, { status: number; body: unknown }> {
      readonly type = 'HTTP_LIKE';
      readonly configSchema = HttpLikeConfig;
      readonly name = 'Http Like';
      readonly description = 'mimics http output resolution';
      readonly outputSchema = HttpLikeOutput;
      readonly category = 'data';
      async execute(
        _config: z.infer<typeof HttpLikeConfig>,
        _ctx: StepExecutionContext,
      ): Promise<{ status: number; body: unknown }> {
        return { status: 200, body: {} };
      }
      override resolveOutputJsonSchema(config: Record<string, unknown>): Record<string, unknown> {
        const bodySchema = (config['bodySchema'] as Record<string, unknown> | undefined) ?? { type: 'object' };
        return { type: 'object', properties: { status: { type: 'integer' }, body: bodySchema } };
      }
    }

    function httpSetup() {
      const connectors = testRegistry({
        triggers: [new TestTrigger()],
        steps: [new SendStep(), new HttpLikeStep()],
      });
      return new ConfigValidator(connectors);
    }

    it('accepts a ref into a body field declared via resolveOutputJsonSchema', () => {
      const validator = httpSetup();
      const result = validator.validate({
        trigger: { type: 'TEST_EVENT', config: { channel: 'ch_1' } },
        steps: [
          { id: 'http1', type: 'HTTP_LIKE', config: { bodySchema: { type: 'object', properties: { field1: { type: 'string' } } } } },
          { id: 'step1', type: 'SEND_MSG', config: { to: '{{http1.output.body.field1}}', body: 'hi' } },
        ],
      });
      expect(result.valid).toBe(true);
    });

    it('accepts any body sub-path when the body shape is dynamic (unknown)', () => {
      const validator = httpSetup();
      const result = validator.validate({
        trigger: { type: 'TEST_EVENT', config: { channel: 'ch_1' } },
        steps: [
          { id: 'http1', type: 'HTTP_LIKE', config: {} }, // no bodySchema → body: { type: object }
          { id: 'step1', type: 'SEND_MSG', config: { to: '{{http1.output.body.anything.deep}}', body: 'hi' } },
        ],
      });
      expect(result.valid).toBe(true);
    });

    it('still flags a typo against a declared top-level output field', () => {
      const validator = httpSetup();
      const result = validator.validate({
        trigger: { type: 'TEST_EVENT', config: { channel: 'ch_1' } },
        steps: [
          { id: 'http1', type: 'HTTP_LIKE', config: {} },
          { id: 'step1', type: 'SEND_MSG', config: { to: '{{http1.output.stattus}}', body: 'hi' } }, // typo
        ],
      });
      expect(result.valid).toBe(false);
      expect(result.issues[0]!.code).toBe(ValidationIssueCode.UNKNOWN_REFERENCE);
    });
  });

  describe('a wait for a webhook cannot sit in a fan-out', () => {
    const waiting = (inside: Record<string, unknown>): WorkflowConfig => ({
      trigger: { type: 'TEST_EVENT', config: { channel: 'ch_1' } },
      steps: [inside as never],
    });

    it('refuses one inside a MAP, where its step id would name one wait per item', () => {
      const { validator } = setup();
      const result = validator.validate(
        waiting({
          id: 'each',
          type: BuiltinStepType.MAP,
          config: {
            source: 'trigger.items',
            body: [{ id: 'callback', type: BuiltinStepType.WAIT_FOR_WEBHOOK, config: {} }],
          },
        }),
      );
      expect(result.valid).toBe(false);
      const issue = result.issues.find((i) => i.location?.stepId === 'callback');
      expect(issue!.message).toContain('runs its steps for every item at once');
    });

    it('allows one inside a CYCLE, whose rounds park one at a time', () => {
      const { validator } = setup();
      const result = validator.validate(
        waiting({
          id: 'round',
          type: BuiltinStepType.CYCLE,
          config: { body: [{ id: 'callback', type: BuiltinStepType.WAIT_FOR_WEBHOOK, config: {} }] },
        }),
      );
      expect(result.valid).toBe(true);
    });

    it('allows one inside a LOOP, which also walks its body one item at a time', () => {
      const { validator } = setup();
      const result = validator.validate(
        waiting({
          id: 'each',
          type: BuiltinStepType.LOOP,
          config: {
            source: 'trigger.items',
            body: [{ id: 'callback', type: BuiltinStepType.WAIT_FOR_WEBHOOK, config: {} }],
          },
        }),
      );
      expect(result.valid).toBe(true);
    });

    it('allows one per PARALLEL branch, since a step id cannot repeat across them', () => {
      const { validator } = setup();
      const result = validator.validate(
        waiting({
          id: 'both',
          type: BuiltinStepType.PARALLEL,
          config: {
            branches: {
              a: [{ id: 'callback_a', type: BuiltinStepType.WAIT_FOR_WEBHOOK, config: {} }],
              b: [{ id: 'callback_b', type: BuiltinStepType.WAIT_FOR_WEBHOOK, config: {} }],
            },
          },
        }),
      );
      expect(result.valid).toBe(true);
    });

    it('allows one inside a plain branch, which parks at most once', () => {
      const { validator } = setup();
      const result = validator.validate(
        waiting({
          id: 'cond',
          type: BuiltinStepType.CONDITIONAL,
          config: {
            condition: { variable: '{{trigger.text}}', operator: 'eq', value: 'go' },
            if_true: [{ id: 'callback', type: BuiltinStepType.WAIT_FOR_WEBHOOK, config: {} }],
            if_false: [],
          },
        }),
      );
      expect(result.valid).toBe(true);
    });

    it('allows one at the top level', () => {
      const { validator } = setup();
      const result = validator.validate(
        waiting({ id: 'callback', type: BuiltinStepType.WAIT_FOR_WEBHOOK, config: {} }),
      );
      expect(result.valid).toBe(true);
    });
  });

  describe("referring to a CYCLE's result below it", () => {
    const declared = {
      type: 'object',
      properties: {
        build_id: { type: 'string' },
        attempts: { type: 'number' },
        logs: { type: 'array' },
      },
      required: ['build_id'],
    };

    /** A cycle that declares its result, finishes with it, then one step after. */
    const cycleThen = (after: Record<string, unknown>): WorkflowConfig => ({
      trigger: { type: 'TEST_EVENT', config: { channel: 'ch_1' } },
      steps: [
        {
          id: 'poll',
          type: BuiltinStepType.CYCLE,
          config: {
            input: { attempt: 1 },
            result: declared,
            body: [
              {
                id: 'done',
                type: BuiltinStepType.FINISH,
                config: { target: 'poll', with: { build_id: 'b1', attempts: 3, logs: [] } },
              },
            ],
          },
        },
        after,
      ] as never,
    });

    const send = (config: Record<string, unknown>): Record<string, unknown> => ({
      id: 'notify',
      type: 'SEND_MSG',
      config: { body: 'x', ...config },
    });

    it('resolves a declared result field', () => {
      const { validator } = setup();
      const result = validator.validate(
        cycleThen(send({ to: '{{steps.poll.output.result.build_id}}' })),
      );
      expect(result.valid).toBe(true);
    });

    it('resolves a state field, which is typed from the cycle input', () => {
      const { validator } = setup();
      const result = validator.validate(
        cycleThen(send({ to: 'someone', count: '{{steps.poll.output.state.attempt}}' })),
      );
      expect(result.valid).toBe(true);
    });

    it('rejects a field the result does not declare', () => {
      const { validator } = setup();
      const result = validator.validate(
        cycleThen(send({ to: '{{steps.poll.output.result.nope}}' })),
      );
      expect(result.valid).toBe(false);
      expect(result.issues[0]!.code).toBe(ValidationIssueCode.UNKNOWN_REFERENCE);
    });

    it('rejects a declared field used at the wrong type', () => {
      const { validator } = setup();
      // `logs` is a list and `count` takes a number. A string-typed field would
      // accept it — the platform is permissive there, which is not this
      // change's business; what matters is that the declared types are read.
      const result = validator.validate(
        cycleThen(send({ to: 'someone', count: '{{steps.poll.output.result.logs}}' })),
      );
      expect(result.valid).toBe(false);
      expect(result.issues[0]!.code).toBe(ValidationIssueCode.TYPE_MISMATCH);
    });

    it('still resolves branch step outputs, which share the same schema', () => {
      const { validator } = setup();
      const result = validator.validate(
        cycleThen(send({ to: '{{steps.poll.output.branches.body.steps.done.output.nope}}' })),
      );
      expect(result.valid).toBe(false);
      expect(result.issues[0]!.code).toBe(ValidationIssueCode.UNKNOWN_REFERENCE);
    });
  });

  describe('control flow branch validation', () => {
    it('validates steps inside branches', () => {
      const { validator } = setup();
      const config: WorkflowConfig = {
        trigger: { type: 'TEST_EVENT', config: { channel: 'ch_1' } },
        steps: [
          {
            id: 'cond1',
            type: BuiltinStepType.CONDITIONAL,
            config: {
              condition: { variable: '{{trigger.text}}', operator: 'eq', value: 'go' },
              if_true: [
                {
                  id: 'inner1',
                  type: 'SEND_MSG',
                  config: { to: '{{trigger.text}}', body: 'yes' },
                },
              ],
              if_false: [],
            },
          },
        ],
      };
      const result = validator.validate(config);
      expect(result.valid).toBe(true);
    });

    it('reports errors inside branches', () => {
      const { validator } = setup();
      const config: WorkflowConfig = {
        trigger: { type: 'TEST_EVENT', config: { channel: 'ch_1' } },
        steps: [
          {
            id: 'cond1',
            type: BuiltinStepType.CONDITIONAL,
            config: {
              condition: {},
              if_true: [
                {
                  id: 'inner1',
                  type: 'UNKNOWN_STEP',
                  config: {},
                },
              ],
              if_false: [],
            },
          },
        ],
      };
      const result = validator.validate(config);
      expect(result.valid).toBe(false);
      const unknownStep = result.issues.find((i) =>
        i.message.includes('Unknown step type'),
      );
      expect(unknownStep).toBeDefined();
      expect(unknownStep!.path).toContain('if_true');
    });

    it('steps inside branch cannot reference steps after the branch', () => {
      const { validator } = setup();
      const config: WorkflowConfig = {
        trigger: { type: 'TEST_EVENT', config: { channel: 'ch_1' } },
        steps: [
          {
            id: 'cond1',
            type: BuiltinStepType.CONDITIONAL,
            config: {
              // Valid condition so the SHAPE check passes; the test is
              // about catching the forward reference inside the branch.
              condition: { variable: '{{trigger.text}}', operator: 'eq', value: 'go' },
              if_true: [
                {
                  id: 'inner1',
                  type: 'SEND_MSG',
                  config: {
                    to: '{{afterBranch.output.msgId}}',
                    body: 'hi',
                  },
                },
              ],
              if_false: [],
            },
          },
          {
            id: 'afterBranch',
            type: 'SEND_MSG',
            config: { to: 'bob', body: 'after' },
          },
        ],
      };
      const result = validator.validate(config);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.code === ValidationIssueCode.FORWARD_REFERENCE))
        .toBe(true);
    });
  });

  describe('workflow ref is skipped (not validated against output schemas)', () => {
    it('does not report workflow.id, workflow.metadata or execution.id as forward refs', () => {
      const { validator } = setup();
      const result = validator.validate({
        trigger: { type: 'TEST_EVENT', config: { channel: 'ch_1' } },
        steps: [
          {
            id: 'step1',
            type: 'SEND_MSG',
            config: {
              to: '{{workflow.metadata.workspaceId}}',
              body: '{{workflow.id}} {{execution.id}}',
            },
          },
        ],
      });
      // No forward ref issues for workflow.*
      const fwdIssues = result.issues.filter(
        (i) => i.code === ValidationIssueCode.FORWARD_REFERENCE,
      );
      expect(fwdIssues).toHaveLength(0);
    });
  });

  describe('empty workflow', () => {
    it('validates empty steps array', () => {
      const { validator } = setup();
      const result = validator.validate({
        trigger: { type: 'TEST_EVENT', config: { channel: 'ch_1' } },
        steps: [],
      });
      expect(result.valid).toBe(true);
    });
  });

  describe('author citations', () => {
    const base = (citations: Record<string, { ref: string }[]>): WorkflowConfig => ({
      trigger: { type: 'TEST_EVENT', config: { channel: 'ch_1' } },
      steps: [
        { id: 'a', type: 'SEND_MSG', config: { to: '{{trigger.messageId}}', body: 'hi' } },
        { id: 'b', type: 'SEND_MSG', config: { to: 'x', body: 'hello' }, citations },
      ],
    });

    it('accepts a citation pointing at an earlier step output', () => {
      const { validator } = setup();
      const result = validator.validate(base({ body: [{ ref: '{{steps.a.output.msgId}}' }] }));
      expect(result.valid).toBe(true);
    });

    it('flags a citation ref whose path does not exist', () => {
      const { validator } = setup();
      const result = validator.validate(base({ body: [{ ref: '{{steps.a.output.nope}}' }] }));
      const issue = result.issues.find((i) => i.path.includes('citations'));
      expect(issue?.code).toBe(ValidationIssueCode.UNKNOWN_REFERENCE);
    });

    it('flags a citation targeting a non-existent field', () => {
      const { validator } = setup();
      const result = validator.validate(base({ nosuchfield: [{ ref: '{{steps.a.output.msgId}}' }] }));
      const issue = result.issues.find((i) => i.message.includes('does not exist in step'));
      expect(issue?.code).toBe(ValidationIssueCode.UNKNOWN_REFERENCE);
    });
  });

  describe('loops and jumps', () => {
    const trigger = { type: 'TEST_EVENT', config: { channel: 'ch_1' } };
    const goCondition = { variable: '{{trigger.text}}', operator: 'eq', value: 'go' };
    const jumpIssue = (steps: unknown[]) => {
      const { validator } = setup();
      const result = validator.validate({ trigger, steps: steps as WorkflowStepConfig[] });
      return result.issues.find((i) => i.code === ValidationIssueCode.INVALID_JUMP);
    };

    it("accepts refs to a CYCLE's round input inside its body", () => {
      const { validator } = setup();
      const result = validator.validate({
        trigger,
        steps: [
          {
            id: 'menu',
            type: BuiltinStepType.CYCLE,
            config: {
              input: { screen: 'root' },
              body: [
                {
                  id: 'route',
                  type: BuiltinStepType.SWITCH,
                  config: {
                    cases: [
                      {
                        condition: {
                          variable: '{{steps.__loop.output.input.screen}}',
                          operator: 'eq',
                          value: 'rides',
                        },
                        steps: [
                          {
                            id: 'ask_rides',
                            type: 'SEND_MSG',
                            config: { to: '{{steps.__loop.output.input.screen}}', body: 'rides' },
                          },
                        ],
                      },
                    ],
                    default: [
                      {
                        id: 'go',
                        type: BuiltinStepType.GO_TO,
                        config: { target: 'menu', with: { screen: 'rides' } },
                      },
                    ],
                  },
                },
              ],
            },
          },
        ] as unknown as WorkflowStepConfig[],
      });
      expect(result.issues).toEqual([]);
    });

    it('flags a ref to a round input key the CYCLE does not declare', () => {
      const { validator } = setup();
      const result = validator.validate({
        trigger,
        steps: [
          {
            id: 'menu',
            type: BuiltinStepType.CYCLE,
            config: {
              input: { screen: 'root' },
              body: [
                { id: 'ask', type: 'SEND_MSG', config: { to: '{{steps.__loop.output.input.scren}}', body: 'hi' } },
              ],
            },
          },
        ] as unknown as WorkflowStepConfig[],
      });
      expect(result.issues.map((i) => i.code)).toEqual([ValidationIssueCode.UNKNOWN_REFERENCE]);
    });

    it('accepts refs to the current LOOP item inside its body', () => {
      const { validator } = setup();
      const result = validator.validate({
        trigger,
        steps: [
          {
            id: 'each',
            type: BuiltinStepType.LOOP,
            config: {
              source: 'trigger.items',
              body: [
                { id: 'send', type: 'SEND_MSG', config: { to: '{{steps.__loop.output.currentItem}}', body: 'hi' } },
              ],
            },
          },
        ] as unknown as WorkflowStepConfig[],
      });
      expect(result.issues).toEqual([]);
    });

    it('lets a branch step reference an earlier step in the same branch', () => {
      const { validator } = setup();
      const result = validator.validate({
        trigger,
        steps: [
          {
            id: 'cond1',
            type: BuiltinStepType.CONDITIONAL,
            config: {
              condition: goCondition,
              if_true: [
                { id: 'first', type: 'SEND_MSG', config: { to: 'alice', body: 'one' } },
                { id: 'second', type: 'SEND_MSG', config: { to: '{{steps.first.output.msgId}}', body: 'two' } },
              ],
              if_false: [],
            },
          },
        ] as unknown as WorkflowStepConfig[],
      });
      expect(result.issues).toEqual([]);
    });

    it('rejects a jump whose target does not contain it', () => {
      const issue = jumpIssue([
        { id: 'menu', type: BuiltinStepType.CYCLE, config: { input: {}, body: [] } },
        { id: 'stray', type: BuiltinStepType.GO_TO, config: { target: 'menu' } },
      ]);
      expect(issue).toMatchObject({
        path: 'steps[1].config.target',
        location: { scope: 'step', stepId: 'stray', field: 'target' },
        message: 'GO_TO targets "menu", which doesn\'t contain step "stray". Choose a CYCLE around it.',
      });
    });

    it('rejects a jump that targets a step which is not a loop', () => {
      const issue = jumpIssue([
        {
          id: 'cond1',
          type: BuiltinStepType.CONDITIONAL,
          config: {
            condition: goCondition,
            if_true: [{ id: 'stop', type: BuiltinStepType.FINISH, config: { target: 'cond1' } }],
            if_false: [],
          },
        },
      ]);
      expect(issue).toMatchObject({
        path: 'steps[0].config.if_true[0].config.target',
        message: 'FINISH can\'t target "cond1": a CONDITIONAL doesn\'t catch jumps. Choose a CYCLE around step "stop".',
      });
    });

    it('rejects a jump that would leave a PARALLEL branch', () => {
      const issue = jumpIssue([
        {
          id: 'menu',
          type: BuiltinStepType.CYCLE,
          config: {
            input: {},
            body: [
              {
                id: 'fan',
                type: BuiltinStepType.PARALLEL,
                config: {
                  branches: {
                    left: [{ id: 'escape', type: BuiltinStepType.GO_TO, config: { target: 'menu' } }],
                  },
                },
              },
            ],
          },
        },
      ]);
      expect(issue?.message).toBe('GO_TO can\'t leave "fan": a PARALLEL runs its branches at the same time.');
    });

    it('rejects a GO_TO that does not carry the CYCLE input keys', () => {
      const issue = jumpIssue([
        {
          id: 'menu',
          type: BuiltinStepType.CYCLE,
          config: {
            input: { screen: 'root' },
            body: [{ id: 'go', type: BuiltinStepType.GO_TO, config: { target: 'menu', with: {} } }],
          },
        },
      ]);
      expect(issue).toMatchObject({
        path: 'steps[0].config.body[0].config.with',
        message: 'GO_TO must set "screen": every round starts from the CYCLE\'s input.',
      });
    });
  });
});

// ─── Trigger credentials and filter ───

const TEST_SECRET = defineCredential({
  connectorId: 'test',
  credType: 'TEST_SECRET',
  label: 'Test secret',
  authType: 'secret',
});

const SecretTriggerConfig = z.object({ secretName: z.string().optional() });

class SecretTrigger extends BaseTrigger<typeof SecretTriggerConfig> {
  readonly type = 'SECRET_EVENT';
  readonly configSchema = SecretTriggerConfig;
  readonly name = 'Secret event';
  readonly description = 'Needs a secret';
  readonly outputSchema = z.object({ kind: z.string() });
  readonly category = TriggerCategory.EVENT;
  override readonly credentialSlots = [{ name: 'secretName', required: true }] as const;
  override readonly credential = [TEST_SECRET];
}

describe('ConfigValidator — trigger credentials and filter', () => {
  const validator = () =>
    new ConfigValidator(testRegistry({ triggers: [new SecretTrigger()], credentials: [TEST_SECRET] }));

  const withTrigger = (trigger: WorkflowConfig['trigger']): WorkflowConfig => ({ trigger, steps: [] });

  it('reports a required trigger credential left empty, on its own field', () => {
    const result = validator().validate(withTrigger({ type: 'SECRET_EVENT', config: {} }));
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: ValidationIssueCode.MISSING_CREDENTIAL,
        path: 'trigger.config.secretName',
        location: { scope: 'trigger', field: 'secretName' },
      }),
    ]);
  });

  it('accepts a filter on trigger data and workflow variables', () => {
    const result = validator().validate(
      withTrigger({
        type: 'SECRET_EVENT',
        config: { secretName: 's' },
        filter: {
          conditions: {
            all: [
              { variable: '{{trigger.kind}}', operator: ConditionOperator.EQ, value: 'push' },
              { variable: '{{vars.region}}', operator: ConditionOperator.EXISTS },
            ],
          },
        },
      }),
    );
    expect(result.issues).toEqual([]);
  });

  it('rejects a filter condition on a step output, which does not exist before a run', () => {
    const result = validator().validate(
      withTrigger({
        type: 'SECRET_EVENT',
        config: { secretName: 's' },
        filter: {
          conditions: { variable: '{{steps.fetch.output.ok}}', operator: ConditionOperator.EXISTS },
        },
      }),
    );
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: ValidationIssueCode.INVALID_FILTER,
        location: { scope: 'trigger', field: 'filter' },
      }),
    ]);
  });

  it('rejects a filter condition with no variable chosen', () => {
    const result = validator().validate(
      withTrigger({
        type: 'SECRET_EVENT',
        config: { secretName: 's' },
        filter: { conditions: { any: [{ variable: '', operator: ConditionOperator.EQ, value: 'x' }] } },
      }),
    );
    expect(result.issues.map((i) => i.code)).toEqual([ValidationIssueCode.INVALID_FILTER]);
  });

  it('rejects a malformed filter', () => {
    const result = validator().validate(
      withTrigger({
        type: 'SECRET_EVENT',
        config: { secretName: 's' },
        filter: { conditions: { nope: true } } as never,
      }),
    );
    expect(result.issues.map((i) => i.code)).toContain(ValidationIssueCode.INVALID_FILTER);
  });
});

// ─── Expressions (`{% ... %}`) ───

const ItemsOutput = z.object({
  total: z.number(),
  items: z.array(z.object({ tag: z.string(), amount: z.number() })),
});

class ItemsStep extends BaseActionStep<typeof SendConfig, z.infer<typeof ItemsOutput>> {
  readonly type = 'GET_ITEMS';
  readonly configSchema = SendConfig;
  readonly name = 'Get Items';
  readonly description = 'Returns line items';
  readonly outputSchema = ItemsOutput;
  readonly category = 'data';

  async execute(): Promise<z.infer<typeof ItemsOutput>> {
    return { total: 0, items: [] };
  }
}

describe('ConfigValidator — expressions', () => {
  function exprSetup() {
    return new ConfigValidator(
      testRegistry({
        triggers: [new TestTrigger()],
        // CONDITIONAL comes from the builtin connector the test registry already
        // installs, so the condition case exercises the real step.
        steps: [new SendStep(), new ItemsStep()],
      }),
    );
  }

  /** A config whose second step's `count` / `body` hold whatever is under test. */
  function withConfig(config: Record<string, unknown>): WorkflowConfig {
    return {
      trigger: { type: 'TEST_EVENT', config: { channel: 'ch_1' } },
      steps: [
        { id: 'items', type: 'GET_ITEMS', config: { to: 'x', body: 'y' } },
        { id: 'send', type: 'SEND_MSG', config: { to: 'x', body: 'y', ...config } },
      ],
    } as unknown as WorkflowConfig;
  }

  const issues = (config: Record<string, unknown>) =>
    exprSetup().validate(withConfig(config)).issues;

  it('accepts an expression that sums a list of numbers', () => {
    expect(issues({ count: '{% $sum(steps.items.output.items.amount) %}' })).toEqual([]);
  });

  it('accepts an expression over several steps and a variable', () => {
    expect(
      issues({ body: 'Total {% $sum([steps.items.output.total, trigger.tags[0]]) %}' }),
    ).toEqual([]);
  });

  it('reads a property on a list as a property of each item', () => {
    // JSONata's rule. `items` is an array of objects, and `.amount` means "the
    // amount of each", which is what anyone sums.
    expect(issues({ count: '{% $count(steps.items.output.items.amount) %}' })).toEqual([]);
  });

  it('still rejects that same path in a {{ref}}, which cannot map', () => {
    // The two grammars differ here and must keep differing: `resolvePath` does a
    // property lookup on the array itself and finds nothing.
    const found = issues({ count: '{{steps.items.output.items.amount}}' });
    expect(found).toHaveLength(1);
    expect(found[0]!.code).toBe(ValidationIssueCode.UNKNOWN_REFERENCE);
  });

  it('accepts a filtered list, and still checks the field read off it', () => {
    // The shape the conversational Calculate form writes. The predicate is not
    // a reference and must not be read as one; the field after it is.
    expect(
      issues({ count: '{% $sum(steps.items.output.items[tag = "fee"].amount) %}' }),
    ).toEqual([]);

    const found = issues({ count: '{% $sum(steps.items.output.items[tag = "fee"].amuont) %}' });
    expect(found).toHaveLength(1);
    expect(found[0]!.code).toBe(ValidationIssueCode.UNKNOWN_REFERENCE);
    expect(found[0]!.message).toContain('amuont');
  });

  it('does not read a predicate field as a reference of its own', () => {
    // `tag` is a field of each item, not a step called "tag" — reading it as
    // one would report a forward reference on a correct expression.
    expect(issues({ count: '{% $count(steps.items.output.items[tag = "fee"]) %}' })).toEqual([]);
  });

  it('does not hold a reference inside an expression to the field type', () => {
    // `$sum` takes a list and gives a number. Type-checking the list against the
    // number field would reject exactly the expression worth writing.
    expect(issues({ count: '{% $sum(steps.items.output.items.amount) %}' })).toEqual([]);
  });

  // ─── Result and argument types ───

  const typeIssues = (config: Record<string, unknown>) =>
    issues(config).filter((i) => i.code === ValidationIssueCode.TYPE_MISMATCH);

  it('accepts a total in a number field, and the same total in a text field', () => {
    // Text is the sink: the runtime really does stringify into it.
    expect(typeIssues({ count: '{% $sum(steps.items.output.items.amount) %}' })).toEqual([]);
    expect(typeIssues({ body: '{% $sum(steps.items.output.items.amount) %}' })).toEqual([]);
  });

  it('refuses a result the field cannot hold', () => {
    // The gap this closes: text into a number field used to save clean and fail
    // at runtime with "Expected number, received string".
    const found = typeIssues({ count: '{% $uppercase(trigger.text) %}' });
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toContain('gives text');
    expect(found[0]!.message).toContain('expects a number');
  });

  it('refuses a list where a single value is expected', () => {
    const found = typeIssues({ count: '{% $split(trigger.text, ",") %}' });
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toContain('list of texts');
  });

  it('refuses adding up a list of the wrong element type', () => {
    // `items.amount` is numbers and `items.tag` is text — both are "a list" to
    // the old vocabulary, which is why this needed element types.
    const found = typeIssues({ count: '{% $sum(steps.items.output.items.tag) %}' });
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toContain('$sum needs list of numbers');
    expect(found[0]!.message).toContain('list of texts');

    expect(typeIssues({ count: '{% $sum(trigger.tags) %}' })).toHaveLength(1);
    expect(typeIssues({ body: '{% $join(steps.items.output.items.amount, ", ") %}' })).toHaveLength(1);
  });

  it('refuses a list where a single value belongs', () => {
    expect(typeIssues({ count: '{% $round(steps.items.output.items.amount, 2) %}' })).toHaveLength(1);
  });

  it('accepts one value where a list belongs, as JSONata does', () => {
    expect(typeIssues({ count: '{% $sum(steps.items.output.total) %}' })).toHaveLength(0);
  });

  it('refuses arithmetic on text', () => {
    const found = typeIssues({ count: '{% trigger.text * 2 %}' });
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toContain('needs numbers');
  });

  it('accepts what genuinely type-checks, including through a filter', () => {
    for (const expression of [
      '{% $count(steps.items.output.items) %}',
      '{% $sum(steps.items.output.items[tag = "fee"].amount) %}',
      '{% $round($sum(steps.items.output.items.amount) / $count(steps.items.output.items), 2) %}',
      '{% $sum([steps.items.output.total, trigger.tags[0] ? 1 : 0]) %}',
      '{% $max(steps.items.output.items.amount) %}',
    ]) {
      expect(typeIssues({ count: expression }), expression).toEqual([]);
    }
    expect(typeIssues({ body: '{% $join(trigger.tags, ", ") %}' })).toEqual([]);
    expect(typeIssues({ body: '{% $uppercase(trigger.text) %}' })).toEqual([]);
  });

  it('says nothing about a type it cannot read', () => {
    // Text into a text field: a real builtin, correctly typed.
    expect(typeIssues({ body: '{% $substringBefore(trigger.text, "@") %}' })).toEqual([]);

    for (const expression of [
      // A lambda has no type here, so the filter inside is simply not judged.
      '{% $count($filter(steps.items.output.items, function($i){ $i.amount > 1 })) %}',
      // `workflow` describes nothing, exactly as a {{ref}} into it is unchecked.
      '{% workflow.metadata.anything %}',
      // An undeclared reference: reported as an unknown reference, and not
      // complained about twice.
      '{% $sum(steps.items.output.nope) %}',
    ]) {
      expect(typeIssues({ count: expression }), expression).toEqual([]);
    }
  });

  it('still knows the result when it does not know the argument', () => {
    // `$uppercase` gives text whatever it is handed, so text in a number field
    // is a real mismatch even though the reference itself is unreadable. The
    // reference is reported separately, as unknown.
    const found = issues({ count: '{% $uppercase(steps.items.output.nope) %}' });
    expect(found.map((i) => i.code).sort()).toEqual([
      ValidationIssueCode.TYPE_MISMATCH,
      ValidationIssueCode.UNKNOWN_REFERENCE,
    ].sort());
  });

  it('reports a bad argument once, not twice', () => {
    // A wrong argument already explains the wrong result.
    expect(typeIssues({ count: '{% $sum(trigger.tags) %}' })).toHaveLength(1);
  });

  // ─── What an operator can hold ───

  it('refuses a comparison that can never be true', () => {
    // "is greater than" against text is not a near miss — the branch is
    // unreachable, so the author meant something else.
    const found = exprSetup().validate(
      withCondition({
        variable: '{% $uppercase(trigger.text) %}',
        operator: ConditionOperator.GT,
        value: 1,
      }),
    ).issues;
    expect(found).toHaveLength(1);
    expect(found[0]!.code).toBe(ValidationIssueCode.TYPE_MISMATCH);
    expect(found[0]!.message).toContain('can never be true');
    expect(found[0]!.message).toContain('is greater than');
  });

  it('refuses "starts with" against something that is not text', () => {
    expect(
      exprSetup()
        .validate(
          withCondition({
            variable: '{% $count(trigger.tags) %}',
            operator: ConditionOperator.STARTS_WITH,
            value: 'A',
          }),
        )
        .issues.some((i) => i.message.includes('can never be true')),
    ).toBe(true);
  });

  it('accepts a comparison that can hold', () => {
    for (const leaf of [
      { variable: '{% $sum(steps.items.output.items.amount) %}', operator: ConditionOperator.GT, value: 100 },
      { variable: '{{steps.items.output.total}}', operator: ConditionOperator.LTE, value: 5 },
      { variable: '{% $uppercase(trigger.text) %}', operator: ConditionOperator.STARTS_WITH, value: 'A' },
    ]) {
      expect(exprSetup().validate(withCondition(leaf)).issues, JSON.stringify(leaf)).toEqual([]);
    }
  });

  it('says nothing where the operator is not fussy', () => {
    // `EQ`/`NEQ` coerce on purpose — `5` equals `"5"` in this engine — and
    // `CONTAINS` holds for a substring *or* a list member, which is a union this
    // vocabulary cannot say. Both stay silent rather than guess.
    for (const operator of [
      ConditionOperator.EQ,
      ConditionOperator.NEQ,
      ConditionOperator.CONTAINS,
      ConditionOperator.NOT_CONTAINS,
      ConditionOperator.EXISTS,
      ConditionOperator.IS_EMPTY,
    ]) {
      expect(
        exprSetup().validate(
          withCondition({ variable: '{% $uppercase(trigger.text) %}', operator, value: 1 }),
        ).issues,
        operator,
      ).toEqual([]);
    }
  });

  it('says nothing about a type it cannot read', () => {
    expect(
      exprSetup().validate(
        withCondition({
          variable: '{{workflow.metadata.whatever}}',
          operator: ConditionOperator.GT,
          value: 1,
        }),
      ).issues,
    ).toEqual([]);
  });

  it('reads a trigger filter condition the same way', () => {
    const found = exprSetup().validate(
      withFilter('{% $uppercase(trigger.text) %}'),
    ).issues;
    expect(found.some((i) => i.message.includes('can never be true'))).toBe(true);
  });

  // ─── Outside a step: the trigger's own slots ───

  /** A filter whose single leaf is whatever is under test. */
  function withFilter(variable: unknown): WorkflowConfig {
    return {
      trigger: {
        type: 'TEST_EVENT',
        config: { channel: 'ch_1' },
        filter: { conditions: { variable, operator: ConditionOperator.GT, value: 1 } },
      },
      steps: [],
    } as unknown as WorkflowConfig;
  }

  it('accepts an expression in a trigger filter', () => {
    // Regression: reading the left side as a reference made every expression
    // "Choose a value for every filter condition", while the engine evaluated
    // it happily.
    expect(exprSetup().validate(withFilter('{% $count(trigger.tags) %}')).issues).toEqual([]);
  });

  it('still refuses a filter with nothing chosen', () => {
    // Caught by the schema now that it accepts only a reference or an
    // expression, so the message is the schema's rather than the visit's.
    const found = exprSetup().validate(withFilter('')).issues;
    expect(found.map((i) => i.code)).toEqual([ValidationIssueCode.INVALID_FILTER]);
    expect(found[0]!.message).toMatch(/reference|expression/);
  });

  it('confines a filter expression to what exists before a run', () => {
    // Every reference inside it, not just the leading one — an expression must
    // not reach further than a plain reference can.
    const found = exprSetup().validate(
      withFilter('{% $sum([trigger.tags[0], steps.items.output.total]) %}'),
    ).issues;
    expect(found.some((i) => i.code === ValidationIssueCode.INVALID_FILTER)).toBe(true);
    expect(found.find((i) => i.code === ValidationIssueCode.INVALID_FILTER)!.message).toContain(
      'only use trigger data',
    );
  });

  it('refuses an unsafe expression in a trigger filter', () => {
    // Nothing outside a step used to be read at all, so this reached the engine.
    for (const unsafe of ['{% $eval("1+1") %}', '{% ($f := function($n){ $f($n) }; $f(1)) %}']) {
      const found = exprSetup().validate(withFilter(unsafe)).issues;
      expect(
        found.some((i) => i.code === ValidationIssueCode.INVALID_EXPRESSION),
        unsafe,
      ).toBe(true);
    }
  });

  it('reads an expression in a delayed start, including what it produces', () => {
    const at = (anchor: string): WorkflowConfig =>
      ({
        trigger: {
          type: 'TEST_EVENT',
          config: { channel: 'ch_1' },
          start: { kind: 'at', anchor, ifPast: 'skip' },
        },
        steps: [],
      }) as unknown as WorkflowConfig;

    expect(exprSetup().validate(at('{% $string(trigger.messageId) %}')).issues).toEqual([]);
    // A list can never be a moment in time.
    expect(
      exprSetup()
        .validate(at('{% trigger.tags %}'))
        .issues.some((i) => i.code === ValidationIssueCode.TYPE_MISMATCH),
    ).toBe(true);
    // And it may read no further than a plain reference could.
    expect(
      exprSetup()
        .validate(at('{% $string(steps.items.output.total) %}'))
        .issues.some((i) => i.message.includes('only read trigger data')),
    ).toBe(true);
    // And an unsafe one is refused here too.
    expect(
      exprSetup()
        .validate(at('{% $eval("1") %}'))
        .issues.some((i) => i.code === ValidationIssueCode.INVALID_EXPRESSION),
    ).toBe(true);
  });

  it('reports a path the source schema does not have, naming the expression', () => {
    const found = issues({ count: '{% $sum(steps.items.output.items.amuont) %}' });
    expect(found).toHaveLength(1);
    expect(found[0]!.code).toBe(ValidationIssueCode.UNKNOWN_REFERENCE);
    expect(found[0]!.message).toContain('amuont');
    expect(found[0]!.message).toContain('{% $sum(steps.items.output.items.amuont) %}');
  });

  it('reports a forward reference inside an expression', () => {
    const config = {
      trigger: { type: 'TEST_EVENT', config: { channel: 'ch_1' } },
      steps: [
        { id: 'send', type: 'SEND_MSG', config: { to: 'x', body: 'y', count: '{% $sum(steps.items.output.total) %}' } },
        { id: 'items', type: 'GET_ITEMS', config: { to: 'x', body: 'y' } },
      ],
    } as unknown as WorkflowConfig;
    const found = exprSetup().validate(config).issues;
    expect(found).toHaveLength(1);
    expect(found[0]!.code).toBe(ValidationIssueCode.FORWARD_REFERENCE);
  });

  it('ignores a bare step id, which is not a reference inside an expression', () => {
    // Shorthand is deliberately unsupported here, so this is not reported as a
    // bad reference — it simply reads as nothing at runtime.
    expect(issues({ count: '{% $sum(items.output.total) %}' })).toEqual([]);
  });

  it('reports an expression that cannot be read', () => {
    const found = issues({ count: '{% $sum(steps.items.output.total %}' });
    expect(found).toHaveLength(1);
    expect(found[0]!.code).toBe(ValidationIssueCode.INVALID_EXPRESSION);
    expect(found[0]!.message).toContain('Expected');
  });

  it('refuses a named function', () => {
    const found = issues({ count: '{% ($f := function($n){ $f($n + 1) }; $f(0)) %}' });
    expect(found).toHaveLength(1);
    expect(found[0]!.code).toBe(ValidationIssueCode.INVALID_EXPRESSION);
    expect(found[0]!.message).toContain('named function');
  });

  it('refuses $eval', () => {
    const found = issues({ body: '{% $eval("1+1") %}' });
    expect(found).toHaveLength(1);
    expect(found[0]!.code).toBe(ValidationIssueCode.INVALID_EXPRESSION);
    expect(found[0]!.message).toContain('$eval');
  });

  it('allows an inline function, which is what the list helpers need', () => {
    expect(
      issues({
        body: '{% $count($filter(steps.items.output.items, function($i){ $i.amount > 10 })) %}',
      }),
    ).toEqual([]);
  });

  /** A CONDITIONAL whose single leaf is whatever is under test. */
  function withCondition(leaf: Record<string, unknown>): WorkflowConfig {
    return {
      trigger: { type: 'TEST_EVENT', config: { channel: 'ch_1' } },
      steps: [
        { id: 'items', type: 'GET_ITEMS', config: { to: 'x', body: 'y' } },
        {
          id: 'branch',
          type: BuiltinStepType.CONDITIONAL,
          config: { condition: leaf, if_true: [] },
        },
      ],
    } as unknown as WorkflowConfig;
  }

  it('accepts an expression in a condition, on either side', () => {
    expect(
      exprSetup().validate(
        withCondition({
          variable: '{% $sum(steps.items.output.items.amount) %}',
          operator: ConditionOperator.GT,
          value: '{% $count(steps.items.output.items) * 100 %}',
        }),
      ).issues,
    ).toEqual([]);
  });

  it('still reports a bad expression inside a condition', () => {
    const found = exprSetup().validate(
      withCondition({
        variable: '{% $sum(steps.items.output.items.amuont) %}',
        operator: ConditionOperator.GT,
        value: 10,
      }),
    ).issues;
    expect(found).toHaveLength(1);
    expect(found[0]!.code).toBe(ValidationIssueCode.UNKNOWN_REFERENCE);
    expect(found[0]!.message).toContain('amuont');
  });

  it('refuses a named function inside a condition too', () => {
    const found = exprSetup().validate(
      withCondition({
        variable: '{% ($f := function($n){ $f($n + 1) }; $f(0)) %}',
        operator: ConditionOperator.GT,
        value: 10,
      }),
    ).issues;
    expect(found.some((i) => i.code === ValidationIssueCode.INVALID_EXPRESSION)).toBe(true);
  });

  it('leaves a config with no expressions exactly as it validated before', () => {
    expect(issues({ count: '{{steps.items.output.total}}' })).toEqual([]);
  });
});
