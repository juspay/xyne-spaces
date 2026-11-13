import { describe, it, expect } from 'vitest';
import { testRegistry } from '../testing/test-connector.js';
import { WorkflowRuntime } from './workflow-runtime.js';
import { InMemoryPersistenceAdapter } from '../persistence/in-memory-adapter.js';
import { WorkflowExecutor } from '../engine/workflow-executor.js';
import { ServiceRegistry } from '../engine/service-registry.js';
import type { WorkflowAuthorizer, Action, ResourceRef } from '../authz/types.js';
import { FOLDER_ACTIONS, CONTAINER_ACTIONS } from '../authz/types.js';
import type { IdScope } from '../authz/id-scope.js';
import { AccessDeniedError, ResourceNotFoundError } from '../authz/default.js';
import type { QueueAdapter, SchedulerAdapter } from '../persistence/types.js';
import { ApprovalRequirement } from '../types/approval.js';

interface Ctx {
  userId: string;
}

const FOLDER_AND_CONTAINER = [...FOLDER_ACTIONS, ...CONTAINER_ACTIONS] as const;

/** Grants folder + container actions and records every ref it is asked about. */
class RecordingAuthorizer implements WorkflowAuthorizer<Ctx, IdScope> {
  readonly refs: ResourceRef[] = [];
  async permissions(_ctx: Ctx, ref: ResourceRef): Promise<readonly Action[]> {
    this.refs.push(ref);
    return FOLDER_AND_CONTAINER;
  }
  async visibleFilter(): Promise<IdScope> {
    return { kind: 'all' };
  }
  private lastAttributes(): unknown {
    const ref = this.refs.at(-1);
    if (!ref || ref.type === 'root') return undefined;
    return (ref.record as { attributes?: unknown }).attributes;
  }
  last = { attributes: (): unknown => this.lastAttributes() };
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

describe('folder read-side ACL parity', () => {
  it('getFolder returns permittedActions, and the folder’s real attributes reach the authorizer', async () => {
    const authorizer = new RecordingAuthorizer();
    const { runtime, persistence } = build(authorizer);
    const id = await persistence.createFolder({ name: 'Ops', metadata: '{}', attributes: { department: 'sales' } });

    const folder = await runtime.getFolder(ctx, id);
    expect(folder.permittedActions).toEqual(FOLDER_AND_CONTAINER);
    expect(authorizer.refs.at(-1)!.type).toBe('folder');
    expect(authorizer.last.attributes()).toEqual({ department: 'sales' });
  });

  it('updateFolder / deleteFolder guard with the stored record (attributes visible, not a stub)', async () => {
    const authorizer = new RecordingAuthorizer();
    const { runtime, persistence } = build(authorizer);
    const id = await persistence.createFolder({ name: 'Ops', metadata: '{}', attributes: { department: 'eng' } });

    await runtime.updateFolder(ctx, id, { name: 'Ops2' });
    expect(authorizer.last.attributes()).toEqual({ department: 'eng' });

    await runtime.deleteFolder(ctx, id);
    expect(authorizer.last.attributes()).toEqual({ department: 'eng' });
  });

  it('getFolder throws ResourceNotFoundError for a missing folder', async () => {
    const { runtime } = build(new RecordingAuthorizer());
    await expect(runtime.getFolder(ctx, 'nope')).rejects.toBeInstanceOf(ResourceNotFoundError);
  });
});

describe('create is an action on the container', () => {
  /**
   * Grants `folder:create` only inside the folder named by `allowed`; root and
   * every other folder are readable but closed to new children.
   */
  class ContainerGated implements WorkflowAuthorizer<Ctx, IdScope> {
    containers: string[] = [];
    allowed = '';
    async permissions(_c: Ctx, ref: ResourceRef): Promise<readonly Action[]> {
      if (ref.type === 'root') {
        this.containers.push('root');
        return [];
      }
      if (ref.type === 'folder') {
        this.containers.push(ref.id);
        return ref.id === this.allowed ? FOLDER_AND_CONTAINER : FOLDER_ACTIONS;
      }
      return [];
    }
    async visibleFilter(): Promise<IdScope> {
      return { kind: 'all' };
    }
  }

  it('gates a nested folder on its parent — the container, not a fabricated resource', async () => {
    const authorizer = new ContainerGated();
    const { runtime, persistence } = build(authorizer);
    const open = await persistence.createFolder({ name: 'open', metadata: '{}' });
    const closed = await persistence.createFolder({ name: 'closed', metadata: '{}' });
    authorizer.allowed = open;

    const child = await runtime.createFolder(ctx, { name: 'child', parentId: open });
    expect(child.parentId).toBe(open);
    // The authorizer was asked about the *parent folder* — a real resource.
    expect(authorizer.containers).toContain(open);

    await expect(
      runtime.createFolder(ctx, { name: 'nope', parentId: closed }),
    ).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it('gates a top-level folder on `root`', async () => {
    const authorizer = new ContainerGated();
    const { runtime } = build(authorizer);
    await expect(runtime.createFolder(ctx, { name: 'X' })).rejects.toBeInstanceOf(AccessDeniedError);
    expect(authorizer.containers).toContain('root');
  });

  it('display ⇔ enforce: the create decision the UI reads is the one the runtime applies', async () => {
    // The exact invariant the fabricated-draft ref could not express: whatever
    // `getFolder().permittedActions` says about creating here is what create does.
    const authorizer = new ContainerGated();
    const { runtime, persistence } = build(authorizer);
    const openId = await persistence.createFolder({ name: 'open', metadata: '{}' });
    const closedId = await persistence.createFolder({ name: 'closed', metadata: '{}' });
    authorizer.allowed = openId;

    for (const [id, expected] of [[openId, true], [closedId, false]] as const) {
      const shown = (await runtime.getFolder(ctx, id)).permittedActions.includes('folder:create');
      expect(shown).toBe(expected);
      const created = await runtime
        .createFolder(ctx, { name: 'c', parentId: id })
        .then(() => true, () => false);
      expect(created).toBe(shown);
    }
  });

  it('moving a folder needs create on the destination — drag-and-drop cannot bypass the button', async () => {
    const authorizer = new ContainerGated();
    const { runtime, persistence } = build(authorizer);
    const openId = await persistence.createFolder({ name: 'open', metadata: '{}' });
    const closed = await persistence.createFolder({ name: 'closed', metadata: '{}' });
    const moving = await persistence.createFolder({ name: 'moving', metadata: '{}' });
    authorizer.allowed = openId;

    await runtime.updateFolder(ctx, moving, { parentId: openId });
    await expect(
      runtime.updateFolder(ctx, moving, { parentId: closed }),
    ).rejects.toBeInstanceOf(AccessDeniedError);
  });
});

describe('list rows carry per-row permittedActions', () => {
  it('populates each row (fallback: per-item permissions)', async () => {
    const authorizer = new RecordingAuthorizer();
    const { runtime, persistence } = build(authorizer);
    await persistence.createFolder({ name: 'A', metadata: '{}', attributes: { workspaceId: 'w' } });
    await persistence.createFolder({ name: 'B', metadata: '{}', attributes: { workspaceId: 'w' } });

    const folders = (await runtime.listFolders(ctx, { limit: 100 })).items;
    expect(folders).toHaveLength(2);
    expect(folders.every((f) => f.permittedActions?.includes('folder:read'))).toBe(true);
  });

  it('uses permissionsBatch when the authorizer provides it (one round-trip)', async () => {
    class BatchAuth extends RecordingAuthorizer {
      batchCalls = 0;
      async permissionsBatch(_c: Ctx, refs: readonly ResourceRef[]): Promise<ReadonlyArray<readonly Action[]>> {
        this.batchCalls += 1;
        return refs.map(() => ['folder:read'] as Action[]);
      }
    }
    const authorizer = new BatchAuth();
    const { runtime, persistence } = build(authorizer);
    await persistence.createFolder({ name: 'A', metadata: '{}', attributes: { workspaceId: 'w' } });
    await persistence.createFolder({ name: 'B', metadata: '{}', attributes: { workspaceId: 'w' } });

    const folders = (await runtime.listFolders(ctx, { limit: 100 })).items;
    expect(authorizer.batchCalls).toBe(1);
    expect(folders.every((f) => f.permittedActions?.length === 1)).toBe(true);
  });
});
