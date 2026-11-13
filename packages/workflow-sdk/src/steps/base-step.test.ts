import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import {
  BaseStep,
  BaseActionStep,
  BaseControlFlowStep,
  StepKind,
  createPauseFunction,
  cloneScope,
} from './base-step.js';
import type {
  StepExecutionContext,
  ControlFlowExecutionContext,
} from './base-step.js';
import { PauseStep } from '../engine/pause-step.js';
import { GateCategory } from '../types/known-types.js';

// ─── Concrete test implementations ───

const TestConfigSchema = z.object({
  message: z.string(),
});

const TestOutputSchema = z.object({
  sent: z.boolean(),
});

class TestActionStep extends BaseActionStep<
  typeof TestConfigSchema,
  { sent: boolean }
> {
  readonly type = 'TEST_ACTION';
  readonly configSchema = TestConfigSchema;
  readonly name = 'Test Action';
  readonly description = 'A test action step';
  readonly outputSchema = TestOutputSchema;
  readonly category = 'testing';

  async execute(
    config: z.infer<typeof TestConfigSchema>,
    _ctx: StepExecutionContext,
  ): Promise<{ sent: boolean }> {
    return { sent: config.message.length > 0 };
  }
}

class TestActionWithResume extends BaseActionStep<
  typeof TestConfigSchema,
  { sent: boolean }
> {
  readonly type = 'TEST_RESUME';
  readonly configSchema = TestConfigSchema;
  readonly name = 'Test Resume';
  readonly description = 'A test action step with resume';
  readonly outputSchema = TestOutputSchema;
  readonly category = 'testing';

  async execute(
    _config: z.infer<typeof TestConfigSchema>,
    ctx: StepExecutionContext,
  ): Promise<{ sent: boolean }> {
    ctx.pause('waiting', { category: GateCategory.WaitingOnApiCall, externalRef: 'ext_1' });
  }

  override async onResume(
    rowData: Record<string, unknown>,
    _config: z.infer<typeof TestConfigSchema>,
    _ctx: StepExecutionContext,
  ): Promise<{ sent: boolean }> {
    return { sent: rowData['resumed'] === true };
  }
}

const ConditionalConfigSchema = z.object({
  condition: z.boolean(),
});

const ConditionalOutputSchema = z.object({
  branch: z.string(),
});

class TestControlStep extends BaseControlFlowStep<
  typeof ConditionalConfigSchema,
  { branch: string }
> {
  readonly type = 'TEST_CONDITIONAL';
  readonly configSchema = ConditionalConfigSchema;
  readonly name = 'Test Conditional';
  readonly description = 'A test control flow step';
  readonly outputSchema = ConditionalOutputSchema;
  override readonly category = 'control' as const;
  override readonly declaredOutputs = [
    { key: 'if_true', label: 'True' },
    { key: 'if_false', label: 'False' },
  ] as const;

  async execute(
    config: z.infer<typeof ConditionalConfigSchema>,
    _ctx: ControlFlowExecutionContext,
  ): Promise<{ branch: string }> {
    return { branch: config.condition ? 'if_true' : 'if_false' };
  }

  override getBranches(
    config: Record<string, unknown>,
  ): Record<string, never[]> {
    return {
      if_true: [],
      if_false: [],
      ...(config as Record<string, never[]>),
    };
  }
}

// ─── Minimal mock context ───

function createMockCtx(
  overrides?: Partial<StepExecutionContext>,
): StepExecutionContext {
  return {
    workflow: {
      workflow: { id: 'wf_1', metadata: {} },
      trigger: { type: 'TEST' },
      steps: {},
    },
    runtime: {
      executionId: 'exec_1',
      stepId: 'step_1_id',
      stepName: 'step_1',
      isResuming: false,
      metadata: {},
      baseUrl: '',
    },
    services: {
      get: vi.fn(),
      has: vi.fn(),
      register: vi.fn(),
      replace: vi.fn(),
      assertRegistered: vi.fn(),
      size: 0,
      keys: vi.fn(),
    } as unknown as StepExecutionContext['services'],
    staticData: {
      get: vi.fn(),
      set: vi.fn(),
      delete: vi.fn(),
    },
    pause: createPauseFunction(),
    emit: vi.fn(),
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    ...overrides,
  };
}

// ─── Tests ───

describe('StepKind', () => {
  it('has ACTION and CONTROL values', () => {
    expect(StepKind.ACTION).toBe('action');
    expect(StepKind.CONTROL).toBe('control');
  });
});

describe('BaseActionStep', () => {
  const step = new TestActionStep();

  it('has kind ACTION', () => {
    expect(step.kind).toBe(StepKind.ACTION);
  });

  it('has correct metadata', () => {
    expect(step.type).toBe('TEST_ACTION');
    expect(step.name).toBe('Test Action');
    expect(step.description).toBe('A test action step');
    expect(step.category).toBe('testing');
  });

  it('validates valid config', () => {
    const result = step.validate({ message: 'hello' });
    expect(result).toEqual({ message: 'hello' });
  });

  it('rejects invalid config', () => {
    expect(() => step.validate({ message: 42 })).toThrow();
    expect(() => step.validate({})).toThrow();
  });

  it('executes and returns output', async () => {
    const ctx = createMockCtx();
    const result = await step.execute({ message: 'hello' }, ctx);
    expect(result).toEqual({ sent: true });
  });

  it('executes with empty message', async () => {
    const ctx = createMockCtx();
    const result = await step.execute({ message: '' }, ctx);
    expect(result).toEqual({ sent: false });
  });
});

describe('BaseActionStep with onResume', () => {
  const step = new TestActionWithResume();

  it('pause throws PauseStep', async () => {
    const ctx = createMockCtx();
    await expect(() =>
      step.execute({ message: 'hi' }, ctx),
    ).rejects.toThrow(PauseStep);
  });

  it('onResume returns output', async () => {
    const ctx = createMockCtx();
    const result = await step.onResume!(
      { resumed: true },
      { message: 'hi' },
      ctx,
    );
    expect(result).toEqual({ sent: true });
  });
});

describe('BaseControlFlowStep', () => {
  const step = new TestControlStep();

  it('has kind CONTROL', () => {
    expect(step.kind).toBe(StepKind.CONTROL);
  });

  it('has category control', () => {
    expect(step.category).toBe('control');
  });

  it('has declared outputs', () => {
    expect(step.declaredOutputs).toEqual([
      { key: 'if_true', label: 'True' },
      { key: 'if_false', label: 'False' },
    ]);
  });

  it('executes and returns branch', async () => {
    const ctx: ControlFlowExecutionContext = {
      ...createMockCtx(),
      walkBranch: vi.fn(),
    };
    const result = await step.execute({ condition: true }, ctx);
    expect(result).toEqual({ branch: 'if_true' });
  });

  it('getBranches returns branch map', () => {
    const branches = step.getBranches!({});
    expect(branches).toHaveProperty('if_true');
    expect(branches).toHaveProperty('if_false');
  });

  it('validates config', () => {
    const result = step.validate({ condition: true });
    expect(result).toEqual({ condition: true });
  });

  it('rejects invalid config', () => {
    expect(() => step.validate({ condition: 'not-bool' })).toThrow();
  });
});

describe('createPauseFunction', () => {
  it('throws PauseStep with reason', () => {
    const pause = createPauseFunction();
    const opts = { category: GateCategory.WaitingOnApprover };
    expect(() => pause('test reason', opts)).toThrow(PauseStep);
    try {
      pause('test reason', opts);
    } catch (err) {
      expect(PauseStep.is(err)).toBe(true);
      expect((err as PauseStep).message).toBe('Step paused: test reason');
      expect((err as PauseStep).category).toBe(GateCategory.WaitingOnApprover);
      expect((err as PauseStep).origin).toBe('step');
    }
  });

  it('refuses to pause without a category', () => {
    const pause = createPauseFunction();
    // A step reaching this from JavaScript gets a plain Error, so the run fails
    // with the reason rather than parking in nobody's queue.
    const untyped = pause as unknown as (reason: string) => never;
    expect(() => untyped('no category')).toThrow(/without a category/);
    try {
      untyped('no category');
    } catch (err) {
      expect(PauseStep.is(err)).toBe(false);
    }
  });

  it('throws PauseStep with options', () => {
    const pause = createPauseFunction();
    try {
      pause('with-opts', {
        category: GateCategory.WaitingOnApiCall,
        externalRef: 'ref_1',
        statePatch: { x: 1 },
      });
    } catch (err) {
      expect(PauseStep.is(err)).toBe(true);
      expect((err as PauseStep).externalRef).toBe('ref_1');
      expect((err as PauseStep).statePatch).toEqual({ x: 1 });
    }
  });
});

describe('BaseStep.redactInput', () => {
  it('is optionally implementable', () => {
    class RedactingStep extends BaseActionStep<
      typeof TestConfigSchema,
      { sent: boolean }
    > {
      readonly type = 'REDACT_TEST';
      readonly configSchema = TestConfigSchema;
      readonly name = 'Redact Test';
      readonly description = 'test';
      readonly outputSchema = TestOutputSchema;
      readonly category = 'testing';

      async execute(): Promise<{ sent: boolean }> {
        return { sent: true };
      }

      override redactInput(
        input: Record<string, unknown>,
      ): Record<string, unknown> {
        return { ...input, message: '***' };
      }
    }

    const step = new RedactingStep();
    const redacted = step.redactInput!({ message: 'secret' });
    expect(redacted).toEqual({ message: '***' });
  });
});

describe('BaseStep metadata fields', () => {
  it('supports icon', () => {
    class IconStep extends BaseActionStep<
      typeof TestConfigSchema,
      { sent: boolean }
    > {
      readonly type = 'ICON_TEST';
      readonly configSchema = TestConfigSchema;
      readonly name = 'Icon Test';
      readonly description = 'test';
      readonly outputSchema = TestOutputSchema;
      readonly category = 'testing';
      override readonly icon = 'mail';

      async execute(): Promise<{ sent: boolean }> {
        return { sent: true };
      }
    }

    expect(new IconStep().icon).toBe('mail');
  });

  it('supports requiredServices', () => {
    class ServiceStep extends BaseActionStep<
      typeof TestConfigSchema,
      { sent: boolean }
    > {
      readonly type = 'SVC_TEST';
      readonly configSchema = TestConfigSchema;
      readonly name = 'Service Test';
      readonly description = 'test';
      readonly outputSchema = TestOutputSchema;
      readonly category = 'testing';
      override readonly requiredServices = ['db', 'mailer'] as const;

      async execute(): Promise<{ sent: boolean }> {
        return { sent: true };
      }
    }

    const step = new ServiceStep();
    expect(step.requiredServices).toEqual(['db', 'mailer']);
  });

  it('supports credentialSlots', () => {
    class CredStep extends BaseActionStep<
      typeof TestConfigSchema,
      { sent: boolean }
    > {
      readonly type = 'CRED_TEST';
      readonly configSchema = TestConfigSchema;
      readonly name = 'Cred Test';
      readonly description = 'test';
      readonly outputSchema = TestOutputSchema;
      readonly category = 'testing';
      override readonly credentialSlots = [
        // Step 19: slots no longer carry a `types` array.
        { name: 'auth', required: true },
      ] as const;

      async execute(): Promise<{ sent: boolean }> {
        return { sent: true };
      }
    }

    const step = new CredStep();
    expect(step.credentialSlots).toHaveLength(1);
    expect(step.credentialSlots![0]!.name).toBe('auth');
  });

  it('supports mayEmit on action steps', () => {
    class EmitStep extends BaseActionStep<
      typeof TestConfigSchema,
      { sent: boolean }
    > {
      readonly type = 'EMIT_TEST';
      readonly configSchema = TestConfigSchema;
      readonly name = 'Emit Test';
      readonly description = 'test';
      readonly outputSchema = TestOutputSchema;
      readonly category = 'testing';
      override readonly mayEmit = ['TICKET_CREATED'] as const;

      async execute(): Promise<{ sent: boolean }> {
        return { sent: true };
      }
    }

    expect(new EmitStep().mayEmit).toEqual(['TICKET_CREATED']);
  });
});

describe('cloneScope', () => {
  const parent = {
    workflow: { id: 'wf_1', attributes: undefined, metadata: {} },
    execution: { id: 'exec_1' },
    trigger: { type: 'MANUAL' },
    steps: { first: { type: 'CODE', output: { ok: true } } },
    vars: {},
  } as unknown as Parameters<typeof cloneScope>[0];

  it('carries the run identity into a branch', () => {
    // A branch or loop iteration is still the same run. A step nested inside
    // one must be able to name the execution it belongs to, so `execution`
    // travels down with `workflow` and `trigger`.
    expect(cloneScope(parent).execution).toEqual({ id: 'exec_1' });
  });

  it('gives the branch its own steps map', () => {
    const child = cloneScope(parent);
    child.steps['second'] = { type: 'CODE', output: {} } as never;
    expect(parent.steps['second']).toBeUndefined();
    expect(child.steps['first']).toBeDefined();
  });
});
