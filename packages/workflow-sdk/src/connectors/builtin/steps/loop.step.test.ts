import { describe, it, expect } from 'vitest';
import { LoopStep, LoopStepConfigSchema } from './loop.step.js';
import { BranchSignal } from '../../../engine/branch-signal.js';
import { createMockControlFlowContext } from '../../../testing/mock-step-context.js';
import { createMockContext } from '../../../testing/mock-context.js';
import type { WorkflowContext } from '../../../types/context.js';

describe('LoopStep', () => {
  const step = new LoopStep();

  it('has correct metadata', () => {
    expect(step.type).toBe('LOOP');
    expect(step.kind).toBe('control');
    expect(step.category).toBe('control');
    expect(step.declaredOutputs).toEqual([{ key: 'body', label: 'For each item' }]);
  });

  describe('config schema', () => {
    it('validates valid config', () => {
      const config = LoopStepConfigSchema.parse({
        source: 'steps.fetch.output.items',
        body: [{ id: 's1', type: 'ECHO', config: {} }],
      });
      expect(config.maxIterations).toBe(1000);
    });

    it('rejects empty source', () => {
      expect(() =>
        LoopStepConfigSchema.parse({ source: '', body: [] }),
      ).toThrow();
    });
  });

  describe('getBranches', () => {
    it('returns body branch', () => {
      const branches = step.getBranches!({
        body: [{ id: 's1', type: 'ECHO', config: {} }],
      });
      expect(branches['body']).toHaveLength(1);
    });

    it('returns empty body when not set', () => {
      const branches = step.getBranches!({});
      expect(branches['body']).toEqual([]);
    });
  });

  describe('execute', () => {
    it('iterates array and calls walkBranch per item', async () => {
      const ctx = createMockControlFlowContext({
        workflow: createMockContext({
          steps: {
            fetch: {
              type: 'HTTP',
              output: { items: ['a', 'b', 'c'] },
            },
          },
        }),
      });

      const result = await step.execute(
        {
          source: 'steps.fetch.output.items',
          body: [],
          maxIterations: 1000,
        },
        ctx,
      );

      expect(result.count).toBe(3);
      expect(result.results).toEqual(['a', 'b', 'c']);
      expect(ctx.walkBranchCalls).toHaveLength(3);
      // All walkBranch calls use branchKey 'body'
      expect(ctx.walkBranchCalls[0]!.branchKey).toBe('body');
    });

    it('respects maxIterations', async () => {
      const ctx = createMockControlFlowContext({
        workflow: createMockContext({
          steps: {
            data: {
              type: 'TEST',
              output: { list: [1, 2, 3, 4, 5] },
            },
          },
        }),
      });

      const result = await step.execute(
        {
          source: 'steps.data.output.list',
          body: [],
          maxIterations: 2,
        },
        ctx,
      );

      expect(result.count).toBe(2);
      expect(result.results).toEqual([1, 2]);
      expect(ctx.walkBranchCalls).toHaveLength(2);
    });

    it('throws when source is not an array', async () => {
      const ctx = createMockControlFlowContext({
        workflow: createMockContext({
          steps: {
            s1: { type: 'TEST', output: { val: 'not-array' } },
          },
        }),
      });

      await expect(
        step.execute(
          { source: 'steps.s1.output.val', body: [], maxIterations: 1000 },
          ctx,
        ),
      ).rejects.toThrow('did not resolve to an array');
    });

    it('handles empty array', async () => {
      const ctx = createMockControlFlowContext({
        workflow: createMockContext({
          steps: {
            s1: { type: 'TEST', output: { items: [] } },
          },
        }),
      });

      const result = await step.execute(
        { source: 'steps.s1.output.items', body: [], maxIterations: 1000 },
        ctx,
      );

      expect(result.count).toBe(0);
      expect(result.results).toEqual([]);
      expect(ctx.walkBranchCalls).toHaveLength(0);
    });

    it('sets __loop metadata during iteration', async () => {
      const loopMetas: unknown[] = [];
      const ctx = createMockControlFlowContext({
        workflow: createMockContext({
          steps: {
            s1: { type: 'TEST', output: { items: ['x', 'y'] } },
          },
        }),
        walkBranch: async (_steps, workflow) => {
          loopMetas.push(
            (workflow.steps as Record<string, unknown>)['__loop'],
          );
        },
      });

      await step.execute(
        { source: 'steps.s1.output.items', body: [], maxIterations: 1000 },
        ctx,
      );

      expect(loopMetas).toHaveLength(2);
      const first = loopMetas[0] as { output: { currentItem: unknown; currentIndex: number } };
      expect(first.output.currentItem).toBe('x');
      expect(first.output.currentIndex).toBe(0);
      const second = loopMetas[1] as { output: { currentItem: unknown; currentIndex: number } };
      expect(second.output.currentItem).toBe('y');
      expect(second.output.currentIndex).toBe(1);
    });

    it('cleans up __loop metadata after execution', async () => {
      const ctx = createMockControlFlowContext({
        workflow: createMockContext({
          steps: {
            s1: { type: 'TEST', output: { items: ['a'] } },
          },
        }),
      });

      await step.execute(
        { source: 'steps.s1.output.items', body: [], maxIterations: 1000 },
        ctx,
      );

      expect(
        (ctx.workflow.steps as Record<string, unknown>)['__loop'],
      ).toBeUndefined();
    });
  });

  describe('branch scope', () => {
    // LOOP has always injected `__loop` into its body at runtime; declaring it
    // is what lets the validator and the variable picker see it too. Jumps are
    // deliberately NOT supported here — only CYCLE catches GO_TO/FINISH.
    it('declares __loop so the body can reference it', () => {
      expect(step.branchScopeSchemas()['__loop.output']).toEqual({
        type: 'object',
        properties: {
          currentItem: {},
          currentIndex: { type: 'number' },
          totalItems: { type: 'number' },
        },
      });
    });

    it('is not a jump target: a jump unwinds past it', async () => {
      const ctx = createMockControlFlowContext({
        runtime: { stepId: 'loop1' },
        workflow: createMockContext({
          steps: { s1: { type: 'TEST', output: { items: ['a', 'b', 'c'] } } },
        }),
        walkBranch: async () => {
          throw new BranchSignal({ kind: 'goto', target: 'loop1', value: {} });
        },
      });

      // Even aimed at this loop's own id, the signal is not caught here.
      await expect(
        step.execute({ source: 'steps.s1.output.items', body: [], maxIterations: 1000 }, ctx),
      ).rejects.toMatchObject({ signal: { target: 'loop1' } });
    });
  });
});
