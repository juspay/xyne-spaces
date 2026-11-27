import type { Ticket, TicketTag } from '@xyne/shared';

export type CalendarViewMode = 'month' | 'week' | 'day';

export interface CalendarViewProps {
  tickets: Ticket[];
  /** Stable saved-view ID when available; otherwise the workspace calendar preference. */
  viewKey?: string;
  ticketTags?: Map<string, TicketTag[]>;
  onTicketClick?: (ticket: Ticket) => void;
}
