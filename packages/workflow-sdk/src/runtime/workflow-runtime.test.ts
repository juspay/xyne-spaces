import { Readable } from 'node:stream';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { testRegistry } from '../testing/test-connector.js';
import { z } from 'zod';
import { WorkflowRuntime } from './workflow-runtime.js';
import { AllowAllAuthorizer } from '../authz/default.js';
import { SYSTEM, ALL_ACTIONS } from '../authz/types.js';
import type { WorkflowRunNaming } from '../types/workflow-config.js';
import { ValidationIssueCode } from '../types/validation.js';
import { ApprovalRequirement } from '../types/approval.js';
import type { ApprovalConfig } from '../types/approval.js';
import { WorkflowStatus } from '../types/status.js';
import { variableRef } from '../types/workflow-config.js';
import type { ConfigIssue, ConfigValidationContext } from '../schema/config-check.js';
import type { WorkflowAuthorizer } from '../authz/types.js';
import type { IdScope } from '../authz/id-scope.js';
import { WorkflowExecutor } from '../engine/workflow-executor.js';
import { InMemoryPersistenceAdapter } from '../persistence/in-memory-adapter.js';
import { InMemoryStorageAdapter } from '../storage/in-memory-adapter.js';
import type { DeliveryFile } from '../completion/types.js';
import type { StorageAdapter } from '../storage/types.js';
import { ATTACHMENT_JSON_SCHEMA } from '../common/attachment.js';
import type { HydrateResult } from '../triggers/base-trigger.js';
import type { FieldOptionsContext, FieldOptionsPage } from '../schema/options.js';
import type { TriggerEvent } from '../ingest/types.js';
import { ServiceRegistry } from '../engine/service-registry.js';
import { BaseActionStep } from '../steps/base-step.js';
import type { StepExecutionContext } from '../steps/base-step.js';
import { EventTrigger } from '../triggers/event-trigger.js';
import { WebhookTrigger } from '../triggers/webhook-trigger.js';
import type { InboundHttpRequest, InboundReply, RawInboundRequest, Translation } from '../ingest/types.js';
import type { TriggerExecutionContext } from '../triggers/base-trigger.js';
import { credentialValues } from '../common/credentials.js';
import { headerValue } from '../ingest/headers.js';
import { defineCredential } from '../connectors/core/credentials.js';
import { ConditionOperator } from '../types/operators.js';
import { CronTrigger } from '../triggers/cron-trigger.js';
import type { CronSchedule } from '../triggers/cron-trigger.js';
import { ManualTrigger } from '../triggers/manual-trigger.js';
import { TriggerCategory } from '../types/categories.js';
import type { QueueAdapter, SchedulerAdapter } from '../persistence/types.js';
import type { AnyStep, AnyTrigger } from '../connectors/core/base-connector.js';
import { GateCategory } from '../types/known-types.js';

// ─── Test Step ───

const EchoConfig = z.object({ message: z.string() });
const EchoOutput = z.object({ echoed: z.string() });

class EchoStep extends BaseActionStep<typeof EchoConfig, { echoed: string }> {
  readonly type = 'ECHO';
  readonly configSchema = EchoConfig;
  readonly name = 'Echo';
  readonly description = 'Echoes';
  readonly outputSchema = EchoOutput;
  readonly category = 'testing';

  async execute(
    config: z.infer<typeof EchoConfig>,
    _ctx: StepExecutionContext,
  ): Promise<{ echoed: string }> {
    return { echoed: config.message };
  }
}

const PauseConfig = z.object({ reason: z.string() });
const PauseOutput = z.object({ resumed: z.boolean() });

class PauseTestStep extends BaseActionStep<
  typeof PauseConfig,
  { resumed: boolean }
> {
  readonly type = 'PAUSE_TEST';
  readonly configSchema = PauseConfig;
  readonly name = 'Pause';
  readonly description = 'Pauses';
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

// ─── Test Triggers ───

const EventConfig = z.object({});
const EventOutput = z.object({});

class TestEventTrigger extends EventTrigger<typeof EventConfig> {
  readonly type = 'TEST_EVENT';
  readonly configSchema = EventConfig;
  readonly name = 'Test Event';
  readonly description = 'Test event trigger';
  readonly outputSchema = EventOutput;
  readonly category = TriggerCategory.EVENT;
}

class FilteredEventTrigger extends EventTrigger<typeof EventConfig> {
  readonly type = 'FILTERED_EVENT';
  readonly configSchema = EventConfig;
  readonly name = 'Filtered Event';
  readonly description = 'Event trigger with filter';
  readonly outputSchema = EventOutput;
  readonly category = TriggerCategory.EVENT;

  override accepts(event: TriggerEvent, config: Record<string, unknown>): boolean {
    if (config['channel'] && event.payload['channel'] !== config['channel']) {
      return false;
    }
    return true;
  }
}

const TEST_WEBHOOK_SECRET = defineCredential({
  connectorId: 'test',
  credType: 'TEST_WEBHOOK_SECRET',
  label: 'Test webhook secret',
  authType: 'secret',
});

const WebhookConfig = z.object({ secretName: z.string() });

/**
 * Authenticates with a token header against the secret in `secretName`.
 * A `validationToken` query is a handshake, echoed as plain text before verification.
 * A `challenge` body is answered without a run; an `items` body fans out.
 */
class TestWebhookTrigger extends WebhookTrigger<typeof WebhookConfig> {
  readonly type = 'TEST_WEBHOOK';
  readonly configSchema = WebhookConfig;
  readonly name = 'Test Webhook';
  readonly description = 'Test webhook trigger';
  readonly outputSchema = z.object({});
  readonly category = TriggerCategory.WEBHOOK;
  override readonly credentialSlots = [{ name: 'secretName', required: true }] as const;
  override readonly credential = [TEST_WEBHOOK_SECRET];

  async verify(
    request: InboundHttpRequest,
    _config: unknown,
    ctx: TriggerExecutionContext,
  ): Promise<boolean> {
    const token = headerValue(request.headers, 'x-token');
    if (token === 'explode') throw new Error('verifier crashed');
    return token === credentialValues(ctx.credentials, 'secretName', 'secret').value;
  }

  override async handshake(request: InboundHttpRequest): Promise<InboundReply | undefined> {
    const token = request.query['validationToken'];
    if (token === 'explode') throw new Error('handshake crashed');
    if (typeof token !== 'string') return undefined;
    return { status: 200, headers: { 'Content-Type': 'text/plain' }, body: token };
  }

  async handleRequest(request: RawInboundRequest): Promise<Translation> {
    const body = request.body as { challenge?: string; items?: Array<Record<string, unknown>> };
    if (body.challenge) {
      return { events: [], reply: { status: 200, body: { challenge: body.challenge } } };
    }
    const items = body.items ?? [request.body as Record<string, unknown>];
    return {
      events: items.map((item) => ({ type: this.type, payload: { body: item } })),
      reply: { status: 202, body: { accepted: true } },
    };
  }
}

const CronConfig = z.object({
  expression: z.string(),
});

class TestCronTrigger extends CronTrigger<typeof CronConfig> {
  readonly type = 'TEST_CRON';
  readonly configSchema = CronConfig;
  readonly name = 'Test Cron';
  readonly description = 'Test cron trigger';
  readonly outputSchema = z.object({});
  readonly category = TriggerCategory.SCHEDULED;

  getSchedule(config: z.infer<typeof CronConfig>): CronSchedule {
    return { expression: config.expression };
  }
}

/** Scope in `accepts`: which board this rule watches, decided on the raw event. */
class ScopedEventTrigger extends EventTrigger<typeof EventConfig> {
  readonly type = 'SCOPED_EVENT';
  readonly configSchema = EventConfig;
  readonly name = 'Scoped Event';
  readonly description = 'Event trigger scoped to one board';
  readonly outputSchema = EventOutput;
  readonly category = TriggerCategory.EVENT;

  override accepts(event: TriggerEvent, config: Record<string, unknown>): boolean {
    return !config['boardId'] || config['boardId'] === event.payload['boardId'];
  }
}

/** Counts its reads, so a test can prove one event costs one hydration. */
class CountingHydratingTrigger extends EventTrigger<typeof EventConfig> {
  readonly type = 'HYDRATING_EVENT';
  readonly configSchema = EventConfig;
  readonly name = 'Hydrating Event';
  readonly description = 'Resolves the subject once per event';
  readonly outputSchema = EventOutput;
  readonly category = TriggerCategory.EVENT;

  calls = 0;
  mode: 'ok' | 'gone' | 'throw' = 'ok';

  override hydrationKey(event: TriggerEvent): string {
    return String(event.payload['ticketId']);
  }

  override async hydrate(event: TriggerEvent): Promise<HydrateResult> {
    this.calls += 1;
    if (this.mode === 'throw') throw new Error('upstream is down');
    if (this.mode === 'gone') return { kind: 'gone', reason: 'ticket deleted' };
    return {
      kind: 'payload',
      payload: { ...event.payload, status: 'Backlog', readCount: this.calls },
    };
  }
}

const PickerConfig = z.object({
  projectId: z.string().optional(),
  channelId: z.string().optional(),
  repository: z.object({ id: z.string(), name: z.string() }).optional(),
  boardIds: z.array(z.string()).optional(),
});

/** A step with a field worth picking rather than typing. */
class PickerStep extends BaseActionStep<typeof PickerConfig, { ok: boolean }> {
  readonly type = 'PICKER';
  readonly configSchema = PickerConfig;
  readonly name = 'Picker';
  readonly description = 'Has a field with choices';
  readonly outputSchema = z.object({ ok: z.boolean() });
  readonly category = 'testing';

  /** What the last call was given, so a test can look at it. */
  seen: FieldOptionsContext<z.infer<typeof PickerConfig>> | null = null;

  async execute(): Promise<{ ok: boolean }> {
    return { ok: true };
  }

  override async getOptions(
    ctx: FieldOptionsContext<z.infer<typeof PickerConfig>>,
  ): Promise<FieldOptionsPage> {
    this.seen = ctx;

    // Describing ids the editor already holds, rather than searching.
    if (ctx.values) {
      return { items: ctx.values.map((v) => ({ value: v, label: `Channel ${v}` })) };
    }

    // The question only a literal sibling can answer.
    if (!ctx.literal['projectId']) {
      return { items: [], notice: 'Choose a project first' };
    }

    const all = [
      { value: 'ch_1', label: 'support', description: 'Customer requests', group: 'Yours' },
      { value: 'ch_2', label: 'billing', hint: '42 members' },
    ];
    const items = ctx.search ? all.filter((o) => o.label.includes(ctx.search!)) : all;
    return ctx.cursor === 'page2'
      ? { items: [{ value: 'ch_3', label: 'archived' }], total: 3 }
      : { items, nextCursor: 'page2', total: 3 };
  }
}

/** A picker whose data needs a credential the author has not chosen yet. */
class CredentialPickerStep extends BaseActionStep<typeof PickerConfig, { ok: boolean }> {
  readonly type = 'CRED_PICKER';
  readonly configSchema = PickerConfig;
  readonly name = 'Credential picker';
  readonly description = 'Needs a connection before it can answer';
  readonly outputSchema = z.object({ ok: z.boolean() });
  readonly category = 'testing';
  override readonly credentialSlots = [{ name: 'secretName', required: true }] as const;
  override readonly credential = [TEST_WEBHOOK_SECRET];

  seen: FieldOptionsContext<z.infer<typeof PickerConfig>> | null = null;

  async execute(): Promise<{ ok: boolean }> {
    return { ok: true };
  }

  override async getOptions(
    ctx: FieldOptionsContext<z.infer<typeof PickerConfig>>,
  ): Promise<FieldOptionsPage> {
    this.seen = ctx;
    if (Object.keys(ctx.credentials).length === 0) {
      return { items: [], notice: 'Choose a connection first' };
    }
    return { items: [{ value: 'ch_1', label: 'support' }] };
  }
}

/**
 * A step that checks its configuration against something only it can see.
 *
 * `channelId` is a plain literal here on purpose: the point of the hook is that
 * a value can be perfectly well-formed and still name nothing real.
 */
const CheckedConfig = z.object({
  channelId: variableRef(z.string()),
  note: z.string().optional(),
});

class CheckedStep extends BaseActionStep<typeof CheckedConfig, { ok: boolean }> {
  readonly type = 'CHECKED';
  readonly configSchema = CheckedConfig;
  readonly name = 'Checked';
  readonly description = 'Validates its config against the world';
  readonly outputSchema = z.object({ ok: z.boolean() });
  readonly category = 'testing';

  /** What the last call was handed, so a test can look at it. */
  seen: ConfigValidationContext<z.infer<typeof CheckedConfig>> | null = null;
  constructor(private readonly behaviour: 'pass' | 'fail' | 'throw' = 'pass') {
    super();
  }

  async execute(): Promise<{ ok: boolean }> {
    return { ok: true };
  }

  override async validateConfig(
    ctx: ConfigValidationContext<z.infer<typeof CheckedConfig>>,
  ): Promise<ConfigIssue[]> {
    this.seen = ctx;
    if (this.behaviour === 'throw') throw new Error('upstream is down');
    // A reference cannot be checked — it is absent from `known`, and saying
    // nothing is the only correct answer.
    if (ctx.known.channelId === undefined) return [];
    if (this.behaviour === 'fail') {
      return [{ path: 'channelId', message: `You are not a member of ${ctx.known.channelId}.` }];
    }
    return [];
  }
}

const ManualConfig = z.object({});

class TestManualTrigger extends ManualTrigger<typeof ManualConfig> {
  readonly type = 'TEST_MANUAL';
  readonly configSchema = ManualConfig;
  readonly name = 'Test Manual';
  readonly description = 'Test manual trigger';
  readonly outputSchema = z.object({});
  readonly category = TriggerCategory.MANUAL;
}

// ─── Helpers ───

function createTestFixture(extra?: {
  steps?: readonly AnyStep[];
  triggers?: readonly AnyTrigger[];
  authorizer?: WorkflowAuthorizer<typeof SYSTEM, IdScope>;
  approval?: ApprovalConfig;
  storage?: StorageAdapter;
}) {
  const persistence = new InMemoryPersistenceAdapter();
  const enqueuedJobs: Array<{ executionId: string; delay?: number; kind?: string }> = [];
  const queue: QueueAdapter = {
    async enqueue(data) {
      enqueuedJobs.push(data);
    },
  };
  const scheduledJobs = new Map<string, { expression: string; timezone?: string }>();
  const scheduler: SchedulerAdapter = {
    async schedule(workflowId, expression, timezone) {
      scheduledJobs.set(workflowId, { expression, timezone });
    },
    async unschedule(workflowId) {
      scheduledJobs.delete(workflowId);
    },
  };
  const services = new ServiceRegistry();
  const webhookTrigger = new TestWebhookTrigger();
  const connectors = testRegistry({
    steps: [new EchoStep(), new PauseTestStep(), ...(extra?.steps ?? [])],
    triggers: [
      new TestEventTrigger(),
      new FilteredEventTrigger(),
      webhookTrigger,
      new TestCronTrigger(),
      new TestManualTrigger(),
      ...(extra?.triggers ?? []),
    ],
    credentials: [TEST_WEBHOOK_SECRET],
  });

  const executor = new WorkflowExecutor(
    persistence,
    connectors,
    services,
  );

  const runtime = new WorkflowRuntime({
    persistence,
    // Explicit: these are not ACL tests, so enforcement is deliberately off.
    authorizer: extra?.authorizer ?? new AllowAllAuthorizer(),
    queue,
    scheduler,
    services,
    connectors,
    executor,
    ...(extra?.storage ? { storage: extra.storage } : {}),
    config: {
      baseUrl: 'https://api.example.com',
      // Explicit, like the authorizer above: a case that cares about review
      // says so, and every other one is on record as not gating anything.
      approval: extra?.approval ?? { default: ApprovalRequirement.NOT_REQUIRED },
    },
  });

  return {
    runtime,
    persistence,
    queue,
    enqueuedJobs,
    scheduler,
    scheduledJobs,
    services,
    connectors,
    executor,
  };
}

function seedWorkflow(
  persistence: InMemoryPersistenceAdapter,
  id: string,
  opts: {
    triggerType: string;
    triggerConfig?: Record<string, unknown>;
    steps?: Array<{ id: string; type: string; config: Record<string, unknown> }>;
    status?: string;
    metadata?: Record<string, unknown>;
    triggerFilter?: Record<string, unknown>;
    triggerStart?: Record<string, unknown>;
    runNaming?: WorkflowRunNaming;
  },
) {
  persistence.seedWorkflow({
    id,
    status: opts.status ?? 'ACTIVE',
    eventType: opts.triggerType,
    config: JSON.stringify({
      trigger: {
        type: opts.triggerType,
        config: opts.triggerConfig ?? {},
        ...(opts.triggerFilter ? { filter: opts.triggerFilter } : {}),
        ...(opts.triggerStart ? { start: opts.triggerStart } : {}),
      },
      steps: opts.steps ?? [],
      ...(opts.runNaming ? { settings: { runNaming: opts.runNaming } } : {}),
    }),
    metadata: JSON.stringify(opts.metadata ?? {}),
    summary: null,
    folderId: 'folder_test',
    // Every workflow carries its tenant: the create route stamps it, and code
    // that reads it — storage scoping above all — is only exercised honestly if
    // the fixture has one too.
    attributes: { workspaceId: 'ws_1' },
  });
}

/** A webhook workflow whose token secret `shh` is stored as `hook-secret`. */
function seedWebhookWorkflow(
  persistence: InMemoryPersistenceAdapter,
  opts: { status?: string; triggerFilter?: Record<string, unknown>; withSecret?: boolean } = {},
) {
  if (opts.withSecret !== false) {
    persistence.seedCredential('hook-secret', {
      credType: 'TEST_WEBHOOK_SECRET',
      authType: 'secret',
      values: { value: 'shh' },
    });
  }
  seedWorkflow(persistence, 'wf1', {
    triggerType: 'TEST_WEBHOOK',
    triggerConfig: { secretName: 'hook-secret' },
    ...(opts.status ? { status: opts.status } : {}),
    ...(opts.triggerFilter ? { triggerFilter: opts.triggerFilter } : {}),
  });
}

function webhookRequest(
  body: unknown,
  headers: Record<string, string> = { 'x-token': 'shh' },
  extra: { method?: string; query?: Record<string, string> } = {},
): InboundHttpRequest {
  return {
    method: extra.method ?? 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    query: extra.query ?? {},
    rawBody: new TextEncoder().encode(typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

// ─── Tests ───

describe('WorkflowRuntime', () => {
  describe('dispatchEvent', () => {
    it('creates executions for matching event triggers', async () => {
      const { runtime, persistence, enqueuedJobs } = createTestFixture();
      seedWorkflow(persistence, 'wf1', {
        triggerType: 'TEST_EVENT',
        steps: [{ id: 's1', type: 'ECHO', config: { message: 'hello' } }],
      });

      const ids = await runtime.dispatchEvent({
        type: 'TEST_EVENT',
        payload: { key: 'value' },
        metadata: {},
      });

      expect(ids).toHaveLength(1);
      expect(enqueuedJobs).toHaveLength(1);
      expect(enqueuedJobs[0]!.executionId).toBe(ids[0]);

      const exec = await persistence.getExecution(ids[0]!);
      expect(exec?.status).toBe('PENDING');
    });

    it('skips workflows with non-matching event type', async () => {
      const { runtime, persistence } = createTestFixture();
      seedWorkflow(persistence, 'wf1', { triggerType: 'TEST_EVENT' });

      const ids = await runtime.dispatchEvent({
        type: 'OTHER_EVENT',
        payload: {},
        metadata: {},
      });

      expect(ids).toHaveLength(0);
    });

    it('applies trigger filters', async () => {
      const { runtime, persistence } = createTestFixture();
      seedWorkflow(persistence, 'wf1', {
        triggerType: 'FILTERED_EVENT',
        triggerConfig: { channel: 'general' },
      });

      const matched = await runtime.dispatchEvent({
        type: 'FILTERED_EVENT',
        payload: { channel: 'general' },
        metadata: {},
      });
      expect(matched).toHaveLength(1);

      const filtered = await runtime.dispatchEvent({
        type: 'FILTERED_EVENT',
        payload: { channel: 'random' },
        metadata: {},
      });
      expect(filtered).toHaveLength(0);
    });

    it('creates multiple executions for multiple matching workflows', async () => {
      const { runtime, persistence, enqueuedJobs } = createTestFixture();
      seedWorkflow(persistence, 'wf1', { triggerType: 'TEST_EVENT' });
      seedWorkflow(persistence, 'wf2', { triggerType: 'TEST_EVENT' });

      const ids = await runtime.dispatchEvent({
        type: 'TEST_EVENT',
        payload: {},
        metadata: {},
      });

      expect(ids).toHaveLength(2);
      expect(enqueuedJobs).toHaveLength(2);
    });

    it('ignores non-ACTIVE workflows', async () => {
      const { runtime, persistence } = createTestFixture();
      seedWorkflow(persistence, 'wf1', {
        triggerType: 'TEST_EVENT',
        status: 'DISABLED',
      });

      const ids = await runtime.dispatchEvent({
        type: 'TEST_EVENT',
        payload: {},
        metadata: {},
      });

      expect(ids).toHaveLength(0);
    });
  });

  describe('admission', () => {
    it('prunes on the raw event with accepts(), before any enrichment', async () => {
      const { runtime, persistence } = createTestFixture({
        triggers: [new ScopedEventTrigger()],
      });
      seedWorkflow(persistence, 'watching', {
        triggerType: 'SCOPED_EVENT',
        triggerConfig: { boardId: 'b_support' },
      });
      seedWorkflow(persistence, 'elsewhere', {
        triggerType: 'SCOPED_EVENT',
        triggerConfig: { boardId: 'b_billing' },
      });

      const ids = await runtime.dispatchEvent({
        type: 'SCOPED_EVENT',
        payload: { boardId: 'b_support', ticketId: 't_1' },
        metadata: {},
      });

      expect(ids).toHaveLength(1);
      const exec = await persistence.getExecution(ids[0]!);
      expect(exec?.workflowId).toBe('watching');
    });

    it('hydrates once per event, however many workflows are watching', async () => {
      const trigger = new CountingHydratingTrigger();
      const { runtime, persistence } = createTestFixture({ triggers: [trigger] });
      seedWorkflow(persistence, 'wf1', { triggerType: 'HYDRATING_EVENT' });
      seedWorkflow(persistence, 'wf2', { triggerType: 'HYDRATING_EVENT' });
      seedWorkflow(persistence, 'wf3', { triggerType: 'HYDRATING_EVENT' });

      const ids = await runtime.dispatchEvent({
        type: 'HYDRATING_EVENT',
        payload: { ticketId: 't_1' },
        metadata: {},
      });

      expect(ids).toHaveLength(3);
      expect(trigger.calls).toBe(1);
    });

    it('freezes the hydrated payload into the run', async () => {
      const trigger = new CountingHydratingTrigger();
      const { runtime, persistence } = createTestFixture({ triggers: [trigger] });
      seedWorkflow(persistence, 'wf1', { triggerType: 'HYDRATING_EVENT' });

      const [execId] = await runtime.dispatchEvent({
        type: 'HYDRATING_EVENT',
        payload: { ticketId: 't_1' },
        metadata: {},
      });

      const state = await persistence.getExecutionState(execId!);
      expect(JSON.parse(state!.context!).trigger).toEqual({
        type: 'HYDRATING_EVENT',
        ticketId: 't_1',
        status: 'Backlog',
        readCount: 1,
      });
    });

    it('drops the event when the subject is gone', async () => {
      const trigger = new CountingHydratingTrigger();
      trigger.mode = 'gone';
      const { runtime, persistence } = createTestFixture({ triggers: [trigger] });
      seedWorkflow(persistence, 'wf1', { triggerType: 'HYDRATING_EVENT' });

      const ids = await runtime.dispatchEvent({
        type: 'HYDRATING_EVENT',
        payload: { ticketId: 't_1' },
        metadata: {},
      });

      expect(ids).toHaveLength(0);
    });

    it('drops the event when enrichment fails, rather than running on bare ids', async () => {
      const trigger = new CountingHydratingTrigger();
      trigger.mode = 'throw';
      const { runtime, persistence } = createTestFixture({ triggers: [trigger] });
      seedWorkflow(persistence, 'wf1', { triggerType: 'HYDRATING_EVENT' });

      const ids = await runtime.dispatchEvent({
        type: 'HYDRATING_EVENT',
        payload: { ticketId: 't_1' },
        metadata: {},
      });

      expect(ids).toHaveLength(0);
    });

    it('never re-derives the snapshot once the run starts', async () => {
      const trigger = new CountingHydratingTrigger();
      const { runtime, persistence } = createTestFixture({ triggers: [trigger] });
      seedWorkflow(persistence, 'wf1', {
        triggerType: 'HYDRATING_EVENT',
        steps: [{ id: 's1', type: 'ECHO', config: { message: 'hi' } }],
      });

      const [execId] = await runtime.dispatchEvent({
        type: 'HYDRATING_EVENT',
        payload: { ticketId: 't_1' },
        metadata: {},
      });
      await runtime.processJob(execId!);

      // The executor used to hydrate and re-filter again on a fresh run, so the
      // run could act on different values than the ones it was admitted on.
      expect(trigger.calls).toBe(1);
      const state = await persistence.getExecutionState(execId!);
      expect(JSON.parse(state!.context!).trigger.readCount).toBe(1);
    });

    it('applies the author trigger filter to a manual run', async () => {
      const { runtime, persistence } = createTestFixture();
      seedWorkflow(persistence, 'wf1', {
        triggerType: 'TEST_MANUAL',
        triggerFilter: {
          conditions: {
            variable: '{{trigger.amount}}',
            operator: ConditionOperator.GT,
            value: 100,
          },
        },
      });

      const execId = await runtime.triggerManual(SYSTEM, 'wf1', { amount: 500 });
      expect(execId).toBeTruthy();

      await expect(runtime.triggerManual(SYSTEM, 'wf1', { amount: 5 })).rejects.toThrow(
        /did not accept this run/,
      );
    });

    it('applies the author trigger filter to a cron tick', async () => {
      const { runtime, persistence } = createTestFixture();
      seedWorkflow(persistence, 'wf1', {
        triggerType: 'TEST_CRON',
        triggerConfig: { expression: '0 * * * *' },
        triggerFilter: {
          conditions: {
            variable: '{{trigger.firedAt}}',
            operator: ConditionOperator.EXISTS,
          },
        },
      });
      expect(await runtime.processCronTick('wf1')).toBeTruthy();

      seedWorkflow(persistence, 'wf2', {
        triggerType: 'TEST_CRON',
        triggerConfig: { expression: '0 * * * *' },
        triggerFilter: {
          conditions: {
            variable: '{{trigger.nothingHere}}',
            operator: ConditionOperator.EXISTS,
          },
        },
      });
      expect(await runtime.processCronTick('wf2')).toBeNull();
    });
  });

  describe('delayed start', () => {
    const TWO_HOURS = { kind: 'delay', offset: { amount: 2, unit: 'hours' } };
    const NOW = new Date('2026-03-01T10:00:00.000Z');

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(NOW);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    const readContext = async (
      persistence: InMemoryPersistenceAdapter,
      execId: string,
    ): Promise<{ trigger?: Record<string, unknown> }> => {
      const state = await persistence.getExecutionState(execId);
      return JSON.parse(state!.context!);
    };

    it('arms the run without reading anything, and parks it until its moment', async () => {
      const trigger = new CountingHydratingTrigger();
      const { runtime, persistence, enqueuedJobs } = createTestFixture({ triggers: [trigger] });
      seedWorkflow(persistence, 'wf1', {
        triggerType: 'HYDRATING_EVENT',
        triggerStart: TWO_HOURS,
        steps: [{ id: 's1', type: 'ECHO', config: { message: 'escalate' } }],
      });

      const [execId] = await runtime.dispatchEvent({
        type: 'HYDRATING_EVENT',
        payload: { ticketId: 't_1' },
        metadata: {},
        occurredAt: '2026-03-01T09:30:00.000Z',
      });

      const exec = await persistence.getExecution(execId!);
      expect(exec?.status).toBe('SCHEDULED');
      expect(exec?.fireAt).toEqual(new Date('2026-03-01T11:30:00.000Z'));
      // Nothing was read to arm it: "two hours after the event" needs no lookup.
      expect(trigger.calls).toBe(0);

      expect(enqueuedJobs[0]).toEqual({
        executionId: execId,
        delay: 90 * 60 * 1000,
        singletonKey: execId,
      });

      // The RAW event survives the wait on the RECORD, not inside a context: a run
      // that has not started has nothing to read yet.
      expect(exec?.origin).toEqual({
        event: {
          type: 'HYDRATING_EVENT',
          payload: { ticketId: 't_1' },
          occurredAt: '2026-03-01T09:30:00.000Z',
        },
        anchor: { source: 'event', value: '2026-03-01T09:30:00.000Z' },
      });
      const context = await readContext(persistence, execId!);
      expect(context.trigger).toBeUndefined();
    });

    it('still prunes on scope before arming', async () => {
      const { runtime, persistence } = createTestFixture({ triggers: [new ScopedEventTrigger()] });
      seedWorkflow(persistence, 'wf1', {
        triggerType: 'SCOPED_EVENT',
        triggerConfig: { boardId: 'b_billing' },
        triggerStart: TWO_HOURS,
      });

      const ids = await runtime.dispatchEvent({
        type: 'SCOPED_EVENT',
        payload: { boardId: 'b_support' },
        metadata: {},
      });

      expect(ids).toHaveLength(0);
    });

    it('arms even when the condition is false right now', async () => {
      const { runtime, persistence } = createTestFixture();
      // "escalate if still unassigned in two hours" — assigned at creation, and it
      // must still arm, or the rule can never fire.
      seedWorkflow(persistence, 'wf1', {
        triggerType: 'TEST_EVENT',
        triggerStart: TWO_HOURS,
        triggerFilter: {
          conditions: {
            variable: '{{trigger.assignee}}',
            operator: ConditionOperator.EQ,
            value: '',
          },
        },
      });

      const [execId] = await runtime.dispatchEvent({
        type: 'TEST_EVENT',
        payload: { assignee: 'priya' },
        metadata: {},
      });

      expect((await persistence.getExecution(execId!))?.status).toBe('SCHEDULED');
    });

    it('admits on fresh data when it fires, and runs', async () => {
      const trigger = new CountingHydratingTrigger();
      const { runtime, persistence } = createTestFixture({ triggers: [trigger] });
      seedWorkflow(persistence, 'wf1', {
        triggerType: 'HYDRATING_EVENT',
        triggerStart: TWO_HOURS,
        steps: [{ id: 's1', type: 'ECHO', config: { message: 'escalate' } }],
      });

      const [execId] = await runtime.dispatchEvent({
        type: 'HYDRATING_EVENT',
        payload: { ticketId: 't_1' },
        metadata: {},
      });

      vi.setSystemTime(new Date(NOW.getTime() + 2 * 60 * 60 * 1000));
      const result = await runtime.processJob(execId!);

      expect(result.status).toBe('completed');
      expect(trigger.calls).toBe(1);

      const context = await readContext(persistence, execId!);
      expect(context.trigger).toEqual({
        type: 'HYDRATING_EVENT',
        ticketId: 't_1',
        status: 'Backlog',
        readCount: 1,
      });
      expect(context.__meta?.['pendingStart']).toBeUndefined();
    });

    it('skips, with the reason, when the condition no longer holds', async () => {
      const { runtime, persistence } = createTestFixture();
      seedWorkflow(persistence, 'wf1', {
        triggerType: 'TEST_EVENT',
        triggerStart: TWO_HOURS,
        triggerFilter: {
          conditions: {
            variable: '{{trigger.status}}',
            operator: ConditionOperator.EQ,
            value: 'Backlog',
          },
        },
      });

      const [execId] = await runtime.dispatchEvent({
        type: 'TEST_EVENT',
        payload: { status: 'Done' },
        metadata: {},
      });

      vi.setSystemTime(new Date(NOW.getTime() + 2 * 60 * 60 * 1000));
      const result = await runtime.processJob(execId!);

      expect(result.status).toBe('skipped');
      const exec = await persistence.getExecution(execId!);
      expect(exec?.status).toBe('SKIPPED');
      expect(exec?.endReason).toMatch(/conditions did not match/);
    });

    it('cancels, with the reason, when the subject is gone by then', async () => {
      const trigger = new CountingHydratingTrigger();
      const { runtime, persistence } = createTestFixture({ triggers: [trigger] });
      seedWorkflow(persistence, 'wf1', {
        triggerType: 'HYDRATING_EVENT',
        triggerStart: TWO_HOURS,
      });

      const [execId] = await runtime.dispatchEvent({
        type: 'HYDRATING_EVENT',
        payload: { ticketId: 't_1' },
        metadata: {},
      });

      trigger.mode = 'gone';
      vi.setSystemTime(new Date(NOW.getTime() + 2 * 60 * 60 * 1000));
      await runtime.processJob(execId!);

      const exec = await persistence.getExecution(execId!);
      expect(exec?.status).toBe('CANCELLED');
      expect(exec?.endReason).toMatch(/ticket deleted/);
    });

    it('cancels when the workflow was switched off while it waited', async () => {
      const { runtime, persistence } = createTestFixture();
      seedWorkflow(persistence, 'wf1', { triggerType: 'TEST_EVENT', triggerStart: TWO_HOURS });

      const [execId] = await runtime.dispatchEvent({
        type: 'TEST_EVENT',
        payload: {},
        metadata: {},
      });

      await persistence.updateWorkflow('wf1', { status: 'DISABLED' });
      vi.setSystemTime(new Date(NOW.getTime() + 2 * 60 * 60 * 1000));
      await runtime.processJob(execId!);

      const exec = await persistence.getExecution(execId!);
      expect(exec?.status).toBe('CANCELLED');
      expect(exec?.endReason).toMatch(/no longer active/);
    });

    it('re-arms instead of admitting early when it is woken ahead of time', async () => {
      const { runtime, persistence, enqueuedJobs } = createTestFixture();
      seedWorkflow(persistence, 'wf1', { triggerType: 'TEST_EVENT', triggerStart: TWO_HOURS });

      const [execId] = await runtime.dispatchEvent({
        type: 'TEST_EVENT',
        payload: {},
        metadata: {},
      });

      enqueuedJobs.length = 0;
      const result = await runtime.processJob(execId!);

      expect(result).toEqual({ status: 'skipped', reason: expect.stringMatching(/not due/) });
      expect((await persistence.getExecution(execId!))?.status).toBe('SCHEDULED');
      expect(enqueuedJobs[0]?.delay).toBe(2 * 60 * 60 * 1000);
    });

    it('reads once to work out when to fire, and again when it fires', async () => {
      const trigger = new CountingHydratingTrigger();
      const { runtime, persistence } = createTestFixture({ triggers: [trigger] });
      seedWorkflow(persistence, 'wf1', {
        triggerType: 'HYDRATING_EVENT',
        triggerStart: { kind: 'at', anchor: '{{trigger.dueAt}}', ifPast: 'skip' },
      });

      // The trigger's hydrate puts `dueAt` on the payload; see CountingHydratingTrigger.
      const [execId] = await runtime.dispatchEvent({
        type: 'HYDRATING_EVENT',
        payload: { ticketId: 't_1', dueAt: '2026-03-01T13:00:00.000Z' },
        metadata: {},
      });

      const exec = await persistence.getExecution(execId!);
      expect(exec?.status).toBe('SCHEDULED');
      expect(exec?.fireAt).toEqual(new Date('2026-03-01T13:00:00.000Z'));
      expect(trigger.calls).toBe(1);

      vi.setSystemTime(new Date('2026-03-01T13:00:00.000Z'));
      await runtime.processJob(execId!);

      // The scheduling read is thrown away; the run is admitted on a fresh one.
      expect(trigger.calls).toBe(2);
      const context = await readContext(persistence, execId!);
      expect(context.trigger['readCount']).toBe(2);
    });

    it('creates nothing when the date it would wait for is not set', async () => {
      const trigger = new CountingHydratingTrigger();
      const { runtime, persistence } = createTestFixture({ triggers: [trigger] });
      seedWorkflow(persistence, 'wf1', {
        triggerType: 'HYDRATING_EVENT',
        triggerStart: { kind: 'at', anchor: '{{trigger.dueAt}}', ifPast: 'skip' },
      });

      const ids = await runtime.dispatchEvent({
        type: 'HYDRATING_EVENT',
        payload: { ticketId: 't_1' },
        metadata: {},
      });

      expect(ids).toHaveLength(0);
    });
  });

  describe('field options', () => {
    const fixture = () => {
      const step = new PickerStep();
      const f = createTestFixture({ steps: [step] });
      seedWorkflow(f.persistence, 'wf1', { triggerType: 'TEST_EVENT' });
      return { ...f, step };
    };

    const ask = (
      runtime: ReturnType<typeof createTestFixture>['runtime'],
      over: Record<string, unknown> = {},
    ) =>
      runtime.getFieldOptions(SYSTEM, {
        kind: 'step',
        type: 'PICKER',
        field: 'channelId',
        workflowId: 'wf1',
        ...over,
      });

    it('asks the step that owns the field, and says which field is asking', async () => {
      const { runtime, step } = fixture();
      const page = await ask(runtime, { config: { projectId: 'p_1' } });

      expect(step.seen?.field).toBe('channelId');
      expect(page.items.map((i) => i.value)).toEqual(['ch_1', 'ch_2']);
      expect(page.items[0]).toMatchObject({ label: 'support', description: 'Customer requests' });
    });

    it('keeps references out of the values a loader may filter by', async () => {
      const { runtime, step } = fixture();
      await ask(runtime, {
        config: { projectId: '{{trigger.projectId}}', channelId: 'ch_9' },
      });

      // The raw form is still there for a loader that wants it…
      expect(step.seen?.config).toEqual({
        projectId: '{{trigger.projectId}}',
        channelId: 'ch_9',
      });
      // …but a reference is a promise about run time, not an id to search by.
      expect(step.seen?.literal).toEqual({ channelId: 'ch_9' });
    });

    it('follows a reference into a nested object without losing its neighbours', async () => {
      const { runtime, step } = fixture();
      await ask(runtime, {
        config: {
          projectId: 'p_1',
          repository: { id: 'r_7', name: '{{trigger.repo.name}}' },
        },
      });

      // A field path may point inside an object, so `literal` goes in after it:
      // the id is still a usable filter even though its neighbour is a promise.
      expect(step.seen?.literal).toEqual({ projectId: 'p_1', repository: { id: 'r_7' } });
    });

    it('drops a list that holds a reference rather than shortening it', async () => {
      const { runtime, step } = fixture();
      await ask(runtime, {
        config: { projectId: 'p_1', boardIds: ['b_1', '{{trigger.boardId}}'] },
      });

      // Two boards were asked for and one is not known yet. Handing over `['b_1']`
      // would read as a narrower filter, with nothing to say it is incomplete.
      expect(step.seen?.literal).toEqual({ projectId: 'p_1' });
    });

    it('lets the loader speak when no credential is chosen yet', async () => {
      // Resolution throws for a required credential that is not configured. At
      // AUTHORING time that is the normal state of a half-filled form, not a
      // failure: the request must reach the loader so it can say what it needs.
      const step = new CredentialPickerStep();
      const f = createTestFixture({ steps: [step] });
      seedWorkflow(f.persistence, 'wf1', { triggerType: 'TEST_EVENT' });

      const page = await f.runtime.getFieldOptions(SYSTEM, {
        kind: 'step',
        type: 'CRED_PICKER',
        field: 'channelId',
        workflowId: 'wf1',
        config: {},
      });

      expect(page.notice).toMatch(/Choose a connection/);
      expect(step.seen?.credentials).toEqual({});
    });

    it('lets someone who may only READ the workflow see what its ids are called', async () => {
      // The lookup here derives the TENANT, not a capability: it says whose
      // credential the loader runs with. Asking for `workflow:update` showed a
      // viewer raw ids where the author saw names, for no boundary in return:
      // what the picker may show is already settled by the credential.
      const reader: WorkflowAuthorizer<typeof SYSTEM, IdScope> = {
        async permissions() {
          return ['workflow:read'];
        },
        async visibleFilter() {
          return { kind: 'all' };
        },
      };
      const step = new PickerStep();
      const f = createTestFixture({ steps: [step], authorizer: reader });
      seedWorkflow(f.persistence, 'wf1', { triggerType: 'TEST_EVENT' });

      const page = await ask(f.runtime, { config: { projectId: 'p_1' }, values: ['ch_9'] });
      expect(page.items.map((i) => i.value)).toEqual(['ch_9']);
    });

    it('refuses someone who may not read the workflow at all', async () => {
      const stranger: WorkflowAuthorizer<typeof SYSTEM, IdScope> = {
        async permissions() {
          return [];
        },
        async visibleFilter() {
          return { kind: 'none' };
        },
      };
      const f = createTestFixture({ steps: [new PickerStep()], authorizer: stranger });
      seedWorkflow(f.persistence, 'wf1', { triggerType: 'TEST_EVENT' });

      // Without an authorized record there is no tenant to act as, so there is
      // no ungated form of this call.
      await expect(ask(f.runtime, { config: {} })).rejects.toThrow();
    });

    it('answers with a notice when the form is not ready, rather than an empty list', async () => {
      const { runtime } = fixture();
      const page = await ask(runtime, { config: { projectId: '{{trigger.projectId}}' } });

      expect(page.items).toEqual([]);
      expect(page.notice).toMatch(/Choose a project/);
    });

    it('pages with a cursor', async () => {
      const { runtime } = fixture();
      const first = await ask(runtime, { config: { projectId: 'p_1' } });
      expect(first.nextCursor).toBe('page2');

      const second = await ask(runtime, { config: { projectId: 'p_1' }, cursor: 'page2' });
      expect(second.items.map((i) => i.value)).toEqual(['ch_3']);
      expect(second.nextCursor).toBeUndefined();
    });

    it('searches at the source', async () => {
      const { runtime } = fixture();
      const page = await ask(runtime, { config: { projectId: 'p_1' }, search: 'bill' });
      expect(page.items.map((i) => i.value)).toEqual(['ch_2']);
    });

    it('describes ids the editor already holds, so a saved workflow shows names', async () => {
      const { runtime } = fixture();
      const page = await ask(runtime, { values: ['ch_1'] });
      expect(page.items).toEqual([{ value: 'ch_1', label: 'Channel ch_1' }]);
    });

    it('is an empty page for a step that offers no choices', async () => {
      const { runtime } = fixture();
      const page = await runtime.getFieldOptions(SYSTEM, {
        kind: 'step',
        type: 'ECHO',
        field: 'message',
        workflowId: 'wf1',
      });
      expect(page).toEqual({ items: [] });
    });

    it('refuses to guess whose data to read', async () => {
      const { runtime } = fixture();
      await expect(
        runtime.getFieldOptions(SYSTEM, { kind: 'step', type: 'PICKER', field: 'channelId' }),
      ).rejects.toThrow(/workflow being edited/);
    });

    it('rejects an unknown type', async () => {
      const { runtime } = fixture();
      await expect(
        ask(runtime, { type: 'NOPE' }),
      ).rejects.toThrow();
    });
  });

  describe('handleWebhook', () => {
    it('enqueues a run for an authenticated request and returns the trigger’s reply', async () => {
      const { runtime, persistence, enqueuedJobs } = createTestFixture();
      seedWebhookWorkflow(persistence);

      const result = await runtime.handleWebhook('wf1', webhookRequest({ event: 'test' }));

      expect(result.reply).toEqual({ status: 202, body: { accepted: true } });
      expect(result.executionIds).toHaveLength(1);
      expect(enqueuedJobs).toHaveLength(1);
      const state = await persistence.getExecutionState(result.executionIds[0]!);
      expect(JSON.parse(state!.context!).trigger).toEqual({
        type: 'TEST_WEBHOOK',
        body: { event: 'test' },
      });
    });

    it('returns 404 for an unknown workflow', async () => {
      const { runtime } = createTestFixture();
      const result = await runtime.handleWebhook('unknown', webhookRequest({}));
      expect(result.reply.status).toBe(404);
      expect(result.executionIds).toEqual([]);
    });

    it('returns 404 for an inactive workflow', async () => {
      const { runtime, persistence } = createTestFixture();
      seedWebhookWorkflow(persistence, { status: 'DISABLED' });
      const result = await runtime.handleWebhook('wf1', webhookRequest({}));
      expect(result.reply.status).toBe(404);
    });

    it('returns the same 404 when the workflow does not use a webhook trigger', async () => {
      const { runtime, persistence } = createTestFixture();
      seedWorkflow(persistence, 'wf1', { triggerType: 'TEST_EVENT' });
      const result = await runtime.handleWebhook('wf1', webhookRequest({}));
      expect(result.reply).toEqual({ status: 404, body: { error: 'Webhook not found' } });
    });

    it('returns 401 for a wrong token, and starts nothing', async () => {
      const { runtime, persistence, enqueuedJobs } = createTestFixture();
      seedWebhookWorkflow(persistence);
      const result = await runtime.handleWebhook('wf1', webhookRequest({}, { 'x-token': 'guess' }));
      expect(result.reply).toEqual({ status: 401, body: { error: 'Unauthorized' } });
      expect(enqueuedJobs).toHaveLength(0);
    });

    it('returns 401, and starts nothing, when the trigger’s verify throws', async () => {
      const { runtime, persistence, enqueuedJobs } = createTestFixture();
      seedWebhookWorkflow(persistence);
      const result = await runtime.handleWebhook('wf1', webhookRequest({}, { 'x-token': 'explode' }));
      expect(result.reply.status).toBe(401);
      expect(enqueuedJobs).toHaveLength(0);
    });

    it('returns 401 when the token header is missing', async () => {
      const { runtime, persistence } = createTestFixture();
      seedWebhookWorkflow(persistence);
      const result = await runtime.handleWebhook('wf1', webhookRequest({}, {}));
      expect(result.reply.status).toBe(401);
    });

    it('fails closed when the secret credential does not exist', async () => {
      const { runtime, persistence, enqueuedJobs } = createTestFixture();
      seedWebhookWorkflow(persistence, { withSecret: false });
      const result = await runtime.handleWebhook('wf1', webhookRequest({}));
      expect(result.reply.status).toBe(401);
      expect(enqueuedJobs).toHaveLength(0);
    });

    it('fails closed when the slot holds a secret of another type', async () => {
      const { runtime, persistence } = createTestFixture();
      persistence.seedCredential('hook-secret', { authType: 'secret', values: { value: 'shh' } });
      seedWebhookWorkflow(persistence, { withSecret: false });
      const result = await runtime.handleWebhook('wf1', webhookRequest({}));
      expect(result.reply.status).toBe(401);
    });

    it('answers a challenge without starting a run', async () => {
      const { runtime, persistence, enqueuedJobs } = createTestFixture();
      seedWebhookWorkflow(persistence);
      const result = await runtime.handleWebhook('wf1', webhookRequest({ challenge: 'abc' }));
      expect(result.reply).toEqual({ status: 200, body: { challenge: 'abc' } });
      expect(enqueuedJobs).toHaveLength(0);
    });

    it('answers a handshake before verification, without starting a run', async () => {
      const { runtime, persistence, enqueuedJobs } = createTestFixture();
      seedWebhookWorkflow(persistence);
      const result = await runtime.handleWebhook(
        'wf1',
        webhookRequest('', {}, { query: { validationToken: 'tok' } }),
      );
      expect(result.reply).toEqual({
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
        body: 'tok',
      });
      expect(result.executionIds).toEqual([]);
      expect(enqueuedJobs).toHaveLength(0);
    });

    it('answers a GET handshake', async () => {
      const { runtime, persistence } = createTestFixture();
      seedWebhookWorkflow(persistence);
      const result = await runtime.handleWebhook(
        'wf1',
        webhookRequest('', {}, { method: 'GET', query: { validationToken: 'tok' } }),
      );
      expect(result.reply.body).toBe('tok');
    });

    it('returns 404 for a GET the handshake does not answer, even when authenticated', async () => {
      const { runtime, persistence, enqueuedJobs } = createTestFixture();
      seedWebhookWorkflow(persistence);
      const result = await runtime.handleWebhook(
        'wf1',
        webhookRequest({ event: 'test' }, { 'x-token': 'shh' }, { method: 'GET' }),
      );
      expect(result.reply).toEqual({ status: 404, body: { error: 'Webhook not found' } });
      expect(enqueuedJobs).toHaveLength(0);
    });

    it('runs no handshake for an inactive workflow', async () => {
      const { runtime, persistence } = createTestFixture();
      seedWebhookWorkflow(persistence, { status: 'DISABLED' });
      const result = await runtime.handleWebhook(
        'wf1',
        webhookRequest('', {}, { query: { validationToken: 'tok' } }),
      );
      expect(result.reply.status).toBe(404);
    });

    it('runs no handshake when the credentials do not resolve', async () => {
      const { runtime, persistence } = createTestFixture();
      seedWebhookWorkflow(persistence, { withSecret: false });
      const result = await runtime.handleWebhook(
        'wf1',
        webhookRequest('', {}, { query: { validationToken: 'tok' } }),
      );
      expect(result.reply.status).toBe(401);
    });

    it('carries on to verification when the handshake throws', async () => {
      const { runtime, persistence, enqueuedJobs } = createTestFixture();
      seedWebhookWorkflow(persistence);
      const result = await runtime.handleWebhook(
        'wf1',
        webhookRequest({ event: 'test' }, { 'x-token': 'shh' }, { query: { validationToken: 'explode' } }),
      );
      expect(result.reply.status).toBe(202);
      expect(enqueuedJobs).toHaveLength(1);
    });

    it('returns 400 for a body that is not the JSON it claims to be', async () => {
      const { runtime, persistence } = createTestFixture();
      seedWebhookWorkflow(persistence);
      const result = await runtime.handleWebhook('wf1', webhookRequest('{oops'));
      expect(result.reply.status).toBe(400);
    });

    it('drops events the trigger filter rejects, leaving no run for them', async () => {
      const { runtime, persistence, enqueuedJobs } = createTestFixture();
      seedWebhookWorkflow(persistence, {
        triggerFilter: {
          conditions: { variable: '{{trigger.body.kind}}', operator: ConditionOperator.EQ, value: 'keep' },
        },
      });

      const result = await runtime.handleWebhook(
        'wf1',
        webhookRequest({ items: [{ kind: 'keep' }, { kind: 'drop' }] }),
      );

      expect(result.executionIds).toHaveLength(1);
      expect(enqueuedJobs).toHaveLength(1);
      expect(persistence.executions.size).toBe(1);
    });
  });

  describe('run identifiers', () => {
    it('builds the name from the trigger input, suffixing a repeat', async () => {
      const { runtime, persistence } = createTestFixture();
      seedWorkflow(persistence, 'wf1', {
        triggerType: 'TEST_MANUAL',
        runNaming: { mode: 'template', template: '{{trigger.aadhar}}-{{trigger.username}}' },
      });

      const first = await runtime.triggerManual(SYSTEM, 'wf1', { aadhar: '1234', username: 'Rahul' });
      const second = await runtime.triggerManual(SYSTEM, 'wf1', { aadhar: '1234', username: 'Rahul' });

      const a = await persistence.getExecution(first);
      const b = await persistence.getExecution(second);
      expect(a?.name).toBe('1234-Rahul');
      expect(b?.name).toBe('1234-Rahul#1');
      // A template name means something — it is not a placeholder to hide.
      expect(a?.nameAutoGenerated).toBe(false);
    });

    it('stores a typed name without leaking it into the trigger input', async () => {
      const { runtime, persistence } = createTestFixture();
      seedWorkflow(persistence, 'wf1', { triggerType: 'TEST_MANUAL', runNaming: { mode: 'user' } });

      const id = await runtime.triggerManual(SYSTEM, 'wf1', { __runIdentifier: 'KYC Review', customer: 'Rahul' });

      expect((await persistence.getExecution(id))?.name).toBe('KYC Review');
      const state = await persistence.getExecutionState(id);
      const context = JSON.parse(state!.context!) as { trigger: Record<string, unknown> };
      expect(context.trigger['customer']).toBe('Rahul');
      expect(context.trigger).not.toHaveProperty('__runIdentifier');
    });

    it('refuses a typed name already used in the same workflow, not in another', async () => {
      const { runtime, persistence } = createTestFixture();
      seedWorkflow(persistence, 'wf1', { triggerType: 'TEST_MANUAL', runNaming: { mode: 'user' } });
      seedWorkflow(persistence, 'wf2', { triggerType: 'TEST_MANUAL', runNaming: { mode: 'user' } });

      await runtime.triggerManual(SYSTEM, 'wf1', { __runIdentifier: 'Review' });
      await expect(
        runtime.triggerManual(SYSTEM, 'wf1', { __runIdentifier: 'Review' }),
      ).rejects.toThrow('Workflow run identifier "Review" already exists');
      await expect(
        runtime.triggerManual(SYSTEM, 'wf2', { __runIdentifier: 'Review' }),
      ).resolves.toBeTruthy();
    });

    it('generates a flagged placeholder when the typed name is blank', async () => {
      const { runtime, persistence } = createTestFixture();
      seedWorkflow(persistence, 'wf1', { triggerType: 'TEST_MANUAL', runNaming: { mode: 'user' } });

      const id = await runtime.triggerManual(SYSTEM, 'wf1', { __runIdentifier: '   ' });

      const exec = await persistence.getExecution(id);
      expect(exec?.name).toMatch(/^Run-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}-\d{3}-UTC$/);
      // Flagged, so the UI hides it rather than showing it as a chosen name.
      expect(exec?.nameAutoGenerated).toBe(true);
    });

    it('falls back to a flagged placeholder when the template resolves empty', async () => {
      const { runtime, persistence } = createTestFixture();
      seedWorkflow(persistence, 'wf1', {
        triggerType: 'TEST_MANUAL',
        runNaming: { mode: 'template', template: '{{trigger.missing}}' },
      });

      const id = await runtime.triggerManual(SYSTEM, 'wf1', {});

      expect((await persistence.getExecution(id))?.nameAutoGenerated).toBe(true);
    });
  });

  describe('triggerManual', () => {
    it('creates execution with provided payload', async () => {
      const { runtime, persistence, enqueuedJobs } = createTestFixture();
      seedWorkflow(persistence, 'wf1', { triggerType: 'TEST_MANUAL' });

      const execId = await runtime.triggerManual(SYSTEM, 'wf1', { key: 'val' });

      expect(execId).toBeTruthy();
      expect(enqueuedJobs).toHaveLength(1);

      const state = await persistence.getExecutionState(execId);
      const context = JSON.parse(state!.context!);
      expect(context.trigger.key).toBe('val');
    });

    it('throws for unknown workflow', async () => {
      const { runtime } = createTestFixture();

      await expect(
        runtime.triggerManual(SYSTEM, 'nonexistent', {}),
      ).rejects.toThrow('Workflow nonexistent not found');
    });

    it('carries an attachment field value into context.trigger by name', async () => {
      const { runtime, persistence } = createTestFixture();
      seedWorkflow(persistence, 'wf1', {
        triggerType: 'TEST_MANUAL',
        triggerConfig: {
          inputSchema: {
            type: 'object',
            properties: { doc: { type: 'object', format: 'attachment' } },
          },
        },
      });

      const att = { name: 'a.txt', mimeType: 'text/plain', handle: 'mem://x', size: 5 };
      const execId = await runtime.triggerManual(SYSTEM, 'wf1', { topic: 't', doc: att });

      const state = await persistence.getExecutionState(execId);
      const context = JSON.parse(state!.context!);
      expect(context.trigger.topic).toBe('t');
      expect(context.trigger.doc).toEqual(att);
    });

    it('rejects when a required attachment field is missing', async () => {
      const { runtime, persistence } = createTestFixture();
      seedWorkflow(persistence, 'wf1', {
        triggerType: 'TEST_MANUAL',
        triggerConfig: {
          inputSchema: {
            type: 'object',
            properties: { pan: { type: 'object', format: 'attachment' } },
            required: ['pan'],
          },
        },
      });

      await expect(runtime.triggerManual(SYSTEM, 'wf1', {})).rejects.toThrow(/required/);
    });

    it('rejects when a multiple-attachment field exceeds maxItems', async () => {
      const { runtime, persistence } = createTestFixture();
      seedWorkflow(persistence, 'wf1', {
        triggerType: 'TEST_MANUAL',
        triggerConfig: {
          inputSchema: {
            type: 'object',
            properties: {
              docs: { type: 'array', items: { type: 'object', format: 'attachment' }, maxItems: 1 },
            },
          },
        },
      });
      const a = { name: 'a.txt', mimeType: 'text/plain', handle: 'mem://x' };
      const b = { name: 'b.txt', mimeType: 'text/plain', handle: 'mem://y' };

      await expect(
        runtime.triggerManual(SYSTEM, 'wf1', { docs: [a, b] }),
      ).rejects.toThrow(/at most 1 file/);
    });

    it('rejects mime types not in a field accept list (with wildcard support)', async () => {
      const { runtime, persistence } = createTestFixture();
      seedWorkflow(persistence, 'wf1', {
        triggerType: 'TEST_MANUAL',
        triggerConfig: {
          inputSchema: {
            type: 'object',
            properties: {
              pan: { type: 'object', format: 'attachment', accept: ['image/*', 'application/pdf'] },
            },
          },
        },
      });

      // image/* matches
      await runtime.triggerManual(SYSTEM, 'wf1', { pan: { name: 'a.png', mimeType: 'image/png', handle: 'mem://1' } });
      // application/pdf matches
      await runtime.triggerManual(SYSTEM, 'wf1', { pan: { name: 'doc.pdf', mimeType: 'application/pdf', handle: 'mem://2' } });
      // text/csv rejected
      await expect(
        runtime.triggerManual(SYSTEM, 'wf1', { pan: { name: 'data.csv', mimeType: 'text/csv', handle: 'mem://3' } }),
      ).rejects.toThrow(/not an accepted type/);
    });

    it('rejects when an attachment exceeds the field maxSize', async () => {
      const { runtime, persistence } = createTestFixture();
      seedWorkflow(persistence, 'wf1', {
        triggerType: 'TEST_MANUAL',
        triggerConfig: {
          inputSchema: {
            type: 'object',
            properties: { pan: { type: 'object', format: 'attachment', maxSize: 100 } },
          },
        },
      });

      await expect(
        runtime.triggerManual(SYSTEM, 'wf1', { pan: { name: 'big.txt', mimeType: 'text/plain', handle: 'mem://x', size: 500 } }),
      ).rejects.toThrow(/exceeds the max size/);
    });
  });

  describe('resume', () => {
    it('re-enqueues a paused execution', async () => {
      const { runtime, persistence, enqueuedJobs } = createTestFixture();
      seedWorkflow(persistence, 'wf1', {
        triggerType: 'TEST_EVENT',
        steps: [
          { id: 's1', type: 'PAUSE_TEST', config: { reason: 'waiting' } },
        ],
      });

      // Create and process to get to EXTERNAL_WAIT state
      const execId = await persistence.createExecution({
        workflowId: 'wf1',
        status: 'EXTERNAL_WAIT',
        context: JSON.stringify({
          workflow: { id: 'wf1', metadata: {} },
          trigger: { type: 'TEST_EVENT' },
          steps: {},
        }),
      });
      await persistence.updateExecutionStatus(execId, 'EXTERNAL_WAIT');
      // A parked run always has the gate's own record — that is where an answer
      // goes now, so the fixture has to have one.
      await persistence.upsertStep(execId, 'gate', {
        status: 'EXTERNAL_WAIT',
        executorType: 'deterministic',
        data: '{}',
        attributes: {} as never,
      });
      enqueuedJobs.length = 0; // clear

      await runtime.resume(SYSTEM, execId, { data: { action: 'approve' } });

      expect(enqueuedJobs).toHaveLength(1);
      // Status stays EXTERNAL_WAIT — executor detects this as a resume
      const exec = await persistence.getExecution(execId);
      expect(exec?.status).toBe('EXTERNAL_WAIT');

      // The answer sits on the gate's own record, which is what the walk reads.
      const gate = await persistence.getStep(execId, 'gate');
      expect(JSON.parse(gate!.data!)).toEqual({ resumePayload: { action: 'approve' } });
    });

    it('aborts a paused execution', async () => {
      const { runtime, persistence, enqueuedJobs } = createTestFixture();
      seedWorkflow(persistence, 'wf1', { triggerType: 'TEST_EVENT' });

      const execId = await persistence.createExecution({
        workflowId: 'wf1',
        status: 'EXTERNAL_WAIT',
        context: '{}',
      });
      await persistence.updateExecutionStatus(execId, 'EXTERNAL_WAIT');
      enqueuedJobs.length = 0;

      await runtime.resume(SYSTEM, execId, { abort: true });

      expect(enqueuedJobs).toHaveLength(0);
      const exec = await persistence.getExecution(execId);
      expect(exec?.status).toBe('CANCELLED');
    });

    it("recognizes data.action: 'abort' as cancellation (unified payload)", async () => {
      const { runtime, persistence, enqueuedJobs } = createTestFixture();
      seedWorkflow(persistence, 'wf1', { triggerType: 'TEST_EVENT' });

      const execId = await persistence.createExecution({
        workflowId: 'wf1',
        status: 'EXTERNAL_WAIT',
        context: '{}',
      });
      await persistence.updateExecutionStatus(execId, 'EXTERNAL_WAIT');
      enqueuedJobs.length = 0;

      await runtime.resume(SYSTEM, execId, { data: { action: 'abort' } });

      expect(enqueuedJobs).toHaveLength(0);
      const exec = await persistence.getExecution(execId);
      expect(exec?.status).toBe('CANCELLED');
    });

    it('persists feedback + attachments through to the resume payload', async () => {
      const { runtime, persistence } = createTestFixture();
      seedWorkflow(persistence, 'wf1', { triggerType: 'TEST_EVENT' });

      const execId = await persistence.createExecution({
        workflowId: 'wf1',
        status: 'EXTERNAL_WAIT',
        context: '{}',
      });
      await persistence.updateExecutionStatus(execId, 'EXTERNAL_WAIT');
      await persistence.upsertStep(execId, 'gate', {
        status: 'EXTERNAL_WAIT',
        executorType: 'deterministic',
        data: '{}',
        attributes: {} as never,
      });

      await runtime.resume(SYSTEM, execId, {
        data: {
          action: 'retry',
          feedback: 'try harder',
          attachments: [{ name: 'note.txt', mimeType: 'text/plain', handle: 'aGk=' }],
        },
      });

      const gate = await persistence.getStep(execId, 'gate');
      expect(JSON.parse(gate!.data!)['resumePayload']).toEqual({
        action: 'retry',
        feedback: 'try harder',
        attachments: [{ name: 'note.txt', mimeType: 'text/plain', handle: 'aGk=' }],
      });
    });

    it('routes the payload to a specific gate by nodePath (multi-gate)', async () => {
      const { runtime, persistence } = createTestFixture();
      seedWorkflow(persistence, 'wf1', { triggerType: 'TEST_EVENT' });
      const execId = await persistence.createExecution({
        workflowId: 'wf1',
        status: 'EXTERNAL_WAIT',
        context: '{}',
      });
      await persistence.updateExecutionStatus(execId, 'EXTERNAL_WAIT');
      // Two open gates (a parallel with two paused branches).
      await persistence.upsertStep(execId, 'par:a#0/g1', {
        status: 'EXTERNAL_WAIT',
        executorType: 'deterministic',
        data: JSON.stringify({ output: {} }),
      });
      await persistence.upsertStep(execId, 'par:b#0/g2', {
        status: 'EXTERNAL_WAIT',
        executorType: 'deterministic',
        data: JSON.stringify({ output: {} }),
      });

      await runtime.resume(SYSTEM, execId, {
        nodePath: 'par:b#0/g2',
        data: { action: 'approve', feedback: 'ok' },
      });

      // Only the targeted gate received the payload.
      const g2 = JSON.parse((await persistence.getStep(execId, 'par:b#0/g2'))!.data!) as Record<string, unknown>;
      expect(g2['resumePayload']).toEqual({ action: 'approve', feedback: 'ok' });
      const g1 = JSON.parse((await persistence.getStep(execId, 'par:a#0/g1'))!.data!) as Record<string, unknown>;
      expect(g1['resumePayload']).toBeUndefined();
    });

    it('throws when multiple gates are open and no nodePath is given', async () => {
      const { runtime, persistence } = createTestFixture();
      seedWorkflow(persistence, 'wf1', { triggerType: 'TEST_EVENT' });
      const execId = await persistence.createExecution({
        workflowId: 'wf1',
        status: 'EXTERNAL_WAIT',
        context: '{}',
      });
      await persistence.updateExecutionStatus(execId, 'EXTERNAL_WAIT');
      await persistence.upsertStep(execId, 'par:a#0/g1', {
        status: 'EXTERNAL_WAIT',
        executorType: 'deterministic',
        data: '{}',
      });
      await persistence.upsertStep(execId, 'par:b#0/g2', {
        status: 'EXTERNAL_WAIT',
        executorType: 'deterministic',
        data: '{}',
      });

      await expect(
        runtime.resume(SYSTEM, execId, { data: { action: 'approve' } }),
      ).rejects.toThrow('multiple open gates');
    });

    it('throws for non-paused execution', async () => {
      const { runtime, persistence } = createTestFixture();
      seedWorkflow(persistence, 'wf1', { triggerType: 'TEST_EVENT' });

      const execId = await persistence.createExecution({
        workflowId: 'wf1',
        status: 'COMPLETED',
        context: '{}',
      });
      await persistence.updateExecutionStatus(execId, 'COMPLETED');

      await expect(
        runtime.resume(SYSTEM, execId),
      ).rejects.toThrow('is not paused');
    });
  });

  // ─── Continuing a run from outside ───

  describe('deliver', () => {
    const CONTRACT = {
      type: 'object',
      required: ['result'],
      properties: { result: { type: 'string' } },
    };

    /** A run parked on an API-call gate, with the contract on its record. */
    async function parked(
      persistence: InMemoryPersistenceAdapter,
      opts: { contract?: Record<string, unknown>; fence?: number } = {},
    ): Promise<string> {
      seedWorkflow(persistence, 'wf_api', {
        triggerType: 'TEST_EVENT',
        steps: [
          { id: 'start', type: 'ECHO', config: {} },
          { id: 'wait_for_build', type: 'WAIT_FOR_WEBHOOK', config: {} },
        ],
      });
      const execId = await persistence.createExecution({
        workflowId: 'wf_api',
        status: 'EXTERNAL_WAIT',
        context: '{}',
      });
      await persistence.updateExecutionStatus(execId, 'EXTERNAL_WAIT');
      await persistence.upsertStep(execId, 'wait_for_build', {
        status: 'EXTERNAL_WAIT',
        executorType: 'deterministic',
        data: JSON.stringify({
          ...(opts.contract ? { contract: opts.contract } : {}),
          ...(opts.fence !== undefined ? { fence: opts.fence } : {}),
        }),
        attributes: {} as never,
        category: GateCategory.WaitingOnApiCall,
      });
      return execId;
    }

    const gateData = async (persistence: InMemoryPersistenceAdapter, execId: string) =>
      JSON.parse((await persistence.getStep(execId, 'wait_for_build'))!.data!) as Record<string, unknown>;

    const REPORT_CONTRACT = {
      type: 'object',
      required: ['result', 'report'],
      properties: {
        result: { type: 'string' },
        report: ATTACHMENT_JSON_SCHEMA,
        screenshots: { type: 'array', items: ATTACHMENT_JSON_SCHEMA },
      },
    };

    /** A file as the host hands it over: already streamed into storage. */
    const part = async (
      storage: InMemoryStorageAdapter,
      fieldName: string,
      name: string,
    ): Promise<DeliveryFile> => ({
      fieldName,
      attachment: await storage.put({} as never, {
        name,
        mimeType: 'application/xml',
        stream: Readable.from(Buffer.from('<testsuite/>')),
      }),
    });

    it('merges a delivered file into the payload under its field name', async () => {
      const storage = new InMemoryStorageAdapter();
      const { runtime, persistence } = createTestFixture({ storage });
      const execId = await parked(persistence, { contract: REPORT_CONTRACT });

      const outcome = await runtime.deliver(
        { executionId: execId, stepId: 'wait_for_build' },
        { payload: { result: 'SUCCESS' }, files: [await part(storage, 'report', 'junit.xml')] },
      );

      expect(outcome).toEqual({ kind: 'applied', nodePath: 'wait_for_build' });
      const delivery = (await gateData(persistence, execId))['delivery'] as Record<string, unknown>;
      const payload = delivery['payload'] as Record<string, unknown>;
      expect(payload['result']).toBe('SUCCESS');
      // A real reference the step below can stream from.
      expect(payload['report']).toMatchObject({ name: 'junit.xml', mimeType: 'application/xml' });
      expect(storage.blobs.size).toBe(1);
    });

    it('refuses a file delivery that does not satisfy the contract', async () => {
      const { runtime, persistence } = createTestFixture({ storage: new InMemoryStorageAdapter() });
      const execId = await parked(persistence, { contract: REPORT_CONTRACT });

      // `report` is required and no file carried it.
      const outcome = await runtime.deliver(
        { executionId: execId, stepId: 'wait_for_build' },
        { payload: { result: 'SUCCESS' } },
      );

      expect(outcome.kind).toBe('invalid');
    });

    it('gives back the files of a delivery it declines', async () => {
      const storage = new InMemoryStorageAdapter();
      const { runtime, persistence } = createTestFixture({ storage });
      const execId = await parked(persistence, { contract: REPORT_CONTRACT });

      const first = await runtime.deliver(
        { executionId: execId, stepId: 'wait_for_build' },
        {
          payload: { result: 'SUCCESS' },
          files: [await part(storage, 'report', 'junit.xml')],
          deliveryId: 'b1',
        },
      );
      expect(first.kind).toBe('applied');
      expect(storage.blobs.size).toBe(1);

      // The sender retries. Its bytes were already written before anyone could
      // tell it was a repeat, so declining has to hand them back — otherwise a
      // recovery worker fills the bucket with copies of what we dropped.
      const retry = await runtime.deliver(
        { executionId: execId, stepId: 'wait_for_build' },
        {
          payload: { result: 'SUCCESS' },
          files: [await part(storage, 'report', 'junit.xml')],
          deliveryId: 'b1',
        },
      );

      expect(retry).toEqual({ kind: 'ignored', reason: 'duplicate' });
      expect(storage.blobs.size).toBe(1);
      // And it was given the run's tenant, not left to the adapter to guess —
      // a real adapter refuses an unscoped delete, so asserting only that the
      // blob count held would pass against a fake and leak against GCS.
      expect(storage.deleteScopes).toEqual([{ workspaceId: 'ws_1' }]);
    });

    it('gives back the files of a delivery for a run it cannot find', async () => {
      const storage = new InMemoryStorageAdapter();
      const { runtime } = createTestFixture({ storage });

      const outcome = await runtime.deliver(
        { executionId: 'no_such_run', stepId: 'wait_for_build' },
        { payload: {}, files: [await part(storage, 'report', 'junit.xml')] },
      );

      expect(outcome).toEqual({ kind: 'unknown' });
      expect(storage.blobs.size).toBe(0);
    });

    it('applies a body to the node that is waiting, and asks for a pass', async () => {
      const { runtime, persistence, enqueuedJobs } = createTestFixture();
      const execId = await parked(persistence, { contract: CONTRACT });
      enqueuedJobs.length = 0;

      const outcome = await runtime.deliver(
        { executionId: execId, stepId: 'wait_for_build' },
        { payload: { result: 'SUCCESS' } },
      );

      expect(outcome).toEqual({ kind: 'applied', nodePath: 'wait_for_build' });
      const delivery = (await gateData(persistence, execId))['delivery'] as Record<string, unknown>;
      expect(delivery['payload']).toEqual({ result: 'SUCCESS' });
      expect(delivery['receivedAt']).toMatch(/^\d{4}-/);
      // No delay: the pass is wanted now, which supersedes any pending clock.
      expect(enqueuedJobs).toEqual([{ executionId: execId, singletonKey: execId }]);
    });

    it('refuses a body that does not satisfy the declared contract', async () => {
      const { runtime, persistence, enqueuedJobs } = createTestFixture();
      const execId = await parked(persistence, { contract: CONTRACT });
      enqueuedJobs.length = 0;

      const outcome = await runtime.deliver(
        { executionId: execId, stepId: 'wait_for_build' },
        { payload: { buildNumber: 11 } },
      );

      // The sender learns what it sent wrong, rather than the run carrying on
      // with a field that is not there.
      expect(outcome.kind).toBe('invalid');
      expect(outcome.kind === 'invalid' && outcome.issues[0]!.path).toBe('result');
      expect(await gateData(persistence, execId)).not.toHaveProperty('delivery');
      expect(enqueuedJobs).toEqual([]);
    });

    it('accepts anything when the author declared nothing', async () => {
      const { runtime, persistence } = createTestFixture();
      const execId = await parked(persistence);
      const outcome = await runtime.deliver(
        { executionId: execId, stepId: 'wait_for_build' },
        { payload: 'just text' },
      );
      expect(outcome.kind).toBe('applied');
    });

    it('treats the same delivery twice as a duplicate, not an error', async () => {
      const { runtime, persistence } = createTestFixture();
      const execId = await parked(persistence);
      const once = { payload: { result: 'SUCCESS' }, deliveryId: 'd1' };

      expect((await runtime.deliver({ executionId: execId, stepId: 'wait_for_build' }, once)).kind).toBe('applied');
      // What makes `curl --retry` safe.
      expect(await runtime.deliver({ executionId: execId, stepId: 'wait_for_build' }, once)).toEqual({
        kind: 'ignored',
        reason: 'duplicate',
      });
    });

    it('keeps the first answer when a different one follows', async () => {
      const { runtime, persistence } = createTestFixture();
      const execId = await parked(persistence);
      await runtime.deliver({ executionId: execId, stepId: 'wait_for_build' }, { payload: { result: 'SUCCESS' }, deliveryId: 'd1' });

      const outcome = await runtime.deliver(
        { executionId: execId, stepId: 'wait_for_build' },
        { payload: { result: 'FAILURE' }, deliveryId: 'd2' },
      );

      expect(outcome).toEqual({ kind: 'ignored', reason: 'already_answered' });
      const delivery = (await gateData(persistence, execId))['delivery'] as Record<string, unknown>;
      expect(delivery['payload']).toEqual({ result: 'SUCCESS' });
    });

    it('drops an answer to the attempt before', async () => {
      const { runtime, persistence } = createTestFixture();
      const execId = await parked(persistence, { fence: 2 });

      expect(
        await runtime.deliver({ executionId: execId, stepId: 'wait_for_build', fence: 1 }, { payload: {} }),
      ).toEqual({ kind: 'ignored', reason: 'superseded' });
      expect(
        (await runtime.deliver({ executionId: execId, stepId: 'wait_for_build', fence: 2 }, { payload: {} })).kind,
      ).toBe('applied');
    });

    it('tells a caller that is early from one that is wrong', async () => {
      const { runtime, persistence } = createTestFixture();
      const execId = await parked(persistence);
      // A step the config has but no record of yet — the run may still reach it,
      // so the sender should try again.
      expect((await runtime.deliver({ executionId: execId, stepId: 'start' }, { payload: {} })).kind).toBe('not_ready');
      // A step the config does not have at all — trying again will never help.
      expect((await runtime.deliver({ executionId: execId, stepId: 'nope' }, { payload: {} })).kind).toBe('unknown');
    });

    it('drops an answer to a run that has ended', async () => {
      const { runtime, persistence } = createTestFixture();
      const execId = await parked(persistence);
      await persistence.updateExecutionStatus(execId, 'CANCELLED');

      expect(await runtime.deliver({ executionId: execId, stepId: 'wait_for_build' }, { payload: {} })).toEqual({
        kind: 'ignored',
        reason: 'run_ended',
      });
    });

    it('answers unknown for an execution nobody has heard of', async () => {
      const { runtime } = createTestFixture();
      expect(await runtime.deliver({ executionId: 'nope', stepId: 'x' }, { payload: {} })).toEqual({
        kind: 'unknown',
      });
    });
  });

  describe('which lane a pass belongs to', () => {
    it('carries the workflow’s kind on every enqueue, and nothing when it has none', async () => {
      const { runtime, persistence, enqueuedJobs } = createTestFixture();
      seedWorkflow(persistence, 'plain', { triggerType: 'TEST_MANUAL' });
      seedWorkflow(persistence, 'chat', {
        triggerType: 'TEST_MANUAL',
        metadata: { kind: 'conversational_flow' },
      });

      await runtime.triggerManual(SYSTEM, 'plain', {});
      await runtime.triggerManual(SYSTEM, 'chat', {});

      // A host that puts user-facing passes on their own queue reads this; one
      // that ignores it sees the same two jobs it always did.
      expect(enqueuedJobs.map((job) => job.kind)).toEqual([undefined, 'conversational_flow']);
    });

    it('keeps a resumed pass in the same lane the run started in', async () => {
      const { runtime, persistence, enqueuedJobs } = createTestFixture();
      seedWorkflow(persistence, 'chat', {
        triggerType: 'TEST_EVENT',
        steps: [{ id: 'gate', type: 'PAUSE_TEST', config: { reason: 'waiting' } }],
        metadata: { kind: 'conversational_flow' },
      });
      const execId = await persistence.createExecution({
        workflowId: 'chat',
        status: 'EXTERNAL_WAIT',
        context: JSON.stringify({ workflow: { id: 'chat', metadata: {} }, trigger: {}, steps: {} }),
      });
      await persistence.upsertStep(execId, 'gate', {
        status: 'EXTERNAL_WAIT',
        executorType: 'deterministic',
        data: '{}',
        attributes: {} as never,
      });
      enqueuedJobs.length = 0;
      await runtime.resume(SYSTEM, execId, { data: { answer: 'yes' }, nodePath: 'gate' });

      // Lanes are usually separate keyspaces, so a run that changed lanes
      // part-way could be walked twice at once.
      expect(enqueuedJobs.map((job) => job.kind)).toEqual(['conversational_flow']);
    });
  });

  describe('rerunFromStep', () => {
    it('creates a new execution, enqueues it, and links sourceExecutionId', async () => {
      const { runtime, persistence, enqueuedJobs, executor } = createTestFixture();
      seedWorkflow(persistence, 'wf1', {
        triggerType: 'TEST_EVENT',
        steps: [
          { id: 's1', type: 'ECHO', config: { message: 'a' } },
          { id: 's2', type: 'ECHO', config: { message: 'b' } },
        ],
      });
      const sourceId = await persistence.createExecution({
        workflowId: 'wf1',
        status: 'PENDING',
        context: JSON.stringify({
          workflow: { id: 'wf1', metadata: {} },
          trigger: { type: 'TEST_EVENT' },
          steps: {},
        }),
      });
      await executor.runExecution(sourceId);
      enqueuedJobs.length = 0;

      const newId = await runtime.rerunFromStep(SYSTEM, sourceId, 's2');

      expect(newId).not.toBe(sourceId);
      expect(enqueuedJobs).toEqual([{ executionId: newId }]);

      const newExec = await persistence.getExecution(newId);
      expect(newExec?.sourceExecutionId).toBe(sourceId);
      expect(newExec?.status).toBe('PENDING');
    });

    it('rejects rerun from a non-terminal execution', async () => {
      const { runtime, persistence, executor } = createTestFixture();
      seedWorkflow(persistence, 'wf1', {
        triggerType: 'TEST_EVENT',
        steps: [{ id: 's1', type: 'PAUSE_TEST', config: { reason: 'hold' } }],
      });
      const execId = await persistence.createExecution({
        workflowId: 'wf1',
        status: 'PENDING',
        context: JSON.stringify({
          workflow: { id: 'wf1', metadata: {} },
          trigger: { type: 'TEST_EVENT' },
          steps: {},
        }),
      });
      await executor.runExecution(execId);

      await expect(runtime.rerunFromStep(SYSTEM, execId, 's1')).rejects.toThrow(/non-terminal/);
    });

    it('forwards configOverrides + inheritStepState to executor', async () => {
      const { runtime, persistence, executor } = createTestFixture();
      seedWorkflow(persistence, 'wf1', {
        triggerType: 'TEST_EVENT',
        steps: [{ id: 's1', type: 'ECHO', config: { message: 'one' } }],
      });
      const sourceId = await persistence.createExecution({
        workflowId: 'wf1',
        status: 'PENDING',
        context: JSON.stringify({
          workflow: { id: 'wf1', metadata: {} },
          trigger: { type: 'TEST_EVENT' },
          steps: {},
        }),
      });
      await executor.runExecution(sourceId);

      const newId = await runtime.rerunFromStep(SYSTEM, sourceId, 's1', {
        configOverrides: { message: 'two' },
        inheritStepState: true,
      });

      const newState = await persistence.getExecutionState(newId);
      const newCtx = JSON.parse(newState!.context!);
      expect(newCtx.__meta.__configOverrides).toEqual({ message: 'two' });
      expect(newCtx.__meta.rerunSource.fromStepId).toBe('s1');
      expect(newCtx.__meta.__priorStepState).toBeDefined();
    });
  });

  describe('processJob', () => {
    it('runs a fresh execution to completion', async () => {
      const { runtime, persistence } = createTestFixture();
      seedWorkflow(persistence, 'wf1', {
        triggerType: 'TEST_EVENT',
        steps: [{ id: 's1', type: 'ECHO', config: { message: 'hi' } }],
      });

      const execId = await persistence.createExecution({
        workflowId: 'wf1',
        status: 'PENDING',
        context: JSON.stringify({
          workflow: { id: 'wf1', metadata: {} },
          trigger: { type: 'TEST_EVENT' },
          steps: {},
        }),
      });

      const result = await runtime.processJob(execId);

      expect(result.status).toBe('completed');
      const exec = await persistence.getExecution(execId);
      expect(exec?.status).toBe('COMPLETED');
    });

    it('returns not_found for unknown execution', async () => {
      const { runtime } = createTestFixture();

      const result = await runtime.processJob('nonexistent');
      expect(result.status).toBe('not_found');
    });

    it('skips already-completed executions', async () => {
      const { runtime, persistence } = createTestFixture();
      seedWorkflow(persistence, 'wf1', { triggerType: 'TEST_EVENT' });

      const execId = await persistence.createExecution({
        workflowId: 'wf1',
        status: 'COMPLETED',
        context: '{}',
      });
      await persistence.updateExecutionStatus(execId, 'COMPLETED');

      const result = await runtime.processJob(execId);
      expect(result.status).toBe('skipped');
    });

    it('handles execution that pauses', async () => {
      const { runtime, persistence } = createTestFixture();
      seedWorkflow(persistence, 'wf1', {
        triggerType: 'TEST_EVENT',
        steps: [
          { id: 's1', type: 'PAUSE_TEST', config: { reason: 'need approval' } },
        ],
      });

      const execId = await persistence.createExecution({
        workflowId: 'wf1',
        status: 'PENDING',
        context: JSON.stringify({
          workflow: { id: 'wf1', metadata: {} },
          trigger: { type: 'TEST_EVENT' },
          steps: {},
        }),
      });

      const result = await runtime.processJob(execId);

      expect(result.status).toBe('paused');
      const exec = await persistence.getExecution(execId);
      expect(exec?.status).toBe('EXTERNAL_WAIT');
    });

    it('handles execution that fails', async () => {
      // Register a failing step
      const FailConfig = z.object({ msg: z.string() });
      class FailStep extends BaseActionStep<typeof FailConfig> {
        readonly type = 'FAIL_STEP';
        readonly configSchema = FailConfig;
        readonly name = 'Fail';
        readonly description = 'Fails';
        readonly outputSchema = z.object({});
        readonly category = 'testing';
        async execute(): Promise<Record<string, unknown>> {
          throw new Error('boom');
        }
      }
      const { runtime, persistence } = createTestFixture({ steps: [new FailStep()] });

      seedWorkflow(persistence, 'wf1', {
        triggerType: 'TEST_EVENT',
        steps: [{ id: 's1', type: 'FAIL_STEP', config: { msg: 'x' } }],
      });

      const execId = await persistence.createExecution({
        workflowId: 'wf1',
        status: 'PENDING',
        context: JSON.stringify({
          workflow: { id: 'wf1', metadata: {} },
          trigger: { type: 'TEST_EVENT' },
          steps: {},
        }),
      });

      const result = await runtime.processJob(execId);

      expect(result.status).toBe('failed');
      expect((result as { error: string }).error).toBe('boom');
    });

  });

  describe('activateWorkflow', () => {
    it('activates a webhook trigger whose secret resolves, and marks the workflow ACTIVE', async () => {
      const { runtime, persistence } = createTestFixture();
      seedWebhookWorkflow(persistence, { status: 'DISABLED' });

      await runtime.activateWorkflow(SYSTEM, 'wf1');

      expect(persistence.workflows.get('wf1')!.status).toBe('ACTIVE');
      const result = await runtime.handleWebhook('wf1', webhookRequest({}));
      expect(result.reply.status).toBe(202);
    });

    it('refuses to activate a webhook trigger whose secret is missing, naming it', async () => {
      const { runtime, persistence } = createTestFixture();
      seedWebhookWorkflow(persistence, { status: 'DISABLED', withSecret: false });

      await expect(runtime.activateWorkflow(SYSTEM, 'wf1')).rejects.toThrow(
        'Required credential "hook-secret" not found',
      );
      expect(persistence.workflows.get('wf1')!.status).toBe('DISABLED');
    });

    it('registers cron trigger with scheduler using the runtime default timezone', async () => {
      const { runtime, persistence, scheduledJobs } = createTestFixture();
      seedWorkflow(persistence, 'wf1', {
        triggerType: 'TEST_CRON',
        triggerConfig: { expression: '0 * * * *' },
      });

      await runtime.activateWorkflow(SYSTEM, 'wf1');

      expect(scheduledJobs.has('wf1')).toBe(true);
      expect(scheduledJobs.get('wf1')!.expression).toBe('0 * * * *');
      // Default cron timezone is Asia/Kolkata — no per-workflow timezone any more.
      expect(scheduledJobs.get('wf1')!.timezone).toBe('Asia/Kolkata');
    });

    it('uses RuntimeConfig.defaultCronTimezone when host overrides it', async () => {
      const { runtime: _ignored, persistence, scheduledJobs, services, queue, scheduler, connectors, executor } =
        createTestFixture();
      const runtime = new WorkflowRuntime({
        persistence,
        // Explicit: these are not ACL tests, so enforcement is deliberately off.
        authorizer: new AllowAllAuthorizer(),
        queue,
        scheduler,
        services,
        connectors,
        executor,
        config: {
          baseUrl: 'https://api.example.com',
          defaultCronTimezone: 'UTC',
          approval: { default: ApprovalRequirement.NOT_REQUIRED },
        },
      });
      seedWorkflow(persistence, 'wf1', {
        triggerType: 'TEST_CRON',
        triggerConfig: { expression: '0 * * * *' },
      });

      await runtime.activateWorkflow(SYSTEM, 'wf1');

      expect(scheduledJobs.get('wf1')!.timezone).toBe('UTC');
    });

    it('does nothing extra for event triggers', async () => {
      const { runtime, persistence, scheduledJobs } = createTestFixture();
      seedWorkflow(persistence, 'wf1', { triggerType: 'TEST_EVENT' });

      await runtime.activateWorkflow(SYSTEM, 'wf1');

      expect(scheduledJobs.size).toBe(0);
      expect(persistence.workflows.get('wf1')!.status).toBe('ACTIVE');
    });

    it('throws for unknown workflow', async () => {
      const { runtime } = createTestFixture();

      await expect(
        runtime.activateWorkflow(SYSTEM, 'nonexistent'),
      ).rejects.toThrow('not found');
    });
  });

  describe('deactivateWorkflow', () => {
    it('marks the workflow DISABLED, which stops its webhook', async () => {
      const { runtime, persistence } = createTestFixture();
      seedWebhookWorkflow(persistence);

      await runtime.deactivateWorkflow(SYSTEM, 'wf1');

      expect(persistence.workflows.get('wf1')!.status).toBe('DISABLED');
      const result = await runtime.handleWebhook('wf1', webhookRequest({}));
      expect(result.reply.status).toBe(404);
    });

    it('unschedules cron trigger', async () => {
      const { runtime, persistence, scheduledJobs } = createTestFixture();
      seedWorkflow(persistence, 'wf1', {
        triggerType: 'TEST_CRON',
        triggerConfig: { expression: '0 * * * *' },
      });
      await runtime.activateWorkflow(SYSTEM, 'wf1');
      expect(scheduledJobs.size).toBe(1);

      await runtime.deactivateWorkflow(SYSTEM, 'wf1');

      expect(scheduledJobs.size).toBe(0);
    });
  });

  describe('processCronTick', () => {
    it('fires a cron workflow', async () => {
      const { runtime, persistence, enqueuedJobs } = createTestFixture();
      seedWorkflow(persistence, 'wf1', {
        triggerType: 'TEST_CRON',
        triggerConfig: { expression: '0 * * * *' },
      });

      const execId = await runtime.processCronTick('wf1');

      expect(execId).toBeTruthy();
      expect(enqueuedJobs).toHaveLength(1);
    });

    it('returns null for inactive workflow', async () => {
      const { runtime, persistence } = createTestFixture();
      seedWorkflow(persistence, 'wf1', {
        triggerType: 'TEST_CRON',
        triggerConfig: { expression: '0 * * * *' },
        status: 'DISABLED',
      });

      const result = await runtime.processCronTick('wf1');
      expect(result).toBeNull();
    });

    it('uses poll() when available', async () => {

      // Register a cron trigger with poll
      class PollingCronTrigger extends CronTrigger<typeof CronConfig> {
        readonly type = 'POLLING_CRON';
        readonly configSchema = CronConfig;
        readonly name = 'Polling Cron';
        readonly description = 'Cron with poll';
        readonly outputSchema = z.object({});
        readonly category = TriggerCategory.SCHEDULED;

        getSchedule(config: z.infer<typeof CronConfig>): CronSchedule {
          return { expression: config.expression };
        }

        override async poll(): Promise<Record<string, unknown> | null> {
          return { newItems: 5 };
        }
      }
      const { runtime, persistence, enqueuedJobs } = createTestFixture({
        triggers: [new PollingCronTrigger()],
      });

      seedWorkflow(persistence, 'wf1', {
        triggerType: 'POLLING_CRON',
        triggerConfig: { expression: '*/5 * * * *' },
      });

      const execId = await runtime.processCronTick('wf1');
      expect(execId).toBeTruthy();
      expect(enqueuedJobs).toHaveLength(1);

      // Check the trigger data includes poll result
      const state = await persistence.getExecutionState(execId!);
      const ctx = JSON.parse(state!.context!);
      expect(ctx.trigger.newItems).toBe(5);
    });

    it('skips when poll() returns null', async () => {

      class EmptyPollingCron extends CronTrigger<typeof CronConfig> {
        readonly type = 'EMPTY_POLL_CRON';
        readonly configSchema = CronConfig;
        readonly name = 'Empty Poll Cron';
        readonly description = 'Cron with empty poll';
        readonly outputSchema = z.object({});
        readonly category = TriggerCategory.SCHEDULED;

        getSchedule(config: z.infer<typeof CronConfig>): CronSchedule {
          return { expression: config.expression };
        }

        override async poll(): Promise<Record<string, unknown> | null> {
          return null;
        }
      }
      const { runtime, persistence, enqueuedJobs } = createTestFixture({
        triggers: [new EmptyPollingCron()],
      });

      seedWorkflow(persistence, 'wf1', {
        triggerType: 'EMPTY_POLL_CRON',
        triggerConfig: { expression: '*/5 * * * *' },
      });

      const result = await runtime.processCronTick('wf1');
      expect(result).toBeNull();
      expect(enqueuedJobs).toHaveLength(0);
    });
  });

  describe('validateConfig', () => {
    it('returns valid for a correct config', async () => {
      const { runtime } = createTestFixture();
      const result = await runtime.validateConfig(SYSTEM, {
        trigger: { type: 'TEST_EVENT', config: {} },
        steps: [{ id: 's1', type: 'ECHO', config: { message: 'hi' } }],
      });
      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('returns issues for unknown trigger type', async () => {
      const { runtime } = createTestFixture();
      const result = await runtime.validateConfig(SYSTEM, {
        trigger: { type: 'NONEXISTENT', config: {} },
        steps: [],
      });
      expect(result.valid).toBe(false);
      expect(result.issues[0]!.message).toContain('Unknown trigger type');
    });

    it('returns issues for unknown step type', async () => {
      const { runtime } = createTestFixture();
      const result = await runtime.validateConfig(SYSTEM, {
        trigger: { type: 'TEST_EVENT', config: {} },
        steps: [{ id: 's1', type: 'NONEXISTENT', config: {} }],
      });
      expect(result.valid).toBe(false);
      expect(result.issues[0]!.message).toContain('Unknown step type');
    });

    it('returns issues for invalid step config', async () => {
      const { runtime } = createTestFixture();
      const result = await runtime.validateConfig(SYSTEM, {
        trigger: { type: 'TEST_EVENT', config: {} },
        steps: [{ id: 's1', type: 'ECHO', config: {} }], // missing message
      });
      expect(result.valid).toBe(false);
      expect(result.issues.length).toBeGreaterThan(0);
    });
  });

  describe('createWorkflow', () => {
    it('creates a draft when the trigger config is incomplete (does not throw) and leaves it unscheduled', async () => {
      const { runtime, persistence, scheduledJobs } = createTestFixture();
      const folder = await runtime.createFolder(SYSTEM, { name: 'Drafts' });

      // CRON requires an `expression`; the create dialog sends an empty config.
      const record = await runtime.createWorkflow(SYSTEM, {
        name: 'Scheduled draft',
        config: { trigger: { type: 'CRON', config: {} }, steps: [] },
        folderId: folder.id,
      });

      expect(record).toBeDefined();
      const stored = await persistence.getWorkflow(record.id);
      expect(stored).not.toBeNull();
      // Draft is not activated — an incomplete cron must never be scheduled.
      expect(scheduledJobs.has(record.id)).toBe(false);
    });

    it('auto-activates (schedules) a complete cron config', async () => {
      const { runtime, scheduledJobs } = createTestFixture();
      const folder = await runtime.createFolder(SYSTEM, { name: 'Live' });

      const record = await runtime.createWorkflow(SYSTEM, {
        name: 'Hourly',
        config: { trigger: { type: 'CRON', config: { expression: '0 * * * *' } }, steps: [] },
        folderId: folder.id,
      });

      expect(scheduledJobs.get(record.id)?.expression).toBe('0 * * * *');
    });
  });

  describe('end-to-end: dispatch → process', () => {
    it('dispatches event and processes to completion', async () => {
      const { runtime, persistence, enqueuedJobs } = createTestFixture();
      seedWorkflow(persistence, 'wf1', {
        triggerType: 'TEST_EVENT',
        steps: [{ id: 's1', type: 'ECHO', config: { message: 'e2e' } }],
      });

      // Dispatch
      const ids = await runtime.dispatchEvent({
        type: 'TEST_EVENT',
        payload: { data: 'test' },
        metadata: {},
      });
      expect(ids).toHaveLength(1);

      // Process
      const result = await runtime.processJob(ids[0]!);
      expect(result.status).toBe('completed');

      // Verify step output
      const state = await persistence.getExecutionState(ids[0]!);
      const ctx = JSON.parse(state!.context!);
      expect(ctx.steps.s1.output.echoed).toBe('e2e');
    });

    it('dispatches, pauses, resumes, and completes', async () => {
      const { runtime, persistence, enqueuedJobs } = createTestFixture();
      seedWorkflow(persistence, 'wf1', {
        triggerType: 'TEST_EVENT',
        steps: [
          {
            id: 's1',
            type: 'PAUSE_TEST',
            config: { reason: 'need approval' },
          },
        ],
      });

      // Dispatch
      const [execId] = await runtime.dispatchEvent({
        type: 'TEST_EVENT',
        payload: {},
        metadata: {},
      });

      // Process — should pause
      const r1 = await runtime.processJob(execId!);
      expect(r1.status).toBe('paused');

      // Resume
      enqueuedJobs.length = 0;
      await runtime.resume(SYSTEM, execId!, { data: { action: 'approve' } });
      expect(enqueuedJobs).toHaveLength(1);

      // Process again — should complete
      const r2 = await runtime.processJob(execId!);
      expect(r2.status).toBe('completed');
    });
  });
});

describe('validateConfig — checking a config against the world it names', () => {
  const seedChecked = (
    persistence: InMemoryPersistenceAdapter,
    channelId: string,
    status = 'DISABLED',
  ) =>
    seedWorkflow(persistence, 'wf1', {
      triggerType: 'TEST_EVENT',
      status,
      steps: [{ id: 's1', type: 'CHECKED', config: { channelId } }],
    });

  it('activates when every component is happy', async () => {
    const step = new CheckedStep('pass');
    const f = createTestFixture({ steps: [step] });
    seedChecked(f.persistence, 'ch_1');

    await f.runtime.activateWorkflow(SYSTEM, 'wf1');

    expect(f.persistence.workflows.get('wf1')!.status).toBe('ACTIVE');
    expect(step.seen?.known.channelId).toBe('ch_1');
  });

  it('refuses activation when a component says no, and says why', async () => {
    const f = createTestFixture({ steps: [new CheckedStep('fail')] });
    seedChecked(f.persistence, 'ch_secret');

    await expect(f.runtime.activateWorkflow(SYSTEM, 'wf1')).rejects.toThrow(
      /not a member of ch_secret/,
    );
    // Refusing to activate must not half-activate.
    expect(f.persistence.workflows.get('wf1')!.status).toBe('DISABLED');
  });

  it('refuses activation when the check could not be made at all', async () => {
    const f = createTestFixture({ steps: [new CheckedStep('throw')] });
    seedChecked(f.persistence, 'ch_1');

    // Fails closed — and reads as "unknown", not "wrong", so the author retries
    // rather than hunting for a mistake that may not exist.
    await expect(f.runtime.activateWorkflow(SYSTEM, 'wf1')).rejects.toThrow(/try again/);
  });

  it('says nothing about a field holding a reference', async () => {
    const step = new CheckedStep('fail');
    const f = createTestFixture({ steps: [step] });
    seedChecked(f.persistence, '{{trigger.channelId}}');

    // `fail` would object to any literal — but a reference is a promise about
    // run time, so there is nothing to object to yet.
    await expect(f.runtime.activateWorkflow(SYSTEM, 'wf1')).resolves.toMatchObject({
      status: WorkflowStatus.ACTIVE,
    });
    expect(step.seen?.known.channelId).toBeUndefined();
    expect(step.seen?.config.channelId).toBe('{{trigger.channelId}}');
  });

  it('leaves saving alone — a draft is allowed to be wrong', async () => {
    const f = createTestFixture({ steps: [new CheckedStep('fail')] });
    seedChecked(f.persistence, 'ch_secret', 'ACTIVE');

    // updateWorkflow does not validate; the objection surfaces at activation.
    await expect(
      f.runtime.updateWorkflow(SYSTEM, 'wf1', {
        config: {
          trigger: { type: 'TEST_EVENT', config: {} },
          steps: [{ id: 's1', type: 'CHECKED', config: { channelId: 'ch_other' } }],
        } as never,
      }),
    ).resolves.toBeDefined();
  });

  it('costs nothing for a component that does not implement it', async () => {
    const f = createTestFixture();
    seedWorkflow(f.persistence, 'wf1', {
      triggerType: 'TEST_EVENT',
      status: 'DISABLED',
      steps: [{ id: 's1', type: 'ECHO', config: { message: 'hi' } }],
    });

    await expect(f.runtime.activateWorkflow(SYSTEM, 'wf1')).resolves.toMatchObject({
      status: WorkflowStatus.ACTIVE,
    });
  });

  it('answers on shape alone when no workflow is named', async () => {
    const step = new CheckedStep('fail');
    const f = createTestFixture({ steps: [step] });
    seedChecked(f.persistence, 'ch_secret');

    const result = await f.runtime.validateConfig(SYSTEM, {
      trigger: { type: 'TEST_EVENT', config: {} },
      steps: [{ id: 's1', type: 'CHECKED', config: { channelId: 'ch_secret' } }],
    } as never);

    // Whose channels? A config alone does not say, so the question is not asked.
    expect(result.valid).toBe(true);
    expect(step.seen).toBeNull();
  });

  it('asks the components once a workflow is named, and paths the answer', async () => {
    const step = new CheckedStep('fail');
    const f = createTestFixture({ steps: [step] });
    seedChecked(f.persistence, 'ch_secret');

    const result = await f.runtime.validateConfig(
      SYSTEM,
      {
        trigger: { type: 'TEST_EVENT', config: {} },
        steps: [{ id: 's1', type: 'CHECKED', config: { channelId: 'ch_secret' } }],
      } as never,
      'wf1',
    );

    expect(result.valid).toBe(false);
    const issue = result.issues.find((i) => i.code === ValidationIssueCode.MISCONFIGURED);
    expect(issue?.message).toMatch(/not a member of ch_secret/);
    // Lands on the field, exactly as a shape issue would.
    expect(issue?.path).toBe('steps[0].config.channelId');
    expect(issue?.location).toEqual({ scope: 'step', stepId: 's1', field: 'channelId' });
  });

  it('does not ask the world about a config that does not parse', async () => {
    const step = new CheckedStep('fail');
    const f = createTestFixture({ steps: [step] });
    seedChecked(f.persistence, 'ch_secret');

    const result = await f.runtime.validateConfig(
      SYSTEM,
      { trigger: { type: 'NONEXISTENT', config: {} }, steps: [] } as never,
      'wf1',
    );

    expect(result.valid).toBe(false);
    // The hook promises a config that already passed — so it is never called.
    expect(step.seen).toBeNull();
  });

  it('hands the component its caller and the record’s tenant', async () => {
    const step = new CheckedStep('pass');
    const f = createTestFixture({ steps: [step] });
    // Seeded directly: `attributes` is host-defined and optional on the record,
    // so the shared helper leaves it unset — and this is the one test that cares
    // that whatever the record carries reaches the component unchanged.
    f.persistence.seedWorkflow({
      id: 'wf1',
      status: 'DISABLED',
      eventType: 'TEST_EVENT',
      config: JSON.stringify({
        trigger: { type: 'TEST_EVENT', config: {} },
        steps: [{ id: 's1', type: 'CHECKED', config: { channelId: 'ch_1' } }],
      }),
      metadata: '{}',
      attributes: { team: 'sales' } as never,
    });

    await f.runtime.activateWorkflow(SYSTEM, 'wf1');

    // The caller is the whole reason a host component can check ACL at all.
    expect(step.seen?.caller).toBe(SYSTEM);
    expect(step.seen?.attributes).toEqual({ team: 'sales' });
  });
});


// ─── Approval ───

describe('WorkflowRuntime — approval policy', () => {
  /** Everything AllowAll grants, minus the checker's action. */
  const maker: WorkflowAuthorizer<typeof SYSTEM, IdScope> = {
    async permissions() {
      return ALL_ACTIONS.filter((a) => a !== 'workflow:approve');
    },
    async visibleFilter() {
      return { kind: 'all' };
    },
  };

  /** ECHO needs a reviewer; nothing else does. */
  const gateEcho: ApprovalConfig = {
    default: ApprovalRequirement.NOT_REQUIRED,
    steps: { ECHO: ApprovalRequirement.REQUIRED },
  };

  const echoStep = { id: 's1', type: 'ECHO', config: { message: 'hi' } };
  const exemptStep = { id: 's1', type: 'PAUSE_TEST', config: { reason: 'why' } };

  function statusOf(f: ReturnType<typeof createTestFixture>, id = 'wf1') {
    return f.persistence.getWorkflow(id).then((w) => w?.status);
  }

  describe('activate', () => {
    it('leaves activation exactly as it was when no policy is configured', async () => {
      const f = createTestFixture({ authorizer: maker });
      seedWorkflow(f.persistence, 'wf1', {
        triggerType: 'TEST_EVENT',
        steps: [echoStep],
        status: WorkflowStatus.DRAFT,
      });

      await f.runtime.activateWorkflow(SYSTEM, 'wf1');

      expect(await statusOf(f)).toBe(WorkflowStatus.ACTIVE);
    });

    it('sends a gated configuration to a reviewer instead of live', async () => {
      const f = createTestFixture({ authorizer: maker, approval: gateEcho });
      seedWorkflow(f.persistence, 'wf1', {
        triggerType: 'TEST_EVENT',
        steps: [echoStep],
        status: WorkflowStatus.DRAFT,
      });

      await f.runtime.activateWorkflow(SYSTEM, 'wf1');

      expect(await statusOf(f)).toBe(WorkflowStatus.PENDING_APPROVAL);
    });

    it('holds no cron registration while a workflow waits for review', async () => {
      const f = createTestFixture({ authorizer: maker, approval: gateEcho });
      seedWorkflow(f.persistence, 'wf1', {
        triggerType: 'TEST_CRON',
        triggerConfig: { expression: '0 * * * *' },
        steps: [echoStep],
        status: WorkflowStatus.DRAFT,
      });

      await f.runtime.activateWorkflow(SYSTEM, 'wf1');

      // A schedule registered now would fire a workflow nobody has approved.
      expect(f.scheduledJobs.size).toBe(0);
    });

    it('lets a caller who may approve activate in one act', async () => {
      // AllowAll grants `workflow:approve`, so activating IS the approval —
      // an admin should not have to queue a review of their own work.
      const f = createTestFixture({ approval: gateEcho });
      seedWorkflow(f.persistence, 'wf1', {
        triggerType: 'TEST_EVENT',
        steps: [echoStep],
        status: WorkflowStatus.DRAFT,
      });

      await f.runtime.activateWorkflow(SYSTEM, 'wf1');

      expect(await statusOf(f)).toBe(WorkflowStatus.ACTIVE);
    });

    it('does not gate a configuration whose components are all exempt', async () => {
      const f = createTestFixture({ authorizer: maker, approval: gateEcho });
      seedWorkflow(f.persistence, 'wf1', {
        triggerType: 'TEST_EVENT',
        steps: [exemptStep],
        status: WorkflowStatus.DRAFT,
      });

      await f.runtime.activateWorkflow(SYSTEM, 'wf1');

      expect(await statusOf(f)).toBe(WorkflowStatus.ACTIVE);
    });

    it('gates a component buried in a control-flow branch', async () => {
      const f = createTestFixture({ authorizer: maker, approval: gateEcho });
      seedWorkflow(f.persistence, 'wf1', {
        triggerType: 'TEST_EVENT',
        status: WorkflowStatus.DRAFT,
        steps: [
          {
            id: 'c1',
            type: 'CONDITIONAL',
            config: { condition: {}, if_true: [echoStep], if_false: [] },
          },
        ],
      });

      await f.runtime.activateWorkflow(SYSTEM, 'wf1');

      // Nesting is not a hiding place: the walk is the same one validation does.
      expect(await statusOf(f)).toBe(WorkflowStatus.PENDING_APPROVAL);
    });

    it('keeps step and trigger policies in separate namespaces', async () => {
      // A trigger rule named ECHO must not reach the ECHO *step*, and a step
      // rule named TEST_EVENT must not reach the TEST_EVENT *trigger*. One
      // flat map would let either govern the other.
      const triggerRule = createTestFixture({
        authorizer: maker,
        approval: {
          default: ApprovalRequirement.NOT_REQUIRED,
          triggers: { ECHO: ApprovalRequirement.REQUIRED },
        },
      });
      seedWorkflow(triggerRule.persistence, 'wf1', {
        triggerType: 'TEST_EVENT',
        steps: [echoStep],
        status: WorkflowStatus.DRAFT,
      });
      await triggerRule.runtime.activateWorkflow(SYSTEM, 'wf1');
      expect(await statusOf(triggerRule)).toBe(WorkflowStatus.ACTIVE);

      const stepRule = createTestFixture({
        authorizer: maker,
        approval: {
          default: ApprovalRequirement.NOT_REQUIRED,
          steps: { TEST_EVENT: ApprovalRequirement.REQUIRED },
        },
      });
      seedWorkflow(stepRule.persistence, 'wf1', {
        triggerType: 'TEST_EVENT',
        steps: [exemptStep],
        status: WorkflowStatus.DRAFT,
      });
      await stepRule.runtime.activateWorkflow(SYSTEM, 'wf1');
      expect(await statusOf(stepRule)).toBe(WorkflowStatus.ACTIVE);
    });

    it('gates a trigger on its own account, whatever the steps do', async () => {
      const f = createTestFixture({
        authorizer: maker,
        approval: {
          default: ApprovalRequirement.NOT_REQUIRED,
          triggers: { TEST_EVENT: ApprovalRequirement.REQUIRED },
        },
      });
      seedWorkflow(f.persistence, 'wf1', {
        triggerType: 'TEST_EVENT',
        steps: [exemptStep],
        status: WorkflowStatus.DRAFT,
      });

      await f.runtime.activateWorkflow(SYSTEM, 'wf1');

      expect(await statusOf(f)).toBe(WorkflowStatus.PENDING_APPROVAL);
    });

    it('gates everything the deployment has not exempted, when the default says so', async () => {
      const failClosed: ApprovalConfig = {
        default: ApprovalRequirement.REQUIRED,
        steps: { ECHO: ApprovalRequirement.NOT_REQUIRED },
        triggers: { TEST_EVENT: ApprovalRequirement.NOT_REQUIRED },
      };

      const exempted = createTestFixture({ authorizer: maker, approval: failClosed });
      seedWorkflow(exempted.persistence, 'wf1', {
        triggerType: 'TEST_EVENT',
        steps: [echoStep],
        status: WorkflowStatus.DRAFT,
      });
      await exempted.runtime.activateWorkflow(SYSTEM, 'wf1');
      expect(await statusOf(exempted)).toBe(WorkflowStatus.ACTIVE);

      const unlisted = createTestFixture({ authorizer: maker, approval: failClosed });
      seedWorkflow(unlisted.persistence, 'wf1', {
        triggerType: 'TEST_EVENT',
        steps: [exemptStep],
        status: WorkflowStatus.DRAFT,
      });
      await unlisted.runtime.activateWorkflow(SYSTEM, 'wf1');
      expect(await statusOf(unlisted)).toBe(WorkflowStatus.PENDING_APPROVAL);
    });
  });

  describe('approve and reject', () => {
    it('puts an approved workflow live and registers its trigger', async () => {
      const f = createTestFixture({ approval: gateEcho });
      seedWorkflow(f.persistence, 'wf1', {
        triggerType: 'TEST_CRON',
        triggerConfig: { expression: '0 * * * *' },
        steps: [echoStep],
        status: WorkflowStatus.PENDING_APPROVAL,
      });

      await f.runtime.approveWorkflow(SYSTEM, 'wf1');

      expect(await statusOf(f)).toBe(WorkflowStatus.ACTIVE);
      // The side-effects belong here, not at submit: a workflow awaiting
      // review must not already own a schedule.
      expect(f.scheduledJobs.get('wf1')?.expression).toBe('0 * * * *');
    });

    it('records a rejection as its own state, not as "nobody looked yet"', async () => {
      const f = createTestFixture({ approval: gateEcho });
      seedWorkflow(f.persistence, 'wf1', {
        triggerType: 'TEST_EVENT',
        steps: [echoStep],
        status: WorkflowStatus.PENDING_APPROVAL,
      });

      await f.runtime.rejectWorkflow(SYSTEM, 'wf1');

      expect(await statusOf(f)).toBe(WorkflowStatus.REJECTED);
    });

    it('refuses to approve something that is not awaiting review', async () => {
      const f = createTestFixture({ approval: gateEcho });
      seedWorkflow(f.persistence, 'wf1', {
        triggerType: 'TEST_EVENT',
        steps: [echoStep],
        status: WorkflowStatus.ACTIVE,
      });

      await expect(f.runtime.approveWorkflow(SYSTEM, 'wf1')).rejects.toThrow(
        /not awaiting approval/,
      );
    });

    it('refuses to reject something that is not awaiting review', async () => {
      const f = createTestFixture({ approval: gateEcho });
      seedWorkflow(f.persistence, 'wf1', {
        triggerType: 'TEST_EVENT',
        steps: [echoStep],
        status: WorkflowStatus.DRAFT,
      });

      await expect(f.runtime.rejectWorkflow(SYSTEM, 'wf1')).rejects.toThrow(
        /not awaiting approval/,
      );
    });

    it('will not let the maker approve their own submission', async () => {
      const f = createTestFixture({ authorizer: maker, approval: gateEcho });
      seedWorkflow(f.persistence, 'wf1', {
        triggerType: 'TEST_EVENT',
        steps: [echoStep],
        status: WorkflowStatus.PENDING_APPROVAL,
      });

      await expect(f.runtime.approveWorkflow(SYSTEM, 'wf1')).rejects.toThrow();
      expect(await statusOf(f)).toBe(WorkflowStatus.PENDING_APPROVAL);
    });
  });

  describe('editing', () => {
    const gatedConfig = {
      trigger: { type: 'TEST_EVENT', config: {} },
      steps: [echoStep],
    } as never;
    const exemptConfig = {
      trigger: { type: 'TEST_EVENT', config: {} },
      steps: [exemptStep],
    } as never;

    it('refuses to edit a live workflow into something that needs approval', async () => {
      // The bypass this closes: activate something harmless, then edit the
      // gated step in while it is already running.
      const f = createTestFixture({ authorizer: maker, approval: gateEcho });
      seedWorkflow(f.persistence, 'wf1', {
        triggerType: 'TEST_EVENT',
        steps: [exemptStep],
        status: WorkflowStatus.ACTIVE,
      });

      await expect(
        f.runtime.updateWorkflow(SYSTEM, 'wf1', { config: gatedConfig }),
      ).rejects.toThrow(/Deactivate it first/);
      expect(await statusOf(f)).toBe(WorkflowStatus.ACTIVE);
    });

    it('allows editing a live workflow when the result needs no approval', async () => {
      const f = createTestFixture({ authorizer: maker, approval: gateEcho });
      seedWorkflow(f.persistence, 'wf1', {
        triggerType: 'TEST_EVENT',
        steps: [exemptStep],
        status: WorkflowStatus.ACTIVE,
      });

      await f.runtime.updateWorkflow(SYSTEM, 'wf1', { config: exemptConfig });

      expect(await statusOf(f)).toBe(WorkflowStatus.ACTIVE);
    });

    it('returns a submitted workflow to draft when it is edited', async () => {
      const f = createTestFixture({ authorizer: maker, approval: gateEcho });
      seedWorkflow(f.persistence, 'wf1', {
        triggerType: 'TEST_EVENT',
        steps: [echoStep],
        status: WorkflowStatus.PENDING_APPROVAL,
      });

      await f.runtime.updateWorkflow(SYSTEM, 'wf1', { config: gatedConfig });

      // Whatever the reviewer was looking at is no longer what is on the table.
      expect(await statusOf(f)).toBe(WorkflowStatus.DRAFT);
    });

    it('returns a rejected workflow to draft when it is edited', async () => {
      const f = createTestFixture({ authorizer: maker, approval: gateEcho });
      seedWorkflow(f.persistence, 'wf1', {
        triggerType: 'TEST_EVENT',
        steps: [echoStep],
        status: WorkflowStatus.REJECTED,
      });

      await f.runtime.updateWorkflow(SYSTEM, 'wf1', { config: gatedConfig });

      expect(await statusOf(f)).toBe(WorkflowStatus.DRAFT);
    });

    it('imposes none of these rules under a policy that gates nothing', async () => {
      // The gate is required config, so "off" is a policy rather than an
      // absence — and it has to behave exactly as no feature would.
      const f = createTestFixture({ authorizer: maker });
      seedWorkflow(f.persistence, 'wf1', {
        triggerType: 'TEST_EVENT',
        steps: [exemptStep],
        status: WorkflowStatus.ACTIVE,
      });

      await f.runtime.updateWorkflow(SYSTEM, 'wf1', { config: gatedConfig });

      expect(await statusOf(f)).toBe(WorkflowStatus.ACTIVE);
    });
  });

  describe('the review queue', () => {
    it('lists what is waiting, with what obliged it', async () => {
      const f = createTestFixture({ authorizer: maker, approval: gateEcho });
      seedWorkflow(f.persistence, 'wf1', {
        triggerType: 'TEST_EVENT',
        steps: [echoStep],
        status: WorkflowStatus.PENDING_APPROVAL,
        metadata: { name: 'Email the customer' },
      });

      const { items: [row] } = await f.runtime.listPendingWorkflows(SYSTEM);

      expect(row?.workflowId).toBe('wf1');
      expect(row?.name).toBe('Email the customer');
      expect(row?.triggerType).toBe('TEST_EVENT');
      // The point of the row: triage without opening each workflow.
      expect(row?.gatedBy).toEqual(['ECHO']);
    });

    it('leaves out workflows that are not waiting', async () => {
      const f = createTestFixture({ authorizer: maker, approval: gateEcho });
      seedWorkflow(f.persistence, 'wf1', {
        triggerType: 'TEST_EVENT',
        steps: [echoStep],
        status: WorkflowStatus.ACTIVE,
      });
      seedWorkflow(f.persistence, 'wf2', {
        triggerType: 'TEST_EVENT',
        steps: [echoStep],
        status: WorkflowStatus.PENDING_APPROVAL,
      });

      const { items } = await f.runtime.listPendingWorkflows(SYSTEM);

      expect(items.map((r) => r.workflowId)).toEqual(['wf2']);
    });

    it('shows the author their own submission, not only reviewers theirs', async () => {
      // Scoped to what the caller can SEE, not what they can approve: one list
      // serves both sides, and permittedActions decides who gets the button.
      const f = createTestFixture({ authorizer: maker, approval: gateEcho });
      seedWorkflow(f.persistence, 'wf1', {
        triggerType: 'TEST_EVENT',
        steps: [echoStep],
        status: WorkflowStatus.PENDING_APPROVAL,
      });

      const { items: [row] } = await f.runtime.listPendingWorkflows(SYSTEM);

      expect(row).toBeDefined();
      expect(row?.permittedActions).not.toContain('workflow:approve');
    });

    it('carries the approver action for someone who may decide', async () => {
      const f = createTestFixture({ approval: gateEcho });
      seedWorkflow(f.persistence, 'wf1', {
        triggerType: 'TEST_EVENT',
        steps: [echoStep],
        status: WorkflowStatus.PENDING_APPROVAL,
      });

      const { items: [row] } = await f.runtime.listPendingWorkflows(SYSTEM);

      expect(row?.permittedActions).toContain('workflow:approve');
    });
  });

  describe('running', () => {
    it('refuses a manual run while a workflow is awaiting review', async () => {
      // Otherwise the gate is a suggestion: Run does what activating would.
      const f = createTestFixture({ authorizer: maker, approval: gateEcho });
      seedWorkflow(f.persistence, 'wf1', {
        triggerType: 'TEST_MANUAL',
        steps: [echoStep],
        status: WorkflowStatus.PENDING_APPROVAL,
      });

      await expect(f.runtime.triggerManual(SYSTEM, 'wf1', {})).rejects.toThrow(
        /awaiting approval/,
      );
    });

    it('still lets a draft be test-run, so nothing legitimate is lost', async () => {
      const f = createTestFixture({ authorizer: maker, approval: gateEcho });
      seedWorkflow(f.persistence, 'wf1', {
        triggerType: 'TEST_MANUAL',
        steps: [echoStep],
        status: WorkflowStatus.DRAFT,
      });

      await expect(f.runtime.triggerManual(SYSTEM, 'wf1', {})).resolves.toBeTruthy();
    });
  });

  describe('paging the queue', () => {
    it('hands back a cursor and resumes after it', async () => {
      const f = createTestFixture({ approval: gateEcho });
      for (const id of ['wf1', 'wf2', 'wf3']) {
        seedWorkflow(f.persistence, id, {
          triggerType: 'TEST_EVENT',
          steps: [echoStep],
          status: WorkflowStatus.PENDING_APPROVAL,
        });
      }

      const first = await f.runtime.listPendingWorkflows(SYSTEM, { limit: 2 });
      expect(first.items).toHaveLength(2);
      // Opaque: it encodes the last row's sort position, not its id, so that a
      // row leaving the queue between pages does not strand the rest.
      expect(first.nextCursor).toBeDefined();

      const second = await f.runtime.listPendingWorkflows(SYSTEM, {
        limit: 2,
        cursor: first.nextCursor!,
      });

      // No overlap, and the short page ends the walk.
      expect(second.items).toHaveLength(1);
      expect(second.nextCursor).toBeUndefined();
      const seen = [...first.items, ...second.items].map((r) => r.workflowId);
      expect(new Set(seen).size).toBe(3);
    });
  });

  describe('what activating reports back', () => {
    it('says it went live, and names nothing', async () => {
      const f = createTestFixture({ authorizer: maker, approval: gateEcho });
      seedWorkflow(f.persistence, 'wf1', {
        triggerType: 'TEST_EVENT',
        steps: [exemptStep],
        status: WorkflowStatus.DRAFT,
      });

      const outcome = await f.runtime.activateWorkflow(SYSTEM, 'wf1');

      expect(outcome).toEqual({ status: WorkflowStatus.ACTIVE, gatedBy: [] });
    });

    it('says it went for review, and why', async () => {
      // The author finds out from the act itself, so there is nothing to
      // predict beforehand and nothing to disagree with afterwards.
      const f = createTestFixture({ authorizer: maker, approval: gateEcho });
      seedWorkflow(f.persistence, 'wf1', {
        triggerType: 'TEST_EVENT',
        steps: [echoStep],
        status: WorkflowStatus.DRAFT,
      });

      const outcome = await f.runtime.activateWorkflow(SYSTEM, 'wf1');

      expect(outcome).toEqual({
        status: WorkflowStatus.PENDING_APPROVAL,
        gatedBy: ['ECHO'],
      });
    });
  });

  describe('create', () => {
    async function create(f: ReturnType<typeof createTestFixture>, steps: unknown[]) {
      const folder = await f.runtime.createFolder(SYSTEM, { name: 'Test' });
      return f.runtime.createWorkflow(SYSTEM, {
        name: 'New',
        folderId: folder.id,
        config: { trigger: { type: 'TEST_EVENT', config: {} }, steps } as never,
      });
    }

    it('creates a gated workflow awaiting review rather than live', async () => {
      // Create goes live in one call, so it is an activation — otherwise
      // "build it fresh" would be the way around every other check.
      const f = createTestFixture({ authorizer: maker, approval: gateEcho });

      const record = await create(f, [echoStep]);

      expect(record.status).toBe(WorkflowStatus.PENDING_APPROVAL);
    });

    it('creates live when the creator may approve', async () => {
      const f = createTestFixture({ approval: gateEcho });

      const record = await create(f, [echoStep]);

      expect(record.status).toBe(WorkflowStatus.ACTIVE);
    });

    it('creates live when nothing in the configuration is gated', async () => {
      const f = createTestFixture({ authorizer: maker, approval: gateEcho });

      const record = await create(f, [exemptStep]);

      expect(record.status).toBe(WorkflowStatus.ACTIVE);
    });
  });
});
