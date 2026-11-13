import { describe, it, expect } from 'vitest';
import { testRegistry } from '../testing/test-connector.js';
import { WorkflowRuntime } from './workflow-runtime.js';
import { InMemoryPersistenceAdapter } from '../persistence/in-memory-adapter.js';
import { WorkflowExecutor } from '../engine/workflow-executor.js';
import { ServiceRegistry } from '../engine/service-registry.js';
import type { WorkflowAuthorizer, Action } from '../authz/types.js';
import type { IdScope } from '../authz/id-scope.js';
import { AccessDeniedError } from '../authz/default.js';
import type { QueueAdapter, SchedulerAdapter } from '../persistence/types.js';
import { ApprovalRequirement } from '../types/approval.js';

interface Ctx {
  userId: string;
}

/** Thrown by the tripwire authorizer the moment it is consulted. */
class Tripwire extends Error {}

/**
 * Every method fails the instant it consults the authorizer. A caller-facing
 * runtime method that reaches the authorizer therefore rejects with `Tripwire`;
 * one that *forgot* to guard would succeed (or throw something else) — failing
 * the test. This is the guard against a future method silently reopening the
 * hole, which is precisely how `getTopErrors` shipped unauthorized.
 */
class TripwireAuthorizer implements WorkflowAuthorizer<Ctx, IdScope> {
  async permissions(): Promise<readonly Action[]> {
    throw new Tripwire('permissions consulted');
  }
  async visibleFilter(): Promise<IdScope> {
    throw new Tripwire('visibleFilter consulted');
  }
}

/** Denies everything: no actions, and an empty list filter. */
class DenyAllAuthorizer implements WorkflowAuthorizer<Ctx, IdScope> {
  async permissions(): Promise<readonly Action[]> {
    return [];
  }
  async visibleFilter(): Promise<IdScope> {
    return { kind: 'none' };
  }
}

function build(authorizer: WorkflowAuthorizer<Ctx, IdScope>) {
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

const ctx: Ctx = { userId: 'u1' };

describe('ACL coverage — every caller-facing method consults the authorizer', () => {
  it('guards or filters each entry point (tripwire)', async () => {
    const { runtime, persistence } = build(new TripwireAuthorizer());

    persistence.seedWorkflow({
      id: 'wf1',
      status: 'ACTIVE',
      config: JSON.stringify({ trigger: { type: 'MANUAL', config: {} }, steps: [] }),
      metadata: '{}',
      eventType: 'MANUAL',
      folderId: 'f1',
    });
    await persistence.createFolder({ id: 'f1', name: 'F', metadata: '{}' });
    const exId = await persistence.createExecution({ workflowId: 'wf1', status: 'EXTERNAL_WAIT', context: '{}' });

    // [name, thunk] — each must reach the authorizer (→ Tripwire).
    const cases: Array<[string, () => Promise<unknown>]> = [
      ['getWorkflow', () => runtime.getWorkflow(ctx, 'wf1')],
      ['listWorkflows', () => runtime.listWorkflows(ctx, { limit: 100 })],
      ['workflowCounts', () => runtime.workflowCounts(ctx)],
      ['createWorkflow', () => runtime.createWorkflow(ctx, { name: 'n', config: { trigger: { type: 'MANUAL', config: {} }, steps: [] }, folderId: 'f1' })],
      ['updateWorkflow', () => runtime.updateWorkflow(ctx, 'wf1', { summary: 'x' })],
      ['activateWorkflow', () => runtime.activateWorkflow(ctx, 'wf1')],
      ['deactivateWorkflow', () => runtime.deactivateWorkflow(ctx, 'wf1')],
      ['triggerManual', () => runtime.triggerManual(ctx, 'wf1', {})],
      ['listFolders', () => runtime.listFolders(ctx, { limit: 100 })],
      ['getFolder', () => runtime.getFolder(ctx, 'f1')],
      ['capabilities', () => runtime.capabilities(ctx)],
      ['createFolder', () => runtime.createFolder(ctx, { name: 'n' })],
      ['updateFolder', () => runtime.updateFolder(ctx, 'f1', { name: 'n' })],
      ['deleteFolder', () => runtime.deleteFolder(ctx, 'f1')],
      ['moveBatch', () => runtime.moveBatch(ctx, { folders: [{ id: 'f1', parentId: null }], workflows: [] })],
      ['listExecutions', () => runtime.listExecutions(ctx, {})],
      ['listPendingApprovals', () => runtime.listPendingApprovals(ctx)],
      ['getExecutionDetail', () => runtime.getExecutionDetail(ctx, exId)],
      ['getAnalyticsSummary', () => runtime.getAnalyticsSummary(ctx, { since: new Date(0), rangeDays: 7 })],
      ['getTopErrors', () => runtime.getTopErrors(ctx, { limit: 5 })],
      ['resume', () => runtime.resume(ctx, exId, { data: { action: 'approve' } })],
      ['rerunFromStep', () => runtime.rerunFromStep(ctx, exId, 'step')],
      ['cancelExecution', () => runtime.cancelExecution(ctx, exId)],
      ['getStepEvents', () => runtime.getStepEvents(ctx, exId, 'step')],
    ];

    const unguarded: string[] = [];
    for (const [name, thunk] of cases) {
      try {
        await thunk();
        unguarded.push(`${name} (resolved without consulting authorizer)`);
      } catch (err) {
        if (!(err instanceof Tripwire)) {
          unguarded.push(`${name} (threw ${(err as Error).constructor.name}, not authorizer)`);
        }
      }
    }
    expect(unguarded).toEqual([]);
  });
});

describe('ACL — folder guards', () => {
  it('denies folder create / update / delete', async () => {
    const { runtime, persistence } = build(new DenyAllAuthorizer());
    await persistence.createFolder({ id: 'f1', name: 'F', metadata: '{}' });
    await expect(runtime.createFolder(ctx, { name: 'n' })).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(runtime.updateFolder(ctx, 'f1', { name: 'n' })).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(runtime.deleteFolder(ctx, 'f1')).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it('filters the pending-approvals queue to visible workflows', async () => {
    // Sees wf1 only; an approval on wf2 must not appear.
    class OnlyWf1 implements WorkflowAuthorizer<Ctx, IdScope> {
      async permissions(): Promise<readonly Action[]> { return []; }
      async visibleFilter(): Promise<IdScope> { return { kind: 'ids', ids: ['wf1'] }; }
    }
    const { runtime, persistence } = build(new OnlyWf1());
    for (const id of ['wf1', 'wf2']) {
      persistence.seedWorkflow({ id, status: 'ACTIVE', config: '{}', metadata: '{}', eventType: 'MANUAL', folderId: 'f1' });
      await persistence.createExecution({ workflowId: id, status: 'EXTERNAL_WAIT', context: '{}' });
    }
    const approvals = await runtime.listPendingApprovals(ctx);
    expect(approvals.items.every((a) => a.workflowId === 'wf1')).toBe(true);
  });
});
