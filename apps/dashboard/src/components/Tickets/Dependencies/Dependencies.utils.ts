import type { DependencyPrimaryState } from '@xyne/shared';
import type { DependencyBatch, PublicDependencyEdge } from '../../../services/dependencies/types';

export const dependencyTone = (state: DependencyPrimaryState | null): string => {
  switch (state) {
    case 'Blocked':
      return 'bg-destructive/10 text-destructive border-destructive/30';
    case 'Needs review':
    case 'At risk':
      return 'bg-warning/10 text-warning border-warning/30';
    case 'Unblocked':
      return 'bg-stage-completed text-status-success border-stage-completed-border';
    default:
      return 'bg-muted text-muted-foreground border-border';
  }
};
export const dependencyIcon = (state: DependencyPrimaryState | null): string => {
  switch (state) {
    case 'Blocked':
      return '⊘';
    case 'Needs review':
      return '?';
    case 'At risk':
      return '◷';
    case 'Paused':
      return 'Ⅱ';
    case 'Unblocked':
      return '✓';
    default:
      return '◇';
  }
};

export function dependencyOtherTicket(
  ticketId: string,
  edge: PublicDependencyEdge,
  batch: DependencyBatch,
) {
  const id = edge.blockerTicketId === ticketId ? edge.dependentTicketId : edge.blockerTicketId;
  if (edge.restricted) return undefined;
  return batch.tickets.find(ticket => ticket.id === id);
}

/** Never fall back to an opaque token or an endpoint id when the title is absent. */
export function dependencyOtherLabel(
  ticketId: string,
  edge: PublicDependencyEdge,
  batch: DependencyBatch,
): string {
  const ticket = dependencyOtherTicket(ticketId, edge, batch);
  return ticket ? [ticket.xyneId, ticket.title].filter(Boolean).join(' · ') : 'Restricted ticket';
}
