import type { Ticket } from '@xyne/shared';

export interface CompactTicketBadgeProps {
  ticket: Ticket;
  onClick?: (e?: React.MouseEvent) => void;
}
