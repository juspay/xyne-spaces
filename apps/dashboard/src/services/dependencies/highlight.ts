import type { DependencyBatch } from './types';

/** Only currently readable endpoint summaries can participate in cross-view highlighting. */
export function dependencyHighlightIds(ticketId: string, batch: DependencyBatch): Set<string> {
  const visible = new Set(batch.tickets.map(ticket => ticket.id));
  const result = new Set<string>([ticketId]);
  for (const edge of batch.edges) {
    if (edge.restricted || edge.satisfiedAt !== null) continue;
    const other =
      edge.blockerTicketId === ticketId
        ? edge.dependentTicketId
        : edge.dependentTicketId === ticketId
          ? edge.blockerTicketId
          : null;
    if (other && visible.has(other) && !other.startsWith('restricted:')) result.add(other);
  }
  return result;
}

/** One transient selection, never persisted or shared across authenticated identities. */
export class DependencyHighlightStore {
  private selection: { scope: string; owner: symbol; ids: ReadonlySet<string> } | null = null;
  private listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  contains = (scope: string | null, id: string): boolean =>
    scope !== null && this.selection?.scope === scope && this.selection.ids.has(id);

  activate(scope: string, owner: symbol, ids: ReadonlySet<string>): () => void {
    this.selection = { scope, owner, ids: new Set(ids) };
    this.emit();
    return () => {
      // A stale popup cleanup must not clear a more recent popup's selection.
      if (this.selection?.owner !== owner) return;
      this.selection = null;
      this.emit();
    };
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
