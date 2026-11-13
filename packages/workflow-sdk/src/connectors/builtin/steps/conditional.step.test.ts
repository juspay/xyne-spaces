import { describe, it, expect, vi } from 'vitest';
import { ConditionalStep, ConditionalStepConfigSchema } from './conditional.step.js';
import { createMockControlFlowContext } from '../../../testing/mock-step-context.js';

describe('ConditionalStep', () => {
  const step = new ConditionalStep();

  describe('metadata', () => {
    it('declares CONDITIONAL type + control category + branch outputs', () => {
      expect(step.type).toBe('CONDITIONAL');
      expect(step.category).toBe('control');
      expect(step.declaredOutputs).toEqual([
        { key: 'if_true', label: 'When true' },
        { key: 'if_false', label: 'When false' },
      ]);
    });

    it('exposes both branches via getBranches() for the config validator', () => {
      const branches = step.getBranches!({
        if_true: [{ id: 'a', type: 'CODE' }],
        if_false: [{ id: 'b', type: 'CODE' }],
      });
      expect(branches['if_true']).toHaveLength(1);
      expect(branches['if_false']).toHaveLength(1);
    });

    it('getBranches() returns empty arrays when branches are omitted', () => {
      const branches = step.getBranches!({});
      expect(branches['if_true']).toEqual([]);
      expect(branches['if_false']).toEqual([]);
    });
  });

  describe('config schema', () => {
    it('accepts a leaf condition + both branches', () => {
      const cfg = ConditionalStepConfigSchema.parse({
        condition: {
          variable: '{{steps.fetch.output.status}}',
          operator: 'eq',
          value: 200,
        },
        if_true: [{ id: 'a', type: 'CODE', config: {} }],
        if_false: [{ id: 'b', type: 'CODE', config: {} }],
      });
      expect(cfg.if_true).toHaveLength(1);
      expect(cfg.if_false).toHaveLength(1);
    });

    it('accepts nested all/any composites', () => {
      const cfg = ConditionalStepConfigSchema.parse({
        condition: {
          all: [
            { variable: '{{trigger.body.userId}}', operator: 'neq', value: null },
            { any: [
              { variable: '{{trigger.body.role}}', operator: 'eq', value: 'admin' },
              { variable: '{{trigger.body.role}}', operator: 'eq', value: 'owner' },
            ] },
          ],
        },
        if_true: [],
      });
      expect(cfg.condition).toBeDefined();
    });

    it('rejects raw (un-templated) variable strings', () => {
      // LeafConditionSchema enforces variableRefStringSchema — must look like {{...}}.
      expect(() =>
        ConditionalStepConfigSchema.parse({
          condition: { variable: 'not a ref', operator: 'eq', value: 1 },
          if_true: [],
        }),
      ).toThrow();
    });
  });

  describe('execute', () => {
    it('walks if_true when the condition resolves true', async () => {
      const walkBranch = vi.fn().mockResolvedValue(undefined);
      const ctx = createMockControlFlowContext({
        workflow: {
          workflow: { id: 'wf', metadata: {} },
          trigger: { type: 'TEST' },
          steps: { fetch: { type: 'CODE', output: { status: 200 } } },
        },
        walkBranch,
      });

      const output = await step.execute(
        {
          condition: {
            variable: '{{steps.fetch.output.status}}',
            operator: 'eq',
            value: 200,
          },
          if_true: [{ id: 'success', type: 'CODE' } as never],
          if_false: [{ id: 'failure', type: 'CODE' } as never],
        },
        ctx,
      );

      expect(output).toMatchObject({ branch: 'if_true', evaluated: true });
      expect(walkBranch).toHaveBeenCalledTimes(1);
      expect(walkBranch.mock.calls[0]![2]).toBe('if_true');
    });

    it('walks if_false when the condition resolves false', async () => {
      const walkBranch = vi.fn().mockResolvedValue(undefined);
      const ctx = createMockControlFlowContext({
        workflow: {
          workflow: { id: 'wf', metadata: {} },
          trigger: { type: 'TEST' },
          steps: { fetch: { type: 'CODE', output: { status: 500 } } },
        },
        walkBranch,
      });

      const output = await step.execute(
        {
          condition: {
            variable: '{{steps.fetch.output.status}}',
            operator: 'eq',
            value: 200,
          },
          if_true: [{ id: 'success', type: 'CODE' } as never],
          if_false: [{ id: 'failure', type: 'CODE' } as never],
        },
        ctx,
      );

      expect(output).toMatchObject({ branch: 'if_false', evaluated: false });
      expect(walkBranch.mock.calls[0]![2]).toBe('if_false');
    });

    it('returns branch=none when condition is false and if_false is omitted', async () => {
      const walkBranch = vi.fn().mockResolvedValue(undefined);
      const ctx = createMockControlFlowContext({
        workflow: {
          workflow: { id: 'wf', metadata: {} },
          trigger: { type: 'TEST' },
          steps: { fetch: { type: 'CODE', output: { status: 500 } } },
        },
        walkBranch,
      });

      const output = await step.execute(
        {
          condition: {
            variable: '{{steps.fetch.output.status}}',
            operator: 'eq',
            value: 200,
          },
          if_true: [{ id: 'success', type: 'CODE' } as never],
        },
        ctx,
      );

      expect(output).toMatchObject({ branch: 'none', evaluated: false });
      expect(walkBranch).not.toHaveBeenCalled();
    });

    it('returns branch=none when condition is false and if_false is empty', async () => {
      const walkBranch = vi.fn().mockResolvedValue(undefined);
      const ctx = createMockControlFlowContext({
        workflow: {
          workflow: { id: 'wf', metadata: {} },
          trigger: { type: 'TEST' },
          steps: { fetch: { type: 'CODE', output: { status: 500 } } },
        },
        walkBranch,
      });

      const output = await step.execute(
        {
          condition: {
            variable: '{{steps.fetch.output.status}}',
            operator: 'eq',
            value: 200,
          },
          if_true: [],
          if_false: [],
        },
        ctx,
      );

      expect(output).toMatchObject({ branch: 'none', evaluated: false });
      expect(walkBranch).not.toHaveBeenCalled();
    });

    it('honors nested all/any composites', async () => {
      const walkBranch = vi.fn().mockResolvedValue(undefined);
      const ctx = createMockControlFlowContext({
        workflow: {
          workflow: { id: 'wf', metadata: {} },
          trigger: {
            type: 'TEST',
            body: { userId: 42, role: 'admin' },
          },
          steps: {},
        },
        walkBranch,
      });

      const output = await step.execute(
        {
          condition: {
            all: [
              { variable: '{{trigger.body.userId}}', operator: 'neq', value: null },
              { any: [
                { variable: '{{trigger.body.role}}', operator: 'eq', value: 'admin' },
                { variable: '{{trigger.body.role}}', operator: 'eq', value: 'owner' },
              ] },
            ],
          },
          if_true: [{ id: 'a', type: 'CODE' } as never],
        },
        ctx,
      );

      expect(output.branch).toBe('if_true');
      expect(output.evaluated).toBe(true);
    });
  });
});
