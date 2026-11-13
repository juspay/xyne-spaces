import { describe, it, expect } from 'vitest';
import { testRegistry } from '../testing/test-connector.js';
import { WorkflowRuntime } from './workflow-runtime.js';
import { InMemoryPersistenceAdapter } from '../persistence/in-memory-adapter.js';
import { WorkflowExecutor } from '../engine/workflow-executor.js';
import { ServiceRegistry } from '../engine/service-registry.js';
import type { WorkflowAuthorizer, Action, ResourceRef } from '../authz/types.js';
import type { IdScope } from '../authz/id-scope.js';
import { AccessDeniedError, AllowAllAuthorizer } from '../authz/default.js';
import type { QueueAdapter, SchedulerAdapter } from '../persistence/types.js';
import { ApprovalRequirement } from '../types/approval.js';

interface Ctx {
  userId: string;
}

/**
 * Tenant-style authorizer used across these tests: user `owner` may act on and
 * see the seeded workflows; user `intruder` may do/see nothing. This exercises
 * both the point guard and the list filter through a real authorizer.
 */
class TestAuthorizer implements WorkflowAuthorizer<Ctx, IdScope> {
  constructor(private readonly visibleIds: string[]) {}
  async permissions(ctx: Ctx, _ref: ResourceRef): Promise<readonly Action[]> {
    return ctx.userId === 'owner'
      ? ['workflow:read', 'workflow:update', 'workflow:run', 'workflow:activate', 'execution:read']
      : [];
  }
  async visibleFilter(ctx: Ctx): Promise<IdScope> {
    return ctx.userId === 'owner' ? { kind: 'ids', ids: this.visibleIds } : { kind: 'none' };
  }
}

/** Defaults to AllowAll — explicitly, since the runtime has no implicit default. */
function build(authorizer: WorkflowAuthorizer<Ctx, IdScope> = new AllowAllAuthorizer()) {
  const persistence = new InMemoryPersistenceAdapter();
  const queue: QueueAdapter = { async enqueue() {} };
  const scheduler: SchedulerAdapter = { async schedule() {}, async unschedule() {} };
  const services = new ServiceRegistry();
  const connectors = testRegistry();
  const executor = new WorkflowExecutor(persistence, connectors, services);
  const runtime = new WorkflowRuntime<Record<string, unknown>, Ctx, IdScope>({
    persistence,
    queue,
    scheduler,
    services,
    connectors,
    executor,
    authorizer,
    config: { approval: { default: ApprovalRequirement.NOT_REQUIRED } },
  });
  return { runtime, persistence };
}

const owner: Ctx = { userId: 'owner' };
const intruder: Ctx = { userId: 'intruder' };

function seedWf(persistence: InMemoryPersistenceAdapter, id: string, folderId = 'f1') {
  persistence.seedWorkflow({
    id,
    status: 'ACTIVE',
    config: '{}',
    metadata: '{}',
    eventType: 'MANUAL',
    folderId,
  });
}

describe('ACL enforcement', () => {
  it('point read denies a caller the authorizer rejects (closes the IDOR)', async () => {
    const { runtime, persistence } = build(new TestAuthorizer(['wf1']));
    seedWf(persistence, 'wf1');
    await expect(runtime.getWorkflow(intruder, 'wf1')).rejects.toBeInstanceOf(AccessDeniedError);
    const asOwner = await runtime.getWorkflow(owner, 'wf1');
    expect(asOwner.id).toBe('wf1');
  });

  it('point write/run/activate are guarded too', async () => {
    const { runtime, persistence } = build(new TestAuthorizer(['wf1']));
    seedWf(persistence, 'wf1');
    await expect(runtime.updateWorkflow(intruder, 'wf1', { summary: 'x' })).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(runtime.triggerManual(intruder, 'wf1', {})).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(runtime.activateWorkflow(intruder, 'wf1')).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it('attaches the caller permittedActions to a detail read', async () => {
    const { runtime, persistence } = build(new TestAuthorizer(['wf1']));
    seedWf(persistence, 'wf1');
    const wf = await runtime.getWorkflow(owner, 'wf1');
    expect(wf.permittedActions).toContain('workflow:read');
    expect(wf.permittedActions).not.toContain('workflow:delete');
  });

  it('lists are filtered to the visible ids', async () => {
    const { runtime, persistence } = build(new TestAuthorizer(['wf1']));
    seedWf(persistence, 'wf1');
    seedWf(persistence, 'wf2');
    expect((await runtime.listWorkflows(owner, { limit: 100 })).items.map((w) => w.id)).toEqual(['wf1']);
    expect((await runtime.listWorkflows(intruder, { limit: 100 })).items).toHaveLength(0);
  });

  it('invariant: list ⊆ readable — every listed row is one the caller may read', async () => {
    const { runtime, persistence } = build(new TestAuthorizer(['wf1']));
    seedWf(persistence, 'wf1');
    seedWf(persistence, 'wf2');
    for (const row of (await runtime.listWorkflows(owner, { limit: 100 })).items) {
      await expect(runtime.getWorkflow(owner, row.id)).resolves.toBeDefined();
    }
  });

  it('a hidden workflow hides its executions (filter derived from workflow)', async () => {
    const { runtime, persistence } = build(new TestAuthorizer(['wf1']));
    seedWf(persistence, 'wf1');
    seedWf(persistence, 'wf2');
    await persistence.createExecution({ workflowId: 'wf1', status: 'RUNNING', context: '{}' });
    await persistence.createExecution({ workflowId: 'wf2', status: 'RUNNING', context: '{}' });
    const runs = await runtime.listExecutions(owner, {});
    expect(runs.items).toHaveLength(1);
    expect(runs.items[0]?.workflowId).toBe('wf1');
  });

  it('system isolation: system paths never consult the authorizer, and expose no bypass ctx', async () => {
    // There is no SYSTEM sentinel to smuggle into the caller API any more — a
    // caller-facing method takes a real TCtx and always decides. The system
    // trust domain is reached only through its own entry points, which is why
    // this authorizer (which denies everything) is simply never asked.
    let consulted = 0;
    class Counting implements WorkflowAuthorizer<Ctx, IdScope> {
      async permissions(): Promise<readonly Action[]> {
        consulted += 1;
        return [];
      }
      async visibleFilter(): Promise<IdScope> {
        consulted += 1;
        return { kind: 'none' };
      }
    }
    const { runtime, persistence } = build(new Counting());
    persistence.seedWorkflow({
      id: 'wf1',
      status: 'ACTIVE',
      config: JSON.stringify({ trigger: { type: 'EVENT', config: { eventType: 'order.paid' } }, steps: [] }),
      metadata: '{}',
      eventType: 'order.paid',
      folderId: 'f1',
    });

    // The system event-routing path resolves workflows by event scope, not ACL.
    await runtime.dispatchEvent({ type: 'order.paid', payload: {}, metadata: {} });
    expect(consulted).toBe(0);

    // …while the caller API is decided, and denies.
    await expect(runtime.getWorkflow(intruder, 'wf1')).rejects.toBeInstanceOf(AccessDeniedError);
    expect(consulted).toBeGreaterThan(0);
  });

  it('AllowAll permits everything — but only when a host asks for it explicitly', async () => {
    // There is no implicit fallback: `authorizer` is a required option, so
    // turning enforcement off is a visible act that `grep AllowAllAuthorizer`
    // finds. Forgetting it is a type error, not an open door.
    const { runtime, persistence } = build(new AllowAllAuthorizer());
    seedWf(persistence, 'wf1');
    expect((await runtime.getWorkflow(intruder, 'wf1')).id).toBe('wf1');
    expect((await runtime.listWorkflows(intruder, { limit: 100 })).items).toHaveLength(1);
  });
});
