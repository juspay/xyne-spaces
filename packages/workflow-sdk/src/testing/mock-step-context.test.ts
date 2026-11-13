import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  createMockStepContext,
  createMockControlFlowContext,
} from './mock-step-context.js';
import { ServiceRegistry } from '../engine/service-registry.js';
import { PauseStep } from '../engine/pause-step.js';
import {
  BaseActionStep,
  BaseControlFlowStep,
} from '../steps/base-step.js';
import type {
  StepExecutionContext,
  ControlFlowExecutionContext,
} from '../steps/base-step.js';
import { createMockContext } from './mock-context.js';
import { GateCategory } from '../types/known-types.js';

describe('createMockStepContext', () => {
  it('creates context with defaults', () => {
    const ctx = createMockStepContext();
    expect(ctx.workflow.workflow.id).toBe('wf_test');
    expect(ctx.runtime.executionId).toBe('exec_test');
    expect(ctx.runtime.stepName).toBe('step_test');
    expect(ctx.runtime.isResuming).toBe(false);
    expect(ctx.credentials).toEqual({});
  });

  it('pause() throws PauseStep', () => {
    const ctx = createMockStepContext();
    expect(() => ctx.pause('testing', { category: GateCategory.WaitingOnApprover })).toThrow(PauseStep);
  });

  it('accepts workflow override', () => {
    const workflow = createMockContext({ workflowId: 'wf_custom' });
    const ctx = createMockStepContext({ workflow });
    expect(ctx.workflow.workflow.id).toBe('wf_custom');
  });

  it('accepts runtime overrides', () => {
    const ctx = createMockStepContext({
      runtime: { executionId: 'exec_override', isResuming: true },
    });
    expect(ctx.runtime.executionId).toBe('exec_override');
    expect(ctx.runtime.isResuming).toBe(true);
    expect(ctx.runtime.stepName).toBe('step_test'); // default kept
  });

  it('accepts typed services', () => {
    // `type`, not `interface`: an interface has no implicit index signature, so
    // it doesn't satisfy the `Record<string, unknown>` constraint.
    type MyServices = {
      db: { query(): string };
    };
    const services = new ServiceRegistry<MyServices>();
    services.register('db', { query: () => 'result' });

    const ctx = createMockStepContext<MyServices>({ services });
    const db = ctx.services.get('db');
    expect(db.query()).toBe('result');
  });

  it('logger methods are no-ops by default', () => {
    const ctx = createMockStepContext();
    // Should not throw
    ctx.log.info('test');
    ctx.log.warn('test');
    ctx.log.error('test');
  });

  it('emit is a no-op by default', () => {
    const ctx = createMockStepContext();
    // Should not throw
    ctx.emit({ type: 'progress', data: { phase: 'test' } });
  });

  it('accepts custom emit', () => {
    const events: unknown[] = [];
    const ctx = createMockStepContext({
      emit: (event) => { events.push(event); },
    });
    ctx.emit({ type: 'log', data: { msg: 'hi' } });
    expect(events).toHaveLength(1);
  });

  it('staticData methods work by default', async () => {
    const ctx = createMockStepContext();
    expect(await ctx.staticData.get('key')).toBeUndefined();
    await ctx.staticData.set('key', 'value');
    await ctx.staticData.delete('key');
    // All no-ops, no errors
  });

  it('works with a real action step', async () => {
    const Config = z.object({ msg: z.string() });
    const Output = z.object({ echoed: z.string() });

    class TestStep extends BaseActionStep<typeof Config, { echoed: string }> {
      readonly type = 'TEST';
      readonly configSchema = Config;
      readonly name = 'Test';
      readonly description = 'test';
      readonly outputSchema = Output;
      readonly category = 'testing';

      async execute(
        config: z.infer<typeof Config>,
        _ctx: StepExecutionContext,
      ): Promise<{ echoed: string }> {
        return { echoed: config.msg };
      }
    }

    const step = new TestStep();
    const ctx = createMockStepContext();
    const result = await step.execute({ msg: 'hello' }, ctx);
    expect(result).toEqual({ echoed: 'hello' });
  });
});

describe('createMockControlFlowContext', () => {
  it('creates context with walkBranch', () => {
    const ctx = createMockControlFlowContext();
    expect(typeof ctx.walkBranch).toBe('function');
    expect(ctx.walkBranchCalls).toHaveLength(0);
  });

  it('records walkBranch calls with branchKey', async () => {
    const ctx = createMockControlFlowContext();
    const mockSteps = [{ id: 'step1', type: 'ECHO', config: {} }];
    await ctx.walkBranch(
      mockSteps as never[],
      ctx.workflow,
      'if_true',
    );
    expect(ctx.walkBranchCalls).toHaveLength(1);
    expect(ctx.walkBranchCalls[0]!.steps).toBe(mockSteps);
    expect(ctx.walkBranchCalls[0]!.context).toBe(ctx.workflow);
    expect(ctx.walkBranchCalls[0]!.branchKey).toBe('if_true');
  });

  it('records walkBranch calls without branchKey', async () => {
    const ctx = createMockControlFlowContext();
    await ctx.walkBranch([], ctx.workflow);
    expect(ctx.walkBranchCalls).toHaveLength(1);
    expect(ctx.walkBranchCalls[0]!.branchKey).toBeUndefined();
  });

  it('accepts custom walkBranch', async () => {
    let called = false;
    const ctx = createMockControlFlowContext({
      walkBranch: async () => {
        called = true;
      },
    });
    await ctx.walkBranch([], ctx.workflow);
    expect(called).toBe(true);
  });

  it('works with a real control flow step', async () => {
    const Config = z.object({ branch: z.boolean() });
    const Output = z.object({ taken: z.string() });

    class TestCondStep extends BaseControlFlowStep<
      typeof Config,
      { taken: string }
    > {
      readonly type = 'TEST_COND';
      readonly configSchema = Config;
      readonly name = 'Test Cond';
      readonly description = 'test';
      readonly outputSchema = Output;
      override readonly category = 'control' as const;

      async execute(
        config: z.infer<typeof Config>,
        ctx: ControlFlowExecutionContext,
      ): Promise<{ taken: string }> {
        const branch = config.branch ? 'yes' : 'no';
        await ctx.walkBranch([], ctx.workflow);
        return { taken: branch };
      }
    }

    const step = new TestCondStep();
    const ctx = createMockControlFlowContext();
    const result = await step.execute({ branch: true }, ctx);
    expect(result).toEqual({ taken: 'yes' });
    expect(ctx.walkBranchCalls).toHaveLength(1);
  });
});
