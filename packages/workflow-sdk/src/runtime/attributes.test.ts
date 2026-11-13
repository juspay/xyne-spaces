import { describe, it, expect } from 'vitest';
import { testRegistry } from '../testing/test-connector.js';
import { WorkflowRuntime } from './workflow-runtime.js';
import { InMemoryPersistenceAdapter } from '../persistence/in-memory-adapter.js';
import { WorkflowExecutor } from '../engine/workflow-executor.js';
import { ServiceRegistry } from '../engine/service-registry.js';
import { ALL_ACTIONS } from '../authz/types.js';
import type { WorkflowAuthorizer } from '../authz/types.js';
import type { IdScope } from '../authz/id-scope.js';
import { AccessDeniedError, AllowAllAuthorizer } from '../authz/default.js';
import type { QueueAdapter, SchedulerAdapter } from '../persistence/types.js';
import type { WorkflowConfig } from '../types/workflow-config.js';
import { ApprovalRequirement } from '../types/approval.js';

interface Ctx {
  userId: string;
}

const cfg: WorkflowConfig = { trigger: { type: 'MANUAL', config: {} }, steps: [] };
const ctx: Ctx = { userId: 'u' };

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

const team = (a: unknown): string | undefined => (a as { team?: string } | undefined)?.team;

describe('create attributes', () => {
  it('round-trips workflow attributes to the record and the authorizer', async () => {
    const seen: unknown[] = [];
    const authz: WorkflowAuthorizer<Ctx, IdScope> = {
      async permissions(_c, ref) {
        if (ref.type === 'workflow') seen.push(ref.record.attributes);
        return ALL_ACTIONS;
      },
      async visibleFilter(): Promise<IdScope> {
        return { kind: 'all' };
      },
    };
    const { runtime, persistence } = build(authz);
    await persistence.createFolder({ id: 'f1', name: 'F', metadata: '{}' });

    const wf = await runtime.createWorkflow(ctx, {
      name: 'W',
      config: cfg,
      folderId: 'f1',
      attributes: { team: 'sales' },
    });

    // stored opaquely on the record…
    expect((await persistence.getWorkflow(wf.id))?.attributes).toEqual({ team: 'sales' });
    // …surfaced typed on the detail read…
    expect((await runtime.getWorkflow(ctx, wf.id)).attributes).toEqual({ team: 'sales' });
    // …and every later decision about it sees them:
    expect(seen).toContainEqual({ team: 'sales' });
  });

  it('gates creation by the container, which carries its own attributes', async () => {
    // v2: create is decided against the folder, so a host keys create policy off
    // the *container's* attributes — a real resource — rather than off a
    // fabricated stub of the thing that does not exist yet.
    const authz: WorkflowAuthorizer<Ctx, IdScope> = {
      async permissions(_c, ref) {
        if (ref.type === 'folder' && team(ref.record.attributes) !== 'sales') {
          return ['folder:read'];
        }
        return ALL_ACTIONS;
      },
      async visibleFilter(): Promise<IdScope> {
        return { kind: 'all' };
      },
    };
    const { runtime, persistence } = build(authz);
    await persistence.createFolder({ id: 'sales', name: 'Sales', metadata: '{}', attributes: { team: 'sales' } });
    await persistence.createFolder({ id: 'legal', name: 'Legal', metadata: '{}', attributes: { team: 'legal' } });

    await expect(
      runtime.createWorkflow(ctx, { name: 'W', config: cfg, folderId: 'legal' }),
    ).rejects.toBeInstanceOf(AccessDeniedError);

    const ok = await runtime.createWorkflow(ctx, { name: 'W2', config: cfg, folderId: 'sales' });
    expect(ok.id).toBeTruthy();
  });


  it('round-trips folder attributes', async () => {
    const { runtime, persistence } = build();
    const folder = await runtime.createFolder(ctx, { name: 'Ops', attributes: { department: 'sales' } });
    expect(folder.attributes).toEqual({ department: 'sales' });
    const listed = (await persistence.listFolders({ kind: 'all' }, { limit: 100 })).items;
    expect(listed.find((f) => f.id === folder.id)?.attributes).toEqual({ department: 'sales' });
  });

  it('a workflow carries its scope into execution, where no caller exists', async () => {
    // The resource-carried scope: at execution time there is nobody to ask, so
    // credential resolution keys off the workflow's own typed attributes.
    const { runtime, persistence } = build();
    await persistence.createFolder({ id: 'f1', name: 'F', metadata: '{}' });
    const wf = await runtime.createWorkflow(ctx, {
      name: 'W',
      config: cfg,
      folderId: 'f1',
      attributes: { workspaceId: 'ws1' },
    });
    expect((await persistence.getWorkflow(wf.id))?.attributes).toEqual({ workspaceId: 'ws1' });
  });
});
