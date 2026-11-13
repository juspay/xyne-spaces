import { Readable } from 'node:stream';
import { describe, it, expect, beforeEach } from 'vitest';
import { DEFAULT_PAGE, MAX_PAGE } from '../runtime/paging.js';
import { testRegistry } from '../testing/test-connector.js';
import { z } from 'zod';
import { createWorkflowRouter } from './workflow-router.js';
import { WorkflowRuntime } from '../runtime/workflow-runtime.js';
import { AllowAllAuthorizer } from '../authz/default.js';
import type { WorkflowAuthorizer } from '../authz/types.js';
import type { IdScope } from '../authz/id-scope.js';
import { WorkflowExecutor } from '../engine/workflow-executor.js';
import { InMemoryPersistenceAdapter } from '../persistence/in-memory-adapter.js';
import { ATTACHMENT_JSON_SCHEMA } from '../common/attachment.js';
import { InMemoryStorageAdapter } from '../storage/in-memory-adapter.js';
import type { StorageAdapter } from '../storage/types.js';
import { ServiceRegistry } from '../engine/service-registry.js';
import { BaseActionStep } from '../steps/base-step.js';
import type { StepExecutionContext } from '../steps/base-step.js';
import { EventTrigger } from '../triggers/event-trigger.js';
import { WebhookTrigger } from '../triggers/webhook-trigger.js';
import type { InboundHttpRequest, InboundReply, RawInboundRequest, Translation } from '../ingest/types.js';
import type { TriggerExecutionContext } from '../triggers/base-trigger.js';
import { credentialValues } from '../common/credentials.js';
import { ApprovalRequirement } from '../types/approval.js';
import { headerValue } from '../ingest/headers.js';
import { defineCredential } from '../connectors/core/credentials.js';
import { ManualTrigger } from '../triggers/manual-trigger.js';
import { TriggerCategory } from '../types/categories.js';
import type { RouteDefinition, RouteRequest, AuthContext } from './types.js';
import type { QueueAdapter, SchedulerAdapter } from '../persistence/types.js';
import { InMemoryEventBus } from '../events/in-memory-adapter.js';
import { workflowTopic } from '../events/types.js';
import type { BusEvent, EventBusAdapter, WorkflowChangeEvent } from '../events/types.js';
import type {
  CredentialListItem,
  CredentialSummary,
} from '../common/credentials.js';

// ─── Test Steps & Triggers ───

const EchoConfig = z.object({ message: z.string() });

class EchoStep extends BaseActionStep<typeof EchoConfig, { echoed: string }> {
  readonly type = 'ECHO';
  readonly configSchema = EchoConfig;
  readonly name = 'Echo';
  readonly description = 'Echoes';
  readonly outputSchema = z.object({ echoed: z.string() });
  readonly category = 'testing';

  async execute(
    config: z.infer<typeof EchoConfig>,
    _ctx: StepExecutionContext,
  ): Promise<{ echoed: string }> {
    return { echoed: config.message };
  }
}

class TestEventTrigger extends EventTrigger<z.ZodObject<{}>> {
  readonly type = 'TEST_EVENT';
  readonly configSchema = z.object({});
  readonly name = 'Test Event';
  readonly description = 'Test event';
  readonly outputSchema = z.object({});
  readonly category = TriggerCategory.EVENT;
}

const TEST_WEBHOOK_SECRET = defineCredential({
  connectorId: 'test',
  credType: 'TEST_WEBHOOK_SECRET',
  label: 'Test webhook secret',
  authType: 'secret',
});

const TestWebhookConfig = z.object({ secretName: z.string() });

class TestWebhookTrigger extends WebhookTrigger<typeof TestWebhookConfig> {
  readonly type = 'TEST_WEBHOOK';
  readonly configSchema = TestWebhookConfig;
  readonly name = 'Test Webhook';
  readonly description = 'Test webhook';
  readonly outputSchema = z.object({});
  readonly category = TriggerCategory.WEBHOOK;
  override readonly credentialSlots = [{ name: 'secretName', required: true }] as const;
  override readonly credential = [TEST_WEBHOOK_SECRET];
  async verify(
    request: InboundHttpRequest,
    _config: unknown,
    ctx: TriggerExecutionContext,
  ): Promise<boolean> {
    return (
      headerValue(request.headers, 'x-token') ===
      credentialValues(ctx.credentials, 'secretName', 'secret').value
    );
  }

  override async handshake(request: InboundHttpRequest): Promise<InboundReply | undefined> {
    const token = request.query['validationToken'];
    if (typeof token !== 'string') return undefined;
    return { status: 200, headers: { 'Content-Type': 'text/plain' }, body: token };
  }

  async handleRequest(request: RawInboundRequest): Promise<Translation> {
    return {
      events: [{ type: this.type, payload: { body: request.body as Record<string, unknown> } }],
      reply: { status: 200, body: { ok: true } },
    };
  }
}

class TestManualTrigger extends ManualTrigger<z.ZodObject<{}>> {
  readonly type = 'TEST_MANUAL';
  readonly configSchema = z.object({});
  readonly name = 'Test Manual';
  readonly description = 'Test manual';
  readonly outputSchema = z.object({});
  readonly category = TriggerCategory.MANUAL;
}

// ─── Helpers ───

function createFixture(opts?: {
  withStorage?: boolean;
  storage?: StorageAdapter;
  authorizer?: WorkflowAuthorizer<AuthContext, IdScope>;
  eventBus?: EventBusAdapter;
}) {
  const persistence = new InMemoryPersistenceAdapter();
  const enqueuedJobs: Array<{ executionId: string }> = [];
  const queue: QueueAdapter = {
    async enqueue(data) {
      enqueuedJobs.push(data);
    },
  };
  const scheduler: SchedulerAdapter = {
    async schedule() {},
    async unschedule() {},
  };
  const services = new ServiceRegistry();
  const connectors = testRegistry({ steps: [new EchoStep()], triggers: [new TestEventTrigger(), new TestWebhookTrigger(), new TestManualTrigger()], credentials: [TEST_WEBHOOK_SECRET] });

  const executor = new WorkflowExecutor(
    persistence,
    connectors,
    services,
  );

  const storage = opts?.storage ?? (opts?.withStorage ? new InMemoryStorageAdapter() : undefined);
  const runtime = new WorkflowRuntime({
    persistence,
    // Explicit: these are not ACL tests, so enforcement is deliberately off.
    authorizer: opts?.authorizer ?? new AllowAllAuthorizer(),
    queue,
    scheduler,
    services,
    connectors,
    executor,
    ...(storage ? { storage } : {}),
    ...(opts?.eventBus ? { eventBus: opts.eventBus } : {}),
    config: {
      baseUrl: 'https://api.example.com',
      approval: { default: ApprovalRequirement.NOT_REQUIRED },
    },
  });

  const auth: AuthContext = {
    userId: 'user_1',
    metadata: { workspaceId: 'ws_1' },
  };

  const routes = createWorkflowRouter(runtime, {
    authenticate: () => auth,
  });

  return {
    routes,
    persistence,
    enqueuedJobs,
    auth,
    runtime,
    executor,
    storage,
    eventBus: opts?.eventBus,
  };
}

function findRoute(
  routes: RouteDefinition[],
  method: string,
  pathPattern: string,
): RouteDefinition | undefined {
  return routes.find(
    (r) => r.method === method && r.path === pathPattern,
  );
}

function makeReq(overrides?: Partial<RouteRequest>): RouteRequest {
  return {
    params: {},
    query: {},
    body: undefined,
    headers: {},
    ...overrides,
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
    attributes?: Record<string, unknown>;
    runNaming?: { mode: 'template'; template: string } | { mode: 'user' };
  },
) {
  persistence.seedWorkflow({
    id,
    status: opts.status ?? 'ACTIVE',
    eventType: opts.triggerType,
    config: JSON.stringify({
      trigger: { type: opts.triggerType, config: opts.triggerConfig ?? {} },
      steps: opts.steps ?? [],
      ...(opts.runNaming ? { settings: { runNaming: opts.runNaming } } : {}),
    }),
    metadata: JSON.stringify({}),
    summary: null,
    folderId: 'folder_test',
    ...(opts.attributes ? { attributes: opts.attributes } : {}),
  });
}


/**
 * Read up to `count` SSE frames from a never-ending stream, then stop.
 *
 * `/events` stays open by design, so a test must decide when it has seen enough —
 * `for await` over it would hang forever. Breaking out also exercises the
 * generator's `finally`, which is where the bus subscription is released.
 */
async function readFrames(
  stream: AsyncIterable<string>,
  count: number,
): Promise<Array<{ event: string; data: unknown }>> {
  const frames: Array<{ event: string; data: unknown }> = [];
  for await (const chunk of stream) {
    // Keepalives are comments and carry no event.
    if (chunk.startsWith(':')) continue;
    const event = /^event: (.*)$/m.exec(chunk)?.[1] ?? '';
    const data = /^data: (.*)$/m.exec(chunk)?.[1] ?? 'null';
    frames.push({ event, data: JSON.parse(data) as unknown });
    if (frames.length >= count) break;
  }
  return frames;
}

// ─── Tests ───

describe('createWorkflowRouter', () => {
  it('returns an array of route definitions', () => {
    const { routes } = createFixture();
    expect(Array.isArray(routes)).toBe(true);
    expect(routes.length).toBeGreaterThan(0);
    for (const route of routes) {
      expect(route).toHaveProperty('method');
      expect(route).toHaveProperty('path');
      expect(route).toHaveProperty('handler');
    }
  });

  describe('POST /workflows/validate', () => {
    it('returns valid for a correct config', async () => {
      const { routes, auth } = createFixture();

      const route = findRoute(routes, 'POST', '/workflows/validate')!;
      const result = await route.handler(
        makeReq({
          body: {
            trigger: { type: 'TEST_EVENT', config: {} },
            steps: [{ id: 's1', type: 'ECHO', config: { message: 'hi' } }],
          },
        }),
        auth,
      );

      expect(result.status).toBe(200);
      const body = result.body as { valid: boolean; issues: unknown[] };
      expect(body.valid).toBe(true);
      expect(body.issues).toHaveLength(0);
    });

    it('returns issues for invalid config', async () => {
      const { routes, auth } = createFixture();

      const route = findRoute(routes, 'POST', '/workflows/validate')!;
      const result = await route.handler(
        makeReq({
          body: {
            trigger: { type: 'NONEXISTENT', config: {} },
            steps: [],
          },
        }),
        auth,
      );

      expect(result.status).toBe(200);
      const body = result.body as { valid: boolean; issues: unknown[] };
      expect(body.valid).toBe(false);
      expect(body.issues.length).toBeGreaterThan(0);
    });

    it('returns 400 for missing body', async () => {
      const { routes, auth } = createFixture();

      const route = findRoute(routes, 'POST', '/workflows/validate')!;
      const result = await route.handler(makeReq(), auth);

      expect(result.status).toBe(400);
    });
  });

  describe('POST /workflows/:id/activate', () => {
    it('activates a workflow', async () => {
      const { routes, persistence, auth } = createFixture();
      seedWorkflow(persistence, 'wf1', { triggerType: 'TEST_EVENT' });

      const route = findRoute(routes, 'POST', '/workflows/:id/activate')!;
      const result = await route.handler(
        makeReq({ params: { id: 'wf1' } }),
        auth,
      );

      expect(result.status).toBe(200);
      expect(result.body).toEqual({ status: 'ACTIVE', gatedBy: [] });
    });

    it('returns 400 for unknown workflow', async () => {
      const { routes, auth } = createFixture();

      const route = findRoute(routes, 'POST', '/workflows/:id/activate')!;
      const result = await route.handler(
        makeReq({ params: { id: 'nonexistent' } }),
        auth,
      );

      expect(result.status).toBe(400);
    });
  });

  describe('POST /workflows/:id/deactivate', () => {
    it('deactivates a workflow', async () => {
      const { routes, persistence, auth } = createFixture();
      seedWorkflow(persistence, 'wf1', { triggerType: 'TEST_EVENT' });

      const route = findRoute(routes, 'POST', '/workflows/:id/deactivate')!;
      const result = await route.handler(
        makeReq({ params: { id: 'wf1' } }),
        auth,
      );

      expect(result.status).toBe(200);
      expect(result.body).toEqual({ deactivated: true });
    });
  });

  describe('POST /workflows/:id/trigger', () => {
    it('triggers a workflow manually', async () => {
      const { routes, persistence, enqueuedJobs, auth } = createFixture();
      seedWorkflow(persistence, 'wf1', { triggerType: 'TEST_MANUAL' });

      const route = findRoute(routes, 'POST', '/workflows/:id/trigger')!;
      const result = await route.handler(
        makeReq({ params: { id: 'wf1' }, body: { key: 'val' } }),
        auth,
      );

      expect(result.status).toBe(201);
      expect((result.body as Record<string, unknown>)['executionId']).toBeTruthy();
      expect(enqueuedJobs).toHaveLength(1);
    });

    it('returns 409 when a typed run identifier is already taken', async () => {
      const { routes, persistence, auth } = createFixture();
      seedWorkflow(persistence, 'wf1', { triggerType: 'TEST_MANUAL', runNaming: { mode: 'user' } });
      const route = findRoute(routes, 'POST', '/workflows/:id/trigger')!;

      await route.handler(makeReq({ params: { id: 'wf1' }, body: { __runIdentifier: 'Review' } }), auth);
      const duplicate = await route.handler(
        makeReq({ params: { id: 'wf1' }, body: { __runIdentifier: 'Review' } }),
        auth,
      );

      expect(duplicate.status).toBe(409);
      expect(duplicate.body).toEqual({ error: 'Workflow run identifier "Review" already exists' });
    });

    it('returns 404 for unknown workflow', async () => {
      const { routes, auth } = createFixture();

      const route = findRoute(routes, 'POST', '/workflows/:id/trigger')!;
      const result = await route.handler(
        makeReq({ params: { id: 'nonexistent' }, body: {} }),
        auth,
      );

      expect(result.status).toBe(404);
    });

    it('extracts attachments from body and passes them to triggerManual', async () => {
      const { routes, persistence, auth } = createFixture();
      seedWorkflow(persistence, 'wf1', { triggerType: 'TEST_MANUAL' });

      const route = findRoute(routes, 'POST', '/workflows/:id/trigger')!;
      const att = { name: 'a.txt', mimeType: 'text/plain', handle: 'mem://1', size: 4 };
      const result = await route.handler(
        makeReq({
          params: { id: 'wf1' },
          body: { topic: 't', attachments: [att] },
        }),
        auth,
      );

      expect(result.status).toBe(201);
      const execId = (result.body as { executionId: string }).executionId;
      const state = await persistence.getExecutionState(execId);
      const ctx = JSON.parse(state!.context!);
      // attachments lifted from body to context.trigger.attachments
      expect(ctx.trigger.attachments).toEqual([att]);
      // and not duplicated as a plain payload field
      expect(ctx.trigger.topic).toBe('t');
    });
  });

  describe('POST /v2/workflows/:workflowId/trigger/v2', () => {
    const path = '/v2/workflows/:workflowId/trigger/v2';

    it('is a provider route that accepts multipart bodies', () => {
      const { routes } = createFixture();
      const route = findRoute(routes, 'POST', path)!;

      expect(route.access).toBe('provider');
      expect(route.multipart).toBe('any');
    });

    it('returns 501 when storage is not configured', async () => {
      const { routes } = createFixture();
      const route = findRoute(routes, 'POST', path)!;

      const result = await route.handler(
        makeReq({
          params: { workflowId: 'wf1' },
          body: { responseUrl: 'https://client.example.com/result' },
          files: [{ fieldName: 'documents', attachment: { name: 'doc.pdf', mimeType: 'application/pdf', handle: 'mem://doc.pdf', size: 3 } }],
        }),
        null,
      );

      expect(result.status).toBe(501);
    });

    it('allows missing documents even when the webhook v2 schema lists them as required', async () => {
      const { routes, persistence } = createFixture({ withStorage: true });
      seedWorkflow(persistence, 'wf1', {
        triggerType: 'WEBHOOK_V2',
        triggerConfig: {
          inputSchema: {
            type: 'object',
            required: ['documents', 'responseUrl'],
            properties: {
              documents: { type: 'array', items: { type: 'object', format: 'attachment' } },
              responseUrl: { type: 'string' },
            },
          },
        },
      });
      const route = findRoute(routes, 'POST', path)!;

      const result = await route.handler(
        makeReq({
          params: { workflowId: 'wf1' },
          body: { responseUrl: 'https://client.example.com/result' },
        }),
        null,
      );

      expect(result.status).toBe(201);
    });

    it('returns 400 when a file field name is missing', async () => {
      const { routes, persistence } = createFixture({ withStorage: true });
      seedWorkflow(persistence, 'wf1', { triggerType: 'WEBHOOK_V2' });
      const route = findRoute(routes, 'POST', path)!;

      const result = await route.handler(
        makeReq({
          params: { workflowId: 'wf1' },
          body: { responseUrl: 'https://client.example.com/result' },
          files: [{ attachment: { name: 'doc.pdf', mimeType: 'application/pdf', handle: 'mem://doc.pdf', size: 3 } }],
        }),
        null,
      );

      expect(result.status).toBe(400);
      expect(JSON.stringify(result.body)).toMatch(/field name/);
    });

    it('returns 400 when schema validation rejects the multipart payload', async () => {
      const { routes, persistence } = createFixture({ withStorage: true });
      seedWorkflow(persistence, 'wf1', {
        triggerType: 'WEBHOOK_V2',
        triggerConfig: {
          inputSchema: {
            type: 'object',
            required: ['documents', 'responseUrl'],
            properties: {
              documents: { type: 'array', items: { type: 'object', format: 'attachment' }, minItems: 2 },
              responseUrl: { type: 'string' },
            },
          },
        },
      });
      const route = findRoute(routes, 'POST', path)!;

      const result = await route.handler(
        makeReq({
          params: { workflowId: 'wf1' },
          body: { responseUrl: 'https://client.example.com/result' },
          files: [{ fieldName: 'documents', attachment: { name: 'doc.pdf', mimeType: 'application/pdf', handle: 'mem://doc.pdf', size: 3 } }],
        }),
        null,
      );

      expect(result.status).toBe(400);
      expect(JSON.stringify(result.body)).toMatch(/at least 2 file/);
    });

    it('rejects executable uploads by default', async () => {
      const { routes } = createFixture({ withStorage: true });
      const route = findRoute(routes, 'POST', path)!;

      const result = await route.handler(
        makeReq({
          params: { workflowId: 'wf1' },
          body: { responseUrl: 'https://client.example.com/result' },
          files: [{ fieldName: 'documents', attachment: { name: 'run.sh', mimeType: 'text/plain', handle: 'mem://run.sh', size: 3 } }],
        }),
        null,
      );

      expect(result.status).toBe(400);
      expect(JSON.stringify(result.body)).toMatch(/\.sh/);
    });

    it('starts execution with schema-shaped trigger input from the delivered refs', async () => {
      const storageScopes: unknown[] = [];
      const storage: StorageAdapter = {
        async put(scope, file) {
          storageScopes.push(scope);
          let size = 0;
          for await (const chunk of file.stream) size += (chunk as Uint8Array).length;
          return { name: file.name, mimeType: file.mimeType, handle: `mem://${file.name}`, size };
        },
        async stream() {
          return Readable.from(Buffer.from(''));
        },
        async info() {
          return { size: 0, mimeType: 'application/octet-stream' };
        },
        async delete() {
          /* nothing to reclaim in this fake */
        },
      };
      const { routes, persistence } = createFixture({ storage });
      seedWorkflow(persistence, 'wf1', {
        triggerType: 'WEBHOOK_V2',
        attributes: { workspaceId: 'ws_1' },
        triggerConfig: {
          inputSchema: {
            type: 'object',
            required: ['documents', 'extractionSchema', 'responseUrl'],
            properties: {
              documents: { type: 'array', items: { type: 'object', format: 'attachment' } },
              extractionSchema: { type: 'object' },
              responseUrl: { type: 'string' },
            },
          },
        },
      });
      const route = findRoute(routes, 'POST', path)!;
      const schema = { type: 'object', properties: { total: { type: 'number' } } };

      const result = await route.handler(
        makeReq({
          params: { workflowId: 'wf1' },
          body: {
            extractionSchema: JSON.stringify(schema),
            responseUrl: 'https://client.example.com/result',
          },
          files: [{ fieldName: 'documents', attachment: { name: 'doc.pdf', mimeType: 'application/pdf', handle: 'mem://doc.pdf', size: 3 } }],
        }),
        null,
      );

      expect(result.status).toBe(201);
      const execId = (result.body as { executionId: string }).executionId;
      const state = await persistence.getExecutionState(execId);
      const ctx = JSON.parse(state!.context!) as Record<string, Record<string, unknown>>;
      expect(ctx.trigger['documents']).toEqual([
        expect.objectContaining({ name: 'doc.pdf', mimeType: 'application/pdf', size: 3 }),
      ]);
      expect(ctx.trigger['extractionSchema']).toEqual(schema);
      expect(ctx.trigger['responseUrl']).toBe('https://client.example.com/result');
      expect(ctx.workflow['metadata']).toEqual({});
      // Nothing was stored here: the host did that while parsing, so the
      // route sees references and never touches the adapter.
      expect(storageScopes).toEqual([]);
    });

    it('reads a text field as the input schema declares it', async () => {
      // Multipart delivers every field as a string, so a declared number has to
      // be parsed and a declared string must be left alone. Both paths that
      // take multipart — this one and the wait callback — share the reading, so
      // they cannot disagree about it again.
      const { routes, persistence } = createFixture({ withStorage: true });
      seedWorkflow(persistence, 'wf1', {
        triggerType: 'WEBHOOK_V2',
        attributes: { workspaceId: 'ws_1' },
        triggerConfig: {
          inputSchema: {
            type: 'object',
            properties: {
              buildNumber: { type: 'string' },
              attempt: { type: 'number' },
            },
          },
        },
      });
      const route = findRoute(routes, 'POST', path)!;

      const result = await route.handler(
        makeReq({
          params: { workflowId: 'wf1' },
          body: { buildNumber: '7003', attempt: '3' },
        }),
        null,
      );

      expect(result.status).toBe(201);
      const execId = (result.body as { executionId: string }).executionId;
      const ctx = JSON.parse((await persistence.getExecutionState(execId))!.context!) as
        Record<string, Record<string, unknown>>;
      expect(ctx.trigger['buildNumber']).toBe('7003');
      expect(ctx.trigger['attempt']).toBe(3);
    });

    it('refuses a workflow whose trigger is not an API trigger', async () => {
      const { routes, persistence } = createFixture({ withStorage: true });
      seedWorkflow(persistence, 'wf1', { triggerType: 'TEST_MANUAL' });
      const route = findRoute(routes, 'POST', path)!;

      const result = await route.handler(makeReq({ params: { workflowId: 'wf1' }, body: {} }), null);

      expect(result.status).toBe(400);
      expect(JSON.stringify(result.body)).toContain('does not use an API trigger');
    });
  });

  describe('POST /uploads', () => {
    it('declares file-field multipart parsing', () => {
      const { routes } = createFixture();
      const route = findRoute(routes, 'POST', '/uploads')!;

      expect(route.multipart).toBe('files');
    });

    it('returns 501 when storage is not configured', async () => {
      const { routes, auth } = createFixture(); // no storage
      const route = findRoute(routes, 'POST', '/uploads')!;
      const result = await route.handler(
        makeReq({
          files: [{ attachment: { name: 'a.txt', mimeType: 'text/plain', handle: 'mem://a.txt', size: 3 } }],
        }),
        auth,
      );
      expect(result.status).toBe(501);
    });

    it('returns 400 when no files are present', async () => {
      const { routes, auth } = createFixture({ withStorage: true });
      const route = findRoute(routes, 'POST', '/uploads')!;
      const result = await route.handler(makeReq(), auth);
      expect(result.status).toBe(400);
    });

    it('rejects executable MIME types by default', async () => {
      const { routes, auth } = createFixture({ withStorage: true });
      const route = findRoute(routes, 'POST', '/uploads')!;
      const result = await route.handler(
        makeReq({
          files: [{
            attachment: { name: 'innocent.txt', mimeType: 'application/x-msdownload', handle: 'mem://innocent.txt', size: 3 },
          }],
        }),
        auth,
      );
      expect(result.status).toBe(400);
      expect(JSON.stringify(result.body)).toMatch(/MIME/);
    });

    it('rejects executable extensions by default (even with benign MIME)', async () => {
      const { routes, auth } = createFixture({ withStorage: true });
      const route = findRoute(routes, 'POST', '/uploads')!;
      const result = await route.handler(
        makeReq({
          files: [{
            attachment: { name: 'malware.exe', mimeType: 'image/png', handle: 'mem://malware.exe', size: 3 },
          }],
        }),
        auth,
      );
      expect(result.status).toBe(400);
      expect(JSON.stringify(result.body)).toMatch(/\.exe/);
    });

    it('allows executables when runtime.allowExecutableUploads is true', async () => {
      // Build a fixture that opts in.
      const persistence = new InMemoryPersistenceAdapter();
      const queue: QueueAdapter = { async enqueue() {} };
      const scheduler: SchedulerAdapter = {
        async schedule() {},
        async unschedule() {},
      };
      const services = new ServiceRegistry();
      const connectors = testRegistry({ steps: [new EchoStep()], triggers: [new TestManualTrigger()] });
      const executor = new WorkflowExecutor(persistence, connectors, services);
      const storage = new InMemoryStorageAdapter();
      const runtime = new WorkflowRuntime({
        persistence,
        // Explicit: these are not ACL tests, so enforcement is deliberately off.
        authorizer: new AllowAllAuthorizer(),
        queue,
        scheduler,
        services,
        connectors,
        executor,
        storage,
        config: {
          baseUrl: 'https://api.example.com',
          allowExecutableUploads: true,
          approval: { default: ApprovalRequirement.NOT_REQUIRED },
        },
      });
      const auth: AuthContext = { userId: 'u1', metadata: {} };
      const routes = createWorkflowRouter(runtime, {
        authenticate: () => auth,
      });
      const route = findRoute(routes, 'POST', '/uploads')!;
      const result = await route.handler(
        makeReq({
          files: [{ attachment: { name: 'malware.exe', mimeType: 'image/png', handle: 'mem://malware.exe', size: 3 } }],
        }),
        auth,
      );
      expect(result.status).toBe(201);
    });

    it('returns the delivered Attachment[] keyed under "attachments"', async () => {
      const { routes, auth } = createFixture({ withStorage: true });
      const route = findRoute(routes, 'POST', '/uploads')!;
      const result = await route.handler(
        makeReq({
          files: [{ attachment: { name: 'a.txt', mimeType: 'text/plain', handle: 'mem://a.txt', size: 5 } }],
        }),
        auth,
      );

      expect(result.status).toBe(201);
      const body = result.body as { attachments: Array<{ name: string; size?: number; handle: string }> };
      // The route hands back exactly what the host streamed in — it neither
      // stores nor reads, which is why an upload costs it nothing.
      expect(body.attachments).toEqual([
        { name: 'a.txt', mimeType: 'text/plain', handle: 'mem://a.txt', size: 5 },
      ]);
    });
  });

  describe('POST /executions/:execId/resume', () => {
    it('resumes a paused execution', async () => {
      const { routes, persistence, enqueuedJobs, auth } = createFixture();
      seedWorkflow(persistence, 'wf1', { triggerType: 'TEST_EVENT' });

      const execId = await persistence.createExecution({
        workflowId: 'wf1',
        status: 'EXTERNAL_WAIT',
        context: '{}',
      });
      await persistence.updateExecutionStatus(execId, 'EXTERNAL_WAIT');
      // The answer goes to the gate's own record, so there has to be one.
      await persistence.upsertStep(execId, 'gate', {
        status: 'EXTERNAL_WAIT',
        executorType: 'deterministic',
        data: '{}',
        attributes: {} as never,
      });

      const route = findRoute(
        routes,
        'POST',
        '/executions/:execId/resume',
      )!;
      const result = await route.handler(
        makeReq({
          params: { execId },
          body: { data: { action: 'approve' } },
        }),
        auth,
      );

      expect(result.status).toBe(200);
      expect(enqueuedJobs).toHaveLength(1);
    });

    it('returns 404 for unknown execution', async () => {
      const { routes, auth } = createFixture();

      const route = findRoute(
        routes,
        'POST',
        '/executions/:execId/resume',
      )!;
      const result = await route.handler(
        makeReq({ params: { execId: 'nonexistent' }, body: {} }),
        auth,
      );

      expect(result.status).toBe(404);
    });

    it("cancels execution on resume with data.action: 'abort'", async () => {
      const { routes, persistence, enqueuedJobs, auth } = createFixture();
      seedWorkflow(persistence, 'wf1', { triggerType: 'TEST_EVENT' });

      const execId = await persistence.createExecution({
        workflowId: 'wf1',
        status: 'EXTERNAL_WAIT',
        context: '{}',
      });
      await persistence.updateExecutionStatus(execId, 'EXTERNAL_WAIT');
      enqueuedJobs.length = 0;

      const route = findRoute(routes, 'POST', '/executions/:execId/resume')!;
      const result = await route.handler(
        makeReq({
          params: { execId },
          body: { data: { action: 'abort' } },
        }),
        auth,
      );

      expect(result.status).toBe(200);
      expect(enqueuedJobs).toHaveLength(0);
      const exec = await persistence.getExecution(execId);
      expect(exec?.status).toBe('CANCELLED');
    });
  });

  describe('POST /executions/:execId/rerun', () => {
    async function setupCompletedExecution(
      persistence: InMemoryPersistenceAdapter,
    ): Promise<{ execId: string }> {
      seedWorkflow(persistence, 'wf1', {
        triggerType: 'TEST_EVENT',
        steps: [
          { id: 's1', type: 'ECHO', config: { message: 'one' } },
          { id: 's2', type: 'ECHO', config: { message: 'two' } },
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
      return { execId };
    }

    it('creates a new execution and enqueues it', async () => {
      const { routes, persistence, enqueuedJobs, executor, auth } = createFixture();
      const { execId } = await setupCompletedExecution(persistence);

      await executor.runExecution(execId);
      enqueuedJobs.length = 0;

      const route = findRoute(routes, 'POST', '/executions/:execId/rerun')!;
      const result = await route.handler(
        makeReq({
          params: { execId },
          body: { fromStepId: 's2' },
        }),
        auth,
      );

      expect(result.status).toBe(200);
      const newId = (result.body as { executionId: string }).executionId;
      expect(newId).toBeDefined();
      expect(enqueuedJobs).toEqual([{ executionId: newId }]);

      const newExec = await persistence.getExecution(newId);
      expect(newExec?.sourceExecutionId).toBe(execId);
    });

    it('returns 400 when fromStepId is missing', async () => {
      const { routes, auth } = createFixture();
      const route = findRoute(routes, 'POST', '/executions/:execId/rerun')!;
      const result = await route.handler(
        makeReq({ params: { execId: 'anything' }, body: {} }),
        auth,
      );
      expect(result.status).toBe(400);
    });

    it('returns 400 for unknown source execution', async () => {
      const { routes, auth } = createFixture();
      const route = findRoute(routes, 'POST', '/executions/:execId/rerun')!;
      const result = await route.handler(
        makeReq({
          params: { execId: 'unknown' },
          body: { fromStepId: 's1' },
        }),
        auth,
      );
      // The executor throws "Source execution ... not found"
      expect(result.status).toBe(404);
    });

    it('returns 400 for non-terminal source execution', async () => {
      const { routes, persistence, auth } = createFixture();
      seedWorkflow(persistence, 'wf1', {
        triggerType: 'TEST_EVENT',
        steps: [{ id: 's1', type: 'ECHO', config: { message: 'a' } }],
      });
      const execId = await persistence.createExecution({
        workflowId: 'wf1',
        status: 'EXTERNAL_WAIT',
        context: '{}',
      });
      await persistence.updateExecutionStatus(execId, 'EXTERNAL_WAIT');

      const route = findRoute(routes, 'POST', '/executions/:execId/rerun')!;
      const result = await route.handler(
        makeReq({
          params: { execId },
          body: { fromStepId: 's1' },
        }),
        auth,
      );
      expect(result.status).toBe(400);
    });
  });

  describe('route access', () => {
    it('classifies every route, and only provider routes skip the session', () => {
      const { routes } = createFixture();
      expect(routes.every((route) => route.access !== undefined)).toBe(true);
      expect(
        routes
          .filter((route) => route.access !== 'session')
          .map((route) => `${route.method} ${route.path} ${route.access}`)
          .sort(),
      ).toEqual([
        'GET /webhooks/:workflowId provider',
        'POST /executions/:execId/waits/:stepId provider',
        'POST /v2/workflows/:workflowId/trigger/v2 provider',
        'POST /webhooks/:workflowId provider',
      ]);
    });
  });

  describe('/executions/:execId/waits/:stepId', () => {
    /** A run parked on a gate whose contract wants a string and a file. */
    async function parked(persistence: InMemoryPersistenceAdapter) {
      seedWorkflow(persistence, 'wf_wait', {
        triggerType: 'TEST_EVENT',
        steps: [{ id: 'wait_for_build', type: 'WAIT_FOR_WEBHOOK', config: {} }],
      });
      const execId = await persistence.createExecution({
        workflowId: 'wf_wait',
        status: 'EXTERNAL_WAIT',
        context: '{}',
      });
      await persistence.updateExecutionStatus(execId, 'EXTERNAL_WAIT');
      await persistence.upsertStep(execId, 'wait_for_build', {
        status: 'EXTERNAL_WAIT',
        executorType: 'deterministic',
        data: JSON.stringify({
          contract: {
            type: 'object',
            required: ['buildNumber'],
            properties: { buildNumber: { type: 'string' }, report: ATTACHMENT_JSON_SCHEMA },
          },
        }),
        attributes: {} as never,
      });
      return execId;
    }

    const waitRoute = (routes: ReturnType<typeof createWorkflowRouter>) =>
      routes.find((r) => r.path === '/executions/:execId/waits/:stepId')!;

    const delivered = async (persistence: InMemoryPersistenceAdapter, execId: string) =>
      (JSON.parse((await persistence.getStep(execId, 'wait_for_build'))!.data!) as {
        delivery: { payload: Record<string, unknown> };
      }).delivery.payload;

    it('accepts multipart as well as JSON', () => {
      const { routes } = createFixture();
      expect(waitRoute(routes).multipart).toBe('any');
    });

    it('leaves a JSON body alone — a string that looks like a number stays a string', async () => {
      const { routes, persistence } = createFixture();
      const execId = await parked(persistence);

      const res = await waitRoute(routes).handler(
        makeReq({
          params: { execId, stepId: 'wait_for_build' },
          headers: { 'content-type': 'application/json' },
          body: { buildNumber: '7003' },
        }),
        null,
      );

      expect(res.status).toBe(202);
      // The contract says string. Re-reading a JSON body as multipart would
      // have made this 7003 and failed the sender for satisfying the contract.
      expect(await delivered(persistence, execId)).toEqual({ buildNumber: '7003' });
    });

    it('reads a multipart text field as the contract declares it', async () => {
      const { routes, persistence } = createFixture({ storage: new InMemoryStorageAdapter() });
      const execId = await parked(persistence);

      await waitRoute(routes).handler(
        makeReq({
          params: { execId, stepId: 'wait_for_build' },
          headers: { 'content-type': 'multipart/form-data; boundary=x' },
          body: { buildNumber: '7003' },
          files: [{
            fieldName: 'report',
            attachment: { name: 'junit.xml', mimeType: 'application/xml', handle: 'mem://junit.xml', size: 12 },
          }],
        }),
        null,
      );

      // Same contract, same payload, whichever content type the sender used —
      // which is the whole promise of one URL taking both.
      expect((await delivered(persistence, execId))['buildNumber']).toBe('7003');
    });

    it('stores a multipart file under its field name beside the text fields', async () => {
      const storage = new InMemoryStorageAdapter();
      const { routes, persistence } = createFixture({ storage });
      const execId = await parked(persistence);

      const res = await waitRoute(routes).handler(
        makeReq({
          params: { execId, stepId: 'wait_for_build' },
          headers: { 'content-type': 'multipart/form-data; boundary=x' },
          body: { buildNumber: '7003' },
          files: [{
            fieldName: 'report',
            attachment: { name: 'junit.xml', mimeType: 'application/xml', handle: 'mem://junit.xml', size: 3 },
          }],
        }),
        null,
      );

      expect(res.status).toBe(202);
      const payload = await delivered(persistence, execId);
      expect(payload['report']).toMatchObject({ name: 'junit.xml', mimeType: 'application/xml' });
    });

    it('rejects an executable before it is stored', async () => {
      const { routes, persistence } = createFixture({ storage: new InMemoryStorageAdapter() });
      const execId = await parked(persistence);

      const res = await waitRoute(routes).handler(
        makeReq({
          params: { execId, stepId: 'wait_for_build' },
          headers: { 'content-type': 'multipart/form-data; boundary=x' },
          body: {},
          files: [{ fieldName: 'report', attachment: { name: 'run.sh', mimeType: 'text/plain', handle: 'mem://run.sh', size: 3 } }],
        }),
        null,
      );

      expect(res.status).toBe(400);
    });
  });

  describe('/webhooks/:workflowId', () => {
    function seedWebhook(persistence: InMemoryPersistenceAdapter) {
      persistence.seedCredential('hook-secret', {
        credType: 'TEST_WEBHOOK_SECRET',
        authType: 'secret',
        values: { value: 'shh' },
      });
      seedWorkflow(persistence, 'wf1', {
        triggerType: 'TEST_WEBHOOK',
        triggerConfig: { secretName: 'hook-secret' },
      });
    }

    const webhookReq = (token: string | undefined, rawBody?: Uint8Array) =>
      makeReq({
        params: { workflowId: 'wf1' },
        headers: { 'content-type': 'application/json', ...(token ? { 'x-token': token } : {}) },
        ...(rawBody ? { rawBody } : {}),
      });
    const bytes = (body: unknown) => new TextEncoder().encode(JSON.stringify(body));

    it('is public, asks the host for the raw body, and enqueues an authenticated request', async () => {
      const { routes, persistence, enqueuedJobs } = createFixture();
      seedWebhook(persistence);

      const route = findRoute(routes, 'POST', '/webhooks/:workflowId')!;
      expect(route.access).toBe('provider');
      expect(route.rawBody).toBe(true);

      const result = await route.handler(webhookReq('shh', bytes({ event: 'test' })), null);

      expect(result).toEqual({ status: 200, body: { ok: true } });
      expect(enqueuedJobs).toHaveLength(1);
    });

    it('returns 401 for a wrong token', async () => {
      const { routes, persistence, enqueuedJobs } = createFixture();
      seedWebhook(persistence);
      const route = findRoute(routes, 'POST', '/webhooks/:workflowId')!;
      const result = await route.handler(webhookReq('guess', bytes({})), null);
      expect(result.status).toBe(401);
      expect(enqueuedJobs).toHaveLength(0);
    });

    it('returns 404 for an unknown workflow', async () => {
      const { routes } = createFixture();
      const route = findRoute(routes, 'POST', '/webhooks/:workflowId')!;
      const result = await route.handler(
        makeReq({ params: { workflowId: 'unknown' }, rawBody: bytes({}) }),
        null,
      );
      expect(result.status).toBe(404);
    });

    it('refuses to run when the host did not pass the raw body', async () => {
      const { routes, persistence, enqueuedJobs } = createFixture();
      seedWebhook(persistence);
      const route = findRoute(routes, 'POST', '/webhooks/:workflowId')!;
      const result = await route.handler(webhookReq('shh'), null);
      expect(result.status).toBe(500);
      expect(enqueuedJobs).toHaveLength(0);
    });

    it('answers a GET handshake through the trigger, publicly and without a run', async () => {
      const { routes, persistence, enqueuedJobs } = createFixture();
      seedWebhook(persistence);
      const route = findRoute(routes, 'GET', '/webhooks/:workflowId')!;
      expect(route.access).toBe('provider');

      const result = await route.handler(
        makeReq({ params: { workflowId: 'wf1' }, query: { validationToken: 'tok' } }),
        null,
      );

      expect(result).toEqual({ status: 200, headers: { 'Content-Type': 'text/plain' }, body: 'tok' });
      expect(enqueuedJobs).toHaveLength(0);
    });

    it('returns 404 for a GET that is not a handshake, even with a valid token', async () => {
      const { routes, persistence, enqueuedJobs } = createFixture();
      seedWebhook(persistence);
      const route = findRoute(routes, 'GET', '/webhooks/:workflowId')!;
      const result = await route.handler(
        makeReq({ params: { workflowId: 'wf1' }, headers: { 'x-token': 'shh' } }),
        null,
      );
      expect(result.status).toBe(404);
      expect(enqueuedJobs).toHaveLength(0);
    });
  });

  describe('GET /schema/credentials', () => {
    it('lists credential types grouped by connector', async () => {
      const { routes, auth } = createFixture();
      const route = findRoute(routes, 'GET', '/schema/credentials')!;
      const result = await route.handler(makeReq(), auth);
      const body = result.body as { connectors: Array<{ connectorId: string; credentials: Array<{ credType: string }> }> };
      expect(body.connectors.map((c) => c.connectorId)).toEqual(['builtin', 'test']);
      expect(body.connectors[1]!.credentials.map((c) => c.credType)).toEqual(['TEST_WEBHOOK_SECRET']);
    });
  });

  describe('GET /schema/triggers', () => {
    it('returns trigger metadata', async () => {
      const { routes, auth } = createFixture();

      const route = findRoute(routes, 'GET', '/schema/triggers')!;
      const result = await route.handler(makeReq(), auth);

      expect(result.status).toBe(200);
      const body = result.body as { triggers: Array<{ type: string }> };
      expect(body.triggers.length).toBeGreaterThan(0);
      const types = body.triggers.map((t) => t.type);
      expect(types).toContain('TEST_EVENT');
      expect(types).toContain('TEST_WEBHOOK');
      expect(types).toContain('TEST_MANUAL');
    });
  });

  describe('GET /schema/steps', () => {
    it('returns step summaries', async () => {
      const { routes, auth } = createFixture();

      const route = findRoute(routes, 'GET', '/schema/steps')!;
      const result = await route.handler(makeReq(), auth);

      expect(result.status).toBe(200);
      const body = result.body as { steps: Array<{ type: string }> };
      expect(body.steps.length).toBeGreaterThan(0);
      expect(body.steps.map((s) => s.type)).toContain('ECHO');
    });
  });

  describe('GET /schema/triggers/:type', () => {
    it('returns full trigger descriptor with schemas', async () => {
      const { routes, auth } = createFixture();

      const route = findRoute(routes, 'GET', '/schema/triggers/:type')!;
      const result = await route.handler(
        makeReq({ params: { type: 'TEST_EVENT' } }),
        auth,
      );

      expect(result.status).toBe(200);
      const body = result.body as Record<string, unknown>;
      expect(body['type']).toBe('TEST_EVENT');
      expect(body['name']).toBe('Test Event');
      expect(body['configSchema']).toBeDefined();
      expect((body['configSchema'] as Record<string, unknown>)['type']).toBe('object');
      expect(body['outputSchema']).toBeDefined();
      expect(body['requiresScopeFilter']).toBe(false);
      expect(body['scopeFilterFields']).toEqual([]);
    });

    it('returns 404 for unknown trigger type', async () => {
      const { routes, auth } = createFixture();

      const route = findRoute(routes, 'GET', '/schema/triggers/:type')!;
      const result = await route.handler(
        makeReq({ params: { type: 'NONEXISTENT' } }),
        auth,
      );

      expect(result.status).toBe(404);
    });
  });

  describe('GET /schema/operators', () => {
    it('returns operator descriptors', async () => {
      const { routes, auth } = createFixture();

      const route = findRoute(routes, 'GET', '/schema/operators')!;
      const result = await route.handler(makeReq(), auth);

      expect(result.status).toBe(200);
      const body = result.body as { operators: Array<{ value: string; label: string; valueType: string }> };
      // The editor's dropdown is built from whatever this returns, so a new
      // operator reaches authors without any UI change — which is why the set is
      // asserted by name rather than by count.
      expect(body.operators.map((o) => o.value)).toEqual([
        'eq',
        'neq',
        'contains',
        'not_contains',
        'starts_with',
        'ends_with',
        'gt',
        'gte',
        'lt',
        'lte',
        'exists',
        'not_exists',
        'is_empty',
      ]);
      const exists = body.operators.find((o) => o.value === 'exists');
      expect(exists).toBeDefined();
      expect(exists!.label).toBe('exists');
      expect(exists!.valueType).toBe('none');
      // Value-less operators must say so, or the editor renders a dead input.
      expect(body.operators.find((o) => o.value === 'is_empty')!.valueType).toBe('none');
    });
  });

  describe('GET /schema/steps/:type', () => {
    it('returns full step descriptor with schemas', async () => {
      const { routes, auth } = createFixture();

      const route = findRoute(routes, 'GET', '/schema/steps/:type')!;
      const result = await route.handler(
        makeReq({ params: { type: 'ECHO' } }),
        auth,
      );

      expect(result.status).toBe(200);
      const body = result.body as Record<string, unknown>;
      expect(body['type']).toBe('ECHO');
      expect(body['name']).toBe('Echo');
      expect(body['configSchema']).toBeDefined();
      expect((body['configSchema'] as Record<string, unknown>)['type']).toBe('object');
      expect(body['outputSchema']).toBeDefined();
      expect(body['credentialSlots']).toEqual([]);
      expect(body['declaredOutputs']).toEqual([]);
      expect(body['requiredServices']).toEqual([]);
      expect(body['mayEmit']).toEqual([]);
    });

    it('returns 404 for unknown step type', async () => {
      const { routes, auth } = createFixture();

      const route = findRoute(routes, 'GET', '/schema/steps/:type')!;
      const result = await route.handler(
        makeReq({ params: { type: 'NONEXISTENT' } }),
        auth,
      );

      expect(result.status).toBe(404);
    });
  });

  describe('GET /attachments', () => {
    it('returns 501 when storage is not configured', async () => {
      const { routes, auth } = createFixture();
      const route = findRoute(routes, 'GET', '/attachments')!;
      const result = await route.handler(makeReq({ query: { ref: 'x' } }), auth);
      expect(result.status).toBe(501);
    });

    it('returns 400 when ref is missing', async () => {
      const { routes, auth } = createFixture({ withStorage: true });
      const route = findRoute(routes, 'GET', '/attachments')!;
      const result = await route.handler(makeReq(), auth);
      expect(result.status).toBe(400);
    });

    it('redirects to a signed URL when the adapter supports signUrl', async () => {
      // The in-memory adapter implements signUrl, so the route 302-redirects.
      const { routes, auth, storage } = createFixture({ withStorage: true });
      const stored = await storage!.put({}, {
        name: 'report.txt',
        mimeType: 'text/plain',
        stream: Readable.from(Buffer.from('hello')),
      });
      const route = findRoute(routes, 'GET', '/attachments')!;
      const result = await route.handler(
        makeReq({ query: { ref: stored.handle, name: stored.name, mime: stored.mimeType } }),
        auth,
      );
      expect(result.status).toBe(302);
      expect(result.headers?.['Location']).toBeTruthy();
    });

    it('pipes the object back when the adapter has no signUrl', async () => {
      // A minimal adapter without signUrl exercises the streaming fallback —
      // the route hands back a stream, never a buffer, so serving a large file
      // costs the pipe rather than the file.
      const text = 'hello';
      const noSign: StorageAdapter = {
        async put(_scope, file) {
          return { name: file.name, mimeType: file.mimeType, handle: file.name, size: text.length };
        },
        async stream() {
          return Readable.from(Buffer.from(text));
        },
        async info() {
          return { size: text.length, mimeType: 'text/plain' };
        },
        async delete() {
          /* nothing to reclaim in this fake */
        },
      };
      const { routes, auth } = createFixture({ storage: noSign });
      const route = findRoute(routes, 'GET', '/attachments')!;
      const result = await route.handler(
        makeReq({ query: { ref: 'report.txt', name: 'report.txt', mime: 'text/plain' } }),
        auth,
      );
      expect(result.status).toBe(200);
      expect(result.headers?.['Content-Type']).toBe('text/plain');
      expect(result.headers?.['Content-Disposition']).toContain('report.txt');
      expect(result.headers?.['Content-Length']).toBe(String(text.length));
      expect(result.body).toBeNull();

      const chunks: Buffer[] = [];
      for await (const c of result.bodyStream!) chunks.push(c as Buffer);
      expect(Buffer.concat(chunks).toString('utf8')).toBe(text);
    });
  });

  describe('GET /executions/:execId/steps/:stepName/events', () => {
    it('returns the persisted events for a step', async () => {
      const { routes, persistence, auth } = createFixture();
      await persistence.appendStepEvent('exec1', 'step1', {
        type: 'tool_call',
        data: JSON.stringify({ tool: 'run_code' }),
      });
      const route = findRoute(routes, 'GET', '/executions/:execId/steps/:stepName/events')!;
      const result = await route.handler(
        makeReq({ params: { execId: 'exec1', stepName: 'step1' } }),
        auth,
      );
      expect(result.status).toBe(200);
      const body = result.body as { events: Array<{ type: string }> };
      expect(body.events).toHaveLength(1);
      expect(body.events[0]!.type).toBe('tool_call');
    });

    it('returns 400 on an invalid after timestamp', async () => {
      const { routes, auth } = createFixture();
      const route = findRoute(routes, 'GET', '/executions/:execId/steps/:stepName/events')!;
      const result = await route.handler(
        makeReq({ params: { execId: 'e', stepName: 's' }, query: { after: 'not-a-date' } }),
        auth,
      );
      expect(result.status).toBe(400);
    });
  });

  describe('Credential Vault', () => {
    const VALID_VALUES: Record<string, Record<string, unknown>> = {
      bearer: { token: 'tok-123' },
      basic: { username: 'alice', password: 'pw' },
      custom_header: { name: 'X-Secret', value: 'shh' },
      oauth2_client_credentials: {
        tokenUrl: 'https://auth.example.com/token',
        clientId: 'cid',
        clientSecret: 'csecret',
      },
    };

    // ── GET /credentials ──
    describe('GET /credentials', () => {
      it('returns an empty list when no credentials exist', async () => {
        const { routes, persistence, auth } = createFixture();
        const receivedCalls: unknown[] = [];
        persistence.listCredentials = async (filter, page) => {
          receivedCalls.push({ filter, page });
          return { items: [] };
        };
        const route = findRoute(routes, 'GET', '/credentials')!;
        const result = await route.handler(
          makeReq({ query: { limit: '20', cursor: 'b-cred' } }),
          auth,
        );

        expect(result.status).toBe(200);
        expect(receivedCalls).toEqual([
          {
            filter: { kind: 'all' },
            page: { limit: 20, cursor: 'b-cred' },
          },
        ]);
        const body = result.body as { credentials: CredentialListItem[] };
        expect(body.credentials).toEqual([]);
      });

      it('ignores an offset parameter and still bounds the page', async () => {
        // Paging is cursor-only. A stray `offset` — from an old client, or a
        // hand-written URL — must not reach the adapter and must not turn into
        // an unbounded read; the default limit still applies.
        const { routes, persistence, auth } = createFixture();
        const receivedCalls: unknown[] = [];
        persistence.listCredentials = async (filter, page) => {
          receivedCalls.push({ filter, page });
          return { items: [] };
        };
        const route = findRoute(routes, 'GET', '/credentials')!;
        const result = await route.handler(
          makeReq({ query: { offset: '40' } }),
          auth,
        );

        expect(result.status).toBe(200);
        expect(receivedCalls).toEqual([
          { filter: { kind: 'all' }, page: { limit: DEFAULT_PAGE } },
        ]);
      });

      it('clamps an oversized limit rather than refusing it', async () => {
        const { routes, persistence, auth } = createFixture();
        const receivedCalls: unknown[] = [];
        persistence.listCredentials = async (_filter, page) => {
          receivedCalls.push(page);
          return { items: [] };
        };
        const route = findRoute(routes, 'GET', '/credentials')!;
        const result = await route.handler(
          makeReq({ query: { limit: '100000' } }),
          auth,
        );

        expect(result.status).toBe(200);
        expect(receivedCalls).toEqual([{ limit: MAX_PAGE }]);
      });

      it('returns summaries ordered by name, including revoked, without values', async () => {
        const { routes, persistence, auth } = createFixture();
        persistence.seedCredential('b-cred', {
          authType: 'bearer',
          values: { token: 't' },
        });
        persistence.seedCredential('a-cred', {
          authType: 'basic',
          values: { username: 'u', password: 'p' },
          status: 'REVOKED',
        });

        const route = findRoute(routes, 'GET', '/credentials')!;
        const result = await route.handler(makeReq(), auth);

        expect(result.status).toBe(200);
        const body = result.body as { credentials: CredentialListItem[] };
        expect(body.credentials.map((c) => c.summary.name)).toEqual(['a-cred', 'b-cred']);
        expect(body.credentials[0]!.summary.status).toBe('REVOKED');
        for (const c of body.credentials) {
          expect(c.summary).not.toHaveProperty('values');
        }
      });
    });

    // ── POST /credentials ──
    describe('POST /credentials', () => {
      it('returns 403 when root credential management is denied', async () => {
        const { routes, auth } = createFixture({
          authorizer: {
            permissions: async () => [],
            visibleFilter: async () => ({ kind: 'all' }),
          },
        });
        const route = findRoute(routes, 'POST', '/credentials')!;
        const result = await route.handler(
          makeReq({ body: { name: 'c1', credType: 'BUILTIN_BEARER', values: { token: 't' } } }),
          auth,
        );

        expect(result.status).toBe(403);
      });

      it('creates a credential for each builtin HTTP credential type', async () => {
        for (const [authType, values] of Object.entries(VALID_VALUES)) {
          const { routes, auth } = createFixture();
          const route = findRoute(routes, 'POST', '/credentials')!;
          const credType = `BUILTIN_${authType.toUpperCase()}`;
          const result = await route.handler(
            makeReq({ body: { name: `cred-${authType}`, credType, values } }),
            auth,
          );

          expect(result.status).toBe(201);
          const body = result.body as CredentialSummary;
          expect(body.name).toBe(`cred-${authType}`);
          expect(body.credType).toBe(credType);
          expect(body.authType).toBe(authType);
          expect(body.status).toBe('ACTIVE');
          expect(body).not.toHaveProperty('values');
        }
      });

      it('sets creation and update timestamps', async () => {
        const { routes, auth } = createFixture();
        const route = findRoute(routes, 'POST', '/credentials')!;
        const result = await route.handler(
          makeReq({ body: { name: 'c1', credType: 'BUILTIN_BEARER', values: { token: 't' } } }),
          auth,
        );

        const body = result.body as CredentialSummary;
        expect(body.createdAt).toBe(body.updatedAt);
      });

      it('ignores browser-supplied status/timestamp fields (anti-spoof)', async () => {
        const { routes, auth } = createFixture();
        const route = findRoute(routes, 'POST', '/credentials')!;
        const result = await route.handler(
          makeReq({
            body: {
              name: 'c1',
              credType: 'BUILTIN_BEARER',
              values: { token: 't' },
              status: 'REVOKED',
              createdAt: 0,
            },
          }),
          auth,
        );

        const body = result.body as CredentialSummary;
        expect(body.status).toBe('ACTIVE');
        expect(body.createdAt).not.toBe(0);
      });

      it('returns 400 for a missing body', async () => {
        const { routes, auth } = createFixture();
        const route = findRoute(routes, 'POST', '/credentials')!;
        const result = await route.handler(makeReq(), auth);
        expect(result.status).toBe(400);
      });

      it('returns 400 for a missing name', async () => {
        const { routes, auth } = createFixture();
        const route = findRoute(routes, 'POST', '/credentials')!;
        const result = await route.handler(
          makeReq({ body: { credType: 'BUILTIN_BEARER', values: { token: 't' } } }),
          auth,
        );
        expect(result.status).toBe(400);
      });

      it('returns 400 for an unknown credential type', async () => {
        const { routes, auth } = createFixture();
        const route = findRoute(routes, 'POST', '/credentials')!;
        const result = await route.handler(
          makeReq({ body: { name: 'c1', credType: 'NOPE', values: {} } }),
          auth,
        );
        expect(result.status).toBe(400);
      });

      it('takes the shape from the type, ignoring an authType the client sends', async () => {
        const { routes, auth } = createFixture();
        const route = findRoute(routes, 'POST', '/credentials')!;
        const result = await route.handler(
          makeReq({
            body: { name: 'hook', credType: 'TEST_WEBHOOK_SECRET', authType: 'bearer', values: { value: 's' } },
          }),
          auth,
        );
        expect(result.status).toBe(201);
        expect(result.body).toMatchObject({ credType: 'TEST_WEBHOOK_SECRET', authType: 'secret' });
      });

      it('returns 400 for values that fail the strict schema', async () => {
        const { routes, auth } = createFixture();
        const route = findRoute(routes, 'POST', '/credentials')!;
        const result = await route.handler(
          makeReq({ body: { name: 'c1', credType: 'BUILTIN_BEARER', values: { username: 'u' } } }),
          auth,
        );
        expect(result.status).toBe(400);
      });

      it('returns 409 for a duplicate name', async () => {
        const { routes, auth } = createFixture();
        const route = findRoute(routes, 'POST', '/credentials')!;
        const body = { name: 'dupe', credType: 'BUILTIN_BEARER', values: { token: 't' } };
        const first = await route.handler(makeReq({ body }), auth);
        expect(first.status).toBe(201);
        const second = await route.handler(makeReq({ body }), auth);
        expect(second.status).toBe(409);
      });

      it('returns 401 when unauthenticated', async () => {
        const { routes } = createFixture();
        const route = findRoute(routes, 'POST', '/credentials')!;
        const result = await route.handler(
          makeReq({ body: { name: 'c1', credType: 'BUILTIN_BEARER', values: { token: 't' } } }),
          null, 
        );
        expect(result.status).toBe(401);
      });
    });

    // ── PUT /credentials/:name ──
    describe('PUT /credentials/:name', () => {
      it('returns 403 when the row grants read but not manage', async () => {
        const { routes, persistence, auth } = createFixture({
          authorizer: {
            permissions: async (_ctx, ref) =>
              ref.type === 'credential' ? ['credential:read'] : [],
            visibleFilter: async () => ({ kind: 'all' }),
          },
        });
        persistence.seedCredential('c1', {
          authType: 'bearer',
          values: { token: 'old' },
        });
        const route = findRoute(routes, 'PUT', '/credentials/:name')!;
        const result = await route.handler(
          makeReq({ params: { name: 'c1' }, body: { values: { token: 'new' } } }),
          auth,
        );

        expect(result.status).toBe(403);
      });

      it('replaces values while preserving the creation timestamp', async () => {
        const { routes, persistence, auth } = createFixture();
        persistence.seedCredential('c1', {
          authType: 'bearer',
          values: { token: 'old' },
          createdAt: 1000,
          updatedAt: 1000,
        });

        const route = findRoute(routes, 'PUT', '/credentials/:name')!;
        const result = await route.handler(
          makeReq({ params: { name: 'c1' }, body: { values: { token: 'new' } } }),
          auth,
        );

        expect(result.status).toBe(200);
        const body = result.body as CredentialSummary;
        expect(body.createdAt).toBe(1000);
      });

      it('returns 404 when the credential does not exist', async () => {
        const { routes, auth } = createFixture();
        const route = findRoute(routes, 'PUT', '/credentials/:name')!;
        const result = await route.handler(
          makeReq({ params: { name: 'ghost' }, body: { values: { token: 't' } } }),
          auth,
        );
        expect(result.status).toBe(404);
      });

      it('returns 409 when the credential is revoked', async () => {
        const { routes, persistence, auth } = createFixture();
        persistence.seedCredential('c1', {
          authType: 'bearer',
          values: { token: 't' },
          status: 'REVOKED',
        });
        const route = findRoute(routes, 'PUT', '/credentials/:name')!;
        const result = await route.handler(
          makeReq({ params: { name: 'c1' }, body: { values: { token: 'new' } } }),
          auth,
        );
        expect(result.status).toBe(409);
      });

      it('returns 400 when the body has no values', async () => {
        const { routes, persistence, auth } = createFixture();
        persistence.seedCredential('c1', {
          authType: 'bearer',
          values: { token: 't' },
        });
        const route = findRoute(routes, 'PUT', '/credentials/:name')!;
        const result = await route.handler(
          makeReq({ params: { name: 'c1' }, body: {} }),
          auth,
        );
        expect(result.status).toBe(400);
      });

      it('returns 400 when the new values fail the stored auth type schema', async () => {
        const { routes, persistence, auth } = createFixture();
        persistence.seedCredential('c1', {
          authType: 'basic',
          values: { username: 'user', password: 'password' },
        });
        const route = findRoute(routes, 'PUT', '/credentials/:name')!;
        const result = await route.handler(
          makeReq({ params: { name: 'c1' }, body: { values: { key: 'only' } } }),
          auth,
        );
        expect(result.status).toBe(400);
      });

      it('returns 401 when unauthenticated', async () => {
        const { routes, persistence } = createFixture();
        persistence.seedCredential('c1', {
          authType: 'bearer',
          values: { token: 't' },
        });
        const route = findRoute(routes, 'PUT', '/credentials/:name')!;
        const result = await route.handler(
          makeReq({ params: { name: 'c1' }, body: { values: { token: 'new' } } }),
          null,
        );
        expect(result.status).toBe(401);
      });
    });

    // ── POST /credentials/:name/revoke ──
    describe('POST /credentials/:name/revoke', () => {
      it('revokes an active credential while preserving creation time', async () => {
        const { routes, persistence, auth } = createFixture();
        persistence.seedCredential('c1', {
          authType: 'bearer',
          values: { token: 't' },
          createdAt: 1000,
        });
        const route = findRoute(routes, 'POST', '/credentials/:name/revoke')!;
        const result = await route.handler(
          makeReq({ params: { name: 'c1' } }),
          auth,
        );

        expect(result.status).toBe(200);
        const body = result.body as CredentialSummary;
        expect(body.status).toBe('REVOKED');
        expect(body.createdAt).toBe(1000);
      });

      it('is idempotent: re-revoking does not change the original time', async () => {
        const { routes, persistence, auth } = createFixture();
        persistence.seedCredential('c1', {
          authType: 'bearer',
          values: { token: 't' },
          status: 'REVOKED',
          updatedAt: 5000,
        });
        const route = findRoute(routes, 'POST', '/credentials/:name/revoke')!;
        const result = await route.handler(
          makeReq({ params: { name: 'c1' } }),
          auth,
        );

        expect(result.status).toBe(200);
        const body = result.body as CredentialSummary;
        expect(body.status).toBe('REVOKED');
        expect(body.updatedAt).toBe(5000);
      });

      it('returns 404 when the credential does not exist', async () => {
        const { routes, auth } = createFixture();
        const route = findRoute(routes, 'POST', '/credentials/:name/revoke')!;
        const result = await route.handler(
          makeReq({ params: { name: 'ghost' } }),
          auth,
        );
        expect(result.status).toBe(404);
      });

      it('returns 401 when unauthenticated', async () => {
        const { routes, persistence } = createFixture();
        persistence.seedCredential('c1', {
          authType: 'bearer',
          values: { token: 't' },
        });
        const route = findRoute(routes, 'POST', '/credentials/:name/revoke')!;
        const result = await route.handler(makeReq({ params: { name: 'c1' } }), null);
        expect(result.status).toBe(401);
      });
    });

    
    it('exposes no DELETE /credentials/:name route', () => {
      const { routes } = createFixture();
      expect(findRoute(routes, 'DELETE', '/credentials/:name')).toBeUndefined();
    });

    // It sent a stored secret to any caller-chosen URL, private addresses included.
    it('exposes no POST /credentials/:name/test route', () => {
      const { routes } = createFixture();
      expect(findRoute(routes, 'POST', '/credentials/:name/test')).toBeUndefined();
    });
  });

  // ─── Change notifications ───

  describe('workflow change events', () => {
    it('publishes `workflow_changed` on update, to that workflow\'s topic', async () => {
      const eventBus = new InMemoryEventBus();
      const { routes, persistence, auth } = createFixture({ eventBus });
      seedWorkflow(persistence, 'wf_1', { triggerType: 'TEST_EVENT' });

      const seen: BusEvent[] = [];
      await eventBus.subscribe(workflowTopic('wf_1'), (e) => seen.push(e));

      const route = findRoute(routes, 'PUT', '/workflows/:id')!;
      await route.handler(
        makeReq({ params: { id: 'wf_1' }, body: { name: 'renamed' } }),
        auth,
      );

      expect(seen).toHaveLength(1);
      const event = seen[0] as WorkflowChangeEvent;
      expect(event.event).toBe('workflow_changed');
      expect(event.data.workflowId).toBe('wf_1');
      expect(event.data.change).toBe('updated');
    });

    it('does not reach a different workflow\'s topic', async () => {
      const eventBus = new InMemoryEventBus();
      const { routes, persistence, auth } = createFixture({ eventBus });
      seedWorkflow(persistence, 'wf_1', { triggerType: 'TEST_EVENT' });

      const seen: BusEvent[] = [];
      await eventBus.subscribe(workflowTopic('wf_other'), (e) => seen.push(e));

      const route = findRoute(routes, 'PUT', '/workflows/:id')!;
      await route.handler(makeReq({ params: { id: 'wf_1' }, body: { name: 'x' } }), auth);

      expect(seen).toEqual([]);
    });

    it('echoes the writer\'s X-Workflow-Origin back on the event', async () => {
      const eventBus = new InMemoryEventBus();
      const { routes, persistence, auth } = createFixture({ eventBus });
      seedWorkflow(persistence, 'wf_1', { triggerType: 'TEST_EVENT' });

      const seen: WorkflowChangeEvent[] = [];
      await eventBus.subscribe(workflowTopic('wf_1'), (e) =>
        seen.push(e as WorkflowChangeEvent),
      );

      const route = findRoute(routes, 'PUT', '/workflows/:id')!;
      await route.handler(
        makeReq({
          params: { id: 'wf_1' },
          body: { name: 'x' },
          headers: { 'x-workflow-origin': 'tab-abc' },
        }),
        auth,
      );

      expect(seen[0]?.data.origin).toBe('tab-abc');
    });

    it('omits origin when the writer sent no header', async () => {
      const eventBus = new InMemoryEventBus();
      const { routes, persistence, auth } = createFixture({ eventBus });
      seedWorkflow(persistence, 'wf_1', { triggerType: 'TEST_EVENT' });

      const seen: WorkflowChangeEvent[] = [];
      await eventBus.subscribe(workflowTopic('wf_1'), (e) =>
        seen.push(e as WorkflowChangeEvent),
      );

      const route = findRoute(routes, 'PUT', '/workflows/:id')!;
      await route.handler(makeReq({ params: { id: 'wf_1' }, body: { name: 'x' } }), auth);

      expect(seen[0]?.data.origin).toBeUndefined();
    });

    it('publishes nothing when the runtime has no event bus', async () => {
      const { routes, persistence, auth } = createFixture();
      seedWorkflow(persistence, 'wf_1', { triggerType: 'TEST_EVENT' });

      const route = findRoute(routes, 'PUT', '/workflows/:id')!;
      const result = await route.handler(
        makeReq({ params: { id: 'wf_1' }, body: { name: 'x' } }),
        auth,
      );

      // The write still succeeds — notification is best-effort, never a gate.
      expect(result.status).toBe(200);
    });
  });

  // ─── GET /events ───

  describe('GET /events', () => {
    it('answers 501 when no event bus is configured', async () => {
      const { routes, auth } = createFixture();
      const route = findRoute(routes, 'GET', '/events')!;
      const result = await route.handler(makeReq({ query: { workflows: 'wf_1' } }), auth);
      expect(result.status).toBe(501);
    });

    it('rejects an empty topic set', async () => {
      const { routes, auth } = createFixture({ eventBus: new InMemoryEventBus() });
      const route = findRoute(routes, 'GET', '/events')!;
      const result = await route.handler(makeReq({ query: {} }), auth);
      expect(result.status).toBe(400);
    });

    it('rejects more topics than one connection may carry', async () => {
      const { routes, auth } = createFixture({ eventBus: new InMemoryEventBus() });
      const many = Array.from({ length: 101 }, (_, i) => `wf_${String(i)}`).join(',');
      const route = findRoute(routes, 'GET', '/events')!;
      const result = await route.handler(makeReq({ query: { workflows: many } }), auth);
      expect(result.status).toBe(400);
    });

    it('opens with a `ready` frame naming the accepted topics', async () => {
      const eventBus = new InMemoryEventBus();
      const { routes, persistence, auth } = createFixture({ eventBus });
      seedWorkflow(persistence, 'wf_1', { triggerType: 'TEST_EVENT' });
      seedWorkflow(persistence, 'wf_2', { triggerType: 'TEST_EVENT' });

      const route = findRoute(routes, 'GET', '/events')!;
      const result = await route.handler(
        makeReq({ query: { workflows: 'wf_1,wf_2' } }),
        auth,
      );

      const [ready] = await readFrames(result.stream!, 1);
      expect(ready?.event).toBe('ready');
      expect((ready?.data as { subscribed: string[] }).subscribed.sort()).toEqual([
        'wf_1',
        'wf_2',
      ]);
    });

    it('accepts `?workflows=a&workflows=b` as well as a comma list', async () => {
      const eventBus = new InMemoryEventBus();
      const { routes, persistence, auth } = createFixture({ eventBus });
      seedWorkflow(persistence, 'wf_1', { triggerType: 'TEST_EVENT' });
      seedWorkflow(persistence, 'wf_2', { triggerType: 'TEST_EVENT' });

      const route = findRoute(routes, 'GET', '/events')!;
      const result = await route.handler(
        makeReq({ query: { workflows: ['wf_1', 'wf_2'] } }),
        auth,
      );

      const [ready] = await readFrames(result.stream!, 1);
      expect((ready?.data as { subscribed: string[] }).subscribed.sort()).toEqual([
        'wf_1',
        'wf_2',
      ]);
    });

    it('reports unreadable ids as rejected without failing the connection', async () => {
      const eventBus = new InMemoryEventBus();
      const { routes, persistence, auth } = createFixture({
        eventBus,
        authorizer: {
          // Readable only for wf_1 — wf_2 exists but is not this caller's.
          permissions: async (_ctx, ref) =>
            ref.id === 'wf_1' ? ['workflow:read'] : [],
          visibleFilter: async () => ({ kind: 'all' }),
        },
      });
      seedWorkflow(persistence, 'wf_1', { triggerType: 'TEST_EVENT' });
      seedWorkflow(persistence, 'wf_2', { triggerType: 'TEST_EVENT' });

      const route = findRoute(routes, 'GET', '/events')!;
      const result = await route.handler(
        makeReq({ query: { workflows: 'wf_1,wf_2' } }),
        auth,
      );

      expect(result.status).toBe(200);
      const [ready] = await readFrames(result.stream!, 1);
      const data = ready?.data as { subscribed: string[]; rejected: string[] };
      expect(data.subscribed).toEqual(['wf_1']);
      expect(data.rejected).toEqual(['wf_2']);
    });

    it('streams a change published on a subscribed topic', async () => {
      const eventBus = new InMemoryEventBus();
      const { routes, persistence, auth } = createFixture({ eventBus });
      seedWorkflow(persistence, 'wf_1', { triggerType: 'TEST_EVENT' });

      const route = findRoute(routes, 'GET', '/events')!;
      const result = await route.handler(makeReq({ query: { workflows: 'wf_1' } }), auth);

      // Publish only once the subscription is live; the route subscribes before
      // it yields `ready`, so awaiting the handler is enough.
      const framesPromise = readFrames(result.stream!, 2);
      await eventBus.publish(workflowTopic('wf_1'), {
        event: 'workflow_changed',
        data: { workflowId: 'wf_1', change: 'updated', at: '2026-01-01T00:00:00.000Z' },
      });

      const frames = await framesPromise;
      expect(frames[1]?.event).toBe('workflow_changed');
      expect((frames[1]?.data as { workflowId: string }).workflowId).toBe('wf_1');
    });

    it('releases its bus subscription when the consumer stops reading', async () => {
      const eventBus = new InMemoryEventBus();
      const { routes, persistence, auth } = createFixture({ eventBus });
      seedWorkflow(persistence, 'wf_1', { triggerType: 'TEST_EVENT' });

      const route = findRoute(routes, 'GET', '/events')!;
      const result = await route.handler(makeReq({ query: { workflows: 'wf_1' } }), auth);

      // Breaking out of `for await` runs the generator's `finally`.
      await readFrames(result.stream!, 1);

      // Nothing is listening now, so a later publish reaches no one and — the
      // real point — leaves no listener behind to leak.
      const stray: BusEvent[] = [];
      await eventBus.subscribe(workflowTopic('wf_1'), (e) => stray.push(e));
      await eventBus.publish(workflowTopic('wf_1'), {
        event: 'workflow_changed',
        data: { workflowId: 'wf_1', change: 'updated', at: '2026-01-01T00:00:00.000Z' },
      });
      expect(stray).toHaveLength(1);
    });
  });

  describe('approval routes', () => {
    it('registers /workflows/pending ahead of /workflows/:id', async () => {
      // Order is the contract: the host maps these onto its framework in array
      // order, and a first-match router would otherwise read "pending" as an id
      // and answer 404 for the whole review queue.
      const { routes } = createFixture();
      const order = (path: string) =>
        routes.findIndex((r) => r.method === 'GET' && r.path === path);

      expect(order('/workflows/pending')).toBeGreaterThanOrEqual(0);
      expect(order('/workflows/pending')).toBeLessThan(order('/workflows/:id'));
    });

    it('serves the review queue', async () => {
      const { routes, persistence, auth } = createFixture();
      seedWorkflow(persistence, 'wf_1', {
        triggerType: 'TEST_EVENT',
        status: 'PENDING_APPROVAL',
      });

      const route = findRoute(routes, 'GET', '/workflows/pending')!;
      const result = await route.handler(makeReq({}), auth);

      expect(result.status).toBe(200);
      expect((result.body as { items: unknown[] }).items).toHaveLength(1);
    });

    it('answers 400 rather than throwing when a decision does not apply', async () => {
      const { routes, persistence, auth } = createFixture();
      seedWorkflow(persistence, 'wf_1', { triggerType: 'TEST_EVENT', status: 'ACTIVE' });

      const route = findRoute(routes, 'POST', '/workflows/:id/approve')!;
      const result = await route.handler(makeReq({ params: { id: 'wf_1' } }), auth);

      expect(result.status).toBe(400);
    });
  });

});
