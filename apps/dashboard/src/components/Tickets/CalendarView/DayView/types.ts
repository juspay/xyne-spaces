import type { TicketCalendarDateMode } from '../dateGrouping';
import type { Ticket } from '@xyne/shared';

export interface DayViewProps {
  currentDate: Date;
  dateMode?: TicketCalendarDateMode;
  tickets: Ticket[];
  onTicketClick: (ticket: Ticket) => void;
}
