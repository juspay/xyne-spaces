import type { MouseEvent, ReactNode } from 'react';
import type { Ticket } from '@xyne/shared';

export interface SubTicketProgress {
  done: number;
  total: number;
}

/** A sub-ticket as the tree lists it; `ticket` is null until it is linked to one. */
export interface SubTicketItem {
  id: string;
  title: string;
  ticket: Ticket | null;
}

export interface SubTicketsToggleProps {
  ticketId: string;
  progress: SubTicketProgress;
  className?: string;
}

/** `item` is a sub-ticket not yet linked to a ticket, `footer` the show-more and collapse line. */
export type SubTicketsListLineKind = 'item' | 'footer';

interface SubTicketsTreeBaseProps {
  ticketId: string;
  total: number;
  /** Called before paint when the tree's height changes, so a virtual list re-measures it. */
  onResize?: () => void;
}

export type SubTicketsTreeProps = SubTicketsTreeBaseProps &
  (
    | {
        layout: 'kanban';
        renderItem: (ticket: Ticket) => ReactNode;
      }
    | {
        layout: 'list';
        /** A linked sub-ticket's row; `connector` is its tree line, for the row to place. */
        renderItem: (ticket: Ticket, connector: ReactNode) => ReactNode;
        /** A line in the rows' columns for anything that is not a linked sub-ticket. */
        renderListLine: (
          content: ReactNode,
          connector: ReactNode,
          kind: SubTicketsListLineKind,
        ) => ReactNode;
      }
  );

export interface SubTicketCardProps {
  ticket: Ticket;
  onOpen: (event: MouseEvent | KeyboardEvent) => void;
}
