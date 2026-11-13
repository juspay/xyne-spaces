import { describe, it, expect } from 'vitest';
import { MapStep, MapStepConfigSchema } from './map.step.js';
import type { MapStepOutput } from './map.step.js';
import { createMockControlFlowContext } from '../../../testing/mock-step-context.js';
import { createMockContext } from '../../../testing/mock-context.js';
import type { WorkflowStepConfig } from '../../../types/workflow-config.js';
import { PauseStep } from '../../../engine/pause-step.js';
import { GateCategory } from '../../../types/known-types.js';

describe('MapStep', () => {
  const step = new MapStep();

  it('has correct metadata', () => {
    expect(step.type).toBe('MAP');
    expect(step.kind).toBe('control');
    expect(step.category).toBe('control');
    expect(step.branchModel).toBe('map');
    expect(step.declaredOutputs).toEqual([{ key: 'body', label: 'For each item' }]);
  });

  describe('config schema', () => {
    it('accepts a source and body', () => {
      const c = MapStepConfigSchema.parse({ source: 'steps.fetch.output.owners', body: [] });
      expect(c.source).toBe('steps.fetch.output.owners');
      expect(c.body).toEqual([]);
    });
    it('rejects an empty source', () => {
      expect(() => MapStepConfigSchema.parse({ source: '', body: [] })).toThrow();
    });
    it('leaves concurrency undefined when omitted, and rejects non-positive values', () => {
      expect(MapStepConfigSchema.parse({ source: 's.a', body: [] }).concurrency).toBeUndefined();
      expect(MapStepConfigSchema.parse({ source: 's.a', body: [], concurrency: 1 }).concurrency).toBe(1);
      expect(() => MapStepConfigSchema.parse({ source: 's.a', body: [], concurrency: 0 })).toThrow();
      expect(() => MapStepConfigSchema.parse({ source: 's.a', body: [], concurrency: 1.5 })).toThrow();
    });
  });

  describe('getBranches', () => {
    it('returns the body branch', () => {
      const b = step.getBranches!({ body: [{ id: 's1', type: 'ECHO', config: {} }] });
      expect(b['body']).toHaveLength(1);
    });
  });

  describe('execute', () => {
    it('maps over the array concurrently — one result per item, keyed by step id', async () => {
      const branchKeys: string[] = [];
      const ctx = createMockControlFlowContext({
        workflow: createMockContext({
          steps: { fetch: { type: 'HTTP', output: { owners: ['a', 'b', 'c'] } } },
        }),
        walkBranch: async (steps, context, branchKey, iter) => {
          branchKeys.push(branchKey ?? 'default');
          const cfgs = steps as unknown as WorkflowStepConfig[];
          const currentItem = (context.steps['__map'] as { output?: { currentItem?: unknown } } | undefined)?.output?.currentItem;
          if (cfgs.length > 0) {
            context.steps[cfgs[cfgs.length - 1]!.id] = { type: 'TEST', output: { i: iter, item: currentItem } };
          }
        },
      });

      const result = (await step.execute(
        {
          source: 'steps.fetch.output.owners',
          body: [{ id: 'validate', type: 'X', config: {} }] as unknown as Record<string, unknown>[],
        },
        ctx,
      )) as MapStepOutput;

      expect(result.count).toBe(3);
      expect(result.items).toHaveLength(3);
      // index-aligned with the source array
      expect(result.items[0]).toMatchObject({ index: 0, item: 'a' });
      expect(result.items[2]).toMatchObject({ index: 2, item: 'c' });
      // per-iteration step outputs (the `__map` item flowed into the body)
      expect(result.items[0]!.steps!['validate']!.output).toEqual({ i: 0, item: 'a' });
      expect(result.items[1]!.steps!['validate']!.output).toEqual({ i: 1, item: 'b' });
      // every iteration ran under branchKey 'item'
      expect(branchKeys).toEqual(['item', 'item', 'item']);
    });

    it('processes every item and uses branchKey "item"', async () => {
      const ctx = createMockControlFlowContext({
        workflow: createMockContext({
          steps: { s: { type: 'T', output: { list: [1, 2, 3, 4, 5] } } },
        }),
      });
      const result = (await step.execute(
        { source: 'steps.s.output.list', body: [] },
        ctx,
      )) as MapStepOutput;
      expect(result.count).toBe(5);
      expect(ctx.walkBranchCalls).toHaveLength(5);
      expect(ctx.walkBranchCalls[0]!.branchKey).toBe('item');
    });

    it('throws when the source does not resolve to an array', async () => {
      const ctx = createMockControlFlowContext({
        workflow: createMockContext({ steps: { s: { type: 'T', output: { v: 'nope' } } } }),
      });
      await expect(
        step.execute({ source: 'steps.s.output.v', body: [] }, ctx),
      ).rejects.toThrow('did not resolve to an array');
    });

    it('parks (throws PauseStep) when any iteration pauses', async () => {
      const ctx = createMockControlFlowContext({
        workflow: createMockContext({ steps: { s: { type: 'T', output: { items: ['a', 'b', 'c'] } } } }),
        walkBranch: async (_steps, _context, _branchKey, iter) => {
          if (iter === 1) throw new PauseStep('await approval', { category: GateCategory.WaitingOnApprover });
        },
      });
      await expect(
        step.execute(
          {
            source: 'steps.s.output.items',
            body: [{ id: 'gate', type: 'X', config: {} }] as unknown as Record<string, unknown>[],
          },
          ctx,
        ),
      ).rejects.toThrow('Step paused');
    });

    it('records a rejected iteration as an error, not a throw, when none paused', async () => {
      const ctx = createMockControlFlowContext({
        workflow: createMockContext({ steps: { s: { type: 'T', output: { items: ['ok', 'bad'] } } } }),
        walkBranch: async (_steps, _context, _branchKey, iter) => {
          if (iter === 1) throw new Error('boom');
        },
      });
      const result = (await step.execute(
        { source: 'steps.s.output.items', body: [{ id: 'x', type: 'X', config: {} }] as unknown as Record<string, unknown>[] },
        ctx,
      )) as MapStepOutput;
      expect(result.count).toBe(2);
      expect(result.items[1]).toMatchObject({ index: 1, item: 'bad', error: 'boom' });
    });

    // Records when each iteration entered and left walkBranch, so a test can
    // assert on real overlap rather than on completion order.
    const overlapProbe = (items: unknown[], delayFor: (i: number) => number) => {
      let inFlight = 0;
      let maxInFlight = 0;
      const order: number[] = [];
      const ctx = createMockControlFlowContext({
        workflow: createMockContext({ steps: { s: { type: 'T', output: { items } } } }),
        walkBranch: async (_steps, _context, _branchKey, iter) => {
          inFlight++;
          maxInFlight = Math.max(maxInFlight, inFlight);
          order.push(iter ?? -1);
          await new Promise((r) => setTimeout(r, delayFor(iter ?? 0)));
          inFlight--;
        },
      });
      return { ctx, order, peak: () => maxInFlight };
    };

    it('concurrency 1 runs items one at a time, in source order', async () => {
      // Descending delays: under any parallelism item 2 would finish first and
      // a completion-ordered implementation would betray itself here.
      const probe = overlapProbe(['a', 'b', 'c'], (i) => 15 - i * 5);
      const result = (await step.execute(
        {
          source: 'steps.s.output.items',
          concurrency: 1,
          body: [{ id: 'x', type: 'X', config: {} }] as unknown as Record<string, unknown>[],
        },
        probe.ctx,
      )) as MapStepOutput;

      expect(probe.peak()).toBe(1);
      expect(probe.order).toEqual([0, 1, 2]);
      expect(result.items.map((r) => r.index)).toEqual([0, 1, 2]);
      expect(result.items.map((r) => r.item)).toEqual(['a', 'b', 'c']);
    });

    it('omitting concurrency still starts every item at once', async () => {
      const probe = overlapProbe(['a', 'b', 'c', 'd'], () => 10);
      const result = (await step.execute(
        {
          source: 'steps.s.output.items',
          body: [{ id: 'x', type: 'X', config: {} }] as unknown as Record<string, unknown>[],
        },
        probe.ctx,
      )) as MapStepOutput;

      expect(probe.peak()).toBe(4);
      expect(result.count).toBe(4);
    });

    it('caps in-flight iterations at concurrency without dropping any', async () => {
      const probe = overlapProbe([1, 2, 3, 4, 5, 6, 7], () => 5);
      const result = (await step.execute(
        {
          source: 'steps.s.output.items',
          concurrency: 2,
          body: [{ id: 'x', type: 'X', config: {} }] as unknown as Record<string, unknown>[],
        },
        probe.ctx,
      )) as MapStepOutput;

      expect(probe.peak()).toBeLessThanOrEqual(2);
      expect(result.count).toBe(7);
      expect(result.items.map((r) => r.index)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    });

    it('keeps going past a failed item when running sequentially', async () => {
      const seen: number[] = [];
      const ctx = createMockControlFlowContext({
        workflow: createMockContext({ steps: { s: { type: 'T', output: { items: ['ok', 'bad', 'also ok'] } } } }),
        walkBranch: async (_steps, _context, _branchKey, iter) => {
          seen.push(iter ?? -1);
          if (iter === 1) throw new Error('boom');
        },
      });
      const result = (await step.execute(
        {
          source: 'steps.s.output.items',
          concurrency: 1,
          body: [{ id: 'x', type: 'X', config: {} }] as unknown as Record<string, unknown>[],
        },
        ctx,
      )) as MapStepOutput;

      expect(seen).toEqual([0, 1, 2]);
      expect(result.items[1]).toMatchObject({ index: 1, error: 'boom' });
      expect(result.items[2]).toMatchObject({ index: 2, item: 'also ok' });
    });

    it('still parks the whole map when a sequential iteration pauses', async () => {
      const ctx = createMockControlFlowContext({
        workflow: createMockContext({ steps: { s: { type: 'T', output: { items: ['a', 'b'] } } } }),
        walkBranch: async (_steps, _context, _branchKey, iter) => {
          if (iter === 0) throw new PauseStep('waiting', { category: GateCategory.WaitingOnApprover });
        },
      });
      await expect(
        step.execute(
          {
            source: 'steps.s.output.items',
            concurrency: 1,
            body: [{ id: 'gate', type: 'X', config: {} }] as unknown as Record<string, unknown>[],
          },
          ctx,
        ),
      ).rejects.toThrow('Step paused');
    });
  });
});
