import type { Ticket } from '@xyne/shared';

export interface WeekViewProps {
  currentDate: Date;
  tickets: Ticket[];
  onTicketClick: (ticket: Ticket) => void;
}
