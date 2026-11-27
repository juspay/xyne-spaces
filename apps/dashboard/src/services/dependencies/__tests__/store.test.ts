import { describe, expect, it, vi } from 'vitest';
import { DependencyBatchStore } from '../store';
import type { DependencyBatch, PublicDependencyEdge } from '../types';

const edge = (blockerTicketId: string, dependentTicketId: string): PublicDependencyEdge => ({
  id: `${blockerTicketId}-${dependentTicketId}`,
  kind: 'BLOCKS',
  blockerTicketId,
  dependentTicketId,
  strength: 'SOFT',
  gatedStageId: null,
  satisfiedStageId: null,
  satisfiedAt: null,
  reviewNeededAt: null,
  override: null,
  restricted: false,
});
const batch = (ids: string[], edges: PublicDependencyEdge[] = []): DependencyBatch => ({
  edges,
  tickets: ids.map(id => ({
    id,
    title: `Title ${id}`,
    xyneId: id,
    boardId: `board-${id}`,
    stageName: 'Open',
    assignedTo: null,
    eta: null,
  })),
  boards: ids.map(id => ({ id: `board-${id}`, boardType: 'DEFAULT' })),
  stages: ids.map(id => ({
    id: `stage-${id}`,
    boardId: `board-${id}`,
    name: 'Open',
    sequenceNumber: 0,
    defaultTicketStatusV2: 'NOT_STARTED',
  })),
  states: Object.fromEntries(ids.map(id => [id, { primary: null, blockedBy: [], blocking: [] }])),
});
const flush = async () => {
  for (let i = 0; i < 15; i++) await Promise.resolve();
};
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

describe('actor-scoped dependency batch store', () => {
  it('coalesces subscriptions and deduplicates ticket IDs', async () => {
    const read = vi.fn((ids: string[]) => Promise.resolve(batch(ids)));
    const store = new DependencyBatchStore(read);
    store.retain(['b', 'a', 'a', '']);
    store.retain(['b', 'c']);
    await flush();
    expect(read).toHaveBeenCalledTimes(1);
    expect(read.mock.calls[0]?.[0]).toEqual(['a', 'b', 'c']);
    expect([...store.getSnapshot().keys()]).toEqual(['a', 'b', 'c']);
    store.dispose();
  });

  it('reads serial chunks of at most 200, not concurrent card requests', async () => {
    const first = deferred<DependencyBatch>();
    const read = vi.fn(async (ids: string[]) =>
      read.mock.calls.length === 1 ? first.promise : batch(ids),
    );
    const store = new DependencyBatchStore(read);
    store.retain(Array.from({ length: 401 }, (_, i) => String(i).padStart(3, '0')));
    await flush();
    expect(read).toHaveBeenCalledTimes(1);
    first.resolve(batch(read.mock.calls[0]![0]));
    await flush();
    expect(read.mock.calls.map(call => call[0].length)).toEqual([200, 200, 1]);
    expect(store.getSnapshot().size).toBe(401);
    store.dispose();
  });

  it('retains only each ticket and its dependency endpoints, not unrelated batch titles', async () => {
    const store = new DependencyBatchStore(() =>
      Promise.resolve(batch(['a', 'b', 'c'], [edge('c', 'a')])),
    );
    const release = store.retain(['b']);
    store.retain(['a']);
    await flush();
    expect(
      store
        .getSnapshot()
        .get('a')
        ?.batch.tickets.map(ticket => ticket.id),
    ).toEqual(['a', 'c']);
    expect(
      store
        .getSnapshot()
        .get('a')
        ?.batch.boards.map(board => board.id),
    ).toEqual(['board-a', 'board-c']);
    release();
    expect([...store.getSnapshot().keys()]).toEqual(['a']);
    expect(JSON.stringify([...store.getSnapshot().values()])).not.toContain('Title b');
    store.dispose();
  });

  it('reference-counts overlapping subscriptions and releases idempotently', async () => {
    const store = new DependencyBatchStore(ids => Promise.resolve(batch(ids)));
    const first = store.retain(['a']);
    const second = store.retain(['a']);
    await flush();
    first();
    first();
    expect(store.getSnapshot().has('a')).toBe(true);
    second();
    expect(store.getSnapshot().size).toBe(0);
    store.dispose();
  });

  it('queues one refresh when multiple invalidations happen during a request', async () => {
    const pending = deferred<DependencyBatch>();
    const read = vi.fn(async (ids: string[]) =>
      read.mock.calls.length === 1 ? pending.promise : batch(ids),
    );
    const store = new DependencyBatchStore(read);
    store.retain(['a']);
    await flush();
    store.refresh();
    store.refresh();
    store.retain(['b']);
    pending.resolve(batch(['a']));
    await flush();
    expect(read).toHaveBeenCalledTimes(2);
    expect(read.mock.calls[1]![0]).toEqual(['a', 'b']);
    expect(store.getSnapshot().has('b')).toBe(true);
    store.dispose();
  });

  it('clears all cached titles and classifications after a read or authorization failure', async () => {
    let fail = false;
    const store = new DependencyBatchStore(ids =>
      fail ? Promise.reject(new Error('403')) : Promise.resolve(batch(ids)),
    );
    store.retain(['a']);
    await flush();
    expect(store.getSnapshot().get('a')?.batch.tickets).toHaveLength(1);
    fail = true;
    store.refresh();
    await flush();
    expect(store.getSnapshot().get('a')?.error).toBeTruthy();
    expect(store.getSnapshot().get('a')?.batch).toEqual({
      edges: [],
      tickets: [],
      boards: [],
      stages: [],
      states: {},
    });
    fail = false;
    store.refresh();
    await flush();
    expect(store.getSnapshot().get('a')?.error).toBeNull();
    store.dispose();
  });

  it('does not publish partial chunks if a later chunk fails', async () => {
    const read = vi.fn((ids: string[]) =>
      read.mock.calls.length === 2
        ? Promise.reject(new Error('revoked'))
        : Promise.resolve(batch(ids)),
    );
    const store = new DependencyBatchStore(read);
    store.retain(Array.from({ length: 201 }, (_, i) => String(i)));
    await flush();
    expect(store.getSnapshot().size).toBe(201);
    expect(
      [...store.getSnapshot().values()].every(
        view => view.error && view.batch.tickets.length === 0,
      ),
    ).toBe(true);
    store.dispose();
  });

  it('aborts the last subscriber and ignores a late response', async () => {
    const pending = deferred<DependencyBatch>();
    let signal: AbortSignal | undefined;
    const store = new DependencyBatchStore(async (_ids, next) => {
      signal = next;
      return pending.promise;
    });
    const release = store.retain(['a']);
    await flush();
    release();
    expect(signal?.aborted).toBe(true);
    pending.resolve(batch(['a']));
    await flush();
    expect(store.getSnapshot().size).toBe(0);
    store.dispose();
  });

  it('supports immediate unsubscribe/resubscribe while an aborted request settles', async () => {
    const pending = deferred<DependencyBatch>();
    const read = vi.fn(async (ids: string[]) =>
      read.mock.calls.length === 1 ? pending.promise : batch(ids),
    );
    const store = new DependencyBatchStore(read);
    const release = store.retain(['a']);
    await flush();
    release();
    store.retain(['a']);
    pending.resolve(batch(['a']));
    await flush();
    expect(read).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot().has('a')).toBe(true);
    store.dispose();
  });

  it('disposes without republishing a late result or starting another chunk', async () => {
    const pending = deferred<DependencyBatch>();
    const read = vi.fn(async () => pending.promise);
    const store = new DependencyBatchStore(read);
    store.retain(Array.from({ length: 201 }, (_, i) => String(i)));
    await flush();
    store.dispose();
    pending.resolve(batch(['a']));
    await flush();
    expect(read).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().size).toBe(0);
    expect(() => store.retain(['a'])).toThrow('disposed');
  });

  it('keeps different actor stores isolated', async () => {
    const first = new DependencyBatchStore(ids => Promise.resolve(batch(ids)));
    const second = new DependencyBatchStore(() => Promise.reject(new Error('not authorized')));
    first.retain(['a']);
    second.retain(['a']);
    await flush();
    expect(first.getSnapshot().get('a')?.batch.tickets).toHaveLength(1);
    expect(second.getSnapshot().get('a')?.batch.tickets).toHaveLength(0);
    first.dispose();
    second.dispose();
  });

  it('unsubscribes listeners and does not request unretained IDs', async () => {
    const read = vi.fn((ids: string[]) => Promise.resolve(batch(ids)));
    const store = new DependencyBatchStore(read);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.refresh();
    await flush();
    expect(read).not.toHaveBeenCalled();
    const release = store.retain(['a']);
    await flush();
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    release();
    expect(listener).toHaveBeenCalledTimes(1);
    store.dispose();
  });
});
