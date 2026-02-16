import type { Ticket, TicketTag } from '@xyne/shared';

export type CalendarViewMode = 'month' | 'week' | 'day';

export interface CalendarViewProps {
  tickets: Ticket[];
  ticketTags?: Map<string, TicketTag[]>;
  onTicketClick?: (ticket: Ticket) => void;
}
