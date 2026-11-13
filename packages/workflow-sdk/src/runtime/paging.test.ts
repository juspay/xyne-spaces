import { describe, it, expect } from 'vitest';
import { DEFAULT_PAGE, MAX_PAGE, resolvePage } from './paging.js';
import { InMemoryPersistenceAdapter } from '../persistence/in-memory-adapter.js';

import { WorkflowRuntime } from './workflow-runtime.js';
import { WorkflowExecutor } from '../engine/workflow-executor.js';
import { ServiceRegistry } from '../engine/service-registry.js';
import { AllowAllAuthorizer } from '../authz/default.js';
import { testRegistry } from '../testing/test-connector.js';
import { ApprovalRequirement } from '../types/approval.js';
import type { QueueAdapter, SchedulerAdapter } from '../persistence/types.js';

/** A runtime over a caller-supplied adapter, so a test can watch its traffic. */
function buildRuntime(persistence: InMemoryPersistenceAdapter) {
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
    authorizer: new AllowAllAuthorizer(),
    config: { approval: { default: ApprovalRequirement.NOT_REQUIRED } },
  });
  return { runtime };
}

describe('resolvePage', () => {
  it('bounds a caller that asked for nothing', () => {
    expect(resolvePage()).toEqual({ limit: DEFAULT_PAGE });
    expect(resolvePage({})).toEqual({ limit: DEFAULT_PAGE });
  });

  it('clamps an oversized limit instead of refusing it', () => {
    // An oversized limit is almost always a stale client, not an attack.
    // Serving it at a size the database can take beats a broken screen.
    expect(resolvePage({ limit: 10_000 })).toEqual({ limit: MAX_PAGE });
  });

  it('treats nonsense limits as "no limit given"', () => {
    for (const limit of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(resolvePage({ limit })).toEqual({ limit: DEFAULT_PAGE });
    }
    expect(resolvePage({ limit: 7.9 })).toEqual({ limit: 7 });
  });

  it('drops an empty cursor rather than passing it through', () => {
    // `?cursor=` with nothing after it. An adapter taking it literally would
    // look for a row whose id is '' and return an empty page forever.
    expect(resolvePage({ cursor: '' })).toEqual({ limit: DEFAULT_PAGE });
    expect(resolvePage({ cursor: 'exec_9' })).toEqual({
      limit: DEFAULT_PAGE,
      cursor: 'exec_9',
    });
  });
});

describe('cursor paging — the contract every list keeps', () => {
  const seed = (adapter: InMemoryPersistenceAdapter, n: number): void => {
    for (let i = 0; i < n; i++) {
      adapter.seedWorkflow({
        id: `wf${String(i).padStart(3, '0')}`,
        status: 'ACTIVE',
        config: '{}',
        metadata: '{}',
        eventType: 'MANUAL',
        folderId: 'f1',
      });
    }
  };

  it('walks every row exactly once across pages', async () => {
    const adapter = new InMemoryPersistenceAdapter();
    seed(adapter, 25);

    const seen: string[] = [];
    let cursor: string | undefined;
    let guard = 0;
    do {
      const page = await adapter.listWorkflows(
        { kind: 'all' },
        { limit: 7, ...(cursor !== undefined ? { cursor } : {}) },
      );
      seen.push(...page.items.map((w) => w.id));
      cursor = page.nextCursor;
    } while (cursor !== undefined && ++guard < 20);

    expect(seen).toHaveLength(25);
    expect(new Set(seen).size).toBe(25);
  });

  it('does not offer a cursor once the list is exhausted', async () => {
    // A cursor on an empty tail gives the UI a Load-more that fetches nothing,
    // forever. Exactly-divisible page sizes are where that bug hides.
    const adapter = new InMemoryPersistenceAdapter();
    seed(adapter, 10);

    const page = await adapter.listWorkflows({ kind: 'all' }, { limit: 10 });
    expect(page.items).toHaveLength(10);
    expect(page.nextCursor).toBeUndefined();
  });

  it('keeps paging when the row the cursor names has been deleted', async () => {
    // The seek is positional, not "the row after this id" — rows leave these
    // lists by design.
    const adapter = new InMemoryPersistenceAdapter();
    seed(adapter, 10);

    const first = await adapter.listWorkflows({ kind: 'all' }, { limit: 4 });
    expect(first.items).toHaveLength(4);

    // Whoever the cursor names is gone by the time Load-more is pressed.
    adapter.workflows.delete(first.items[3]!.id);

    const second = await adapter.listWorkflows(
      { kind: 'all' },
      { limit: 4, cursor: first.nextCursor! },
    );

    expect(second.items).toHaveLength(4);
    const seenIds = new Set(first.items.map((w) => w.id));
    expect(second.items.some((w) => seenIds.has(w.id))).toBe(false);
  });

  it('serves nothing for a cursor it did not issue', async () => {
    // A malformed cursor is a caller error, not a vanished row. Quietly serving
    // page one would hide it — and make an infinite query append duplicates.
    const adapter = new InMemoryPersistenceAdapter();
    seed(adapter, 5);

    const page = await adapter.listWorkflows(
      { kind: 'all' },
      { limit: 5, cursor: 'not-a-cursor' },
    );
    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBeUndefined();
  });

  it('keeps a page stable when a row is inserted mid-paging', async () => {
    // The reason paging is cursor-based and not offset-based: with an offset,
    // inserting ahead of the cursor shifts everything down and page two repeats
    // a row page one already showed.
    const adapter = new InMemoryPersistenceAdapter();
    seed(adapter, 6);

    const first = await adapter.listWorkflows({ kind: 'all' }, { limit: 3 });
    seed(adapter, 1); // arrives while the user is reading page one

    const second = await adapter.listWorkflows(
      { kind: 'all' },
      { limit: 3, cursor: first.nextCursor! },
    );

    const overlap = second.items.filter((row) =>
      first.items.some((seenRow) => seenRow.id === row.id),
    );
    expect(overlap).toEqual([]);
  });
});

describe('the cursor tracks the sort order, not the id', () => {
  it('pages a name-ordered list correctly', async () => {
    const adapter = new InMemoryPersistenceAdapter();
    // Ids deliberately ordered opposite to names: paging by id would interleave.
    for (const [id, name] of [['f9', 'Alpha'], ['f5', 'Beta'], ['f1', 'Gamma']] as const) {
      await adapter.createFolder({ id, name, metadata: '{}' });
    }

    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await adapter.listFolders(
        { kind: 'all' },
        { limit: 1, ...(cursor !== undefined ? { cursor } : {}) },
      );
      seen.push(...page.items.map((f) => f.name));
      cursor = page.nextCursor;
    } while (cursor !== undefined);

    expect(seen).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('pages a time-ordered list newest-first across pages', async () => {
    const adapter = new InMemoryPersistenceAdapter();
    for (let i = 0; i < 6; i++) {
      adapter.seedWorkflow({
        id: `wf${i}`,
        status: 'ACTIVE',
        config: '{}',
        metadata: '{}',
        eventType: 'MANUAL',
        folderId: 'f1',
      });
    }

    const seen: Array<{ id: string; at: number }> = [];
    let cursor: string | undefined;
    do {
      const page = await adapter.listWorkflows(
        { kind: 'all' },
        { limit: 2, ...(cursor !== undefined ? { cursor } : {}) },
      );
      seen.push(...page.items.map((w) => ({ id: w.id, at: w.createdAt.getTime() })));
      cursor = page.nextCursor;
    } while (cursor !== undefined);

    expect(seen).toHaveLength(6);
    // The order survives the page boundaries.
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]!.at).toBeLessThanOrEqual(seen[i - 1]!.at);
    }
  });
});

describe('approvals inbox — one query, not 2N+1', () => {
  const buildInbox = (runs: number): InMemoryPersistenceAdapter => {
    const adapter = new InMemoryPersistenceAdapter();
    for (let i = 0; i < runs; i++) {
      const id = `wf${i}`;
      adapter.seedWorkflow({
        id,
        status: 'ACTIVE',
        config: JSON.stringify({
          steps: [{ id: 'approve', type: 'WAIT', title: 'Sign off' }],
        }),
        metadata: JSON.stringify({ name: `Workflow ${i}`, tags: ['ops'] }),
        eventType: 'MANUAL',
        folderId: 'f1',
      });
    }
    return adapter;
  };

  const park = async (adapter: InMemoryPersistenceAdapter, runs: number): Promise<void> => {
    for (let i = 0; i < runs; i++) {
      const execId = await adapter.createExecution({
        workflowId: `wf${i}`,
        status: 'EXTERNAL_WAIT',
        context: '{}',
        attributes: {},
      });
      await adapter.upsertStep(execId, 'approve', {
        status: 'EXTERNAL_WAIT',
        executorType: 'WAIT',
        attributes: {},
      });
    }
  };

  it('projects the joined row the inbox renders', async () => {
    const adapter = buildInbox(1);
    await park(adapter, 1);

    const page = await adapter.listPendingApprovals({ kind: 'all' }, { limit: 10 });

    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      workflowId: 'wf0',
      workflowName: 'Workflow 0',
      // The author's own label wins over the leaf id.
      pausedStepName: 'Sign off',
      pausedNodePath: 'approve',
      tags: ['ops'],
    });
  });

  it('answers the badge with a count, not with a page of rows', async () => {
    const adapter = buildInbox(30);
    await park(adapter, 30);

    // Not clamped to a page size: the badge says 30 while the inbox shows 10.
    expect(await adapter.countPendingApprovals({ kind: 'all' })).toBe(30);
    expect((await adapter.listPendingApprovals({ kind: 'all' }, { limit: 10 })).items).toHaveLength(10);
  });

  it('builds facets from the whole set, not from the page in hand', async () => {
    // Facets derived from a page would offer fewer choices the further someone
    // paged — which is how they came to be derived in the browser instead.
    const adapter = buildInbox(30);
    await park(adapter, 30);

    const facets = await adapter.pendingApprovalFacets({ kind: 'all' });
    expect(facets.workflows).toHaveLength(30);
    expect(facets.stages).toEqual([{ name: 'Sign off', count: 30 }]);
    expect(facets.tags).toEqual(['ops']);
  });

  it('filters in the query, so a page is a page of matches', async () => {
    const adapter = buildInbox(30);
    await park(adapter, 30);

    const page = await adapter.listPendingApprovals(
      { kind: 'all' },
      { limit: 10, workflowIds: ['wf3', 'wf7'] },
    );
    expect(page.items.map((r) => r.workflowId).sort()).toEqual(['wf3', 'wf7']);

    const searched = await adapter.listPendingApprovals(
      { kind: 'all' },
      { limit: 10, search: 'Workflow 11' },
    );
    expect(searched.items.map((r) => r.workflowId)).toEqual(['wf11']);
  });

  it('does not issue more adapter calls as the inbox grows — the N+1 guard', async () => {
    // Rendering the inbox must cost the same whether one run is waiting or a
    // hundred.
    const callsFor = async (runs: number): Promise<number> => {
      const adapter = buildInbox(runs);
      await park(adapter, runs);

      let calls = 0;
      const counting = new Proxy(adapter, {
        get(target, prop, receiver) {
          const value = Reflect.get(target, prop, receiver) as unknown;
          if (typeof value !== 'function') return value;
          return (...args: unknown[]) => {
            calls++;
            return (value as (...a: unknown[]) => unknown).apply(target, args);
          };
        },
      }) as InMemoryPersistenceAdapter;

      const { runtime } = buildRuntime(counting);
      await runtime.listPendingApprovals({ userId: 'u1' }, { limit: 10 });
      return calls;
    };

    const few = await callsFor(5);
    const many = await callsFor(100);

    // Non-zero, so the assertion cannot pass on two zeroes.
    expect(few).toBeGreaterThan(0);
    expect(many).toBe(few);
  });
});
