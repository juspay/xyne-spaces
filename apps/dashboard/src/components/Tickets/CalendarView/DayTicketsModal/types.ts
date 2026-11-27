import type { TicketCalendarDateMode } from '../dateGrouping';
import type { Ticket } from '@xyne/shared';

export interface DayTicketsModalProps {
  isOpen: boolean;
  dateMode?: TicketCalendarDateMode;
  onClose: () => void;
  date: Date;
  tickets: Ticket[];
  onTicketClick: (ticket: Ticket) => void;
}
