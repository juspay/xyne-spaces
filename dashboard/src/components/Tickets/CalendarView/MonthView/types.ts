import type { Ticket } from '@xyne/shared';

export interface MonthViewProps {
  currentDate: Date;
  tickets: Ticket[];
  onTicketClick: (ticket: Ticket) => void;
}
