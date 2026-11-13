import { describe, it, expect, vi } from 'vitest';
import { SwitchStep, SwitchStepConfigSchema } from './switch.step.js';
import { createMockControlFlowContext } from '../../../testing/mock-step-context.js';

describe('SwitchStep', () => {
  const step = new SwitchStep();

  describe('metadata', () => {
    it('declares SWITCH type + control category', () => {
      expect(step.type).toBe('SWITCH');
      expect(step.category).toBe('control');
      expect(step.declaredOutputs.map((o) => o.key)).toEqual([
        'branch',
        'caseIndex',
        'label',
      ]);
    });

    it('getBranches() exposes each case_N + default for the config validator', () => {
      const branches = step.getBranches!({
        cases: [
          { condition: {}, steps: [{ id: 'a', type: 'CODE' }] },
          { condition: {}, steps: [{ id: 'b', type: 'CODE' }] },
        ],
        default: [{ id: 'd', type: 'CODE' }],
      });
      expect(Object.keys(branches).sort()).toEqual([
        'case_0',
        'case_1',
        'default',
      ]);
      expect(branches['case_0']).toHaveLength(1);
      expect(branches['case_1']).toHaveLength(1);
      expect(branches['default']).toHaveLength(1);
    });

    it('getBranches() handles cases=[] (only default present)', () => {
      const branches = step.getBranches!({ cases: [], default: [] });
      expect(Object.keys(branches)).toEqual(['default']);
      expect(branches['default']).toEqual([]);
    });
  });

  describe('config schema', () => {
    it('accepts multi-case + default', () => {
      const cfg = SwitchStepConfigSchema.parse({
        cases: [
          {
            condition: {
              variable: '{{steps.fetch.output.status}}',
              operator: 'eq',
              value: 200,
            },
            label: 'OK',
            steps: [{ id: 'a', type: 'CODE', config: {} }],
          },
          {
            condition: {
              variable: '{{steps.fetch.output.status}}',
              operator: 'gte',
              value: 500,
            },
            steps: [{ id: 'b', type: 'CODE', config: {} }],
          },
        ],
        default: [{ id: 'd', type: 'CODE', config: {} }],
      });
      expect(cfg.cases).toHaveLength(2);
      expect(cfg.cases[0]!.label).toBe('OK');
      expect(cfg.default).toHaveLength(1);
    });

    it('accepts empty cases (default-only switch)', () => {
      const cfg = SwitchStepConfigSchema.parse({
        cases: [],
        default: [{ id: 'd', type: 'CODE', config: {} }],
      });
      expect(cfg.cases).toEqual([]);
      expect(cfg.default).toHaveLength(1);
    });

    it('accepts empty default (no-op fallback)', () => {
      const cfg = SwitchStepConfigSchema.parse({
        cases: [
          {
            condition: {
              variable: '{{trigger.body.x}}',
              operator: 'exists',
            },
            steps: [],
          },
        ],
        default: [],
      });
      expect(cfg.default).toEqual([]);
    });

    it('accepts nested all/any composites in case condition', () => {
      const cfg = SwitchStepConfigSchema.parse({
        cases: [
          {
            condition: {
              all: [
                { variable: '{{trigger.body.role}}', operator: 'eq', value: 'admin' },
                { any: [
                  { variable: '{{trigger.body.region}}', operator: 'eq', value: 'US' },
                  { variable: '{{trigger.body.region}}', operator: 'eq', value: 'CA' },
                ] },
              ],
            },
            steps: [],
          },
        ],
        default: [],
      });
      expect(cfg.cases[0]!.condition).toBeDefined();
    });

    it('rejects raw (un-templated) variable strings inside a case', () => {
      expect(() =>
        SwitchStepConfigSchema.parse({
          cases: [
            { condition: { variable: 'plain_string', operator: 'eq', value: 1 }, steps: [] },
          ],
          default: [],
        }),
      ).toThrow();
    });

    it('rejects when default is missing entirely', () => {
      expect(() =>
        SwitchStepConfigSchema.parse({
          cases: [],
        }),
      ).toThrow();
    });
  });

  describe('execute', () => {
    const workflow = (status: number) => ({
      workflow: { id: 'wf', metadata: {} },
      trigger: { type: 'TEST' },
      steps: { fetch: { type: 'CODE', output: { status } } },
    });

    it('runs the first matching case', async () => {
      const walkBranch = vi.fn().mockResolvedValue(undefined);
      const ctx = createMockControlFlowContext({ workflow: workflow(200), walkBranch });

      const output = await step.execute(
        {
          cases: [
            {
              condition: { variable: '{{steps.fetch.output.status}}', operator: 'eq', value: 200 },
              label: 'OK',
              steps: [{ id: 'ok', type: 'CODE' } as never],
            },
            {
              condition: { variable: '{{steps.fetch.output.status}}', operator: 'gte', value: 500 },
              steps: [{ id: 'err', type: 'CODE' } as never],
            },
          ],
          default: [{ id: 'fallback', type: 'CODE' } as never],
        },
        ctx,
      );

      expect(output).toMatchObject({ branch: 'case_0', caseIndex: 0, label: 'OK' });
      expect(walkBranch).toHaveBeenCalledTimes(1);
      expect(walkBranch.mock.calls[0]![2]).toBe('case_0');
    });

    it('skips earlier non-matching cases and runs the first that matches', async () => {
      const walkBranch = vi.fn().mockResolvedValue(undefined);
      const ctx = createMockControlFlowContext({ workflow: workflow(503), walkBranch });

      const output = await step.execute(
        {
          cases: [
            {
              condition: { variable: '{{steps.fetch.output.status}}', operator: 'eq', value: 200 },
              steps: [{ id: 'ok', type: 'CODE' } as never],
            },
            {
              condition: { variable: '{{steps.fetch.output.status}}', operator: 'gte', value: 500 },
              steps: [{ id: 'err', type: 'CODE' } as never],
            },
          ],
          default: [{ id: 'fallback', type: 'CODE' } as never],
        },
        ctx,
      );

      expect(output).toMatchObject({ branch: 'case_1', caseIndex: 1, label: null });
      expect(walkBranch).toHaveBeenCalledTimes(1);
      expect(walkBranch.mock.calls[0]![2]).toBe('case_1');
    });

    it('first-match-wins: does not run later matching cases', async () => {
      const walkBranch = vi.fn().mockResolvedValue(undefined);
      const ctx = createMockControlFlowContext({ workflow: workflow(200), walkBranch });

      // Both cases match — only case_0 should run.
      const output = await step.execute(
        {
          cases: [
            {
              condition: { variable: '{{steps.fetch.output.status}}', operator: 'gte', value: 100 },
              steps: [{ id: 'first', type: 'CODE' } as never],
            },
            {
              condition: { variable: '{{steps.fetch.output.status}}', operator: 'lt', value: 300 },
              steps: [{ id: 'second', type: 'CODE' } as never],
            },
          ],
          default: [],
        },
        ctx,
      );

      expect(output.branch).toBe('case_0');
      expect(walkBranch).toHaveBeenCalledTimes(1);
      expect(walkBranch.mock.calls[0]![2]).toBe('case_0');
    });

    it('falls through to default when no case matches', async () => {
      const walkBranch = vi.fn().mockResolvedValue(undefined);
      const ctx = createMockControlFlowContext({ workflow: workflow(404), walkBranch });

      const output = await step.execute(
        {
          cases: [
            {
              condition: { variable: '{{steps.fetch.output.status}}', operator: 'eq', value: 200 },
              steps: [{ id: 'ok', type: 'CODE' } as never],
            },
            {
              condition: { variable: '{{steps.fetch.output.status}}', operator: 'gte', value: 500 },
              steps: [{ id: 'err', type: 'CODE' } as never],
            },
          ],
          default: [{ id: 'fallback', type: 'CODE' } as never],
        },
        ctx,
      );

      expect(output).toMatchObject({ branch: 'default', caseIndex: null, label: null });
      expect(walkBranch).toHaveBeenCalledTimes(1);
      expect(walkBranch.mock.calls[0]![2]).toBe('default');
    });

    it('returns default with no walkBranch call when default is empty and no case matches', async () => {
      const walkBranch = vi.fn().mockResolvedValue(undefined);
      const ctx = createMockControlFlowContext({ workflow: workflow(404), walkBranch });

      const output = await step.execute(
        {
          cases: [
            {
              condition: { variable: '{{steps.fetch.output.status}}', operator: 'eq', value: 200 },
              steps: [{ id: 'ok', type: 'CODE' } as never],
            },
          ],
          default: [],
        },
        ctx,
      );

      expect(output).toMatchObject({ branch: 'default', caseIndex: null, label: null });
      expect(walkBranch).not.toHaveBeenCalled();
    });

    it('skips walkBranch when the matching case has empty steps', async () => {
      const walkBranch = vi.fn().mockResolvedValue(undefined);
      const ctx = createMockControlFlowContext({ workflow: workflow(200), walkBranch });

      const output = await step.execute(
        {
          cases: [
            {
              condition: { variable: '{{steps.fetch.output.status}}', operator: 'eq', value: 200 },
              label: 'noop',
              steps: [],
            },
          ],
          default: [{ id: 'fallback', type: 'CODE' } as never],
        },
        ctx,
      );

      expect(output).toMatchObject({ branch: 'case_0', caseIndex: 0, label: 'noop' });
      expect(walkBranch).not.toHaveBeenCalled();
    });

    it('default-only switch (no cases) always runs default', async () => {
      const walkBranch = vi.fn().mockResolvedValue(undefined);
      const ctx = createMockControlFlowContext({ workflow: workflow(200), walkBranch });

      const output = await step.execute(
        {
          cases: [],
          default: [{ id: 'fallback', type: 'CODE' } as never],
        },
        ctx,
      );

      expect(output).toMatchObject({ branch: 'default', caseIndex: null, label: null });
      expect(walkBranch).toHaveBeenCalledTimes(1);
      expect(walkBranch.mock.calls[0]![2]).toBe('default');
    });

    it('honors nested all/any composites in case conditions', async () => {
      const walkBranch = vi.fn().mockResolvedValue(undefined);
      const ctx = createMockControlFlowContext({
        workflow: {
          workflow: { id: 'wf', metadata: {} },
          trigger: { type: 'TEST', body: { role: 'admin', region: 'US' } },
          steps: {},
        },
        walkBranch,
      });

      const output = await step.execute(
        {
          cases: [
            {
              condition: {
                all: [
                  { variable: '{{trigger.body.role}}', operator: 'eq', value: 'admin' },
                  { any: [
                    { variable: '{{trigger.body.region}}', operator: 'eq', value: 'US' },
                    { variable: '{{trigger.body.region}}', operator: 'eq', value: 'CA' },
                  ] },
                ],
              },
              label: 'admin-na',
              steps: [{ id: 'a', type: 'CODE' } as never],
            },
          ],
          default: [],
        },
        ctx,
      );

      expect(output.branch).toBe('case_0');
      expect(output.label).toBe('admin-na');
      expect(walkBranch.mock.calls[0]![2]).toBe('case_0');
    });
  });
});
