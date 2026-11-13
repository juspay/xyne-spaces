import { describe, it, expect } from 'vitest';
import {
  ParallelStep,
  ParallelStepConfigSchema,
} from './parallel.step.js';
import type {
  ParallelAllSettledOutput,
  ParallelRaceOutput,
  ParallelSettledBranchResult,
} from './parallel.step.js';
import { createMockControlFlowContext } from '../../../testing/mock-step-context.js';
import { createMockContext } from '../../../testing/mock-context.js';
import type { WorkflowContext } from '../../../types/context.js';
import type { WorkflowStepConfig } from '../../../types/workflow-config.js';
import { PauseStep } from '../../../engine/pause-step.js';
import { GateCategory } from '../../../types/known-types.js';

/** A branch's top-level step output, keyed by step id (new control-flow shape). */
type Fulfilled = { status: 'fulfilled'; steps: Record<string, { output: Record<string, unknown> }> };
const stepOut = (b: unknown, id: string): Record<string, unknown> =>
  (b as Fulfilled).steps[id]!.output;

describe('ParallelStep', () => {
  const step = new ParallelStep();

  it('has correct metadata', () => {
    expect(step.type).toBe('PARALLEL');
    expect(step.kind).toBe('control');
    expect(step.category).toBe('control');
  });

  describe('config schema', () => {
    it('validates valid config with default merge', () => {
      const config = ParallelStepConfigSchema.parse({
        branches: {
          a: [{ id: 's1', type: 'ECHO', config: {} }],
          b: [{ id: 's2', type: 'ECHO', config: {} }],
        },
      });
      expect(config.merge).toBe('allSettled');
    });

    it('accepts explicit merge modes', () => {
      for (const mode of ['allSettled', 'race'] as const) {
        const config = ParallelStepConfigSchema.parse({
          branches: { a: [] },
          merge: mode,
        });
        expect(config.merge).toBe(mode);
      }
    });

    it('rejects invalid merge mode', () => {
      expect(() =>
        ParallelStepConfigSchema.parse({
          branches: {},
          merge: 'invalid',
        }),
      ).toThrow();
    });

    it('rejects removed "all" merge mode', () => {
      expect(() =>
        ParallelStepConfigSchema.parse({
          branches: {},
          merge: 'all',
        }),
      ).toThrow();
    });
  });

  describe('getBranches', () => {
    it('returns all branch keys', () => {
      const branches = step.getBranches!({
        branches: {
          users: [{ id: 's1', type: 'HTTP', config: {} }],
          orders: [{ id: 's2', type: 'HTTP', config: {} }],
        },
      });
      expect(Object.keys(branches)).toEqual(['users', 'orders']);
      expect(branches['users']).toHaveLength(1);
      expect(branches['orders']).toHaveLength(1);
    });

    it('returns empty when no branches', () => {
      const branches = step.getBranches!({});
      expect(Object.keys(branches)).toHaveLength(0);
    });
  });

  describe('execute — merge: allSettled', () => {
    it('returns fulfilled/rejected per branch', async () => {
      const ctx = createMockControlFlowContext({
        workflow: createMockContext(),
        walkBranch: async (steps, context, branchKey) => {
          if (branchKey === 'fail') {
            throw new Error('oops');
          }
          const stepConfigs = steps as unknown as WorkflowStepConfig[];
          if (stepConfigs.length > 0) {
            context.steps[stepConfigs[stepConfigs.length - 1]!.id] = {
              type: 'TEST',
              output: { ok: true },
            };
          }
        },
      });

      const result = await step.execute(
        {
          branches: {
            good: [{ id: 's1', type: 'X', config: {} }] as unknown as Record<string, unknown>[],
            fail: [{ id: 's2', type: 'X', config: {} }] as unknown as Record<string, unknown>[],
          },
          merge: 'allSettled',
        },
        ctx,
      );

      expect(result.mode).toBe('allSettled');
      const settled = result as ParallelAllSettledOutput;

      const good = settled.branches['good']!;
      expect(good.status).toBe('fulfilled');
      expect(stepOut(good, 's1')).toEqual({ ok: true });

      const fail = settled.branches['fail']!;
      expect(fail.status).toBe('rejected');
      expect((fail as { status: 'rejected'; reason: string }).reason).toBe('oops');
    });

    it('runs all branches and wraps each in settled result', async () => {
      const ctx = createMockControlFlowContext({
        workflow: createMockContext(),
        walkBranch: async (steps, context, branchKey) => {
          const stepConfigs = steps as unknown as WorkflowStepConfig[];
          if (stepConfigs.length > 0) {
            const lastStep = stepConfigs[stepConfigs.length - 1]!;
            context.steps[lastStep.id] = {
              type: lastStep.type,
              output: { data: `result_${branchKey ?? 'default'}` },
            };
          }
        },
      });

      const result = await step.execute(
        {
          branches: {
            users: [{ id: 's1', type: 'HTTP', config: {} }] as unknown as Record<string, unknown>[],
            orders: [{ id: 's2', type: 'HTTP', config: {} }] as unknown as Record<string, unknown>[],
          },
          merge: 'allSettled',
        },
        ctx,
      );

      expect(result.mode).toBe('allSettled');
      const settled = result as ParallelAllSettledOutput;
      const users = settled.branches['users']!;
      expect(users.status).toBe('fulfilled');
      expect(stepOut(users, 's1')).toEqual({ data: 'result_users' });
      const orders = settled.branches['orders']!;
      expect(orders.status).toBe('fulfilled');
      expect(stepOut(orders, 's2')).toEqual({ data: 'result_orders' });
    });

    it('returns empty branches for empty config', async () => {
      const ctx = createMockControlFlowContext({
        workflow: createMockContext(),
      });

      const result = await step.execute(
        { branches: {}, merge: 'allSettled' },
        ctx,
      );

      expect(result.mode).toBe('allSettled');
    });

    it('branches get isolated context copies', async () => {
      const contextRefs: WorkflowContext[] = [];
      const ctx = createMockControlFlowContext({
        workflow: createMockContext({
          steps: {
            prior: { type: 'TEST', output: { val: 1 } },
          },
        }),
        walkBranch: async (_steps, context) => {
          contextRefs.push(context);
          context.steps['branchStep'] = {
            type: 'TEST',
            output: { written: true },
          };
        },
      });

      await step.execute(
        {
          branches: {
            a: [{ id: 's1', type: 'X', config: {} }] as unknown as Record<string, unknown>[],
            b: [{ id: 's2', type: 'X', config: {} }] as unknown as Record<string, unknown>[],
          },
          merge: 'allSettled',
        },
        ctx,
      );

      expect(contextRefs).toHaveLength(2);
      // Both can read prior step outputs
      expect(contextRefs[0]!.steps['prior']?.output.val).toBe(1);
      expect(contextRefs[1]!.steps['prior']?.output.val).toBe(1);
      // But they're isolated — different objects
      expect(contextRefs[0]!.steps).not.toBe(contextRefs[1]!.steps);
    });

    it('exposes all top-level steps from multi-step branches', async () => {
      const ctx = createMockControlFlowContext({
        workflow: createMockContext(),
        walkBranch: async (steps, context) => {
          const stepConfigs = steps as unknown as WorkflowStepConfig[];
          for (let i = 0; i < stepConfigs.length; i++) {
            context.steps[stepConfigs[i]!.id] = {
              type: stepConfigs[i]!.type,
              output: { index: i },
            };
          }
        },
      });

      const result = await step.execute(
        {
          branches: {
            multi: [
              { id: 's1', type: 'A', config: {} },
              { id: 's2', type: 'B', config: {} },
              { id: 's3', type: 'C', config: {} },
            ] as unknown as Record<string, unknown>[],
          },
          merge: 'allSettled',
        },
        ctx,
      );

      const settled = result as ParallelAllSettledOutput;
      const multi = settled.branches['multi']!;
      // All top-level branch steps are now exposed, keyed by id
      expect(stepOut(multi, 's1')).toEqual({ index: 0 });
      expect(stepOut(multi, 's2')).toEqual({ index: 1 });
      expect(stepOut(multi, 's3')).toEqual({ index: 2 });
    });
  });

  describe('execute — merge: race', () => {
    it('returns the winning branch and its steps', async () => {
      const ctx = createMockControlFlowContext({
        workflow: createMockContext(),
        walkBranch: async (steps, context, branchKey) => {
          const stepConfigs = steps as unknown as WorkflowStepConfig[];
          if (stepConfigs.length > 0) {
            context.steps[stepConfigs[stepConfigs.length - 1]!.id] = {
              type: 'TEST',
              output: { branch: branchKey },
            };
          }
        },
      });

      const result = await step.execute(
        {
          branches: {
            fast: [{ id: 's1', type: 'X', config: {} }] as unknown as Record<string, unknown>[],
            slow: [{ id: 's2', type: 'X', config: {} }] as unknown as Record<string, unknown>[],
          },
          merge: 'race',
        },
        ctx,
      );

      expect(result.mode).toBe('race');
      const raceResult = result as ParallelRaceOutput;
      expect(typeof raceResult.branch).toBe('string');
      // The winner's branch is populated under the uniform `branches` map.
      const winner = raceResult.branches[raceResult.branch]!;
      expect(winner.status).toBe('fulfilled');
      const winnerStepId = raceResult.branch === 'fast' ? 's1' : 's2';
      expect(stepOut(winner, winnerStepId)).toEqual({ branch: raceResult.branch });
    });

    it('propagates error if winner throws', async () => {
      const ctx = createMockControlFlowContext({
        workflow: createMockContext(),
        walkBranch: async () => {
          throw new Error('all fail');
        },
      });

      await expect(
        step.execute(
          {
            branches: {
              a: [{ id: 's1', type: 'X', config: {} }] as unknown as Record<string, unknown>[],
            },
            merge: 'race',
          },
          ctx,
        ),
      ).rejects.toThrow('all fail');
    });
  });

  describe('single branch', () => {
    it('works with a single branch in allSettled mode', async () => {
      const ctx = createMockControlFlowContext({
        workflow: createMockContext(),
        walkBranch: async (steps, context) => {
          const stepConfigs = steps as unknown as WorkflowStepConfig[];
          if (stepConfigs.length > 0) {
            context.steps[stepConfigs[0]!.id] = {
              type: 'TEST',
              output: { solo: true },
            };
          }
        },
      });

      const result = await step.execute(
        {
          branches: {
            only: [{ id: 's1', type: 'X', config: {} }] as unknown as Record<string, unknown>[],
          },
          merge: 'allSettled',
        },
        ctx,
      );

      const settled = result as ParallelAllSettledOutput;
      const only = settled.branches['only']!;
      expect(stepOut(only, 's1')).toEqual({ solo: true });
    });
  });

  describe('empty branch steps', () => {
    it('returns fulfilled with empty output for branch with no steps', async () => {
      const ctx = createMockControlFlowContext({
        workflow: createMockContext(),
      });

      const result = await step.execute(
        {
          branches: {
            empty: [] as unknown as Record<string, unknown>[],
          },
          merge: 'allSettled',
        },
        ctx,
      );

      const settled = result as ParallelAllSettledOutput;
      const empty = settled.branches['empty'] as { status: 'fulfilled'; steps: Record<string, unknown> };
      expect(empty.status).toBe('fulfilled');
      expect(empty.steps).toEqual({});
    });
  });

  describe('pause handling — allSettled', () => {
    // PARALLEL no longer keeps internal saved state: each branch persists its
    // own node-path step records, so a paused branch simply throws PauseStep and
    // the executor's memoized walk handles skip/resume on re-entry. These tests
    // cover the step's contract (throw + surface details); end-to-end
    // pause/resume across branches is covered in workflow-executor.test.ts.

    it('throws PauseStep when a single branch pauses', async () => {
      const ctx = createMockControlFlowContext({
        workflow: createMockContext(),
        walkBranch: async (_steps, _context, branchKey) => {
          if (branchKey === 'approval') {
            throw new PauseStep('need approval', { category: GateCategory.WaitingOnApprover });
          }
        },
      });

      await expect(
        step.execute(
          {
            branches: {
              fast: [{ id: 's1', type: 'X', config: {} }] as unknown as Record<string, unknown>[],
              approval: [{ id: 's2', type: 'X', config: {} }] as unknown as Record<string, unknown>[],
            },
            merge: 'allSettled',
          },
          ctx,
        ),
      ).rejects.toThrow('Step paused');
    });

    it('surfaces the externalRef of a paused branch', async () => {
      const ctx = createMockControlFlowContext({
        workflow: createMockContext(),
        walkBranch: async (steps, context, branchKey) => {
          if (branchKey === 'approval') {
            throw new PauseStep('need approval', { category: GateCategory.WaitingOnApprover, externalRef: 'ticket-123' });
          }
          const stepConfigs = steps as unknown as WorkflowStepConfig[];
          if (stepConfigs.length > 0) {
            context.steps[stepConfigs[stepConfigs.length - 1]!.id] = {
              type: 'TEST',
              output: { done: true },
            };
          }
        },
      });

      try {
        await step.execute(
          {
            branches: {
              fast: [{ id: 's1', type: 'X', config: {} }] as unknown as Record<string, unknown>[],
              approval: [{ id: 's2', type: 'X', config: {} }] as unknown as Record<string, unknown>[],
            },
            merge: 'allSettled',
          },
          ctx,
        );
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(PauseStep.is(err)).toBe(true);
        expect((err as PauseStep).externalRef).toBe('ticket-123');
      }
    });

    it('reports the count when multiple branches pause simultaneously', async () => {
      const ctx = createMockControlFlowContext({
        workflow: createMockContext(),
        walkBranch: async (_steps, _context, branchKey) => {
          if (branchKey === 'approval1') throw new PauseStep('need manager', { category: GateCategory.WaitingOnApprover });
          if (branchKey === 'approval2') throw new PauseStep('need legal', { category: GateCategory.WaitingOnApprover });
        },
      });

      await expect(
        step.execute(
          {
            branches: {
              fast: [{ id: 's1', type: 'X', config: {} }] as unknown as Record<string, unknown>[],
              approval1: [{ id: 's2', type: 'X', config: {} }] as unknown as Record<string, unknown>[],
              approval2: [{ id: 's3', type: 'X', config: {} }] as unknown as Record<string, unknown>[],
            },
            merge: 'allSettled',
          },
          ctx,
        ),
      ).rejects.toThrow('Step paused: 2 branches paused');
    });

    it('still parks (throws PauseStep) when another branch errors alongside a pause', async () => {
      const ctx = createMockControlFlowContext({
        workflow: createMockContext(),
        walkBranch: async (steps, context, branchKey) => {
          if (branchKey === 'approval') throw new PauseStep('need approval', { category: GateCategory.WaitingOnApprover });
          if (branchKey === 'broken') throw new Error('something broke');
          const stepConfigs = steps as unknown as WorkflowStepConfig[];
          if (stepConfigs.length > 0) {
            context.steps[stepConfigs[stepConfigs.length - 1]!.id] = {
              type: 'TEST',
              output: { ok: true },
            };
          }
        },
      });

      try {
        await step.execute(
          {
            branches: {
              good: [{ id: 's1', type: 'X', config: {} }] as unknown as Record<string, unknown>[],
              broken: [{ id: 's2', type: 'X', config: {} }] as unknown as Record<string, unknown>[],
              approval: [{ id: 's3', type: 'X', config: {} }] as unknown as Record<string, unknown>[],
            },
            merge: 'allSettled',
          },
          ctx,
        );
        expect.unreachable('should have thrown');
      } catch (err) {
        // A pause takes precedence: the step parks (the errored branch is
        // recorded as rejected in its own node record by the executor).
        expect(PauseStep.is(err)).toBe(true);
      }
    });
  });

  describe('output schema validates all modes', () => {
    it('validates allSettled mode output', () => {
      const output: ParallelAllSettledOutput = {
        mode: 'allSettled',
        branches: {
          a: { status: 'fulfilled', steps: { s1: { output: { x: 1 } } } },
          b: { status: 'rejected', reason: 'oops' },
        },
      };
      expect(step.outputSchema.parse(output)).toEqual(output);
    });

    it('validates race mode output', () => {
      const output: ParallelRaceOutput = {
        mode: 'race',
        branch: 'fast',
        branches: { fast: { status: 'fulfilled', steps: { s1: { output: { x: 1 } } } } },
      };
      expect(step.outputSchema.parse(output)).toEqual(output);
    });
  });
});
