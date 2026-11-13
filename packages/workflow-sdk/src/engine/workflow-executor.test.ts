import { describe, it, expect, vi, beforeEach } from 'vitest';
import { testRegistry } from '../testing/test-connector.js';
import { z } from 'zod';
import { WorkflowExecutor } from './workflow-executor.js';
import { InMemoryPersistenceAdapter } from '../persistence/in-memory-adapter.js';
import { defineCredential } from '../connectors/core/credentials.js';

/**
 * A bearer credential owned by the TEST connector. It cannot reuse
 * `BUILTIN_BEARER`: a step may only accept types its own connector declares,
 * which is the rule under test two cases down.
 */
const TEST_BEARER = defineCredential({
  connectorId: 'test',
  credType: 'TEST_BEARER',
  label: 'Test Bearer',
  authType: 'bearer',
});
import { ServiceRegistry } from './service-registry.js';
import { InMemoryEventBus } from '../events/in-memory-adapter.js';
import { executionTopic } from '../events/types.js';
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
import type { WorkflowContext, WorkflowStepConfig } from '../types/index.js';
import { variableRef } from '../types/workflow-config.js';
import { CredentialNameSchema } from '../common/credentials.js';
import { GateCategory } from '../types/known-types.js';

// ─── Test steps ───

const EchoConfig = z.object({ message: z.string() });
const EchoOutput = z.object({ echoed: z.string() });

class EchoStep extends BaseActionStep<typeof EchoConfig, { echoed: string }> {
  readonly type = 'ECHO';
  readonly configSchema = EchoConfig;
  readonly name = 'Echo';
  readonly description = 'Echoes the message';
  readonly outputSchema = EchoOutput;
  readonly category = 'testing';

  async execute(
    config: z.infer<typeof EchoConfig>,
    _ctx: StepExecutionContext,
  ): Promise<{ echoed: string }> {
    return { echoed: config.message };
  }
}

const FailConfig = z.object({ error: z.string() });
const FailOutput = z.object({});

class FailStep extends BaseActionStep<typeof FailConfig, Record<string, never>> {
  readonly type = 'FAIL';
  readonly configSchema = FailConfig;
  readonly name = 'Fail';
  readonly description = 'Always fails';
  readonly outputSchema = FailOutput;
  readonly category = 'testing';

  async execute(
    config: z.infer<typeof FailConfig>,
    _ctx: StepExecutionContext,
  ): Promise<Record<string, never>> {
    throw new Error(config.error);
  }
}

const PauseConfig = z.object({ reason: z.string() });
const PauseOutput = z.object({ resumed: z.boolean() });

class PauseStep extends BaseActionStep<typeof PauseConfig, { resumed: boolean }> {
  readonly type = 'PAUSE';
  readonly configSchema = PauseConfig;
  readonly name = 'Pause';
  readonly description = 'Pauses execution';
  readonly outputSchema = PauseOutput;
  readonly category = 'testing';

  async execute(
    config: z.infer<typeof PauseConfig>,
    ctx: StepExecutionContext,
  ): Promise<{ resumed: boolean }> {
    ctx.pause(config.reason, { category: GateCategory.WaitingOnApiCall, externalRef: 'ext_1' });
  }

  override async onResume(
    _rowData: Record<string, unknown>,
    _config: z.infer<typeof PauseConfig>,
    _ctx: StepExecutionContext,
  ): Promise<{ resumed: boolean }> {
    return { resumed: true };
  }
}

/**
 * A number field declared the normal way, with `variableRef`. Expressions have
 * to survive the whole chain to land here — pre-pass, resolver, the string-sink
 * coercion, then `safeParse` — and a plain `z.string()` field would not prove
 * that.
 */
const SumConfig = z.object({ total: variableRef(z.number()), note: z.string().optional() });
const SumOutput = z.object({ total: z.number() });

class SumStep extends BaseActionStep<typeof SumConfig, z.infer<typeof SumOutput>> {
  readonly type = 'SUM';
  readonly configSchema = SumConfig;
  readonly name = 'Sum';
  readonly description = 'Echoes a number back';
  readonly outputSchema = SumOutput;
  readonly category = 'testing';

  async execute(
    config: z.infer<typeof SumConfig>,
    _ctx: StepExecutionContext,
  ): Promise<z.infer<typeof SumOutput>> {
    return { total: config.total as number };
  }
}

const RefConfig = z.object({ to: z.string() });
const RefOutput = z.object({ sent: z.boolean() });

class RefStep extends BaseActionStep<typeof RefConfig, { sent: boolean }> {
  readonly type = 'REF_STEP';
  readonly configSchema = RefConfig;
  readonly name = 'Ref Step';
  readonly description = 'Uses variable refs';
  readonly outputSchema = RefOutput;
  readonly category = 'testing';

  async execute(
    _config: z.infer<typeof RefConfig>,
    _ctx: StepExecutionContext,
  ): Promise<{ sent: boolean }> {
    return { sent: true };
  }
}

// Flaky step — fails N times then succeeds
const FlakyConfig = z.object({ failCount: z.number() });
const FlakyOutput = z.object({ attempts: z.number() });

let flakyAttempts = 0;

class FlakyStep extends BaseActionStep<typeof FlakyConfig, { attempts: number }> {
  readonly type = 'FLAKY';
  readonly configSchema = FlakyConfig;
  readonly name = 'Flaky';
  readonly description = 'Fails N times, then succeeds';
  readonly outputSchema = FlakyOutput;
  readonly category = 'testing';

  async execute(
    config: z.infer<typeof FlakyConfig>,
    _ctx: StepExecutionContext,
  ): Promise<{ attempts: number }> {
    flakyAttempts++;
    if (flakyAttempts <= config.failCount) {
      throw new Error(`flaky failure ${String(flakyAttempts)}`);
    }
    return { attempts: flakyAttempts };
  }
}

// Credential step — reads credential from ctx
const CredConfig = z.object({
  api_token: variableRef(CredentialNameSchema),
});
const CredOutput = z.object({ token: z.string() });

/** Accepts only the TEST_BEARER type — drives the type check. */
class BearerOnlyStep extends BaseActionStep<
  typeof CredConfig,
  { token: string },
  StepExecutionContext
> {
  readonly type = 'BEARER_ONLY';
  readonly configSchema = CredConfig;
  readonly name = 'Bearer only';
  readonly description = 'Accepts one credential shape';
  readonly outputSchema = CredOutput;
  readonly category = 'testing';
  override readonly credentialSlots = [
    { name: 'api_token', required: true },
  ] as const;
  override readonly credential = [TEST_BEARER];

  async execute(
    _config: z.infer<typeof CredConfig>,
    ctx: StepExecutionContext,
  ): Promise<{ token: string }> {
    return { token: (ctx.credentials?.['api_token']?.values as { token: string }).token };
  }
}

class CredStep extends BaseActionStep<
  typeof CredConfig,
  { token: string },
  StepExecutionContext
> {
  readonly type = 'CRED_STEP';
  readonly configSchema = CredConfig;
  readonly name = 'Cred Step';
  readonly description = 'Uses credentials';
  readonly outputSchema = CredOutput;
  readonly category = 'testing';
  override readonly credentialSlots = [
    { name: 'api_token', required: true },
  ] as const;

  async execute(
    _config: z.infer<typeof CredConfig>,
    ctx: StepExecutionContext,
  ): Promise<{ token: string }> {
    const cred = ctx.credentials['api_token'];
    const values = cred?.values as { token?: string } | undefined;
    return { token: values?.token ?? 'missing' };
  }
}

// Credential step — executor reads the selected name from config and injects
// the resolved value before execute().
const DynamicCredConfig = z.object({
  credentialName: variableRef(CredentialNameSchema),
});

class DynamicCredStep extends BaseActionStep<
  typeof DynamicCredConfig,
  { token: string },
  StepExecutionContext
> {
  readonly type = 'DYNAMIC_CRED_STEP';
  readonly configSchema = DynamicCredConfig;
  readonly name = 'Dynamic Cred Step';
  readonly description = 'Receives a selected credential';
  readonly outputSchema = CredOutput;
  readonly category = 'testing';
  override readonly credentialSlots = [
    { name: 'credentialName', required: false },
  ] as const;

  async execute(
    _config: z.infer<typeof DynamicCredConfig>,
    ctx: StepExecutionContext,
  ): Promise<{ token: string }> {
    const cred = ctx.credentials['credentialName'];
    const values = cred?.values as { token?: string } | undefined;
    return { token: values?.token ?? 'missing' };
  }
}

// Optional credential step — credential not required
const OptCredConfig = z.object({
  maybe_token: variableRef(CredentialNameSchema).optional(),
});
const OptCredOutput = z.object({ hasAuth: z.boolean() });

class OptCredStep extends BaseActionStep<
  typeof OptCredConfig,
  { hasAuth: boolean },
  StepExecutionContext
> {
  readonly type = 'OPT_CRED_STEP';
  readonly configSchema = OptCredConfig;
  readonly name = 'Opt Cred Step';
  readonly description = 'Optional credential';
  readonly outputSchema = OptCredOutput;
  readonly category = 'testing';
  override readonly credentialSlots = [
    { name: 'maybe_token', required: false },
  ] as const;

  async execute(
    _config: z.infer<typeof OptCredConfig>,
    ctx: StepExecutionContext,
  ): Promise<{ hasAuth: boolean }> {
    return { hasAuth: ctx.credentials['maybe_token'] !== undefined };
  }
}

// Emitting step — calls ctx.emit during execution
const EmitConfig = z.object({ phase: z.string() });
const EmitOutput = z.object({ done: z.boolean() });

class EmitStep extends BaseActionStep<typeof EmitConfig, { done: boolean }> {
  readonly type = 'EMIT_STEP';
  readonly configSchema = EmitConfig;
  readonly name = 'Emit Step';
  readonly description = 'Emits progress events';
  readonly outputSchema = EmitOutput;
  readonly category = 'testing';

  async execute(
    config: z.infer<typeof EmitConfig>,
    ctx: StepExecutionContext,
  ): Promise<{ done: boolean }> {
    ctx.emit({ type: 'progress', data: { phase: config.phase } });
    ctx.emit({ type: 'log', data: { message: 'step completed' } });
    return { done: true };
  }
}

// Step that captures `ctx.priorState` into its output — for verifying
// review-gate retry + rerunFromStep state inheritance.
const PriorConfig = z.object({ message: z.string() });
const PriorOutput = z.object({
  message: z.string(),
  hadPrior: z.boolean(),
  priorSnapshot: z.unknown().optional(),
  invocation: z.number(),
});

let priorInvocations = 0;

class PriorStateStep extends BaseActionStep<
  typeof PriorConfig,
  z.infer<typeof PriorOutput>
> {
  readonly type = 'PRIOR_STATE_STEP';
  readonly configSchema = PriorConfig;
  readonly name = 'Prior State Step';
  readonly description = 'Captures priorState for testing';
  readonly outputSchema = PriorOutput;
  readonly category = 'testing';

  async execute(
    config: z.infer<typeof PriorConfig>,
    ctx: StepExecutionContext,
  ): Promise<z.infer<typeof PriorOutput>> {
    priorInvocations++;
    return {
      message: config.message,
      hadPrior: ctx.priorState !== undefined,
      ...(ctx.priorState ? { priorSnapshot: ctx.priorState } : {}),
      invocation: priorInvocations,
    };
  }
}

// Counts executions per tag — proves a completed step is memoized (never
// re-executed across pause/resume). Reset `countRuns` at the start of a test.
const CountConfig = z.object({ tag: z.string() });
const CountOutput = z.object({ tag: z.string(), runs: z.number() });
const countRuns: Record<string, number> = {};

class CountStep extends BaseActionStep<typeof CountConfig, z.infer<typeof CountOutput>> {
  readonly type = 'COUNT';
  readonly configSchema = CountConfig;
  readonly name = 'Count';
  readonly description = 'Counts executions by tag';
  readonly outputSchema = CountOutput;
  readonly category = 'testing';

  async execute(
    config: z.infer<typeof CountConfig>,
    _ctx: StepExecutionContext,
  ): Promise<z.infer<typeof CountOutput>> {
    countRuns[config.tag] = (countRuns[config.tag] ?? 0) + 1;
    return { tag: config.tag, runs: countRuns[config.tag] };
  }
}

const ServiceConfig = z.object({});
const ServiceOutput = z.object({ result: z.string() });

class ServiceStep extends BaseActionStep<typeof ServiceConfig, { result: string }> {
  readonly type = 'SERVICE_STEP';
  readonly configSchema = ServiceConfig;
  readonly name = 'Service Step';
  readonly description = 'Uses services';
  readonly outputSchema = ServiceOutput;
  readonly category = 'testing';

  async execute(
    _config: z.infer<typeof ServiceConfig>,
    ctx: StepExecutionContext,
  ): Promise<{ result: string }> {
    const db = ctx.services.get('db') as { query: () => string };
    return { result: db.query() };
  }
}

// Conditional step
const CondConfig = z.object({
  branch: z.boolean(),
  if_true: z.array(z.unknown()),
  if_false: z.array(z.unknown()).optional(),
});
const CondOutput = z.object({ taken: z.string() });

class CondStep extends BaseControlFlowStep<typeof CondConfig, { taken: string }> {
  // Local placeholder — tests the executor's branch-walking machinery, not
  // the real CONDITIONAL step's condition evaluation. Registered under a
  // unique type so it doesn't collide with the auto-registered ConditionalStep.
  readonly type = 'TEST_CONDITIONAL';
  readonly configSchema = CondConfig;
  readonly name = 'Conditional';
  readonly description = 'Branches';
  readonly outputSchema = CondOutput;
  override readonly category = 'control' as const;

  async execute(
    config: z.infer<typeof CondConfig>,
    ctx: ControlFlowExecutionContext,
  ): Promise<{ taken: string }> {
    const branch = config.branch ? 'if_true' : 'if_false';
    const steps = (config.branch ? config.if_true : (config.if_false ?? [])) as WorkflowStepConfig[];
    await ctx.walkBranch(steps, ctx.workflow, branch);
    return { taken: branch };
  }

  override getBranches(config: Record<string, unknown>): Record<string, WorkflowStepConfig[]> {
    return {
      if_true: (config['if_true'] ?? []) as WorkflowStepConfig[],
      if_false: (config['if_false'] ?? []) as WorkflowStepConfig[],
    };
  }
}

// ─── Test trigger ───

const TriggerConfig = z.object({ channel: z.string() });
const TriggerOutput = z.object({ text: z.string() });

class TestTrigger extends BaseTrigger<typeof TriggerConfig> {
  readonly type = 'TEST';
  readonly configSchema = TriggerConfig;
  readonly name = 'Test';
  readonly description = 'Test trigger';
  readonly outputSchema = TriggerOutput;
  readonly category = TriggerCategory.EVENT;
}

// ─── Setup ───

function makeContext(overrides?: Partial<WorkflowContext>): WorkflowContext {
  return {
    workflow: { id: 'wf_1', attributes: undefined, metadata: {} },
    trigger: { type: 'TEST', text: 'hello' },
    steps: {},
    ...overrides,
  };
}

function setup() {
  const persistence = new InMemoryPersistenceAdapter();
  // The built-in CONDITIONAL comes from the connector. The local CondStep
  // placeholder answers to `TEST_CONDITIONAL`, so the branch-walking cases can
  // drive it with a tightly-controlled `branch: boolean` config.
  const connectors = testRegistry({
    steps: [
      new EchoStep(), new FailStep(), new PauseStep(), new RefStep(), new ServiceStep(),
      new BearerOnlyStep(),
      new CondStep(), new FlakyStep(), new CredStep(), new DynamicCredStep(), new OptCredStep(), new EmitStep(), new PriorStateStep(), new CountStep(),
      new SumStep(),
    ],
    triggers: [new TestTrigger()],
    credentials: [TEST_BEARER],
  });


  const services = new ServiceRegistry();
  services.register('db', { query: () => 'db-result' });

  const executor = new WorkflowExecutor(
    persistence,
    connectors,
    services,
  );

  return { persistence, executor, connectors, services };
}

async function seedExecution(
  persistence: InMemoryPersistenceAdapter,
  config: {
    steps: WorkflowStepConfig[];
    trigger?: { type: string; config: Record<string, unknown> };
    settings?: { onError?: 'stop' | 'continue'; retry?: { maxAttempts: number; intervalMs: number } };
  },
  context?: WorkflowContext,
): Promise<string> {
  persistence.seedWorkflow({
    id: 'wf_1',
    status: 'ACTIVE',
    config: JSON.stringify({
      trigger: config.trigger ?? { type: 'TEST', config: { channel: 'ch_1' } },
      steps: config.steps,
      ...(config.settings ? { settings: config.settings } : {}),
    }),
    metadata: null,
    eventType: 'TEST',
  });
  return persistence.createExecution({
    workflowId: 'wf_1',
    status: 'PENDING',
    context: JSON.stringify(context ?? makeContext()),
  });
}

/**
 * Route a resume payload into a specific gate's node record — what
 * `runtime.resume({ nodePath, data })` does, simulated at the executor level so
 * these integration tests can resolve one branch gate at a time.
 */
async function patchGate(
  persistence: InMemoryPersistenceAdapter,
  execId: string,
  nodePath: string,
  payload: Record<string, unknown> = { action: 'approve' },
): Promise<void> {
  const row = await persistence.getStep(execId, nodePath);
  if (!row) throw new Error(`no gate at ${nodePath}`);
  const data = row.data ? (JSON.parse(row.data) as Record<string, unknown>) : {};
  data['resumePayload'] = payload;
  await persistence.upsertStep(execId, nodePath, {
    status: row.status,
    executorType: row.executorType,
    data: JSON.stringify(data),
  });
}

// ─── Tests ───

/**
 * Route an answer to the open gate, as `runtime.resume` does.
 *
 * There is no global resume slot any more: an answer belongs to a node, so a
 * test has to say which one — and with one gate open, that is this.
 */
async function answerGate(
  persistence: InMemoryPersistenceAdapter,
  executionId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const rows = await persistence.getStepRows(executionId);
  const parked = rows.filter((r) => r.status === 'EXTERNAL_WAIT' || r.status === 'REVIEW_WAIT');
  // A control frame gets a marker record too; the answer belongs to the leaf.
  const gate = parked.find((r) => r.executorType === 'deterministic') ?? parked[0];
  if (!gate) throw new Error(`no open gate on ${executionId}`);
  const data = gate.data ? (JSON.parse(gate.data) as Record<string, unknown>) : {};
  data['resumePayload'] = payload;
  await persistence.upsertStep(executionId, gate.stepName, {
    status: gate.status,
    executorType: gate.executorType,
    data: JSON.stringify(data),
    attributes: {} as never,
    ...(gate.category !== undefined ? { category: gate.category } : {}),
  });
}

describe('WorkflowExecutor', () => {
  describe('single step execution', () => {
    it('executes a simple step and completes', async () => {
      const { persistence, executor } = setup();
      const execId = await seedExecution(persistence, {
        steps: [{ id: 'echo1', type: 'ECHO', config: { message: 'hi' } }],
      });

      await executor.runExecution(execId);

      const exec = await persistence.getExecution(execId);
      expect(exec!.status).toBe('COMPLETED');

      const state = await persistence.getExecutionState(execId);
      const ctx = JSON.parse(state!.context!) as WorkflowContext;
      expect(ctx.steps['echo1']!.output).toEqual({ echoed: 'hi' });
    });

    it('marks execution FAILED on step error', async () => {
      const { persistence, executor } = setup();
      const execId = await seedExecution(persistence, {
        steps: [{ id: 'fail1', type: 'FAIL', config: { error: 'boom' } }],
      });

      await expect(executor.runExecution(execId)).rejects.toThrow('boom');

      const exec = await persistence.getExecution(execId);
      expect(exec!.status).toBe('FAILED');

      const state = await persistence.getExecutionState(execId);
      const ctx = JSON.parse(state!.context!) as WorkflowContext;
      expect(ctx.__meta?.error).toBe('boom');
    });
  });

  describe('multi-step execution', () => {
    it('executes steps sequentially', async () => {
      const { persistence, executor } = setup();
      const execId = await seedExecution(persistence, {
        steps: [
          { id: 'echo1', type: 'ECHO', config: { message: 'first' } },
          { id: 'echo2', type: 'ECHO', config: { message: 'second' } },
        ],
      });

      await executor.runExecution(execId);

      const state = await persistence.getExecutionState(execId);
      const ctx = JSON.parse(state!.context!) as WorkflowContext;
      expect(ctx.steps['echo1']!.output).toEqual({ echoed: 'first' });
      expect(ctx.steps['echo2']!.output).toEqual({ echoed: 'second' });
    });

    it('stops at failing step', async () => {
      const { persistence, executor } = setup();
      const execId = await seedExecution(persistence, {
        steps: [
          { id: 'echo1', type: 'ECHO', config: { message: 'ok' } },
          { id: 'fail1', type: 'FAIL', config: { error: 'oops' } },
          { id: 'echo2', type: 'ECHO', config: { message: 'unreachable' } },
        ],
      });

      await expect(executor.runExecution(execId)).rejects.toThrow('oops');

      const state = await persistence.getExecutionState(execId);
      const ctx = JSON.parse(state!.context!) as WorkflowContext;
      expect(ctx.steps['echo1']).toBeDefined();
      expect(ctx.steps['echo2']).toBeUndefined();
    });
  });

  describe('variable resolution', () => {
    it('resolves {{trigger.field}} in step config', async () => {
      const { persistence, executor } = setup();
      const execId = await seedExecution(persistence, {
        steps: [
          { id: 'ref1', type: 'REF_STEP', config: { to: '{{trigger.text}}' } },
        ],
      });

      await executor.runExecution(execId);

      const state = await persistence.getExecutionState(execId);
      const ctx = JSON.parse(state!.context!) as WorkflowContext;
      expect(ctx.steps['ref1']!.input).toEqual({ to: 'hello' });
    });

    it('resolves {{stepId.output.field}} in step config', async () => {
      const { persistence, executor } = setup();
      const execId = await seedExecution(persistence, {
        steps: [
          { id: 'echo1', type: 'ECHO', config: { message: 'hi' } },
          {
            id: 'ref1',
            type: 'REF_STEP',
            config: { to: '{{echo1.output.echoed}}' },
          },
        ],
      });

      await executor.runExecution(execId);

      const state = await persistence.getExecutionState(execId);
      const ctx = JSON.parse(state!.context!) as WorkflowContext;
      expect(ctx.steps['ref1']!.input).toEqual({ to: 'hi' });
    });
  });

  describe('expressions', () => {
    /** A context carrying line items, which is the case this was built for. */
    const withItems = () =>
      makeContext({
        trigger: {
          type: 'TEST',
          text: 'hello',
          items: [
            { tag: 'fee', amount: 100 },
            { tag: 'tax', amount: 20.5 },
            { tag: 'fee', amount: 105 },
          ],
        },
      });

    it('sums a list into a number field', async () => {
      const { persistence, executor } = setup();
      const execId = await seedExecution(
        persistence,
        { steps: [{ id: 'sum1', type: 'SUM', config: { total: '{% $sum(trigger.items.amount) %}' } }] },
        withItems(),
      );

      await executor.runExecution(execId);

      const state = await persistence.getExecutionState(execId);
      const ctx = JSON.parse(state!.context!) as WorkflowContext;
      // Through every layer: the number arrives typed, not as "225.5".
      expect(ctx.steps['sum1']!.input).toEqual({ total: 225.5 });
      expect(ctx.steps['sum1']!.output).toEqual({ total: 225.5 });
    });

    it('filters before summing', async () => {
      const { persistence, executor } = setup();
      const execId = await seedExecution(
        persistence,
        {
          steps: [
            {
              id: 'sum1',
              type: 'SUM',
              config: { total: '{% $sum(trigger.items[tag = "fee"].amount) %}' },
            },
          ],
        },
        withItems(),
      );

      await executor.runExecution(execId);

      const state = await persistence.getExecutionState(execId);
      const ctx = JSON.parse(state!.context!) as WorkflowContext;
      expect(ctx.steps['sum1']!.input).toEqual({ total: 205 });
    });

    it("computes over an earlier step's output", async () => {
      const { persistence, executor } = setup();
      const execId = await seedExecution(persistence, {
        steps: [
          { id: 'echo1', type: 'ECHO', config: { message: 'hi there' } },
          { id: 'ref1', type: 'REF_STEP', config: { to: '{% $uppercase(steps.echo1.output.echoed) %}' } },
        ],
      });

      await executor.runExecution(execId);

      const state = await persistence.getExecutionState(execId);
      const ctx = JSON.parse(state!.context!) as WorkflowContext;
      expect(ctx.steps['ref1']!.input).toEqual({ to: 'HI THERE' });
    });

    it('mixes an expression with text, and with a ref in the same config', async () => {
      const { persistence, executor } = setup();
      const execId = await seedExecution(
        persistence,
        {
          steps: [
            {
              id: 'sum1',
              type: 'SUM',
              config: {
                total: '{% $count(trigger.items) %}',
                note: '{{trigger.text}}: {% $sum(trigger.items.amount) %} over {% $count(trigger.items) %}',
              },
            },
          ],
        },
        withItems(),
      );

      await executor.runExecution(execId);

      const state = await persistence.getExecutionState(execId);
      const ctx = JSON.parse(state!.context!) as WorkflowContext;
      expect(ctx.steps['sum1']!.input).toEqual({ total: 3, note: 'hello: 225.5 over 3' });
    });

    it('fails the step naming the field and the expression', async () => {
      const { persistence, executor } = setup();
      const execId = await seedExecution(
        persistence,
        { steps: [{ id: 'sum1', type: 'SUM', config: { total: '{% trigger.text * 2 %}' } }] },
        withItems(),
      );

      await expect(executor.runExecution(execId)).rejects.toThrow(/total/);

      const exec = await persistence.getExecution(execId);
      expect(exec!.status).toBe('FAILED');
      const state = await persistence.getExecutionState(execId);
      const ctx = JSON.parse(state!.context!) as WorkflowContext;
      expect(ctx.__meta?.error).toContain('trigger.text * 2');
    });

    it('leaves a config without expressions exactly as before', async () => {
      const { persistence, executor } = setup();
      const execId = await seedExecution(persistence, {
        steps: [{ id: 'ref1', type: 'REF_STEP', config: { to: '{{trigger.text}}' } }],
      });

      await executor.runExecution(execId);

      const state = await persistence.getExecutionState(execId);
      const ctx = JSON.parse(state!.context!) as WorkflowContext;
      expect(ctx.steps['ref1']!.input).toEqual({ to: 'hello' });
    });
  });

  describe('pause and resume', () => {
    it('pauses execution and sets EXTERNAL_WAIT', async () => {
      const { persistence, executor } = setup();
      const execId = await seedExecution(persistence, {
        steps: [
          { id: 'pause1', type: 'PAUSE', config: { reason: 'waiting' } },
          { id: 'echo1', type: 'ECHO', config: { message: 'after' } },
        ],
      });

      await executor.runExecution(execId);

      const exec = await persistence.getExecution(execId);
      expect(exec!.status).toBe('EXTERNAL_WAIT');

      const state = await persistence.getExecutionState(execId);
      expect(state!.currentStepIndex).toBe(0);
    });

    it('records who the gate waits on', async () => {
      const { persistence, executor } = setup();
      const execId = await seedExecution(persistence, {
        steps: [{ id: 'pause1', type: 'PAUSE', config: { reason: 'waiting' } }],
      });

      await executor.runExecution(execId);

      // The step said WaitingOnApiCall; the inbox reads it off the record,
      // not out of the pause state's JSON.
      const step = await persistence.getStep(execId, 'pause1');
      expect(step!.category).toBe(GateCategory.WaitingOnApiCall);
    });

    it('resumes from paused state and completes', async () => {
      const { persistence, executor } = setup();
      const execId = await seedExecution(persistence, {
        steps: [
          { id: 'pause1', type: 'PAUSE', config: { reason: 'waiting' } },
          { id: 'echo1', type: 'ECHO', config: { message: 'after' } },
        ],
      });

      // First run: pauses
      await executor.runExecution(execId);
      expect((await persistence.getExecution(execId))!.status).toBe(
        'EXTERNAL_WAIT',
      );

      // Resume
      // An answer belongs to a node: a bare re-run resumes nothing.
      await answerGate(persistence, execId, { action: 'approve' });
      await executor.runExecution(execId);

      const exec = await persistence.getExecution(execId);
      expect(exec!.status).toBe('COMPLETED');

      const state = await persistence.getExecutionState(execId);
      const ctx = JSON.parse(state!.context!) as WorkflowContext;
      expect(ctx.steps['pause1']!.output).toEqual({ resumed: true });
      expect(ctx.steps['echo1']!.output).toEqual({ echoed: 'after' });
    });
  });

  describe('control flow (conditional)', () => {
    it('walks the true branch', async () => {
      const { persistence, executor } = setup();
      const execId = await seedExecution(persistence, {
        steps: [
          {
            id: 'cond1',
            type: 'TEST_CONDITIONAL',
            config: {
              branch: true,
              if_true: [
                { id: 'inner1', type: 'ECHO', config: { message: 'yes' } },
              ],
              if_false: [
                { id: 'inner2', type: 'ECHO', config: { message: 'no' } },
              ],
            },
          },
        ],
      });

      await executor.runExecution(execId);

      const state = await persistence.getExecutionState(execId);
      const ctx = JSON.parse(state!.context!) as WorkflowContext;
      expect(ctx.steps['cond1']!.output).toEqual({ taken: 'if_true' });
      expect(ctx.steps['inner1']!.output).toEqual({ echoed: 'yes' });
      expect(ctx.steps['inner2']).toBeUndefined();
    });

    it('walks the false branch', async () => {
      const { persistence, executor } = setup();
      const execId = await seedExecution(persistence, {
        steps: [
          {
            id: 'cond1',
            type: 'TEST_CONDITIONAL',
            config: {
              branch: false,
              if_true: [
                { id: 'inner1', type: 'ECHO', config: { message: 'yes' } },
              ],
              if_false: [
                { id: 'inner2', type: 'ECHO', config: { message: 'no' } },
              ],
            },
          },
        ],
      });

      await executor.runExecution(execId);

      const state = await persistence.getExecutionState(execId);
      const ctx = JSON.parse(state!.context!) as WorkflowContext;
      expect(ctx.steps['cond1']!.output).toEqual({ taken: 'if_false' });
      expect(ctx.steps['inner2']!.output).toEqual({ echoed: 'no' });
      expect(ctx.steps['inner1']).toBeUndefined();
    });
  });

  describe('services', () => {
    it('step accesses services via ctx.services', async () => {
      const { persistence, executor } = setup();
      const execId = await seedExecution(persistence, {
        steps: [
          { id: 'svc1', type: 'SERVICE_STEP', config: {} },
        ],
      });

      await executor.runExecution(execId);

      const state = await persistence.getExecutionState(execId);
      const ctx = JSON.parse(state!.context!) as WorkflowContext;
      expect(ctx.steps['svc1']!.output).toEqual({ result: 'db-result' });
    });
  });

  describe('startExecution', () => {
    it('creates and runs execution', async () => {
      const { persistence, executor } = setup();
      persistence.seedWorkflow({
        id: 'wf_1',
        status: 'ACTIVE',
        config: JSON.stringify({
          trigger: { type: 'TEST', config: { channel: 'ch_1' } },
          steps: [{ id: 'echo1', type: 'ECHO', config: { message: 'auto' } }],
        }),
        metadata: null,
        eventType: 'TEST',
      });

      const execId = await executor.startExecution('wf_1', makeContext());

      const exec = await persistence.getExecution(execId);
      expect(exec!.status).toBe('COMPLETED');
    });
  });

  describe('edge cases', () => {
    it('skips unknown execution', async () => {
      const { executor } = setup();
      await executor.runExecution('nonexistent');
      // No error thrown
    });

    it('cancels execution when workflow is missing', async () => {
      const { persistence, executor } = setup();
      const execId = await persistence.createExecution({
        workflowId: 'missing_wf',
        status: 'PENDING',
        context: JSON.stringify(makeContext()),
      });

      await executor.runExecution(execId);

      const exec = await persistence.getExecution(execId);
      expect(exec!.status).toBe('CANCELLED');
    });

    it('skips non-pending/non-resume executions', async () => {
      const { persistence, executor } = setup();
      persistence.seedWorkflow({
        id: 'wf_1',
        status: 'ACTIVE',
        config: '{}',
        metadata: null,
        eventType: 'TEST',
      });
      const execId = await persistence.createExecution({
        workflowId: 'wf_1',
        status: 'COMPLETED',
        context: JSON.stringify(makeContext()),
      });
      await persistence.updateExecutionStatus(execId, 'COMPLETED');

      await executor.runExecution(execId);
      // No error, status unchanged
      expect((await persistence.getExecution(execId))!.status).toBe(
        'COMPLETED',
      );
    });

    it('handles empty steps array', async () => {
      const { persistence, executor } = setup();
      const execId = await seedExecution(persistence, { steps: [] });

      await executor.runExecution(execId);

      expect((await persistence.getExecution(execId))!.status).toBe(
        'COMPLETED',
      );
    });
  });

  describe('step tracking in persistence', () => {
    it('persists step rows', async () => {
      const { persistence, executor } = setup();
      const execId = await seedExecution(persistence, {
        steps: [
          { id: 'echo1', type: 'ECHO', config: { message: 'hi' } },
          { id: 'echo2', type: 'ECHO', config: { message: 'bye' } },
        ],
      });

      await executor.runExecution(execId);

      const rows = await persistence.getStepRows(execId);
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.status === 'COMPLETED')).toBe(true);
    });

    it('marks failed step in persistence', async () => {
      const { persistence, executor } = setup();
      const execId = await seedExecution(persistence, {
        steps: [
          { id: 'fail1', type: 'FAIL', config: { error: 'boom' } },
        ],
      });

      await expect(executor.runExecution(execId)).rejects.toThrow('boom');

      const step = await persistence.getStep(execId, 'fail1');
      expect(step!.status).toBe('FAILED');
      const data = JSON.parse(step!.data!) as { error: string };
      expect(data.error).toBe('boom');
    });

    it('marks paused step as EXTERNAL_WAIT', async () => {
      const { persistence, executor } = setup();
      const execId = await seedExecution(persistence, {
        steps: [
          { id: 'pause1', type: 'PAUSE', config: { reason: 'wait' } },
        ],
      });

      await executor.runExecution(execId);

      const step = await persistence.getStep(execId, 'pause1');
      expect(step!.status).toBe('EXTERNAL_WAIT');
    });
  });

  // ─── Phase 2: Nested pause/resume ───

  describe('nested pause inside branches', () => {
    it('pauses inside a conditional branch and records the node', async () => {
      const { persistence, executor } = setup();
      const execId = await seedExecution(persistence, {
        steps: [
          {
            id: 'cond1',
            type: 'TEST_CONDITIONAL',
            config: {
              branch: true,
              if_true: [
                { id: 'inner_echo', type: 'ECHO', config: { message: 'before' } },
                { id: 'inner_pause', type: 'PAUSE', config: { reason: 'nested wait' } },
              ],
              if_false: [],
            },
          },
          { id: 'after', type: 'ECHO', config: { message: 'after cond' } },
        ],
      });

      await executor.runExecution(execId);

      // Should be paused
      const exec = await persistence.getExecution(execId);
      expect(exec!.status).toBe('EXTERNAL_WAIT');

      // The paused leaf is addressed by its node-path key (no positional cursor).
      const pausedRow = await persistence.getStep(execId, 'cond1:if_true#0/inner_pause');
      expect(pausedRow!.status).toBe('EXTERNAL_WAIT');
      // The enclosing conditional is marked waiting too.
      const condRow = await persistence.getStep(execId, 'cond1');
      expect(condRow!.status).toBe('EXTERNAL_WAIT');

      // inner_echo should have been executed
      const state = await persistence.getExecutionState(execId);
      const ctx = JSON.parse(state!.context!) as WorkflowContext;
      expect(ctx.steps['inner_echo']!.output).toEqual({ echoed: 'before' });
      // 'after' step should NOT have run
      expect(ctx.steps['after']).toBeUndefined();
    });

    it('resumes inside a conditional branch and completes', async () => {
      const { persistence, executor } = setup();
      const execId = await seedExecution(persistence, {
        steps: [
          {
            id: 'cond1',
            type: 'TEST_CONDITIONAL',
            config: {
              branch: true,
              if_true: [
                { id: 'inner_echo', type: 'ECHO', config: { message: 'before' } },
                { id: 'inner_pause', type: 'PAUSE', config: { reason: 'nested wait' } },
              ],
              if_false: [],
            },
          },
          { id: 'after', type: 'ECHO', config: { message: 'after cond' } },
        ],
      });

      // First run: pauses inside branch
      await executor.runExecution(execId);
      expect((await persistence.getExecution(execId))!.status).toBe('EXTERNAL_WAIT');

      // Resume
      // An answer belongs to a node: a bare re-run resumes nothing.
      await answerGate(persistence, execId, { action: 'approve' });
      await executor.runExecution(execId);

      const exec = await persistence.getExecution(execId);
      expect(exec!.status).toBe('COMPLETED');

      const state = await persistence.getExecutionState(execId);
      const ctx = JSON.parse(state!.context!) as WorkflowContext;
      // inner_pause should have resumed
      expect(ctx.steps['inner_pause']!.output).toEqual({ resumed: true });
      // after step should have run
      expect(ctx.steps['after']!.output).toEqual({ echoed: 'after cond' });
    });

    it('pause at first step in branch works correctly', async () => {
      const { persistence, executor } = setup();
      const execId = await seedExecution(persistence, {
        steps: [
          {
            id: 'cond1',
            type: 'TEST_CONDITIONAL',
            config: {
              branch: false,
              if_true: [],
              if_false: [
                { id: 'inner_pause', type: 'PAUSE', config: { reason: 'first step' } },
                { id: 'inner_echo', type: 'ECHO', config: { message: 'after pause' } },
              ],
            },
          },
        ],
      });

      // Pauses
      await executor.runExecution(execId);
      const pausedRow = await persistence.getStep(execId, 'cond1:if_false#0/inner_pause');
      expect(pausedRow!.status).toBe('EXTERNAL_WAIT');

      // Resume
      // An answer belongs to a node: a bare re-run resumes nothing.
      await answerGate(persistence, execId, { action: 'approve' });
      await executor.runExecution(execId);
      expect((await persistence.getExecution(execId))!.status).toBe('COMPLETED');

      const finalState = await persistence.getExecutionState(execId);
      const ctx = JSON.parse(finalState!.context!) as WorkflowContext;
      expect(ctx.steps['inner_pause']!.output).toEqual({ resumed: true });
      expect(ctx.steps['inner_echo']!.output).toEqual({ echoed: 'after pause' });
    });
  });

  // ─── WAIT inside PARALLEL / LOOP (the durable-pause fix) ───

  describe('pause/resume inside PARALLEL branches', () => {
    const parallelWorkflow = {
      steps: [
        {
          id: 'par1',
          type: 'PARALLEL',
          config: {
            merge: 'allSettled',
            branches: {
              swot: [
                { id: 'swot_pre', type: 'ECHO', config: { message: 'swot-pre' } },
                { id: 'swot_gate', type: 'PAUSE', config: { reason: 'approve swot' } },
                { id: 'swot_post', type: 'ECHO', config: { message: 'swot-post' } },
              ],
              risk: [
                { id: 'risk_gate', type: 'PAUSE', config: { reason: 'approve risk' } },
              ],
            },
          },
        },
        { id: 'after', type: 'ECHO', config: { message: 'after parallel' } },
      ] as unknown as WorkflowStepConfig[],
    };

    it('parks each branch gate under its own node-path; pre-steps run, post-steps do not', async () => {
      const { persistence, executor } = setup();
      const execId = await seedExecution(persistence, parallelWorkflow);

      await executor.runExecution(execId);

      expect((await persistence.getExecution(execId))!.status).toBe('EXTERNAL_WAIT');
      expect((await persistence.getStep(execId, 'par1:swot#0/swot_gate'))!.status).toBe('EXTERNAL_WAIT');
      expect((await persistence.getStep(execId, 'par1:risk#0/risk_gate'))!.status).toBe('EXTERNAL_WAIT');
      // swot's pre-step ran; its post-step has not.
      expect((await persistence.getStep(execId, 'par1:swot#0/swot_pre'))!.status).toBe('COMPLETED');
      expect(await persistence.getStep(execId, 'par1:swot#0/swot_post')).toBeNull();
    });

    it('resolves one branch at a time, then completes (only one gate resolved)', async () => {
      const { persistence, executor } = setup();
      const execId = await seedExecution(persistence, parallelWorkflow);
      await executor.runExecution(execId);

      // Resolve ONLY swot.
      await patchGate(persistence, execId, 'par1:swot#0/swot_gate');
      await executor.runExecution(execId);

      // swot advanced + completed; risk still parked → execution still waiting.
      expect((await persistence.getExecution(execId))!.status).toBe('EXTERNAL_WAIT');
      expect((await persistence.getStep(execId, 'par1:swot#0/swot_post'))!.status).toBe('COMPLETED');
      expect((await persistence.getStep(execId, 'par1:risk#0/risk_gate'))!.status).toBe('EXTERNAL_WAIT');
      // The downstream step must NOT have run yet.
      expect(await persistence.getStep(execId, 'after')).toBeNull();

      // Resolve risk → whole step joins and the workflow completes.
      await patchGate(persistence, execId, 'par1:risk#0/risk_gate');
      await executor.runExecution(execId);

      expect((await persistence.getExecution(execId))!.status).toBe('COMPLETED');
      const ctx = JSON.parse((await persistence.getExecutionState(execId))!.context!) as WorkflowContext;
      expect(ctx.steps['after']!.output).toEqual({ echoed: 'after parallel' });
      const parOut = ctx.steps['par1']!.output as {
        branches: Record<string, { steps: Record<string, { output: Record<string, unknown> }> }>;
      };
      expect(parOut.branches['swot']!.steps['swot_post']!.output).toEqual({ echoed: 'swot-post' });
      expect(parOut.branches['risk']!.steps['risk_gate']!.output).toEqual({ resumed: true });
    });

    it('resolving both gates at once completes in a single pass', async () => {
      const { persistence, executor } = setup();
      const execId = await seedExecution(persistence, parallelWorkflow);
      await executor.runExecution(execId);

      await patchGate(persistence, execId, 'par1:swot#0/swot_gate');
      await patchGate(persistence, execId, 'par1:risk#0/risk_gate');
      await executor.runExecution(execId);

      expect((await persistence.getExecution(execId))!.status).toBe('COMPLETED');
    });
  });

  describe('pause/resume inside LOOP iterations', () => {
    const loopWorkflow = {
      steps: [
        {
          id: 'loop1',
          type: 'LOOP',
          config: {
            source: 'trigger.items',
            body: [
              { id: 'body_gate', type: 'PAUSE', config: { reason: 'approve item' } },
            ],
            maxIterations: 10,
          },
        },
        { id: 'after', type: 'ECHO', config: { message: 'after loop' } },
      ] as unknown as WorkflowStepConfig[],
    };
    const loopContext = makeContext({ trigger: { type: 'TEST', items: ['a', 'b'] } });

    it('a WAIT in iteration 1 resumes that iteration, not iteration 0', async () => {
      const { persistence, executor } = setup();
      const execId = await seedExecution(persistence, loopWorkflow, loopContext);

      // Iteration 0 parks (sequential loop — iteration 1 hasn't started).
      await executor.runExecution(execId);
      expect((await persistence.getStep(execId, 'loop1:body#0/body_gate'))!.status).toBe('EXTERNAL_WAIT');
      expect(await persistence.getStep(execId, 'loop1:body#1/body_gate')).toBeNull();

      // Resolve iteration 0 → iteration 1 starts and parks at its own record.
      await patchGate(persistence, execId, 'loop1:body#0/body_gate');
      await executor.runExecution(execId);
      expect((await persistence.getStep(execId, 'loop1:body#0/body_gate'))!.status).toBe('COMPLETED');
      expect((await persistence.getStep(execId, 'loop1:body#1/body_gate'))!.status).toBe('EXTERNAL_WAIT');
      expect((await persistence.getExecution(execId))!.status).toBe('EXTERNAL_WAIT');

      // Resolve iteration 1 → loop joins and the workflow completes.
      await patchGate(persistence, execId, 'loop1:body#1/body_gate');
      await executor.runExecution(execId);
      expect((await persistence.getExecution(execId))!.status).toBe('COMPLETED');
      const ctx = JSON.parse((await persistence.getExecutionState(execId))!.context!) as WorkflowContext;
      expect(ctx.steps['loop1']!.output).toEqual({ results: ['a', 'b'], count: 2 });
      expect(ctx.steps['after']!.output).toEqual({ echoed: 'after loop' });
    });
  });

  describe('pause/resume inside MAP iterations (concurrent)', () => {
    it('parks each iteration gate concurrently and resumes each by node-path', async () => {
      const { persistence, executor } = setup();
      const execId = await seedExecution(
        persistence,
        {
          steps: [
            {
              id: 'map1',
              type: 'MAP',
              config: {
                source: 'trigger.owners',
                body: [{ id: 'gate', type: 'PAUSE', config: { reason: 'approve owner' } }],
              },
            },
            { id: 'after', type: 'ECHO', config: { message: 'all validated' } },
          ] as unknown as WorkflowStepConfig[],
        },
        makeContext({ trigger: { type: 'TEST', owners: ['a', 'b'] } }),
      );

      // Both iterations run concurrently and park at once (unlike LOOP, which
      // would only open iteration 0's gate first).
      await executor.runExecution(execId);
      expect((await persistence.getExecution(execId))!.status).toBe('EXTERNAL_WAIT');
      expect((await persistence.getStep(execId, 'map1:item#0/gate'))!.status).toBe('EXTERNAL_WAIT');
      expect((await persistence.getStep(execId, 'map1:item#1/gate'))!.status).toBe('EXTERNAL_WAIT');
      expect(await persistence.getStep(execId, 'after')).toBeNull();

      // Resolve item 0 only → it completes, item 1 still parked.
      await patchGate(persistence, execId, 'map1:item#0/gate');
      await executor.runExecution(execId);
      expect((await persistence.getStep(execId, 'map1:item#0/gate'))!.status).toBe('COMPLETED');
      expect((await persistence.getStep(execId, 'map1:item#1/gate'))!.status).toBe('EXTERNAL_WAIT');
      expect((await persistence.getExecution(execId))!.status).toBe('EXTERNAL_WAIT');

      // Resolve item 1 → MAP joins, workflow completes; output is index-aligned.
      await patchGate(persistence, execId, 'map1:item#1/gate');
      await executor.runExecution(execId);
      expect((await persistence.getExecution(execId))!.status).toBe('COMPLETED');
      const ctx = JSON.parse((await persistence.getExecutionState(execId))!.context!) as WorkflowContext;
      expect(ctx.steps['after']!.output).toEqual({ echoed: 'all validated' });
      const mapOut = ctx.steps['map1']!.output as {
        count: number;
        items: Array<{ index: number; item: unknown; steps: Record<string, { output: Record<string, unknown> }> }>;
      };
      expect(mapOut.count).toBe(2);
      expect(mapOut.items.map((it) => it.item)).toEqual(['a', 'b']);
      expect(mapOut.items[0]!.steps['gate']!.output).toEqual({ resumed: true });
    });

    it('fans out concurrently to completion — each iteration gets its own item scope, output index-aligned', async () => {
      const { persistence, executor } = setup();
      const execId = await seedExecution(
        persistence,
        {
          steps: [
            {
              id: 'map1',
              type: 'MAP',
              config: {
                source: 'trigger.owners',
                // Each body step reads ITS iteration's item via the `__map` scope var —
                // proves per-iteration isolation under concurrency (not a shared scope).
                body: [{ id: 'pan', type: 'ECHO', config: { message: '{{steps.__map.output.currentItem}}' } }],
              },
            },
            { id: 'after', type: 'ECHO', config: { message: 'done' } },
          ] as unknown as WorkflowStepConfig[],
        },
        makeContext({ trigger: { type: 'TEST', owners: ['alice', 'bob', 'carol'] } }),
      );

      await executor.runExecution(execId);
      expect((await persistence.getExecution(execId))!.status).toBe('COMPLETED');

      // One record per iteration, all completed, node-path keyed by index.
      for (let i = 0; i < 3; i++) {
        expect((await persistence.getStep(execId, `map1:item#${i}/pan`))!.status).toBe('COMPLETED');
      }

      const ctx = JSON.parse((await persistence.getExecutionState(execId))!.context!) as WorkflowContext;
      const mapOut = ctx.steps['map1']!.output as {
        count: number;
        items: Array<{ index: number; item: unknown; steps: Record<string, { output: Record<string, unknown> }> }>;
      };
      expect(mapOut.count).toBe(3);
      expect(mapOut.items.map((it) => it.index)).toEqual([0, 1, 2]); // sorted, index-aligned
      expect(mapOut.items.map((it) => it.item)).toEqual(['alice', 'bob', 'carol']);
      // Each iteration echoed its OWN item — confirms scope isolation across concurrent branches.
      expect(mapOut.items.map((it) => it.steps['pan']!.output['echoed'])).toEqual(['alice', 'bob', 'carol']);
    });

    it('emits node-path on lifecycle events so the UI can patch per-iteration records', async () => {
      const { persistence } = setup();
      const bus = new InMemoryEventBus();
      const connectors = testRegistry({ steps: [new EchoStep()], triggers: [new TestTrigger()] });
      const busExecutor = new WorkflowExecutor(persistence, connectors, new ServiceRegistry(), { eventBus: bus });

      persistence.seedWorkflow({
        id: 'wf_map_evt',
        status: 'ACTIVE',
        config: JSON.stringify({
          trigger: { type: 'TEST', config: { channel: 'ch_1' } },
          steps: [
            { id: 'map1', type: 'MAP', config: { source: 'trigger.owners', body: [{ id: 'pan', type: 'ECHO', config: { message: 'check' } }] } },
          ],
        }),
        metadata: null,
        eventType: 'TEST',
      });
      const execId = await persistence.createExecution({
        workflowId: 'wf_map_evt',
        status: 'PENDING',
        context: JSON.stringify(makeContext({ trigger: { type: 'TEST', owners: ['a', 'b'] }, workflow: { id: 'wf_map_evt', metadata: {} } })),
      });
      const captured: Array<{ event: string; data: unknown }> = [];
      await bus.subscribe(executionTopic(execId), (e) => captured.push(e));

      await busExecutor.runExecution(execId);

      // Each iteration's step events carry the FULL node-path (not just the bare id),
      // so the UI can patch the exact per-iteration record without a refetch.
      const panCompletions = captured
        .filter((e) => e.event === 'step_completed')
        .map((e) => e.data as { stepName: string; nodePath?: string })
        .filter((d) => d.stepName === 'pan');
      expect(panCompletions.map((d) => d.nodePath).sort()).toEqual(['map1:item#0/pan', 'map1:item#1/pan']);
    });

    it('processes every item with no cap', async () => {
      const { persistence, executor } = setup();
      const execId = await seedExecution(
        persistence,
        {
          steps: [
            {
              id: 'map1',
              type: 'MAP',
              config: {
                source: 'trigger.owners',
                body: [{ id: 'pan', type: 'ECHO', config: { message: 'check' } }],
              },
            },
          ] as unknown as WorkflowStepConfig[],
        },
        makeContext({ trigger: { type: 'TEST', owners: ['a', 'b', 'c', 'd', 'e'] } }),
      );

      await executor.runExecution(execId);
      expect((await persistence.getExecution(execId))!.status).toBe('COMPLETED');
      for (let i = 0; i < 5; i++) {
        expect((await persistence.getStep(execId, `map1:item#${i}/pan`))!.status).toBe('COMPLETED');
      }

      const ctx = JSON.parse((await persistence.getExecutionState(execId))!.context!) as WorkflowContext;
      expect((ctx.steps['map1']!.output as { count: number }).count).toBe(5);
    });
  });

  describe('pause/resume — deep nesting, memoization, switch, review-in-branch, delay', () => {
    it('resumes a WAIT nested PARALLEL → LOOP → body (pause at any depth)', async () => {
      const { persistence, executor } = setup();
      const execId = await seedExecution(
        persistence,
        {
          steps: [
            {
              id: 'par1',
              type: 'PARALLEL',
              config: {
                merge: 'allSettled',
                branches: {
                  main: [
                    {
                      id: 'loop1',
                      type: 'LOOP',
                      config: {
                        source: 'trigger.items',
                        body: [{ id: 'deep_gate', type: 'PAUSE', config: { reason: 'deep' } }],
                        maxIterations: 10,
                      },
                    },
                  ],
                  side: [{ id: 'side_echo', type: 'ECHO', config: { message: 'side' } }],
                },
              },
            },
          ] as unknown as WorkflowStepConfig[],
        },
        makeContext({ trigger: { type: 'TEST', items: ['x', 'y'] } }),
      );

      const deep0 = 'par1:main#0/loop1:body#0/deep_gate';
      const deep1 = 'par1:main#0/loop1:body#1/deep_gate';

      // Parks 3 levels deep, in iteration 0; the sibling branch completes.
      await executor.runExecution(execId);
      expect((await persistence.getStep(execId, deep0))!.status).toBe('EXTERNAL_WAIT');
      expect((await persistence.getStep(execId, 'par1:side#0/side_echo'))!.status).toBe('COMPLETED');

      // Resolve iteration 0 → iteration 1 parks at its own deep key.
      await patchGate(persistence, execId, deep0);
      await executor.runExecution(execId);
      expect((await persistence.getStep(execId, deep0))!.status).toBe('COMPLETED');
      expect((await persistence.getStep(execId, deep1))!.status).toBe('EXTERNAL_WAIT');

      // Resolve iteration 1 → everything joins and completes.
      await patchGate(persistence, execId, deep1);
      await executor.runExecution(execId);
      expect((await persistence.getExecution(execId))!.status).toBe('COMPLETED');
    });

    it('does not re-execute completed steps on resume (memoized exactly once)', async () => {
      countRuns['pre'] = 0;
      countRuns['post'] = 0;
      const { persistence, executor } = setup();
      const execId = await seedExecution(persistence, {
        steps: [
          { id: 'pre', type: 'COUNT', config: { tag: 'pre' } },
          { id: 'gate', type: 'PAUSE', config: { reason: 'wait' } },
          { id: 'post', type: 'COUNT', config: { tag: 'post' } },
        ],
      });

      await executor.runExecution(execId);
      expect(countRuns['pre']).toBe(1);
      expect(countRuns['post'] ?? 0).toBe(0);

      // An answer belongs to a node: a bare re-run resumes nothing.
      await answerGate(persistence, execId, { action: 'approve' });
      await executor.runExecution(execId); // resume
      expect((await persistence.getExecution(execId))!.status).toBe('COMPLETED');
      // `pre` was memoized — it must NOT have re-executed on resume.
      expect(countRuns['pre']).toBe(1);
      expect(countRuns['post']).toBe(1);
    });

    it('isolates same-id steps across PARALLEL branches (no record clobber)', async () => {
      // Both branches contain a step id 'dup' that pauses. The old executor keyed
      // branch steps on the bare id, so these collided; node-path keys isolate them.
      const { persistence, executor } = setup();
      const execId = await seedExecution(persistence, {
        steps: [
          {
            id: 'par1',
            type: 'PARALLEL',
            config: {
              merge: 'allSettled',
              branches: {
                a: [{ id: 'dup', type: 'PAUSE', config: { reason: 'a' } }],
                b: [{ id: 'dup', type: 'PAUSE', config: { reason: 'b' } }],
              },
            },
          },
        ] as unknown as WorkflowStepConfig[],
      });

      await executor.runExecution(execId);
      // Two distinct records — not one clobbered key.
      expect((await persistence.getStep(execId, 'par1:a#0/dup'))!.status).toBe('EXTERNAL_WAIT');
      expect((await persistence.getStep(execId, 'par1:b#0/dup'))!.status).toBe('EXTERNAL_WAIT');

      // Resolve each independently.
      await patchGate(persistence, execId, 'par1:a#0/dup');
      await executor.runExecution(execId);
      expect((await persistence.getExecution(execId))!.status).toBe('EXTERNAL_WAIT'); // b still parked
      await patchGate(persistence, execId, 'par1:b#0/dup');
      await executor.runExecution(execId);
      expect((await persistence.getExecution(execId))!.status).toBe('COMPLETED');
    });

    it('resumes a WAIT inside a SWITCH case', async () => {
      const { persistence, executor } = setup();
      const execId = await seedExecution(
        persistence,
        {
          steps: [
            {
              id: 'sw1',
              type: 'SWITCH',
              config: {
                cases: [
                  {
                    condition: { variable: '{{trigger.kind}}', operator: 'eq', value: 'a' },
                    steps: [{ id: 'case_gate', type: 'PAUSE', config: { reason: 'sw' } }],
                  },
                ],
                default: [{ id: 'def_echo', type: 'ECHO', config: { message: 'def' } }],
              },
            },
            { id: 'after', type: 'ECHO', config: { message: 'after switch' } },
          ] as unknown as WorkflowStepConfig[],
        },
        makeContext({ trigger: { type: 'TEST', kind: 'a' } }),
      );

      await executor.runExecution(execId);
      expect((await persistence.getStep(execId, 'sw1:case_0#0/case_gate'))!.status).toBe('EXTERNAL_WAIT');
      // The non-taken default branch must not have run.
      expect(await persistence.getStep(execId, 'sw1:default#0/def_echo')).toBeNull();

      // An answer belongs to a node: a bare re-run resumes nothing.
      await answerGate(persistence, execId, { action: 'approve' });
      await executor.runExecution(execId); // sole-gate resume
      expect((await persistence.getExecution(execId))!.status).toBe('COMPLETED');
      const ctx = JSON.parse((await persistence.getExecutionState(execId))!.context!) as WorkflowContext;
      expect(ctx.steps['after']!.output).toEqual({ echoed: 'after switch' });
    });

    it('honors a review gate (onComplete: review) inside a PARALLEL branch', async () => {
      const { persistence, executor } = setup();
      const execId = await seedExecution(persistence, {
        steps: [
          {
            id: 'par1',
            type: 'PARALLEL',
            config: {
              merge: 'allSettled',
              branches: {
                reviewed: [
                  { id: 'gated', type: 'ECHO', config: { message: 'draft' }, onComplete: 'review' },
                ],
                plain: [{ id: 'plain_echo', type: 'ECHO', config: { message: 'plain' } }],
              },
            },
          },
        ] as unknown as WorkflowStepConfig[],
      });

      await executor.runExecution(execId);
      const gatedKey = 'par1:reviewed#0/gated';
      // The step completed but is gated for review (a new capability — review
      // gates previously only worked at the top level).
      expect((await persistence.getStep(execId, gatedKey))!.status).toBe('REVIEW_WAIT');
      expect((await persistence.getExecution(execId))!.status).toBe('EXTERNAL_WAIT');

      await patchGate(persistence, execId, gatedKey, { action: 'approve' });
      await executor.runExecution(execId);
      expect((await persistence.getExecution(execId))!.status).toBe('COMPLETED');
    });

    it('delay-mode WAIT resumes by its deadline, not by a sibling branch resume', async () => {
      const { persistence, executor } = setup();
      const execId = await seedExecution(persistence, {
        steps: [
          {
            id: 'par1',
            type: 'PARALLEL',
            config: {
              merge: 'allSettled',
              branches: {
                timed: [{ id: 'wait1', type: 'WAIT', config: { mode: 'delay', delayMs: 3_600_000 } }],
                manual: [{ id: 'gate', type: 'PAUSE', config: { reason: 'manual' } }],
              },
            },
          },
        ] as unknown as WorkflowStepConfig[],
      });
      const waitKey = 'par1:timed#0/wait1';
      const gateKey = 'par1:manual#0/gate';

      await executor.runExecution(execId);
      expect((await persistence.getStep(execId, waitKey))!.status).toBe('EXTERNAL_WAIT');
      expect((await persistence.getStep(execId, gateKey))!.status).toBe('EXTERNAL_WAIT');

      // A bare re-run with neither answered: the delay is still in the future, so
      // both stay parked. A re-enqueue is not an answer to anything.
      await executor.runExecution(execId);
      expect((await persistence.getStep(execId, waitKey))!.status).toBe('EXTERNAL_WAIT');
      expect((await persistence.getStep(execId, gateKey))!.status).toBe('EXTERNAL_WAIT');

      // Move the clock into the past → that gate alone resumes; the manual one,
      // with no answer of its own, stays parked.
      const row = await persistence.getStep(execId, waitKey);
      const data = JSON.parse(row!.data!) as Record<string, unknown>;
      data['wakeAt'] = '2000-01-01T00:00:00.000Z';
      await persistence.upsertStep(execId, waitKey, {
        status: row!.status,
        executorType: row!.executorType,
        data: JSON.stringify(data),
      });
      await executor.runExecution(execId);
      expect((await persistence.getStep(execId, waitKey))!.status).toBe('COMPLETED');
      expect((await persistence.getStep(execId, gateKey))!.status).toBe('EXTERNAL_WAIT');
      expect((await persistence.getExecution(execId))!.status).toBe('EXTERNAL_WAIT');
    });
  });

  // ─── Phase 3: onError: 'continue' ───

  describe('onError: continue', () => {
    it('continues past a failed step', async () => {
      const { persistence, executor } = setup();
      const execId = await seedExecution(persistence, {
        steps: [
          { id: 'echo1', type: 'ECHO', config: { message: 'ok' } },
          { id: 'fail1', type: 'FAIL', config: { error: 'oops' } },
          { id: 'echo2', type: 'ECHO', config: { message: 'after fail' } },
        ],
        settings: { onError: 'continue' },
      });

      await executor.runExecution(execId);

      const exec = await persistence.getExecution(execId);
      expect(exec!.status).toBe('COMPLETED');

      const state = await persistence.getExecutionState(execId);
      const ctx = JSON.parse(state!.context!) as WorkflowContext;
      expect(ctx.steps['echo1']!.output).toEqual({ echoed: 'ok' });
      expect(ctx.steps['fail1']!.error).toBe('oops');
      expect(ctx.steps['echo2']!.output).toEqual({ echoed: 'after fail' });
    });

    it('records error in step context entry', async () => {
      const { persistence, executor } = setup();
      const execId = await seedExecution(persistence, {
        steps: [
          { id: 'fail1', type: 'FAIL', config: { error: 'broken' } },
        ],
        settings: { onError: 'continue' },
      });

      await executor.runExecution(execId);

      const state = await persistence.getExecutionState(execId);
      const ctx = JSON.parse(state!.context!) as WorkflowContext;
      expect(ctx.steps['fail1']!.error).toBe('broken');
      expect(ctx.steps['fail1']!.output).toEqual({});
    });

    it('marks failed step row in persistence', async () => {
      const { persistence, executor } = setup();
      const execId = await seedExecution(persistence, {
        steps: [
          { id: 'fail1', type: 'FAIL', config: { error: 'boom' } },
          { id: 'echo1', type: 'ECHO', config: { message: 'hi' } },
        ],
        settings: { onError: 'continue' },
      });

      await executor.runExecution(execId);

      const failRow = await persistence.getStep(execId, 'fail1');
      expect(failRow!.status).toBe('FAILED');
      const echoRow = await persistence.getStep(execId, 'echo1');
      expect(echoRow!.status).toBe('COMPLETED');
    });

    it('default onError is stop', async () => {
      const { persistence, executor } = setup();
      const execId = await seedExecution(persistence, {
        steps: [
          { id: 'fail1', type: 'FAIL', config: { error: 'stop!' } },
          { id: 'echo1', type: 'ECHO', config: { message: 'unreachable' } },
        ],
      });

      await expect(executor.runExecution(execId)).rejects.toThrow('stop!');
      expect((await persistence.getExecution(execId))!.status).toBe('FAILED');
    });
  });

  // ─── Phase 3: retry ───

  describe('retry', () => {
    beforeEach(() => {
      flakyAttempts = 0;
    });

    it('retries and succeeds within maxAttempts', async () => {
      const { persistence, executor } = setup();
      const execId = await seedExecution(persistence, {
        steps: [
          { id: 'flaky1', type: 'FLAKY', config: { failCount: 2 } },
        ],
        settings: { retry: { maxAttempts: 3, intervalMs: 1 } },
      });

      await executor.runExecution(execId);

      const exec = await persistence.getExecution(execId);
      expect(exec!.status).toBe('COMPLETED');

      const state = await persistence.getExecutionState(execId);
      const ctx = JSON.parse(state!.context!) as WorkflowContext;
      expect(ctx.steps['flaky1']!.output).toEqual({ attempts: 3 });
    });

    it('fails after exhausting retries', async () => {
      const { persistence, executor } = setup();
      const execId = await seedExecution(persistence, {
        steps: [
          { id: 'flaky1', type: 'FLAKY', config: { failCount: 5 } },
        ],
        settings: { retry: { maxAttempts: 2, intervalMs: 1 } },
      });

      await expect(executor.runExecution(execId)).rejects.toThrow(
        'flaky failure 2',
      );
      expect((await persistence.getExecution(execId))!.status).toBe('FAILED');
    });

    it('does not retry pause steps', async () => {
      const { persistence, executor } = setup();
      const execId = await seedExecution(persistence, {
        steps: [
          { id: 'pause1', type: 'PAUSE', config: { reason: 'wait' } },
        ],
        settings: { retry: { maxAttempts: 3, intervalMs: 1 } },
      });

      await executor.runExecution(execId);

      expect((await persistence.getExecution(execId))!.status).toBe(
        'EXTERNAL_WAIT',
      );
    });

    it('retry + onError continue: retries then continues', async () => {
      const { persistence, executor } = setup();
      const execId = await seedExecution(persistence, {
        steps: [
          { id: 'flaky1', type: 'FLAKY', config: { failCount: 10 } },
          { id: 'echo1', type: 'ECHO', config: { message: 'after' } },
        ],
        settings: {
          onError: 'continue',
          retry: { maxAttempts: 2, intervalMs: 1 },
        },
      });

      await executor.runExecution(execId);

      expect((await persistence.getExecution(execId))!.status).toBe(
        'COMPLETED',
      );
      const state = await persistence.getExecutionState(execId);
      const ctx = JSON.parse(state!.context!) as WorkflowContext;
      expect(ctx.steps['flaky1']!.error).toBeDefined();
      expect(ctx.steps['echo1']!.output).toEqual({ echoed: 'after' });
    });
  });

  // ─── Phase 4: credential resolution ───

  describe('credential resolution', () => {
    it('refuses a credential whose type the step does not accept', async () => {
      // The mismatch is named here — step and credential both — rather than
      // surfacing later as a 401 from whatever the step was calling.
      const { persistence, executor } = setup();
      persistence.seedCredential('basic_cred', {
        authType: 'basic',
        values: { username: 'u', password: 'p' },
      });
      const execId = await seedExecution(persistence, {
        steps: [{
          id: 'shape1',
          type: 'BEARER_ONLY',
          config: { api_token: 'basic_cred' },
        }],
      });

      await expect(executor.runExecution(execId)).rejects.toThrow(
        /Credential "basic_cred" is BUILTIN_BASIC, which is not accepted here/,
      );
      expect((await persistence.getExecution(execId))!.status).toBe('FAILED');
    });

    it('refuses a credential of the same shape but another type', async () => {
      // Two providers can both store a bearer token. Checking the shape would let
      // one provider's token reach the other's step; checking the type does not.
      const { persistence, executor } = setup();
      persistence.seedCredential('builtin_bearer', {
        authType: 'bearer',
        values: { token: 'not-for-this-step' },
      });
      const execId = await seedExecution(persistence, {
        steps: [{
          id: 'shape3',
          type: 'BEARER_ONLY',
          config: { api_token: 'builtin_bearer' },
        }],
      });

      await expect(executor.runExecution(execId)).rejects.toThrow(
        /Credential "builtin_bearer" is BUILTIN_BEARER, which is not accepted here \(accepts: TEST_BEARER\)/,
      );
      expect((await persistence.getExecution(execId))!.status).toBe('FAILED');
    });

    it('accepts a credential whose type the step declares', async () => {
      const { persistence, executor } = setup();
      persistence.seedCredential('bearer_cred', {
        credType: 'TEST_BEARER',
        authType: 'bearer',
        values: { token: 'secret-123' },
      });
      const execId = await seedExecution(persistence, {
        steps: [{
          id: 'shape2',
          type: 'BEARER_ONLY',
          config: { api_token: 'bearer_cred' },
        }],
      });

      await executor.runExecution(execId);

      expect((await persistence.getExecution(execId))!.status).toBe('COMPLETED');
    });

    it('resolves required credentials and injects into ctx', async () => {
      const { persistence, executor } = setup();
      persistence.seedCredential('api_token', {
        authType: 'bearer',
        values: { token: 'secret-123' },
      });
      const execId = await seedExecution(persistence, {
        steps: [{
          id: 'cred1',
          type: 'CRED_STEP',
          config: { api_token: 'api_token' },
        }],
      });

      await executor.runExecution(execId);

      const state = await persistence.getExecutionState(execId);
      const ctx = JSON.parse(state!.context!) as WorkflowContext;
      expect(ctx.steps['cred1']!.output).toEqual({ token: 'secret-123' });
    });

    it('passes the running workflow when resolving declared credentials', async () => {
      const { persistence, executor } = setup();
      persistence.seedCredential('api_token', {
        authType: 'bearer',
        values: { token: 'secret-123' },
      });
      const workflows: unknown[] = [];
      persistence.resolveCredential = async (workflow, name) => {
        workflows.push(workflow);
        return name === 'api_token'
          ? {
              name,
              credType: 'BUILTIN_BEARER',
              authType: 'bearer',
              status: 'ACTIVE',
              values: { token: 'secret-123' },
            }
          : null;
      };

      persistence.seedWorkflow({
        id: 'wf_1',
        status: 'ACTIVE',
        config: JSON.stringify({
          trigger: { type: 'TEST', config: { channel: 'ch_1' } },
          steps: [{
            id: 'cred1',
            type: 'CRED_STEP',
            config: { api_token: 'api_token' },
          }],
        }),
        metadata: JSON.stringify({ name: 'W', workspaceId: 'from-metadata-bag' }),
        eventType: 'TEST',
        attributes: { workspaceId: 'from-attributes' },
      });
      const execId = await persistence.createExecution({
        workflowId: 'wf_1',
        status: 'PENDING',
        context: JSON.stringify(makeContext()),
      });

      await executor.runExecution(execId);

      expect(workflows).toEqual([
        {
          id: 'wf_1',
          attributes: { workspaceId: 'from-attributes' },
          metadata: {},
        },
      ]);
    });

    it('resolves a config-selected credential before the step runs', async () => {
      const { persistence, executor } = setup();
      const workflows: unknown[] = [];
      persistence.resolveCredential = async (workflow, name) => {
        workflows.push(workflow);
        return {
          name,
          credType: 'BUILTIN_BEARER',
          authType: 'bearer',
          status: 'ACTIVE',
          values: { token: 'secret-123' },
        };
      };

      persistence.seedWorkflow({
        id: 'wf_1',
        status: 'ACTIVE',
        config: JSON.stringify({
          trigger: { type: 'TEST', config: { channel: 'ch_1' } },
          steps: [{
            id: 'dynamic-cred',
            type: 'DYNAMIC_CRED_STEP',
            config: { credentialName: '{{trigger.credentialName}}' },
          }],
        }),
        metadata: JSON.stringify({
          name: 'W',
          workspaceId: 'from-metadata-bag',
        }),
        eventType: 'TEST',
        attributes: { workspaceId: 'from-attributes' },
      });
      const execId = await persistence.createExecution({
        workflowId: 'wf_1',
        status: 'PENDING',
        context: JSON.stringify(makeContext({
          trigger: {
            type: 'TEST',
            text: 'hello',
            credentialName: 'api_token',
          },
        })),
      });

      await executor.runExecution(execId);

      expect(workflows).toEqual([
        {
          id: 'wf_1',
          attributes: { workspaceId: 'from-attributes' },
          metadata: {},
        },
      ]);
      const state = await persistence.getExecutionState(execId);
      const ctx = JSON.parse(state!.context!) as WorkflowContext;
      expect(ctx.steps['dynamic-cred']!.output).toEqual({
        token: 'secret-123',
      });
    });

    it('re-reads the execution’s tenant from the workflow record, so a re-scoped workflow cannot resolve the old tenant’s secrets', async () => {
      // A long-paused execution carries a context snapshot. If the workflow is
      // re-scoped meanwhile, honouring that snapshot would resolve the PREVIOUS
      // tenant's credentials — a cross-tenant read. The record is the authority.
      const { persistence, executor } = setup();
      const workflows: unknown[] = [];
      persistence.resolveCredential = async (workflow) => {
        workflows.push(workflow);
        return {
          name: 'api_token',
          credType: 'BUILTIN_BEARER',
          authType: 'bearer',
          status: 'ACTIVE',
          values: { token: 'secret-123' },
        };
      };

      persistence.seedWorkflow({
        id: 'wf_1',
        status: 'ACTIVE',
        config: JSON.stringify({
          trigger: { type: 'TEST', config: { channel: 'ch_1' } },
          steps: [{
            id: 'cred1',
            type: 'CRED_STEP',
            config: { api_token: 'api_token' },
          }],
        }),
        metadata: null,
        eventType: 'TEST',
        attributes: { workspaceId: 'tenant-now' },
      });
      // The persisted context is stale — it says the run belongs to tenant-old.
      const stale = makeContext();
      stale.workflow.attributes = { workspaceId: 'tenant-old' } as never;
      const execId = await persistence.createExecution({
        workflowId: 'wf_1',
        status: 'PENDING',
        context: JSON.stringify(stale),
      });

      await executor.runExecution(execId);

      expect(workflows).toEqual([
        {
          id: 'wf_1',
          attributes: { workspaceId: 'tenant-now' },
          metadata: {},
        },
      ]);
    });

    it('throws when required credential is missing', async () => {
      const { persistence, executor } = setup();
      // Don't seed the credential
      const execId = await seedExecution(persistence, {
        steps: [{
          id: 'cred1',
          type: 'CRED_STEP',
          config: { api_token: 'api_token' },
        }],
      });

      await expect(executor.runExecution(execId)).rejects.toThrow(
        'Required credential "api_token" not found',
      );
      expect((await persistence.getExecution(execId))!.status).toBe('FAILED');
    });

    it('optional credential: works when missing', async () => {
      const { persistence, executor } = setup();
      // Don't seed the optional credential
      const execId = await seedExecution(persistence, {
        steps: [{ id: 'opt1', type: 'OPT_CRED_STEP', config: {} }],
      });

      await executor.runExecution(execId);

      const state = await persistence.getExecutionState(execId);
      const ctx = JSON.parse(state!.context!) as WorkflowContext;
      expect(ctx.steps['opt1']!.output).toEqual({ hasAuth: false });
    });

    it('optional credential: injects when present', async () => {
      const { persistence, executor } = setup();
      persistence.seedCredential('maybe_token', {
        authType: 'bearer',
        values: { token: 'opt-token' },
      });
      const execId = await seedExecution(persistence, {
        steps: [{
          id: 'opt1',
          type: 'OPT_CRED_STEP',
          config: { maybe_token: 'maybe_token' },
        }],
      });

      await executor.runExecution(execId);

      const state = await persistence.getExecutionState(execId);
      const ctx = JSON.parse(state!.context!) as WorkflowContext;
      expect(ctx.steps['opt1']!.output).toEqual({ hasAuth: true });
    });
  });

  // ─── Phase 5: step observability (ctx.emit) ───

  describe('step events (ctx.emit)', () => {
    it('persists events emitted by a step', async () => {
      const { persistence, executor } = setup();
      const execId = await seedExecution(persistence, {
        steps: [
          { id: 'emit1', type: 'EMIT_STEP', config: { phase: 'connecting' } },
        ],
      });

      await executor.runExecution(execId);

      // Allow fire-and-forget promises to settle
      await new Promise((r) => { setTimeout(r, 10); });

      // Step events are keyed by the step's config id (matches the UI's step
      // state + SSE), not the positional step_N persistence key.
      const events = await persistence.getStepEvents(execId, 'emit1');
      expect(events).toHaveLength(2);
      expect(events[0]!.type).toBe('progress');
      expect(JSON.parse(events[0]!.data)).toEqual({ phase: 'connecting' });
      expect(events[1]!.type).toBe('log');
      expect(JSON.parse(events[1]!.data)).toEqual({ message: 'step completed' });
    });

    it('emit does not block step execution', async () => {
      const { persistence, executor } = setup();
      const execId = await seedExecution(persistence, {
        steps: [
          { id: 'emit1', type: 'EMIT_STEP', config: { phase: 'fast' } },
          { id: 'echo1', type: 'ECHO', config: { message: 'after' } },
        ],
      });

      await executor.runExecution(execId);

      expect((await persistence.getExecution(execId))!.status).toBe('COMPLETED');
      const state = await persistence.getExecutionState(execId);
      const ctx = JSON.parse(state!.context!) as WorkflowContext;
      expect(ctx.steps['echo1']!.output).toEqual({ echoed: 'after' });
    });

    it('events have unique ids and timestamps', async () => {
      const { persistence, executor } = setup();
      const execId = await seedExecution(persistence, {
        steps: [
          { id: 'emit1', type: 'EMIT_STEP', config: { phase: 'test' } },
        ],
      });

      await executor.runExecution(execId);
      await new Promise((r) => { setTimeout(r, 10); });

      const events = await persistence.getStepEvents(execId, 'emit1');
      expect(events.length).toBeGreaterThanOrEqual(2);
      const ids = events.map((e) => e.id);
      expect(new Set(ids).size).toBe(ids.length); // all unique
      for (const event of events) {
        expect(event.createdAt).toBeInstanceOf(Date);
      }
    });
  });

  describe('review gate (onComplete: review)', () => {
    beforeEach(() => {
      priorInvocations = 0;
    });

    it('pauses execution after the gated step completes', async () => {
      const { persistence, executor } = setup();
      const execId = await seedExecution(persistence, {
        steps: [
          { id: 'echo1', type: 'ECHO', config: { message: 'first' }, onComplete: 'review' },
          { id: 'echo2', type: 'ECHO', config: { message: 'second' } },
        ],
      });

      await executor.runExecution(execId);

      const exec = await persistence.getExecution(execId);
      expect(exec!.status).toBe('EXTERNAL_WAIT');

      const state = await persistence.getExecutionState(execId);
      expect(state!.pauseType).toBe('review');
      expect(state!.currentStepIndex).toBe(0);

      const ctx = JSON.parse(state!.context!) as WorkflowContext;
      expect(ctx.steps['echo1']!.output).toEqual({ echoed: 'first' });
      expect(ctx.steps['echo2']).toBeUndefined();
    });

    it('resumes past the gated step on approve', async () => {
      const { persistence, executor } = setup();
      const execId = await seedExecution(persistence, {
        steps: [
          { id: 'echo1', type: 'ECHO', config: { message: 'first' }, onComplete: 'review' },
          { id: 'echo2', type: 'ECHO', config: { message: 'second' } },
        ],
      });

      await executor.runExecution(execId);
      await answerGate(persistence, execId, { action: 'approve' });
      await executor.runExecution(execId);

      const exec = await persistence.getExecution(execId);
      expect(exec!.status).toBe('COMPLETED');

      const state = await persistence.getExecutionState(execId);
      const ctx = JSON.parse(state!.context!) as WorkflowContext;
      expect(ctx.steps['echo1']!.output).toEqual({ echoed: 'first' });
      expect(ctx.steps['echo2']!.output).toEqual({ echoed: 'second' });
    });

    it('re-executes the gated step on retry with priorState + feedback overrides', async () => {
      const { persistence, executor } = setup();
      const execId = await seedExecution(persistence, {
        steps: [
          {
            id: 'prior1',
            type: 'PRIOR_STATE_STEP',
            config: { message: 'initial' },
            onComplete: 'review',
          },
        ],
      });

      await executor.runExecution(execId);

      // First invocation: no priorState
      let state = await persistence.getExecutionState(execId);
      let ctx = JSON.parse(state!.context!) as WorkflowContext;
      expect(ctx.steps['prior1']!.output).toMatchObject({
        message: 'initial',
        hadPrior: false,
        invocation: 1,
      });
      expect(priorInvocations).toBe(1);

      // Retry with feedback — should re-execute with priorState
      await answerGate(persistence, execId, {
        action: 'retry',
        feedback: 'try harder',
      });
      await executor.runExecution(execId);

      state = await persistence.getExecutionState(execId);
      ctx = JSON.parse(state!.context!) as WorkflowContext;
      const re = ctx.steps['prior1']!.output as Record<string, unknown>;
      expect(re['invocation']).toBe(2);
      expect(re['hadPrior']).toBe(true);
      // priorSnapshot holds the prior run's persisted row data (input + output)
      const snap = re['priorSnapshot'] as Record<string, unknown>;
      expect((snap['output'] as Record<string, unknown>)['message']).toBe('initial');
      expect((snap['output'] as Record<string, unknown>)['invocation']).toBe(1);
      // Execution should be paused again at the review gate
      const exec = await persistence.getExecution(execId);
      expect(exec!.status).toBe('EXTERNAL_WAIT');
    });

    it('cancels execution on abort', async () => {
      const { persistence, executor } = setup();
      const execId = await seedExecution(persistence, {
        steps: [
          { id: 'echo1', type: 'ECHO', config: { message: 'first' }, onComplete: 'review' },
        ],
      });
      await executor.runExecution(execId);
      await answerGate(persistence, execId, { action: 'abort' });
      await executor.runExecution(execId);

      const exec = await persistence.getExecution(execId);
      expect(exec!.status).toBe('CANCELLED');
    });

    it('multi-round retry: priorState reflects previous run each round', async () => {
      const { persistence, executor } = setup();
      const execId = await seedExecution(persistence, {
        steps: [
          {
            id: 'prior1',
            type: 'PRIOR_STATE_STEP',
            config: { message: 'r1' },
            onComplete: 'review',
          },
        ],
      });

      // Round 1: fresh run, no priorState
      await executor.runExecution(execId);
      let ctx = JSON.parse((await persistence.getExecutionState(execId))!.context!) as WorkflowContext;
      expect((ctx.steps['prior1']!.output as Record<string, unknown>)['hadPrior']).toBe(false);
      expect((ctx.steps['prior1']!.output as Record<string, unknown>)['invocation']).toBe(1);

      // Round 2: retry — priorState should snapshot round 1 output
      await answerGate(persistence, execId, { action: 'retry' });
      await executor.runExecution(execId);
      ctx = JSON.parse((await persistence.getExecutionState(execId))!.context!) as WorkflowContext;
      const r2 = ctx.steps['prior1']!.output as Record<string, unknown>;
      expect(r2['invocation']).toBe(2);
      expect(r2['hadPrior']).toBe(true);
      const r2Snap = r2['priorSnapshot'] as Record<string, unknown>;
      expect((r2Snap['output'] as Record<string, unknown>)['invocation']).toBe(1);

      // Round 3: retry again — priorState should now snapshot round 2 output
      await answerGate(persistence, execId, { action: 'retry' });
      await executor.runExecution(execId);
      ctx = JSON.parse((await persistence.getExecutionState(execId))!.context!) as WorkflowContext;
      const r3 = ctx.steps['prior1']!.output as Record<string, unknown>;
      expect(r3['invocation']).toBe(3);
      const r3Snap = r3['priorSnapshot'] as Record<string, unknown>;
      expect((r3Snap['output'] as Record<string, unknown>)['invocation']).toBe(2);

      // Approve to finish
      await answerGate(persistence, execId, { action: 'approve' });
      await executor.runExecution(execId);
      const exec = await persistence.getExecution(execId);
      expect(exec!.status).toBe('COMPLETED');
    });

    it('priorState is single-use — downstream steps after the gated one do not see it', async () => {
      const { persistence, executor } = setup();
      const execId = await seedExecution(persistence, {
        steps: [
          {
            id: 'gated',
            type: 'PRIOR_STATE_STEP',
            config: { message: 'gated' },
            onComplete: 'review',
          },
          {
            id: 'downstream',
            type: 'PRIOR_STATE_STEP',
            config: { message: 'downstream' },
          },
        ],
      });

      await executor.runExecution(execId);
      await answerGate(persistence, execId, { action: 'retry' });
      await executor.runExecution(execId);
      // After retry the gate pauses again. Approve to continue past it.
      await answerGate(persistence, execId, { action: 'approve' });
      await executor.runExecution(execId);

      const exec = await persistence.getExecution(execId);
      expect(exec!.status).toBe('COMPLETED');

      const ctx = JSON.parse((await persistence.getExecutionState(execId))!.context!) as WorkflowContext;
      const downstreamOut = ctx.steps['downstream']!.output as Record<string, unknown>;
      expect(downstreamOut['hadPrior']).toBe(false);
    });

    it('emits execution_paused with the review gate\'s three choices', async () => {
      const { persistence, executor } = setup();
      const captured: Array<{ event: string; data: unknown }> = [];
      // Hijack the in-memory persistence by subscribing via the event bus.
      // Easier: read step events from persistence — and check the SSE event.
      // The executor stores nothing for review pause besides the persistState
      // call. The event lookup goes through the bus. Use a custom bus.
      const bus = new InMemoryEventBus();
      const connectors = testRegistry({ steps: [new EchoStep()], triggers: [new TestTrigger()] });
      const busExecutor = new WorkflowExecutor(
        persistence,
        connectors,
        new ServiceRegistry(),
        { eventBus: bus },
      );
      void executor;

      persistence.seedWorkflow({
        id: 'wf_evt',
        status: 'ACTIVE',
        config: JSON.stringify({
          trigger: { type: 'TEST', config: { channel: 'ch_1' } },
          steps: [
            { id: 'echo1', type: 'ECHO', config: { message: 'hi' }, onComplete: 'review' },
          ],
        }),
        metadata: null,
        eventType: 'TEST',
      });
      const execId = await persistence.createExecution({
        workflowId: 'wf_evt',
        status: 'PENDING',
        context: JSON.stringify(makeContext({ workflow: { id: 'wf_evt', metadata: {} } })),
      });
      await bus.subscribe(executionTopic(execId), (event) => captured.push(event));

      await busExecutor.runExecution(execId);

      const paused = captured.find((e) => e.event === 'execution_paused');
      expect(paused).toBeDefined();
      const data = paused!.data as {
        stepName: string;
        pauseState: { actions?: Array<{ key: string }> };
      };
      expect(data.stepName).toBe('echo1');
      // What makes it a review gate, as far as a client is concerned: the three
      // choices. `retry` belongs to no other pause.
      const actionKeys = data.pauseState.actions?.map((a) => a.key) ?? [];
      expect(actionKeys).toContain('approve');
      expect(actionKeys).toContain('retry');
      expect(actionKeys).toContain('abort');
    });
  });

  describe('rerunFromStep', () => {
    beforeEach(() => {
      priorInvocations = 0;
    });

    it('seeds cached outputs from source execution and re-executes from the target', async () => {
      const { persistence, executor } = setup();
      const execId = await seedExecution(persistence, {
        steps: [
          { id: 'echo1', type: 'ECHO', config: { message: 'first' } },
          { id: 'echo2', type: 'ECHO', config: { message: 'second' } },
          { id: 'echo3', type: 'ECHO', config: { message: 'third' } },
        ],
      });
      await executor.runExecution(execId);

      const newId = await executor.rerunFromStep(execId, 'echo2');
      expect(newId).not.toBe(execId);

      const newExec = await persistence.getExecution(newId);
      expect(newExec!.sourceExecutionId).toBe(execId);

      await executor.runExecution(newId);

      const state = await persistence.getExecutionState(newId);
      const ctx = JSON.parse(state!.context!) as WorkflowContext;
      // All three steps should have outputs (echo1 cached, echo2+echo3 re-executed)
      expect(ctx.steps['echo1']!.output).toEqual({ echoed: 'first' });
      expect(ctx.steps['echo2']!.output).toEqual({ echoed: 'second' });
      expect(ctx.steps['echo3']!.output).toEqual({ echoed: 'third' });
      expect(ctx.__meta?.rerunSource?.fromStepId).toBe('echo2');
    });

    it('passes priorState to the entry step and applies configOverrides', async () => {
      const { persistence, executor } = setup();
      const execId = await seedExecution(persistence, {
        steps: [
          { id: 'prior1', type: 'PRIOR_STATE_STEP', config: { message: 'original' } },
        ],
      });
      await executor.runExecution(execId);

      const newId = await executor.rerunFromStep(execId, 'prior1', {
        configOverrides: { message: 'modified' },
      });
      await executor.runExecution(newId);

      const state = await persistence.getExecutionState(newId);
      const ctx = JSON.parse(state!.context!) as WorkflowContext;
      const output = ctx.steps['prior1']!.output as Record<string, unknown>;
      expect(output['message']).toBe('modified');
      expect(output['hadPrior']).toBe(true);
      // priorSnapshot comes from the source execution's row data
      const snap = output['priorSnapshot'] as Record<string, unknown>;
      expect((snap['output'] as Record<string, unknown>)['message']).toBe('original');
    });

    it('rejects rerun from a non-terminal execution', async () => {
      const { persistence, executor } = setup();
      const execId = await seedExecution(persistence, {
        steps: [
          { id: 'p1', type: 'PAUSE', config: { reason: 'wait' } },
        ],
      });
      await executor.runExecution(execId); // pauses

      await expect(
        executor.rerunFromStep(execId, 'p1'),
      ).rejects.toThrow(/non-terminal/);
    });

    it('rejects rerun with unknown step id', async () => {
      const { persistence, executor } = setup();
      const execId = await seedExecution(persistence, {
        steps: [{ id: 'echo1', type: 'ECHO', config: { message: 'hi' } }],
      });
      await executor.runExecution(execId);
      await expect(
        executor.rerunFromStep(execId, 'nonexistent'),
      ).rejects.toThrow(/not found/);
    });
  });

  describe('CYCLE / GO_TO / FINISH', () => {
    beforeEach(() => {
      for (const tag of Object.keys(countRuns)) delete countRuns[tag];
    });

    const roundIndex = '{{steps.__loop.output.currentIndex}}';

    const readData = async (
      persistence: InMemoryPersistenceAdapter,
      execId: string,
      nodePath: string,
    ): Promise<Record<string, unknown>> =>
      JSON.parse((await persistence.getStep(execId, nodePath))!.data!) as Record<string, unknown>;

    it('starts a round for each GO_TO, each under its own frame', async () => {
      const { persistence, executor } = setup();
      const execId = await seedExecution(persistence, {
        steps: [
          {
            id: 'menu',
            type: 'CYCLE',
            config: {
              input: { screen: 'root' },
              maxIterations: 10,
              body: [
                { id: 'visit', type: 'COUNT', config: { tag: 'visit' } },
                {
                  id: 'more',
                  type: 'CONDITIONAL',
                  config: {
                    condition: { variable: roundIndex, operator: 'lt', value: 2 },
                    if_true: [
                      { id: 'again', type: 'GO_TO', config: { target: 'menu', with: { screen: 'next' } } },
                    ],
                  },
                },
              ],
            },
          },
          { id: 'after', type: 'ECHO', config: { message: 'rounds={{steps.menu.output.rounds}}' } },
        ] as unknown as WorkflowStepConfig[],
      });

      await executor.runExecution(execId);

      expect((await persistence.getExecution(execId))!.status).toBe('COMPLETED');
      expect(countRuns['visit']).toBe(3);
      for (const round of [0, 1, 2]) {
        expect((await persistence.getStep(execId, `menu:body#${String(round)}/visit`))!.status).toBe('COMPLETED');
      }
      // A round that ended by jumping carries the jump on the GO_TO and on every step around it.
      expect((await readData(persistence, execId, 'menu:body#0/more:if_true#0/again'))['signal']).toEqual({
        kind: 'goto',
        target: 'menu',
        value: { screen: 'next' },
      });
      expect((await readData(persistence, execId, 'menu:body#1/more'))['signal']).toMatchObject({ target: 'menu' });
      expect((await readData(persistence, execId, 'menu:body#2/more'))['signal']).toBeUndefined();

      const ctx = JSON.parse((await persistence.getExecutionState(execId))!.context!) as WorkflowContext;
      expect(ctx.steps['menu']!.output).toEqual({ rounds: 3, exit: 'completed', state: { screen: 'next' } });
      expect(ctx.steps['after']!.output).toEqual({ echoed: 'rounds=3' });
    });

    it('replays finished rounds from their records when a later round resumes', async () => {
      const { persistence, executor } = setup();
      const execId = await seedExecution(persistence, {
        steps: [
          {
            id: 'menu',
            type: 'CYCLE',
            config: {
              input: {},
              maxIterations: 10,
              body: [
                { id: 'classify', type: 'COUNT', config: { tag: 'classify' } },
                { id: 'ask', type: 'PAUSE', config: { reason: 'pick an option' } },
                {
                  id: 'route',
                  type: 'CONDITIONAL',
                  config: {
                    condition: { variable: roundIndex, operator: 'lt', value: 1 },
                    if_true: [{ id: 'reroute', type: 'GO_TO', config: { target: 'menu' } }],
                  },
                },
              ],
            },
          },
        ] as unknown as WorkflowStepConfig[],
      });

      // Round 0 asks and waits.
      await executor.runExecution(execId);
      expect((await persistence.getStep(execId, 'menu:body#0/ask'))!.status).toBe('EXTERNAL_WAIT');

      // Answering it jumps into round 1, which asks again under its own frame.
      await patchGate(persistence, execId, 'menu:body#0/ask');
      await executor.runExecution(execId);
      expect((await persistence.getStep(execId, 'menu:body#0/ask'))!.status).toBe('COMPLETED');
      expect((await persistence.getStep(execId, 'menu:body#1/ask'))!.status).toBe('EXTERNAL_WAIT');
      expect((await persistence.getExecution(execId))!.status).toBe('EXTERNAL_WAIT');

      // Answering round 1 replays round 0 from its records and finishes.
      await patchGate(persistence, execId, 'menu:body#1/ask');
      await executor.runExecution(execId);
      expect((await persistence.getExecution(execId))!.status).toBe('COMPLETED');
      // One run per round: replay never re-runs a finished step.
      expect(countRuns['classify']).toBe(2);
      const ctx = JSON.parse((await persistence.getExecutionState(execId))!.context!) as WorkflowContext;
      expect(ctx.steps['menu']!.output).toEqual({ rounds: 2, exit: 'completed', state: {} });
    });

    it('ends the CYCLE with the FINISH value, skipping the rest of the round', async () => {
      const { persistence, executor } = setup();
      const execId = await seedExecution(persistence, {
        steps: [
          {
            id: 'menu',
            type: 'CYCLE',
            config: {
              input: { screen: 'root' },
              body: [
                { id: 'done', type: 'FINISH', config: { target: 'menu', with: { resolution: 'refund' } } },
                { id: 'unreached', type: 'COUNT', config: { tag: 'unreached' } },
              ],
            },
          },
          { id: 'after', type: 'ECHO', config: { message: '{{steps.menu.output.result.resolution}}' } },
        ] as unknown as WorkflowStepConfig[],
      });

      await executor.runExecution(execId);

      expect((await persistence.getExecution(execId))!.status).toBe('COMPLETED');
      expect(countRuns['unreached']).toBeUndefined();
      const ctx = JSON.parse((await persistence.getExecutionState(execId))!.context!) as WorkflowContext;
      expect(ctx.steps['menu']!.output).toEqual({ rounds: 1, exit: 'finish', result: { resolution: 'refund' }, state: { screen: 'root' } });
      expect(ctx.steps['after']!.output).toEqual({ echoed: 'refund' });
    });

    it('unwinds an inner CYCLE when a GO_TO targets the outer one', async () => {
      const { persistence, executor } = setup();
      const execId = await seedExecution(persistence, {
        steps: [
          {
            id: 'outer',
            type: 'CYCLE',
            config: {
              input: { section: 'rides' },
              body: [
                {
                  id: 'inner',
                  type: 'CYCLE',
                  config: {
                    input: {},
                    body: [
                      { id: 'screen', type: 'COUNT', config: { tag: 'screen' } },
                      {
                        id: 'switch_section',
                        type: 'CONDITIONAL',
                        config: {
                          condition: { variable: '{{steps.screen.output.runs}}', operator: 'eq', value: 1 },
                          if_true: [
                            {
                              id: 'reroute',
                              type: 'GO_TO',
                              config: { target: 'outer', with: { section: 'payments' } },
                            },
                          ],
                        },
                      },
                    ],
                  },
                },
              ],
            },
          },
        ] as unknown as WorkflowStepConfig[],
      });

      await executor.runExecution(execId);

      expect((await persistence.getExecution(execId))!.status).toBe('COMPLETED');
      expect((await readData(persistence, execId, 'outer:body#0/inner'))['signal']).toEqual({
        kind: 'goto',
        target: 'outer',
        value: { section: 'payments' },
      });
      expect((await persistence.getStep(execId, 'outer:body#1/inner:body#0/screen'))!.status).toBe('COMPLETED');
      const ctx = JSON.parse((await persistence.getExecutionState(execId))!.context!) as WorkflowContext;
      expect(ctx.steps['outer']!.output).toEqual({ rounds: 2, exit: 'completed', state: { section: 'payments' } });
    });

    it('fails the run when a jump names no loop around it', async () => {
      const { persistence, executor } = setup();
      const execId = await seedExecution(persistence, {
        steps: [
          { id: 'stray', type: 'GO_TO', config: { target: 'nowhere' } },
          { id: 'after', type: 'ECHO', config: { message: 'unreached' } },
        ] as unknown as WorkflowStepConfig[],
      });

      await expect(executor.runExecution(execId)).rejects.toThrow('GO_TO to "nowhere"');

      expect((await persistence.getExecution(execId))!.status).toBe('FAILED');
      const ctx = JSON.parse((await persistence.getExecutionState(execId))!.context!) as WorkflowContext;
      expect(ctx.__meta?.error).toBe('GO_TO to "nowhere": no CYCLE with that id contains the step');
      expect(await persistence.getStep(execId, 'after')).toBeNull();
    });

    it('fails a PARALLEL whose branch tries to jump out of it', async () => {
      const { persistence, executor } = setup();
      const execId = await seedExecution(persistence, {
        steps: [
          {
            id: 'menu',
            type: 'CYCLE',
            config: {
              input: {},
              body: [
                {
                  id: 'fan',
                  type: 'PARALLEL',
                  config: {
                    branches: {
                      left: [{ id: 'escape', type: 'GO_TO', config: { target: 'menu' } }],
                      right: [{ id: 'work', type: 'ECHO', config: { message: 'right' } }],
                    },
                  },
                },
              ],
            },
          },
        ] as unknown as WorkflowStepConfig[],
      });

      await expect(executor.runExecution(execId)).rejects.toThrow(
        'GO_TO to "menu" can\'t leave a PARALLEL branch: its branches run at the same time.',
      );
      expect((await persistence.getExecution(execId))!.status).toBe('FAILED');
    });
  });
});
