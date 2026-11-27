import { EMPTY_DEPENDENCY_BATCH, type DependencyBatch, type DependencyTicketView } from './types';

function ticketBatch(batch: DependencyBatch, id: string): DependencyBatch {
  const edges = batch.edges.filter(
    edge => edge.blockerTicketId === id || edge.dependentTicketId === id,
  );
  const ids = new Set([
    id,
    ...edges.flatMap(edge => [edge.blockerTicketId, edge.dependentTicketId]),
  ]);
  const tickets = batch.tickets.filter(ticket => ids.has(ticket.id));
  const boards = new Set(tickets.map(ticket => ticket.boardId));
  return {
    edges,
    tickets,
    boards: batch.boards.filter(board => boards.has(board.id)),
    stages: batch.stages.filter(stage => boards.has(stage.boardId)),
    states: { [id]: batch.states[id] ?? null },
  };
}

type FetchBatch = (ids: string[], signal: AbortSignal) => Promise<DependencyBatch>;

/** A single actor/workspace-scoped subscription, not one HTTP request per card. */
export class DependencyBatchStore {
  private refs = new Map<string, number>();
  private listeners = new Set<() => void>();
  private snapshot: ReadonlyMap<string, DependencyTicketView> = new Map();
  private controller: AbortController | null = null;
  private queued = false;
  private pending = false;
  private disposed = false;

  private fetchBatch: FetchBatch;

  constructor(fetchBatch: FetchBatch) {
    this.fetchBatch = fetchBatch;
  }

  getSnapshot = (): ReadonlyMap<string, DependencyTicketView> => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  retain(ids: readonly string[]): () => void {
    if (this.disposed) throw new Error('Cannot subscribe to a disposed dependency store');
    const unique = [...new Set(ids.filter(Boolean))];
    for (const id of unique) this.refs.set(id, (this.refs.get(id) ?? 0) + 1);
    this.refresh();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      for (const id of unique) {
        const count = (this.refs.get(id) ?? 0) - 1;
        if (count > 0) this.refs.set(id, count);
        else this.refs.delete(id);
      }
      this.publish(new Map([...this.snapshot].filter(([id]) => this.refs.has(id))));
      if (!this.refs.size) this.controller?.abort();
    };
  }

  refresh = (): void => {
    if (this.disposed || !this.refs.size) return;
    if (this.controller) {
      this.pending = true;
      return;
    }
    if (this.queued) return;
    this.queued = true;
    // All subscriptions mounted in a render commit share a batch, including chat cards.
    queueMicrotask(() => {
      this.queued = false;
      if (!this.disposed && this.refs.size) void this.load();
    });
  };

  dispose(): void {
    this.disposed = true;
    this.controller?.abort();
    this.refs.clear();
    this.publish(new Map());
    this.listeners.clear();
  }

  private publish(next: ReadonlyMap<string, DependencyTicketView>): void {
    this.snapshot = next;
    this.listeners.forEach(listener => listener());
  }

  private async load(): Promise<void> {
    const controller = new AbortController();
    this.controller = controller;
    const ids = [...this.refs.keys()].sort();
    try {
      // The server caps a batch at 200. Run serially to bound load on large boards.
      const next = new Map<string, DependencyTicketView>();
      for (let start = 0; start < ids.length; start += 200) {
        if (controller.signal.aborted || this.disposed) break;
        const chunk = ids.slice(start, start + 200);
        const batch = await this.fetchBatch(chunk, controller.signal);
        for (const id of chunk) {
          // Never retain another ticket's title just because it was in a previous read.
          if (this.refs.has(id)) next.set(id, { batch: ticketBatch(batch, id), error: null });
        }
      }
      if (!controller.signal.aborted && !this.disposed) this.publish(next);
    } catch {
      if (!controller.signal.aborted && !this.disposed) {
        // Revoke all cached titles on authorization/read failure; do not keep stale data.
        this.publish(
          new Map(
            [...this.refs.keys()].map(id => [
              id,
              {
                batch: EMPTY_DEPENDENCY_BATCH,
                error: 'Dependencies could not be refreshed. Try again.',
              },
            ]),
          ),
        );
      }
    } finally {
      this.controller = null;
      if (this.pending) {
        this.pending = false;
        this.refresh();
      }
    }
  }
}
