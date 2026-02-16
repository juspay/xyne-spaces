import type { Ticket } from '@xyne/shared';

export interface DayTicketsModalProps {
  isOpen: boolean;
  onClose: () => void;
  date: Date;
  tickets: Ticket[];
  onTicketClick: (ticket: Ticket) => void;
}
