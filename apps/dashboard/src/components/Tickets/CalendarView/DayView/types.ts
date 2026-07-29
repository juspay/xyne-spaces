import type { Ticket } from '@xyne/shared';

export interface DayViewProps {
  currentDate: Date;
  tickets: Ticket[];
  onTicketClick: (ticket: Ticket) => void;
}
