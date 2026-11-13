import { describe, it, expect } from 'vitest';
import { testRegistry } from '../testing/test-connector.js';
import { createWorkflowRouter } from './workflow-router.js';
import { WorkflowRuntime } from '../runtime/workflow-runtime.js';
import { WorkflowExecutor } from '../engine/workflow-executor.js';
import { InMemoryPersistenceAdapter } from '../persistence/in-memory-adapter.js';
import { ServiceRegistry } from '../engine/service-registry.js';
import { ALL_ACTIONS } from '../authz/types.js';
import type { WorkflowAuthorizer, Action } from '../authz/types.js';
import type { IdScope } from '../authz/id-scope.js';
import type { RouteDefinition, RouteRequest, AuthContext } from './types.js';
import type { QueueAdapter, SchedulerAdapter } from '../persistence/types.js';
import { ApprovalRequirement } from '../types/approval.js';

/**
 * Authorizer keyed on the auth context's userId. `owner` may act on / see the
 * `visibleIds`; anyone else is denied everything (no actions, empty filter).
 * `TCtx` is `unknown` here (matching the default router runtime), so it casts.
 */
class UserAuthorizer implements WorkflowAuthorizer<unknown, IdScope> {
  constructor(private readonly visibleIds: string[]) {}
  private isOwner(ctx: unknown): boolean {
    return (ctx as { userId?: string } | null)?.userId === 'owner';
  }
  async permissions(ctx: unknown): Promise<readonly Action[]> {
    return this.isOwner(ctx) ? ALL_ACTIONS : [];
  }
  async visibleFilter(ctx: unknown): Promise<IdScope> {
    return this.isOwner(ctx) ? { kind: 'ids', ids: this.visibleIds } : { kind: 'none' };
  }
}

function fixture(visibleIds: string[] = ['wf1']) {
  const persistence = new InMemoryPersistenceAdapter();
  const queue: QueueAdapter = { async enqueue() {} };
  const scheduler: SchedulerAdapter = { async schedule() {}, async unschedule() {} };
  const services = new ServiceRegistry();
  const connectors = testRegistry();
  const executor = new WorkflowExecutor(persistence, connectors, services);
  const runtime = new WorkflowRuntime({
    persistence,
    queue,
    scheduler,
    services,
    connectors,
    executor,
    authorizer: new UserAuthorizer(visibleIds),
    config: {
      baseUrl: 'https://api.example.com',
      approval: { default: ApprovalRequirement.NOT_REQUIRED },
    },
  });
  const routes = createWorkflowRouter(runtime, {
    authenticate: () => ({ userId: 'owner', metadata: {} }),
  });
  return { routes, persistence };
}

const owner: AuthContext = { userId: 'owner', metadata: {} };
const intruder: AuthContext = { userId: 'intruder', metadata: {} };

function route(routes: RouteDefinition[], method: string, path: string): RouteDefinition {
  const r = routes.find((x) => x.method === method && x.path === path);
  if (!r) throw new Error(`route not found: ${method} ${path}`);
  return r;
}

function req(overrides?: Partial<RouteRequest>): RouteRequest {
  return { params: {}, query: {}, body: undefined, headers: {}, ...overrides };
}

function seed(persistence: InMemoryPersistenceAdapter, id: string) {
  persistence.seedWorkflow({
    id,
    status: 'ACTIVE',
    eventType: 'MANUAL',
    config: JSON.stringify({ trigger: { type: 'MANUAL', config: {} }, steps: [] }),
    metadata: JSON.stringify({ name: id }),
    summary: null,
    folderId: 'f1',
  });
}

describe('router — authorization', () => {
  it('maps a denied point read to HTTP 403', async () => {
    const { routes, persistence } = fixture();
    seed(persistence, 'wf1');
    const res = await route(routes, 'GET', '/workflows/:id').handler(req({ params: { id: 'wf1' } }), intruder);
    expect(res.status).toBe(403);
    expect((res.body as { error?: string }).error).toMatch(/denied/i);
  });

  it('maps a missing resource to HTTP 404, not a 500', async () => {
    const { routes } = fixture();
    const res = await route(routes, 'GET', '/workflows/:id').handler(req({ params: { id: 'nope' } }), owner);
    expect(res.status).toBe(404);
  });

  it('allows a permitted point read and includes permittedActions in the body', async () => {
    const { routes, persistence } = fixture();
    seed(persistence, 'wf1');
    const res = await route(routes, 'GET', '/workflows/:id').handler(req({ params: { id: 'wf1' } }), owner);
    expect(res.status).toBe(200);
    expect((res.body as { permittedActions?: Action[] }).permittedActions).toContain('workflow:read');
  });

  it('filters the list body to the visible ids for the owner', async () => {
    const { routes, persistence } = fixture(['wf1']);
    seed(persistence, 'wf1');
    seed(persistence, 'wf2');
    const res = await route(routes, 'GET', '/workflows').handler(req(), owner);
    const ids = (res.body as { workflows: Array<{ id: string }> }).workflows.map((w) => w.id);
    expect(ids).toEqual(['wf1']);
  });

  it('returns an empty list body for a caller who can see nothing', async () => {
    const { routes, persistence } = fixture();
    seed(persistence, 'wf1');
    const res = await route(routes, 'GET', '/workflows').handler(req(), intruder);
    expect((res.body as { workflows: unknown[] }).workflows).toHaveLength(0);
  });

  it('guards a mutating action (trigger) with 403', async () => {
    const { routes, persistence } = fixture();
    seed(persistence, 'wf1');
    const res = await route(routes, 'POST', '/workflows/:id/trigger').handler(
      req({ params: { id: 'wf1' }, body: {} }),
      intruder,
    );
    expect(res.status).toBe(403);
  });

  it('derives execution list visibility from workflow visibility', async () => {
    const { routes, persistence } = fixture(['wf1']);
    seed(persistence, 'wf1');
    seed(persistence, 'wf2');
    await persistence.createExecution({ workflowId: 'wf1', status: 'RUNNING', context: '{}' });
    await persistence.createExecution({ workflowId: 'wf2', status: 'RUNNING', context: '{}' });
    const res = await route(routes, 'GET', '/executions').handler(req(), owner);
    const items = (res.body as { items: Array<{ workflowId: string }> }).items;
    expect(items).toHaveLength(1);
    expect(items[0]?.workflowId).toBe('wf1');
  });

  it('GET /capabilities tells the client what it may create at the top level', async () => {
    const { routes } = fixture();
    const asOwner = await route(routes, 'GET', '/capabilities').handler(req(), owner);
    expect((asOwner.body as { permittedActions: Action[] }).permittedActions).toContain('folder:create');

    const asIntruder = await route(routes, 'GET', '/capabilities').handler(req(), intruder);
    expect((asIntruder.body as { permittedActions: Action[] }).permittedActions).toEqual([]);
  });

  it('analytics/top-errors is authorized — it must not leak other tenants’ failures', async () => {
    // Regression: this handler shipped without binding `auth` at all.
    const { routes, persistence } = fixture(['wf1']);
    seed(persistence, 'wf1');
    const res = await route(routes, 'GET', '/analytics/top-errors').handler(req(), intruder);
    expect(res.status).toBe(200);
    expect((res.body as { topErrors: unknown[] }).topErrors).toEqual([]);
  });
});
