import { describe, it, expect } from 'vitest';
import { testRegistry } from '../testing/test-connector.js';
import { InMemoryPersistenceAdapter } from './in-memory-adapter.js';
import { WorkflowRuntime } from '../runtime/workflow-runtime.js';
import { AllowAllAuthorizer } from '../authz/default.js';
import { SYSTEM } from '../authz/types.js';
import { WorkflowExecutor } from '../engine/workflow-executor.js';
import { ServiceRegistry } from '../engine/service-registry.js';
import type { QueueAdapter, SchedulerAdapter } from './types.js';
import { ApprovalRequirement } from '../types/approval.js';

// ─── Adapter level: folder CRUD + workflow folderId round-trip ───

describe('folders — persistence adapter', () => {
  it('creates folders and lists them', async () => {
    const db = new InMemoryPersistenceAdapter();
    const id = await db.createFolder({ name: 'Marketing', metadata: '{}' });
    const folders = (await db.listFolders({ kind: 'all' }, { limit: 100 })).items;
    expect(folders).toHaveLength(1);
    expect(folders[0]).toMatchObject({ id, name: 'Marketing' });
  });

  it('renames a folder', async () => {
    const db = new InMemoryPersistenceAdapter();
    const id = await db.createFolder({ name: 'Old', metadata: '{}' });
    await db.updateFolder(id, { name: 'New' });
    expect((await db.listFolders({ kind: 'all' }, { limit: 100 })).items[0]?.name).toBe('New');
  });

  it('stores folderId on create and moves it on update', async () => {
    const db = new InMemoryPersistenceAdapter();
    const wfId = await db.createWorkflow({
      status: 'ACTIVE', config: '{}', metadata: '{}', eventType: 'MANUAL', folderId: 'f1',
    });
    expect((await db.getWorkflow(wfId))?.folderId).toBe('f1');
    await db.updateWorkflow(wfId, { folderId: 'f2' });
    expect((await db.getWorkflow(wfId))?.folderId).toBe('f2');
  });

  it('deletes a folder', async () => {
    const db = new InMemoryPersistenceAdapter();
    const id = await db.createFolder({ name: 'Temp', metadata: '{}' });
    await db.deleteFolder(id);
    expect((await db.listFolders({ kind: 'all' }, { limit: 100 })).items).toHaveLength(0);
  });

  it('filters listWorkflows by folderId and reports per-folder counts', async () => {
    const db = new InMemoryPersistenceAdapter();
    const base = { status: 'ACTIVE', config: '{}', metadata: '{}', eventType: 'MANUAL' } as const;
    await db.createWorkflow({ ...base, folderId: 'a' });
    await db.createWorkflow({ ...base, folderId: 'a' });
    await db.createWorkflow({ ...base, folderId: 'b' });

    expect((await db.listWorkflows({ kind: 'all' }, { limit: 100 })).items).toHaveLength(3);
    expect((await db.listWorkflows({ kind: 'all' }, { limit: 100, folderId: 'a' })).items).toHaveLength(2);
    expect((await db.listWorkflows({ kind: 'all' }, { limit: 100, folderId: 'b' })).items).toHaveLength(1);

    const counts = await db.countWorkflowsByFolder({ kind: 'all' });
    expect(counts.total).toBe(3);
    expect(counts.byFolder).toEqual({ a: { total: 2, active: 2 }, b: { total: 1, active: 1 } });
  });
});

// ─── Runtime level: folder-exists validation + non-empty delete guard ───

function createRuntime() {
  const persistence = new InMemoryPersistenceAdapter();
  const queue: QueueAdapter = { async enqueue() {} };
  const scheduler: SchedulerAdapter = {
    async schedule() {},
    async unschedule() {},
  };
  const services = new ServiceRegistry();
  const connectors = testRegistry();
  const executor = new WorkflowExecutor(persistence, connectors, services);
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
      approval: { default: ApprovalRequirement.NOT_REQUIRED },
    },
  });
  return { runtime, persistence };
}

describe('folders — runtime', () => {
  it('createFolder is listable; updateFolder renames', async () => {
    const { runtime } = createRuntime();
    const folder = await runtime.createFolder(SYSTEM, { name: 'Ops' });
    expect((await runtime.listFolders(SYSTEM)).items.map((f) => f.id)).toContain(folder.id);
    await runtime.updateFolder(SYSTEM, folder.id, { name: 'Operations' });
    expect((await runtime.listFolders(SYSTEM)).items[0]?.name).toBe('Operations');
  });

  it('blocks deleting a folder that still holds workflows, allows once empty', async () => {
    const { runtime, persistence } = createRuntime();
    const folder = await runtime.createFolder(SYSTEM, { name: 'Holding' });
    persistence.seedWorkflow({
      id: 'wf1',
      status: 'ACTIVE',
      config: '{}',
      metadata: '{}',
      eventType: 'MANUAL',
      folderId: folder.id,
    });

    await expect(runtime.deleteFolder(SYSTEM, folder.id)).rejects.toThrow('not empty');

    // Move the workflow out, then delete succeeds.
    await persistence.updateWorkflow('wf1', { folderId: 'other' });
    await runtime.deleteFolder(SYSTEM, folder.id);
    expect((await runtime.listFolders(SYSTEM)).items.map((f) => f.id)).not.toContain(folder.id);
  });
});
